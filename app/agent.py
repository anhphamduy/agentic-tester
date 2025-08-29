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
from app.settings import global_settings, blob_storage, results_writer

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
        return {"suite_id": suite_id_value, "stored": stored, "missing": missing}

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
            temperature=0.1,
            messages=[
                {"role": "system", "content": "Return exact JSON only; no extra text."},
                {"role": "user", "content": prompt},
            ],
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
            "suite_id": suite_id_value,
            "requirements_artifact": f"db://requirements/{suite_id_value}",
        }

    def list_requirement_ids() -> Dict[str, Any]:
        reqs = _SUITE_REQUIREMENTS.get(suite_id_value) or []
        ids = [r.get("id") for r in reqs if isinstance(r, dict) and r.get("id")]
        return {"suite_id": suite_id_value, "ids": ids}

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
            temperature=0.2,
            messages=[
                {
                    "role": "system",
                    "content": "Return exact JSON only; no extra text. Generate compact, testable QA cases with clear steps and expectations.",
                },
                {"role": "user", "content": prompt},
            ],
        )
        raw = resp.choices[0].message.content or "{}"
        try:
            tc_obj = json.loads(raw)
            assert isinstance(tc_obj, dict)
            if "requirement_id" not in tc_obj:
                raise ValueError("Missing 'requirement_id' in JSON output")
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

        return {
            "suite_id": suite_id_value,
            "req_id": req_id,
            "artifact": f"db://testcases/{req_id}",
        }

    def generate_preview_requirements(limit: int = 5) -> Dict[str, Any]:
        """Create a small preview list of requirements without persisting anything."""
        sdir = SESSIONS_ROOT / suite_id_value
        docs_dir = sdir / "docs"
        blocks = []
        for p in sorted(docs_dir.glob("*.txt")):
            txt = _read_text(p, max_chars=20_000)
            blocks.append(f"DOC_NAME: {p.name}\nDOC_TEXT:\n{txt}\nEND_DOC")
        if not blocks:
            raise ValueError("No .txt docs in suite.")
        bundle = "\n\n".join(blocks)

        prompt = f"""
You are a strict requirements extractor creating a SHORT PREVIEW.
From the provided documents, output up to {limit} atomic, testable requirements.

Rules:
- Keep each requirement concise and standalone.
- Preserve original meaning; do not invent details.
- Include the source doc name.
- Use PREVIEW-1..PREVIEW-{limit} as ids.

Return ONLY a JSON array (no markdown):
[
  {{"id":"PREVIEW-1","source":"<doc_name>","text":"<requirement>"}}
]

Documents:
{bundle}
""".strip()

        resp = _oai.chat.completions.create(
            model=global_settings.openai_model,
            temperature=0.1,
            messages=[
                {"role": "system", "content": "Return exact JSON only; no extra text."},
                {"role": "user", "content": prompt},
            ],
        )
        raw = resp.choices[0].message.content or "[]"
        try:
            preview_reqs = json.loads(raw)
            assert isinstance(preview_reqs, list)
        except Exception as e:
            raise ValueError(f"Invalid JSON from preview requirements: {e}")

        return {"suite_id": suite_id_value, "preview_requirements": preview_reqs[:limit]}

    def generate_preview_testcases(requirements: List[Dict[str, Any]], per_req: int = 1) -> Dict[str, Any]:
        """Create a tiny preview of test cases for provided requirement objects."""
        if not requirements:
            return {"suite_id": suite_id_value, "samples": []}
        # Limit total size for cost/latency
        reqs_limited = requirements[: min(len(requirements), 3)]

        req_bundle_lines = []
        for r in reqs_limited:
            rid = r.get("id", "PREVIEW")
            src = r.get("source", "unknown.txt")
            txt = r.get("text", "")
            req_bundle_lines.append(f"ID: {rid}\nSOURCE: {src}\nTEXT: {txt}")
        req_bundle = "\n\n".join(req_bundle_lines)

        prompt = f"""
You are a precise QA engineer creating a SHORT PREVIEW of test cases.
For each requirement below, produce {per_req} concise case.

Return ONLY a JSON object (no markdown):
{{
  "suite_id": "{suite_id_value}",
  "samples": [
    {{"requirement_id": "<id>", "cases": [{{"type": "preview", "title": "<short>", "steps": ["..."], "expected": "..."}}]}}
  ]
}}

Requirements:
{req_bundle}
""".strip()

        resp = _oai.chat.completions.create(
            model=global_settings.openai_model,
            temperature=0.2,
            messages=[
                {"role": "system", "content": "Return exact JSON only; no extra text."},
                {"role": "user", "content": prompt},
            ],
        )
        raw = resp.choices[0].message.content or "{}"
        try:
            samples_obj = json.loads(raw)
            assert isinstance(samples_obj, dict)
        except Exception as e:
            raise ValueError(f"Invalid JSON from preview testcases: {e}")

        return samples_obj

    def ask_user(event_type: str, response_to_user: str) -> Dict[str, Any]:
        """Log a user-facing question to events and terminate the flow.

        Parameters:
        - event_type: currently only supports "sample_confirmation".
        - response_to_user: a short, user-friendly message for the user.

        Returns a payload that includes the token "TERMINATE" to trigger termination.
        """
        allowed_types = {"sample_confirmation"}
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

    # Build per-suite agents with closure-bound tools
    planner_local = AssistantAgent(
        "planner",
        model_client=model_client,
        handoffs=["fetcher", "requirements_extractor", "testcase_writer"],
        tools=[generate_preview_requirements, generate_preview_testcases, ask_user],
        system_message=(
            "You are the planner. Keep outputs tiny and always include suite_id.\n"
            "Decision:\n"
            "- If the latest user message contains the exact token CONTINUE, skip preview and execute full flow: handoff to requirements_extractor, then testcase_writer, then summarize and TERMINATE.\n"
            "- Otherwise, do a preview flow:\n"
            "  1) Parse user input for doc names.\n"
            "  2) Handoff to fetcher with the names.\n"
            "  3) Call generate_preview_requirements(limit=5).\n"
            "  4) Call generate_preview_testcases(requirements=<from step 3>, per_req=1).\n"
            "  5) Return a compact preview: suite_id, a few requirement ids+texts, and one preview testcase per requirement.\n"
            "  6) Call ask_user(event_type=\"sample_confirmation\", response_to_user=\"<1-2 lines>\") to request confirmation; this writes an event and returns TERMINATE.\n"
            "Never paste large content."
        ),
    )

    fetcher_local = AssistantAgent(
        "fetcher",
        model_client=model_client,
        handoffs=["planner", "requirements_extractor"],
        tools=[store_docs_from_blob],
        system_message=(
            "Load docs using store_docs_from_blob(doc_names).\n"
            "Reply only: suite_id, stored, missing. No file content.\n"
            "Then handoff to planner for preview unless explicitly instructed to continue."
        ),
    )

    requirements_extractor_local = AssistantAgent(
        "requirements_extractor",
        model_client=model_client,
        handoffs=["testcase_writer", "planner"],
        tools=[extract_and_store_requirements],
        system_message=(
            "Call extract_and_store_requirements().\n"
            "Reply only: suite_id, requirements_artifact.\n"
            "Then handoff to testcase_writer."
        ),
    )

    testcase_writer_local = AssistantAgent(
        "testcase_writer",
        model_client=model_client,
        handoffs=["planner"],
        tools=[list_requirement_ids, generate_and_store_testcases_for_req],
        system_message=(
            "1) Call list_requirement_ids() to get only IDs.\n"
            "2) For each id, call generate_and_store_testcases_for_req(req_id).\n"
            "3) Output a minimal MANIFEST table with (req_id, artifact) only.\n"
            "Do not inline any test content.\n"
            "Then handoff to planner."
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
)

# Global termination condition
termination = TextMentionTermination("TERMINATE") | HandoffTermination(target="user")


# -----------------------------
# Global wrapper helpers to run with suite context
# -----------------------------
# Removed run_async_with_suite in favor of streaming-only execution for event logging


async def run_stream_with_suite(task: str, suite_id: Optional[str], message_id: Optional[str] = None):
    _message_id = message_id or str(uuid4())
    local_team = make_team_for_suite(suite_id, message_id)
    
    _task_with_id = f"[message_id={_message_id}] {task}"
    async for event in local_team.run_stream(task=_task_with_id):
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
    
    await local_team.save_state()


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
