# swarm_testcase_generator.py
# pip install autogen-agentchat autogen-ext openai
# export OPENAI_API_KEY=...

from __future__ import annotations
import asyncio
import json
import re
from pathlib import Path
from typing import Dict, Any, List, Optional
from uuid import uuid4

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.conditions import TextMentionTermination, HandoffTermination
from autogen_agentchat.teams import Swarm
from autogen_agentchat.ui import Console
from autogen_ext.models.openai import OpenAIChatCompletionClient
from openai import OpenAI
from app.settings import global_settings, blob_storage, results_writer, supabase_client

# -----------------------------
# Storage roots / providers
# -----------------------------
ROOT = Path(__file__).parent
SESSIONS_ROOT = ROOT / "sessions"
SESSIONS_ROOT.mkdir(exist_ok=True)

# Blob storage provider is initialized in settings
_blob_storage = blob_storage

# In-memory per-suite cache for generated requirements (avoids filesystem writes)
_SUITE_REQUIREMENTS: Dict[str, List[Dict[str, Any]]] = {}


def _write_text(path: Path, text: str) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", errors="replace")
    return str(path)


def _read_text(path: Path, max_chars: Optional[int] = None) -> str:
    t = Path(path).read_text(encoding="utf-8", errors="replace")
    if max_chars and len(t) > max_chars:
        t = t[:max_chars] + "\n\n[...truncated...]"
    return t


def _fetch_blob_text(blob_name: str, max_chars: int = 80_000) -> str:
    """Read from configured blob storage. Accepts .txt or .pdf (mapped to .txt)."""
    return _blob_storage.read_text(blob_name, max_chars=max_chars)


# -----------------------------
# Tools (return minimal handles only)
# -----------------------------
_oai = OpenAI(api_key=global_settings.openai_api_key)  # uses OPENAI_API_KEY

# Results writer: provided by settings
_results_writer = results_writer


def make_team_for_suite(bound_suite_id: Optional[str], message_id: Optional[str] = None) -> Swarm:
    suite_id_value = bound_suite_id or "unspecified"

    def store_docs_from_blob(doc_names: List[str]) -> Dict[str, Any]:
        sdir = SESSIONS_ROOT / suite_id_value
        docs_dir = sdir / "docs"
        stored, missing = [], []
        for raw in doc_names:
            name = Path(raw).name
            if name.lower().endswith(".pdf"):
                name = Path(name).with_suffix(".txt").name
            if not name.lower().endswith(".txt"):
                missing.append(raw)
                continue
            try:
                text = _fetch_blob_text(name)
            except FileNotFoundError:
                missing.append(raw)
                continue
            _write_text(docs_dir / name, text)
            stored.append(name)
        return {"stored": stored, "missing": missing}

    def extract_and_store_requirements() -> Dict[str, Any]:
        sdir = SESSIONS_ROOT / suite_id_value
        docs_dir = sdir / "docs"
        blocks = []
        for p in sorted(docs_dir.glob("*.txt")):
            txt = _read_text(p, max_chars=80_000)
            blocks.append(f"DOC_NAME: {p.name}\nDOC_TEXT:\n{txt}\nEND_DOC")
        if not blocks:
            raise ValueError("No .txt docs in suite.")
        bundle = "\n\n".join(blocks)

        prompt = f"""
You are a strict requirements extractor.
From the provided documents, output a DEDUPED list of atomic, verifiable requirements.

Rules:
- Each item must be testable and standalone.
- Keep original meaning; do not add new constraints.
- Include the source doc name for each requirement.
- IDs must be REQ-1, REQ-2, ... in order of appearance.

Return ONLY a JSON array (no markdown):
[
  {{"id":"REQ-1","source":"<doc_name>","text":"<requirement>"}}
]

Documents:
{bundle}
""".strip()

        resp = _oai.chat.completions.create(
            model=global_settings.openai_model,
            messages=[
                {"role": "system", "content": "Return exact JSON only; no extra text."},
                {"role": "user", "content": prompt},
            ],
            reasoning_effort="minimal",
        )
        raw = resp.choices[0].message.content or "[]"
        try:
            reqs = json.loads(raw)
            assert isinstance(reqs, list)
        except Exception as e:
            raise ValueError(f"Invalid JSON from extractor: {e}")

        # Cache per suite
        _SUITE_REQUIREMENTS[suite_id_value] = reqs

        # Persist requirements (best-effort)
        try:
            _results_writer.write_requirements(
                session_id=suite_id_value, requirements=reqs, suite_id=suite_id_value
            )
        except Exception:
            pass

        return {
            "requirements_artifact": f"db://requirements/{suite_id_value}",
        }

    def list_requirement_ids() -> Dict[str, Any]:
        reqs = _SUITE_REQUIREMENTS.get(suite_id_value) or []
        ids = [r.get("id") for r in reqs if isinstance(r, dict) and r.get("id")]
        return {"ids": ids}

    def generate_and_store_testcases_for_req(
        req_id: str, style: str = "json"
    ) -> Dict[str, Any]:
        reqs = _SUITE_REQUIREMENTS.get(suite_id_value) or []

        match = next(
            (r for r in reqs if isinstance(r, dict) and r.get("id") == req_id), None
        )
        if not match:
            raise ValueError(f"Requirement {req_id} not found.")
        source = match.get("source", "unknown.txt")
        text = match.get("text", "")

        prompt = f"""
You are a precise QA engineer. Write three concise, testable cases (happy, edge, negative) for the requirement below.

Return ONLY a JSON object (no markdown, no commentary). Use EXACTLY these fields and types:
{{
  "requirement_id": "{req_id}",
  "source": "{source}",
  "requirement_text": "<brief restatement of the requirement>",
  "cases": [
    {{"type": "happy", "title": "<short title>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}},
    {{"type": "edge", "title": "<short title>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}},
    {{"type": "negative", "title": "<short title>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}}
  ]
}}

Requirement text:
{text}
""".strip()

        resp = _oai.chat.completions.create(
            model=global_settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": "Return exact JSON only; no extra text. Generate compact, testable QA cases with clear steps and expectations.",
                },
                {"role": "user", "content": prompt},
            ],
            reasoning_effort="minimal",
        )
        raw = resp.choices[0].message.content or "{}"
        try:
            tc_obj = json.loads(raw)
            assert isinstance(tc_obj, dict)
            if "requirement_id" not in tc_obj:
                raise ValueError("Missing 'requirement_id' in JSON output")
            # Coerce nested case fields to strings for UI consumption
            try:
                cases = tc_obj.get("cases")
                if isinstance(cases, list):
                    normalized_cases = []
                    for c in cases:
                        if not isinstance(c, dict):
                            # Represent non-dict entries as a string row
                            normalized_cases.append({
                                "type": "info",
                                "title": str(c),
                                "preconditions": "",
                                "steps": str(c),
                                "expected": ""
                            })
                            continue
                        normalized_case = dict(c)
                        # Normalize list fields into single strings
                        for key in ("preconditions", "steps"):
                            val = normalized_case.get(key)
                            if isinstance(val, list):
                                normalized_case[key] = "; ".join(str(x) for x in val)
                            elif val is None:
                                normalized_case[key] = ""
                            else:
                                normalized_case[key] = str(val)
                        # Ensure scalar string fields
                        for key in ("title", "type", "expected"):
                            val = normalized_case.get(key)
                            if val is None:
                                normalized_case[key] = ""
                            elif not isinstance(val, str):
                                normalized_case[key] = str(val)
                        normalized_cases.append(normalized_case)
                    tc_obj["cases"] = normalized_cases
                # Ensure top-level strings as well
                for key in ("requirement_id", "source", "requirement_text"):
                    if key in tc_obj and not isinstance(tc_obj[key], str):
                        tc_obj[key] = str(tc_obj[key])
            except Exception:
                # If normalization fails, keep original but continue
                pass
        except Exception as e:
            raise ValueError(f"Invalid JSON from testcase writer: {e}")

        # Persist testcases (best-effort)
        try:
            _results_writer.write_testcases(
                session_id=suite_id_value,
                req_code=req_id,
                testcases=tc_obj,
                suite_id=suite_id_value,
            )
        except Exception:
            pass

        return "Test cases generated successfully"

    def generate_preview(ask: str | None = None) -> str:
        """Generate a brief, free-form preview of requirements and/or test cases.

        This function:
        - Reads .txt docs from the suite session directory (fetched via blob storage).
        - Prompts the model to decide whether to preview requirements, test cases, or both.
        - Optionally includes a short user ask for additional context.
        - Returns compact, readable text (no strict JSON required).
        """
        sdir = SESSIONS_ROOT / suite_id_value
        docs_dir = sdir / "docs"
        blocks = []
        for p in sorted(docs_dir.glob("*.txt")):
            txt = _read_text(p, max_chars=12_000)
            blocks.append(f"DOC_NAME: {p.name}\nDOC_TEXT:\n{txt}\nEND_DOC")
        if not blocks:
            raise ValueError("No .txt docs in suite.")
        bundle = "\n\n".join(blocks)
        user_ask_section = f"\nShort user ask: {ask}\n" if ask else ""

        prompt = f"""
You are assisting with a SHORT PREVIEW for a test suite.

Guidelines:
- Decide whether to preview requirements, test cases, or both, based on what seems most helpful.
- Keep it under ~200 words, easy to skim.
- If requirements: list a few atomic, verifiable items with brief text and doc names.
- If test cases: provide a few short titles, 1-3 bullet steps, and expected outcomes.
- If unsure, include both sections.
- Do not include large excerpts from the docs.

{user_ask_section}Documents:
{bundle}
""".strip()

        resp = _oai.chat.completions.create(
            model=global_settings.openai_model,
            messages=[
                {"role": "system", "content": "Return a compact, readable preview. No code blocks unless necessary."},
                {"role": "user", "content": prompt},
            ],
            reasoning_effort="minimal",
        )
        return ask_user(event_type="sample_confirmation", response_to_user=resp.choices[0].message.content)

    def generate_direct_testcases_on_docs(limit_per_doc: int = 6) -> str:
        """Generate concise test cases directly from the session docs without prior requirement extraction.

        The model should:
        - Skim each document and propose a handful of high-value test cases.
        - Include short titles, brief steps (1-5 bullets), and expected outcomes.
        - Reference source doc names where helpful.
        - Keep the overall output compact and readable.
        """
        sdir = SESSIONS_ROOT / suite_id_value
        docs_dir = sdir / "docs"
        blocks = []
        for p in sorted(docs_dir.glob("*.txt")):
            txt = _read_text(p, max_chars=16_000)
            blocks.append(f"DOC_NAME: {p.name}\nDOC_TEXT:\n{txt}\nEND_DOC")
        if not blocks:
            raise ValueError("No .txt docs in suite.")
        bundle = "\n\n".join(blocks)

        prompt = f"""
You are a QA engineer. Generate concise, high-value TEST CASES directly from the documents below.

Guidelines:
- No need to extract formal requirements first.
- For each doc, produce up to {limit_per_doc} short cases.
- Use short titles, 1-5 bullet steps, and clear expected outcomes.
- Reference doc names (and sections if obvious) to aid traceability.
- Keep total length reasonable; focus on actionable, verifiable cases.

Documents:
{bundle}
""".strip()

        resp = _oai.chat_completions.create if False else _oai.chat.completions.create(
            model=global_settings.openai_model,
            messages=[
                {"role": "system", "content": "Return a compact, readable set of test cases. No unnecessary boilerplate."},
                {"role": "user", "content": prompt},
            ],
            reasoning_effort="minimal",
        )
        return resp.choices[0].message.content or ""

    def ask_user(event_type: str, response_to_user: str) -> Dict[str, Any]:
        """Log a user-facing question to events and terminate the flow.

        Parameters:
        - event_type: currently only supports "sample_confirmation".
        - response_to_user: a short, user-friendly message for the user.

        Returns a payload that includes the token "TERMINATE" to trigger termination.
        """
        allowed_types = {"sample_confirmation", "quality_confirmation", "requirements_feedback", "requirements_sample_offer", "testcases_sample_offer"}
        if event_type not in allowed_types:
            raise ValueError(f"Unsupported event_type: {event_type}")

        event_payload = {
            "type": "ask_user",
            "event_type": event_type,
            "response_to_user": response_to_user,
            "suite_id": suite_id_value,
        }

        try:
            _results_writer.write_event(
                suite_id=suite_id_value,
                event=event_payload,
                message_id=message_id
            )
        except Exception:
            # Swallow errors to avoid breaking the flow; termination should still occur
            pass

        # Include the explicit token so TextMentionTermination triggers
        return {
            "suite_id": suite_id_value,
            "status": "TERMINATE",
            "TERMINATE": True,
            "event": event_payload,
        }

    def get_requirements_info(question: str) -> Any:
        """Answer a user question about this suite's requirements.

        - Loads cached requirements if present, otherwise queries the DB.
        - If none exist, prompt the user to generate them (ask_user flow).
        - Uses the LLM to answer concisely and cite relevant requirement IDs.
        """
        # Try in-memory cache first
        reqs = _SUITE_REQUIREMENTS.get(suite_id_value)
        # If not cached, query DB (best-effort)
        if not reqs:
            try:
                data = (
                    supabase_client
                    .table("requirements")
                    .select("content")
                    .eq("suite_id", suite_id_value)
                    .execute()
                    .data
                    or []
                )
                reqs = [row.get("content") for row in data if isinstance(row.get("content"), dict)]
            except Exception:
                reqs = []

        # If none exist, ask the user whether to generate requirements now
        if not reqs:
            return ask_user(
                event_type="requirements_sample_offer",
                response_to_user=(
                    "No requirements found for this suite.\n\n"
                    "Actions:\n"
                    "- Generate Requirements Sample (preview a few extracted items)\n"
                    "- Or upload/fetch docs first."
                ),
            )

        # Use LLM to answer based on current requirements
        try:
            brief_list = [
                {
                    "id": r.get("id"),
                    "source": r.get("source"),
                    "text": r.get("text"),
                }
                for r in reqs
                if isinstance(r, dict)
            ]
            context_str = json.dumps(brief_list, ensure_ascii=False)
            if len(context_str) > 8000:
                context_str = context_str[:8000] + "\n...truncated..."

            prompt = (
                "You are answering a question about a set of software requirements.\n"
                "- Cite relevant requirement IDs like REQ-1, REQ-2 in your answer.\n"
                "- If the answer is not present in the requirements, say 'Not found in requirements'.\n"
                "- Be concise.\n\n"
                f"Requirements JSON:\n{context_str}\n\n"
                f"Question:\n{question}"
            )
            resp = _oai.chat.completions.create(
                model=global_settings.openai_model,
                messages=[
                    {
                        "role": "system",
                        "content": "Answer concisely based only on the provided requirements.",
                    },
                    {"role": "user", "content": prompt},
                ],
                reasoning_effort="minimal",
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            return f"Error answering about requirements: {e}"

    def get_testcases_info(question: str) -> Any:
        """Answer a user question about this suite's generated test cases.

        - Queries the DB for all test cases for this suite (best-effort).
        - If none exist, prompt the user to generate them (ask_user flow).
        - Uses the LLM to answer concisely and reference requirement IDs where applicable.
        """
        testcases: List[Dict[str, Any]] = []
        try:
            data = (
                supabase_client
                .table("test_cases")
                .select("content")
                .eq("suite_id", suite_id_value)
                .execute()
                .data
                or []
            )
            testcases = [row.get("content") for row in data if isinstance(row.get("content"), dict)]
        except Exception:
            testcases = []

        if not testcases:
            return ask_user(
                event_type="testcases_sample_offer",
                response_to_user=(
                    "No test cases found for this suite.\n\n"
                    "Actions:\n"
                    "- Generate Test Cases Sample (preview a few cases)\n"
                    "- Or extract requirements first for better quality."
                ),
            )

        try:
            compact_cases: List[Dict[str, Any]] = []
            for tc in testcases:
                rid = tc.get("requirement_id")
                src = tc.get("source")
                cases = tc.get("cases") or []
                for c in cases:
                    if not isinstance(c, dict):
                        continue
                    compact_cases.append(
                        {
                            "requirement_id": rid,
                            "source": src,
                            "type": c.get("type"),
                            "title": c.get("title"),
                            "expected": c.get("expected"),
                        }
                    )

            context_str = json.dumps(compact_cases, ensure_ascii=False)
            if len(context_str) > 8000:
                context_str = context_str[:8000] + "\n...truncated..."

            prompt = (
                "You are answering a question about generated QA test cases.\n"
                "- Reference requirement IDs and case titles/types where relevant.\n"
                "- If the answer is not present, say 'Not found in test cases'.\n"
                "- Be concise.\n\n"
                f"Test cases JSON:\n{context_str}\n\n"
                f"Question:\n{question}"
            )
            resp = _oai.chat.completions.create(
                model=global_settings.openai_model,
                messages=[
                    {
                        "role": "system",
                        "content": "Answer concisely based only on the provided test cases.",
                    },
                    {"role": "user", "content": prompt},
                ],
                reasoning_effort="minimal",
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            return f"Error answering about test cases: {e}"

    # Build per-suite agents with closure-bound tools
    planner_local = AssistantAgent(
        "planner",
        model_client=model_client,
        handoffs=["fetcher", "requirements_extractor", "testcase_writer"],
        tools=[generate_preview, ask_user, get_requirements_info, get_testcases_info],
        system_message=(
            "You are the planner. Keep outputs tiny.\n"
            "Flow:\n"
            "  1) Parse doc names from the user's message.\n"
            "  2) Handoff to fetcher to load the docs.\n"
            "  4) Decide the path based on the user's original intent:\n"
            "     - If the ask requested to generate test cases from the document straight away:\n"
            "       You must ask for a quality choice via ask_user(event_type=\\\"quality_confirmation\\\", response_to_user=\\\"Extract requirements first for better quality?\\\").\n"
            "       On the next reply: if it's 'Yes please', handoff to requirements_extractor. If it's 'CONTINUE', handoff to testcase_writer to generate cases directly from docs.\n"
            "     - Otherwise (no explicit direct test-case request): handoff to requirements_extractor by default.\n"
            "  5) After requirements_extractor finishes, it will ask ask_user(event_type=\\\"requirements_feedback\\\"). Wait for the next user reply.\n"
            "     If the reply is 'CONTINUE', handoff to testcase_writer to generate full test cases; then summarize and write TERMINATE.\n"
            "     If the reply indicates changes or hesitation (anything other than 'CONTINUE'), respond briefly and write TERMINATE.\n"
            "  6) After testcase_writer finishes, respond briefly with a bit of content and the word TERMINATE\n"
            "Notes: Before handing off to requirements_extractor or testcase_writer, you must run generate_preview tool first then ask user for feedback through ask_user sample_confirmation. This should be after any quality_confirmation of course.\n"
            "If the user asks questions about existing requirements or test cases, use get_requirements_info(question=...) or get_testcases_info(question=...) to answer conciesly then write TERMINATE\n"
        ),
    )

    fetcher_local = AssistantAgent(
        "fetcher",
        model_client=model_client,
        handoffs=["planner", "requirements_extractor"],
        tools=[store_docs_from_blob],
        system_message=(
            "Load docs using store_docs_from_blob(doc_names).\n"
            "Reply only: stored, missing. No file content.\n"
            "Then handoff to planner for preview unless explicitly instructed to continue."
        ),
    )

    requirements_extractor_local = AssistantAgent(
        "requirements_extractor",
        model_client=model_client,
        handoffs=["testcase_writer", "planner"],
        tools=[extract_and_store_requirements, ask_user],
        system_message=(
            "Call extract_and_store_requirements().\n"
            "Reply only: requirements_artifact.\n"
            "Then call ask_user(event_type=\"requirements_feedback\", response_to_user=\"Requirements extracted. Proceed to generate test cases now?\") to request confirmation; this writes an event and TERMINATE.\n"
            "After every ask_user(...) call, immediately transfer back to planner (handoff to planner).\n"
            "If the user asks about requirements or test cases information at any time, do not answer; handoff to planner so it can respond using its info tools."
        ),
    )

    testcase_writer_local = AssistantAgent(
        "testcase_writer",
        model_client=model_client,
        handoffs=["planner"],
        tools=[list_requirement_ids, generate_and_store_testcases_for_req, generate_direct_testcases_on_docs],
        system_message=(
            "If asked to generate test cases directly from docs, you must call generate_direct_testcases_on_docs() then transfer back to planner\n"
            "Otherwise: 1) Call list_requirement_ids() to get only IDs.\n"
            "2) For each id, call generate_and_store_testcases_for_req(req_id).\n"
            "Then handoff back to the planner.\n"
            "If the user asks about test cases or requirements information, do not answer; handoff to planner so it can respond using its info tools."
        ),
    )

    return Swarm(
        [
            planner_local,
            fetcher_local,
            requirements_extractor_local,
            testcase_writer_local,
        ],
        termination_condition=termination,
    )


# -----------------------------
# Swarm model client
# -----------------------------
model_client = OpenAIChatCompletionClient(
    model=global_settings.openai_model,
    parallel_tool_calls=False,
    api_key=global_settings.openai_api_key,
    reasoning_effort = "minimal"
)

# Global termination condition
termination = TextMentionTermination("TERMINATE") | HandoffTermination(target="user")


# -----------------------------
# Global wrapper helpers to run with suite context
# -----------------------------
# Removed run_async_with_suite in favor of streaming-only execution for event logging


def _get_suite_agent_state(suite_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Fetch previously saved team state for a suite via results writer."""
    try:
        return _results_writer.get_suite_state(suite_id=suite_id)
    except Exception:
        return None


async def run_stream_with_suite(task: str, suite_id: Optional[str], message_id: Optional[str] = None):
    _message_id = message_id or str(uuid4())
    local_team = make_team_for_suite(suite_id, message_id)
    # Mark suite as chatting/running (best-effort)
    try:
        if suite_id:
            supabase_client.table("test_suites").update({"status": "chatting"}).eq("id", suite_id).execute()
    except Exception as e:
        print(e)
    # Best-effort: load prior team state if the suite exists and has stored state
    try:
        prior_state = _get_suite_agent_state(suite_id)
        if prior_state:
            await local_team.load_state(prior_state)
    except Exception as e:
        # Do not block execution if state loading fails
        print(f"Error loading team state: {e}")
    
    async for event in local_team.run_stream(task=task):
        print(event)
        try:
            _event_payload = json.loads(event.model_dump_json())
            if not _event_payload.get("messages"):
                _results_writer.write_event(
                    suite_id=suite_id, event=_event_payload, message_id=_message_id
                )
        except Exception as e:
            print(f"Error writing event: {e}")
            pass
        yield event

    _results_writer.write_suite_state(suite_id=suite_id, state=await local_team.save_state())
    # Back to idle when finished (best-effort)
    try:
        if suite_id:
            supabase_client.table("test_suites").update({"status": "idle"}).eq("id", suite_id).execute()
    except Exception as e:
        print(f"Error updating suite status to idle: {e}")


# -----------------------------
# Demo runner
# -----------------------------
async def main() -> None:
    # Example user task; pdf names ok (auto-mapped to .txt)
    task = "Generate me test cases for document test.txt"
    local_team = make_team_for_suite("demo-suite")
    await Console(local_team.run_stream(task=task))
    await model_client.close()


if __name__ == "__main__":
    asyncio.run(main())
