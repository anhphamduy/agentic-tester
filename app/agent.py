# swarm_testcase_generator.py
# pip install autogen-agentchat autogen-ext openai
# export OPENAI_API_KEY=...

from __future__ import annotations
import asyncio
import json
import re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Any, List, Optional
from uuid import uuid4
from datetime import datetime, timezone

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.conditions import TextMentionTermination, HandoffTermination
from autogen_agentchat.teams import Swarm
from autogen_agentchat.ui import Console
from autogen_ext.models.openai import OpenAIChatCompletionClient
from openai import AsyncOpenAI, OpenAI
from app.settings import global_settings, blob_storage, results_writer, supabase_client
from app.prompts import (
    PLANNER_SYSTEM_MESSAGE,
    FETCHER_SYSTEM_MESSAGE,
    REQUIREMENTS_EXTRACTOR_SYSTEM_MESSAGE,
    TESTCASE_WRITER_SYSTEM_MESSAGE,
)

# -----------------------------
# Storage roots / providers
# -----------------------------
ROOT = Path(__file__).parent
SESSIONS_ROOT = ROOT / "sessions"
SESSIONS_ROOT.mkdir(exist_ok=True)


class DocumentService:
    """Service responsible for reading uploaded session documents.

    Provides text bundles used by analysis/generation tools.
    """

    def __init__(self, sessions_root: Path) -> None:
        self._sessions_root = sessions_root

    def read_docs_bundle(self, suite_id: str, *, max_chars_per_doc: int = 16000) -> str:
        sdir = self._sessions_root / suite_id
        docs_dir = sdir / "docs"
        blocks: List[str] = []
        try:
            for p in sorted(docs_dir.glob("*.txt")):
                try:
                    txt = _read_text(p, max_chars=max_chars_per_doc)
                except Exception:
                    txt = ""
                blocks.append(f"DOC_NAME: {p.name}\nDOC_TEXT:\n{txt}\nEND_DOC")
        except Exception:
            pass
        return "\n\n".join(blocks)


_doc_service = DocumentService(SESSIONS_ROOT)

# Blob storage provider is initialized in settings
_blob_storage = blob_storage

# In-memory per-suite cache for generated requirements (avoids filesystem writes)
_SUITE_REQUIREMENTS: Dict[str, List[Dict[str, Any]]] = {}
_SUITE_TEST_DESIGN_ID: Dict[str, str] = {}


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
_async_client = AsyncOpenAI(api_key=global_settings.openai_api_key)

# Results writer: provided by settings
_results_writer = results_writer


def make_team_for_suite(
    bound_suite_id: Optional[str], message_id: Optional[str] = None
) -> Swarm:
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

    async def chat_with_user(
        context_history: str, message: str, need_documents: bool
    ) -> str:
        if need_documents:
            bundle = _doc_service.read_docs_bundle(
                suite_id_value, max_chars_per_doc=12_000
            )
        else:
            bundle = ""
            bundle_str = "No document available"
        prompt = f"""
        You are a helpful assistant, you can answer the user's question based on the document and context history.
        {bundle}
        {bundle_str}
        Context History: {context_history}
        Message: {message}
        """
        resp = await _async_client.chat.completions.create(
            model=global_settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": "Return the answer to the user's question in a friendly way",
                },
                {"role": "user", "content": prompt},
            ],
        )
        return resp.choices[0].message.content

    def _increment_suite_version(
        description: Optional[str] = None, source_version: Optional[int] = None
    ) -> Optional[int]:
        """Atomically increment suite-level latest_version by 1.

        - Reads prior agent_state via results_writer.get_suite_state (best-effort)
        - Computes new_version = (prior or 0) + 1
        - Writes merged state with updated latest_version
        - Appends a short entry to version_history with timestamp and description
        - Returns the new version if successful, else None
        """
        try:
            prior_state = _get_suite_agent_state(suite_id_value) or {}
            prior_val = prior_state.get("latest_version")
            try:
                prior_int = int(prior_val) if prior_val is not None else 0
            except Exception:
                prior_int = 0
            new_version = prior_int + 1
            merged_state = dict(prior_state)
            merged_state["latest_version"] = int(new_version)
            # Build/append version history separately
            hist: List[Dict[str, Any]] = []
            try:
                if isinstance(prior_state.get("version_history"), list):
                    hist = list(prior_state.get("version_history"))  # type: ignore[list-item]
                elif isinstance(prior_state.get("agent_state"), dict) and isinstance(
                    prior_state.get("agent_state", {}).get("version_history"), list
                ):
                    hist = list(prior_state.get("agent_state", {}).get("version_history"))  # type: ignore[list-item]
            except Exception:
                hist = []
            hist.append(
                {
                    "version": int(new_version),
                    "description": str(description or ""),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )
            _write_full_suite_state(
                suite_id=suite_id_value,
                agent_state=merged_state,
                latest_version=int(new_version),
                version_history=hist,
            )
            # Clone artifacts into this new version to keep versions aligned
            if new_version > 1:
                try:
                    src_v = (
                        int(source_version)
                        if source_version is not None
                        else int(new_version - 1)
                    )
                    _clone_current_artifacts_to_version(src_v, int(new_version))
                except Exception as e:
                    pass
            # Emit a new_version event
            try:
                _results_writer.write_event(
                    suite_id=suite_id_value,
                    event={
                        "type": "new_version",
                        "version": int(new_version),
                        "description": str(description or ""),
                    },
                    message_id=message_id,
                )
            except Exception:
                pass
            return int(new_version)
        except Exception:
            return None

    def extract_requirements() -> Dict[str, Any]:
        bundle = _doc_service.read_docs_bundle(suite_id_value, max_chars_per_doc=80_000)
        if not bundle:
            raise ValueError("No .txt docs in suite.")

        # Gaps analysis is now integrated into the extraction prompt/output

        prompt = f"""
You are an expert requirements analyst.

Instruction for Requirement Analysis

Task:
I have uploaded requirement documents. Please read and analyze the uploaded requirement documents from a business perspective, organizing them into major modules, then breaking them down into detailed functions and corresponding screens. Please create a Requirement List following the rules below.

Rules for Structuring:
- Group requirements hierarchically into: Feature/Module → Function → Screen/Interface.
- Each item should be atomic, testable, and standalone.
- Avoid duplication: if multiple requirements describe the same function, merge them into one.

Summarization Guidelines:
- Summarize each requirement clearly with concise but descriptive names.
- Preserve numbering or IDs if available in the original document (record them in source_section when applicable).
- Do not add new constraints; keep original meaning.

Traceability Requirements:
- For each requirement, include:
  - feature: Feature/Module name
  - function: Function name under the feature
  - screen: Screen/Interface related to the function ("General" if not screen-specific)
  - requirement_description: Requirement description (summarized)
  - source: Source Document Name (filename)
  - source_section: Source section / ID (e.g., heading, paragraph number, or requirement ID)

Gaps Analysis:
- Additionally, produce a short friendly natural-language summary of gaps called gaps_summary:
  - Start with a warm opener (optionally 1–2 light emojis like ✨🔧).
  - Exactly 4 concise points (bullets or short lines). Each point must mention: the document name, the section (or "General"), what the gap is, and a brief suggested action.
  - End with a short, cheerful question offering to skip gaps and continue, or add details. Plain text only. No markdown.

Output Format:
Return STRICT JSON ONLY (no markdown) with EXACTLY this shape:
{{
  "requirements": [
    {{
      "id": "REQ-1",
      "feature": "<Feature / Module>",
      "function": "<Function>",
      "screen": "<Screen / Interface>",
      "requirement_description": "<Requirement Description>",
      "source": "<Source Document Name>",
      "source_section": "<Source Section / ID>"
    }}
  ],
  "gaps_summary": "are there any gaps in the documents and how to improve the documents to address the gaps? answer it as markdown please. short and succint" # empty string if there are no gaps
}}

ID Rules:
- Use REQ-1, REQ-2, ... in order of appearance UNLESS an explicit requirement ID exists in the document; if so, still number sequentially in id, and place the original in source_section.

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
        raw = resp.choices[0].message.content or "{}"
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and isinstance(
                parsed.get("requirements"), list
            ):
                reqs = parsed.get("requirements")
            elif isinstance(parsed, list):
                # Backward-compat: accept a plain array of items
                reqs = parsed
            else:
                raise ValueError("Unexpected JSON shape; expected {requirements:[...]}")
        except Exception as e:
            raise ValueError(f"Invalid JSON from extractor: {e}")

        # Normalize keys for compatibility: ensure both 'requirement_description' and 'text'
        normalized_reqs: List[Dict[str, Any]] = []
        for r in reqs or []:
            if not isinstance(r, dict):
                continue
            item = dict(r)
            normalized_reqs.append(item)

        # Cache per suite
        _SUITE_REQUIREMENTS[suite_id_value] = normalized_reqs

        # Increment suite version and persist requirements (best-effort)
        version_now = _increment_suite_version("Requirements extracted")
        _results_writer.write_requirements(
            session_id=suite_id_value,
            requirements=normalized_reqs,
            suite_id=suite_id_value,
            version=version_now,
        )

        # Use integrated gaps summary from the extractor output if present
        gaps_summary_text = ""
        if isinstance(parsed, dict):
            gs = parsed.get("gaps_summary")
            if isinstance(gs, str):
                gaps_summary_text = gs.strip()

        return ask_user(
            event_type="gaps_follow_up",
            response_to_user=gaps_summary_text
            or "I didn't spot any obvious gaps in the docs. Shall we proceed?",
        )

    def _clone_current_artifacts_to_version(
        source_version: int, target_version: int
    ) -> None:

        rows = (
            supabase_client.table("requirements")
            .select("content")
            .eq("suite_id", suite_id_value)
            .eq("version", source_version)
            .execute()
            .data
            or []
        )
        reqs = [r.get("content") for r in rows if isinstance(r.get("content"), dict)]
        if reqs:
            _results_writer.write_requirements(
                session_id=suite_id_value,
                requirements=reqs,
                suite_id=suite_id_value,
                version=target_version,
            )

        # 2) Test Cases → copy rows that match source_version into target_version if not already present

        td_rows = (
            supabase_client.table("test_designs")
            .select("id, content, testing_type")
            .eq("suite_id", suite_id_value)
            .eq("version", source_version)
            .execute()
            .data
            or []
        )
        if td_rows:
            items = [
                {
                    "content": (td.get("content") or {}),
                    "testing_type": td.get("testing_type"),
                    "version": target_version,
                }
                for td in td_rows
            ]
            _results_writer.write_test_design_bulk(
                session_id=suite_id_value,
                suite_id=suite_id_value,
                items=items,
                version=target_version,
                active=True,
            )

        vp_rows = (
            supabase_client.table("viewpoints")
            .select("content")
            .eq("suite_id", suite_id_value)
            .eq("version", source_version)
            .execute()
            .data
            or []
        )
        if vp_rows:
            items = [vp.get("content") for vp in vp_rows]
            _results_writer.write_viewpoints(
                session_id=suite_id_value,
                suite_id=suite_id_value,
                data=items,
                version=target_version,
            )

        tc_rows = (
            supabase_client.table("test_cases")
            .select("content")
            .eq("suite_id", suite_id_value)
            .eq("version", source_version)
            .execute()
            .data or []
        )
        if tc_rows:
            items = [tc.get("content") for tc in tc_rows]
            _results_writer.write_testcases(
                session_id=suite_id_value,
                suite_id=suite_id_value,
                testcases=items,
                version=target_version,
            )

    async def generate_test_cases(testing_type: str) -> Dict[str, Any]:
        """Generate Integration or Unit Testing cases per requirement using requirements, test design, and viewpoints.

        Parameters:
        - testing_type: "integration" or "unit"
        """

        current_version = _increment_suite_version(f"Generated {testing_type} test cases")
        prev_version = current_version - 1

        requirements_processed = []

        # get all the requirements here per version and suite id from supabase
        requirements = (
            supabase_client.table("requirements")
            .select("*")
            .eq("version", prev_version)
            .eq("suite_id", bound_suite_id)
            .execute()
            .data
        )

        # get all the test designs here per version and suite id from supabase
        flows = []
        test_designs = (
            supabase_client.table("test_designs")
            .select("*")
            .eq("version", prev_version)
            .eq("suite_id", bound_suite_id)
            .execute()
            .data
        )
        if test_designs:
            flows += test_designs[0].get("content").get("flows")

        # get all the viewpoints here per version and suite id from supabase
        viewpoints_res = (
            supabase_client.table("viewpoints")
            .select("*")
            .eq("version", prev_version)
            .eq("suite_id", bound_suite_id)
            .execute()
            .data
        )
        viewpoints = []
        for i in viewpoints_res:
            viewpoints += i.get("content")

        # link test designs and viewpoints to requirements through linked artifacts
        for requirement in requirements:
            requirement = requirement.get("content")
            requirement["linked_test_designs"] = []
            requirement["linked_viewpoints"] = []

            for flow in flows:
                flow_links_artifacts = flow.get("links_artifacts")

                for i in flow_links_artifacts:
                    if i.get("table_name") == "requirements" and requirement.get(
                        i.get("link_key")
                    ) == i.get("link_value"):
                        requirement.get("linked_test_designs").append(flow)

            for viewpoint in viewpoints:
                viewpoint_links_artifacts = viewpoint.get("links_artifacts")
                for i in viewpoint_links_artifacts:
                    if i.get("table_name") == "requirements" and requirement.get(
                        i.get("link_key")
                    ) == i.get("link_value"):
                        requirement.get("linked_viewpoints").append(viewpoint)

            if testing_type == "integration":
                prompt_local = f"""
                You are an expert test designer for Integration Testing (IT).
                
                Input Sources you may use:
                - Requirement Text (below)
                - IT Test Design (flows) if provided in context (not always present)
                - IT Checklist (Viewpoints) if provided in context (not always present)
                @@
                Return ONLY a JSON object (no markdown) with EXACTLY this shape. The array key must be "cases":
                {{
                "cases": [
                    {{
                    "id": "<short id>",
                    "type": "happy|edge|negative|alt",
                    "title": "<short>",
                    "preconditions": ["..."],
                    "steps": ["..."],
                    "expected": "...",
                    "links_artifacts": [
                        {{"table_name": "requirements/viewpoints/test_designs", "link_key": "the field of the id", "link_value": "the actual id value"}},
                        ...
                    ],
                    "flow_description": "<optional: flow description if known>",
                    "scenario": "<optional: checklist scenario/checkpoint>",
                    "name": "<optional: descriptive test case name>",
                    "test_data": [{{"field": "...", "value": "..."}}]
                    }}
                ]
                }}

                Requirement context:
                {json.dumps(requirement, ensure_ascii=False)}
                """.strip()
            elif testing_type == "unit":
                prompt_local = f"""
                You are a precise QA engineer. Write concise, testable cases (happy, edge, negative) for the requirement below.

                Return ONLY a JSON object (no markdown, no commentary). Use EXACTLY these fields and types:
                {{
                "cases": [
                    {{"id": "<short id>", "type": "happy", "title": "<short title>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}},
                    {{"id": "<short id>", "type": "edge", "title": "<short title>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}},
                    {{"id": "<short id>", "type": "negative", "title": "<short title>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}}
                ]
                }}

                Requirement context:
                {json.dumps(requirement, ensure_ascii=False)}
                """.strip()

            requirements_processed.append(
                _async_client.chat.completions.create(
                    model=global_settings.openai_model,
                    messages=[
                        {
                            "role": "system",
                            "content": "Return strict JSON only; no extra text.",
                        },
                        {"role": "user", "content": prompt_local},
                    ],
                    reasoning_effort="minimal",
                    response_format={"type": "json_object"},
                )
            )

        # run all in requirements processed in parallel as it's async
        results = await asyncio.gather(*requirements_processed)
        test_cases = []
        for result in results:
            result_json = result.choices[0].message.content or "{}"
            result_json = json.loads(result_json)
            test_cases += result_json.get("cases")

        _results_writer.write_testcases(
            session_id=suite_id_value,
            testcases=test_cases,
            suite_id=suite_id_value,
            version=current_version,
        )

        return "Test cases generated successfully"

    def restore_suite_version(source_version: int) -> Dict[str, Any]:
        """Create a new version by cloning artifacts from source_version.

        - Increments the suite version with an auto-generated note, cloning from source_version.
        - Returns {new_version, restored_from}.
        """
        description = f"Restored from v{int(source_version)}"
        new_version = _increment_suite_version(
            description, source_version=int(source_version)
        )
        if new_version is None:
            raise ValueError("Failed to create new version during restore")

        # Emit event
        try:
            _results_writer.write_event(
                suite_id=suite_id_value,
                event={
                    "type": "new_version",
                    "version": int(new_version),
                    "description": description,
                },
            )
        except Exception:
            pass

        return {"new_version": int(new_version), "restored_from": int(source_version)}

    async def edit_testcases(
        user_edit_request: str, version_note: str, schema: str
    ) -> Dict[str, Any]:
        """Edit existing test cases suite‑wide based on a free‑form user request.

        Parameters:
        - user_edit_request: Natural language describing how to update existing test cases
          (e.g., rename titles, tweak steps/expected, add/remove cases, align links).
        - version_note: Short note for the newly created suite version capturing this edit.
        - schema: A string of a test case schema

          Expected format of a schema, though it adapt to user edit request please:
          - If integration test cases, schema would be this string, but this should adapt to user edit request if there are any changes in the columns (only links_artifacts and id are required):
                {
                    "id": "<short id>",
                    "type": "happy|edge|negative|alt",
                    "title": "<short>",
                    "preconditions": ["..."],
                    "steps": ["..."],
                    "expected": "...",
                    "links_artifacts": [
                        {"table_name": "requirements/viewpoints/test_designs", "link_key": "the id field of the link table", "link_value": "the actual id value"}
                        ...
                    ],
                    "flow_description": "<optional>",
                    "scenario": "<optional>",
                    "name": "<optional>",
                    "test_data": [{"field": "...", "value": "..."}]
                },
            - If unit test cases, schema would be this string, but this should adapt to user edit request if there are any changes in the columns (only links_artifacts and id are required):
                {
                    "id": "<short id>",
                    "title": "<short>",
                    "steps": ["..."],
                    "expected": "...",
                    "links_artifacts": [
                        {"table_name": "requirements/viewpoints", "link_key": "the id field of the link table", "link_value": "the actual id value"},
                        ...
                    ]
                }
        """
        version_now = _increment_suite_version(version_note)
        prev_version = version_now - 1

        # get all the requirements here per version and suite id from supabase
        requirements = (
            supabase_client.table("requirements")
            .select("*")
            .eq("version", prev_version)
            .eq("suite_id", bound_suite_id)
            .execute()
            .data
        )

        # get all the test designs here per version and suite id from supabase
        flows = []
        test_designs = (
            supabase_client.table("test_designs")
            .select("*")
            .eq("version", prev_version)
            .eq("suite_id", bound_suite_id)
            .execute()
            .data
        )
        if test_designs:
            flows += test_designs[0].get("content").get("flows")

        # get all the viewpoints here per version and suite id from supabase
        viewpoints_res = (
            supabase_client.table("viewpoints")
            .select("*")
            .eq("version", prev_version)
            .eq("suite_id", bound_suite_id)
            .execute()
            .data
        )
        viewpoints = []
        for i in viewpoints_res:
            viewpoints += i.get("content")

        # get all the test cases here per version and suite id from supabase
        test_cases = (
            supabase_client.table("test_cases")
            .select("*")
            .eq("version", prev_version)
            .eq("suite_id", bound_suite_id)
            .execute()
            .data
        )

       
        prompt = f"""
        You are a test case editor. Edit the suite's test cases according to the user's request, preserving traceability and consistency.

        Say explicitly in your reasoning (not in the JSON) which scenario's schema you used and strictly follow it when shaping any added/modified cases.

        User edit request: {user_edit_request}

        Requirements: {requirements}
        Test cases: {test_cases}
        Test designs (flows): {flows}
        Viewpoints: {viewpoints}
        
        link artifacts table name must be either requirements table or viewpoints table or test_designs table, not all

        Return STRICT JSON with the following top-level shape only:
        {{
           "modified": [{{backend_id: "<backend id>", content: {schema}}}, ...],
           "deleted": [a list of backend ids of the test cases to delete],
           "added":   [{schema}, ...]
        }}
        """
        resp = _oai.chat.completions.create(
            model=global_settings.openai_model,
            messages=[
                {"role": "system", "content": "Return strict JSON only; no extra text."},
                {"role": "user", "content": prompt},
            ],
            reasoning_effort="minimal",
            response_format={"type": "json_object"},
        )
        result = json.loads(resp.choices[0].message.content or "{}")

        _results_writer.write_testcases(
            session_id=suite_id_value,
            testcases=result.get("modified", []),
            suite_id=suite_id_value,
            version=version_now,
        )
            

        return "Test cases edited successfully"

    def generate_preview(
        ask: str | None = None, preview_mode: Optional[str] = None
    ) -> str:
        """Generate a brief, free-form preview of requirements and/or test cases.

        Parameters:
        - ask: Optional short user ask for additional context.
        - preview_mode: "requirements" | "testcases" | None. If provided, the preview
          will focus ONLY on the specified type. If None, the model decides what is most helpful.

        Behavior:
        - Reads .txt docs from the suite session directory (fetched via blob storage).
        - Adjusts prompt guidelines based on preview_mode.
        - Returns compact, readable text (no strict JSON required).
        """
        bundle = _doc_service.read_docs_bundle(suite_id_value, max_chars_per_doc=12_000)
        if not bundle:
            raise ValueError("No .txt docs in suite.")

        mode = (preview_mode or "").strip().lower()
        if mode == "requirements":
            guidelines = (
                "- Friendly, user-facing tone.\n"
                "- Show a tiny sample of REQUIREMENTS that look like the real output (3–6 bullets).\n"
                "- Each bullet: REQ-like label + short paraphrase + (source doc).\n"
                "- Add a short section 'What you'll get next' listing: complete deduped REQ-1..n, source mapping, and readiness for Test Design + Viewpoints (integration) or Unit viewpoints.\n"
                "- End with a one-line friendly follow-up question (e.g., 'Shall I extract requirements now, or show another sample?').\n"
                "- Keep under ~160 words; plain text (no code blocks)."
            )
        elif mode == "testcases":
            guidelines = (
                "- Friendly, user-facing tone.\n"
                "- Show a tiny sample of TEST CASES close to the real output (2–4).\n"
                "- For each sample: Title line; 1–3 very short steps; Expected result; cite source doc if helpful.\n"
                "- Add 'What you'll get next': structured JSON per requirement, concise steps/expected, and traceability.\n"
                "- End with a one-line friendly follow-up question (e.g., 'Proceed to generate test cases now, or see another sample?').\n"
                "- Keep under ~160 words; plain text (no code blocks)."
            )
        elif mode == "test_design":
            guidelines = (
                "- Friendly, user-facing tone.\n"
                "- Show a tiny sample of INTEGRATION TEST DESIGN flows (1–3).\n"
                "- Each flow: id, name, short description (A → B → C).\n"
                "- Add 'What you'll get next': sitemap + flows with requirement mapping.\n"
                "- End with a one-line friendly follow-up question (e.g., 'Proceed to generate test design now, or see another sample?').\n"
                "- Keep under ~160 words; plain text."
            )
        elif mode == "viewpoints":
            guidelines = (
                "- Friendly, user-facing tone.\n"
                "- Show a tiny sample of VIEWPOINTS/Checklist items (3–6).\n"
                "- Each item: name and brief scenario; optionally refs (requirements/flows).\n"
                "- Add 'What you'll get next': structured checklist and per-requirement viewpoints.\n"
                "- End with a one-line friendly follow-up question (e.g., 'Proceed to generate viewpoints now, or see another sample?').\n"
                "- Keep under ~160 words; plain text."
            )
        else:
            guidelines = (
                "- Friendly, user-facing tone.\n"
                "- Choose the most helpful preview (requirements or test cases) and show small, realistic samples.\n"
                "- Include a short 'What you'll get next' section aligned with what will be generated.\n"
                "- End with a one-line friendly follow-up question inviting continue or another sample.\n"
                "- Keep under ~160 words; plain text (no code blocks)."
            )

        prompt = f"""
You are assisting with a SHORT, FRIENDLY PREVIEW for a test suite. The preview must look very close to the artifacts that will actually be generated next.

Guidelines:
{guidelines}
- Use short sentences and bullet lists; easy to skim.
- Avoid large excerpts from docs; derive content from them.

Context from user (optional): {ask or ''}

Documents:
{bundle}
""".strip()

        resp = _oai.chat.completions.create(
            model=global_settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": "Return a friendly, user-facing preview rendered as a Markdown table that mirrors the upcoming artifacts. Use short cells. No code blocks. Keep under ~160 words.",
                },
                {"role": "user", "content": prompt},
            ],
            reasoning_effort="minimal",
        )
        preview_text = resp.choices[0].message.content or ""
        return ask_user(
            event_type="sample_confirmation",
            response_to_user=preview_text,
        )

    def generate_direct_testcases_on_docs(limit_per_doc: int = 6) -> str:
        """Generate concise test cases directly from the session docs without prior requirement extraction.

        The model should:
        - Skim each document and propose a handful of high-value test cases.
        - Include short titles, brief steps (1-5 bullets), and expected outcomes.
        - Reference source doc names where helpful.
        - Keep the overall output compact and readable.
        """
        bundle = _doc_service.read_docs_bundle(suite_id_value, max_chars_per_doc=16_000)
        if not bundle:
            raise ValueError("No .txt docs in suite.")

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

        resp = (
            _oai.chat_completions.create
            if False
            else _oai.chat.completions.create(
                model=global_settings.openai_model,
                messages=[
                    {
                        "role": "system",
                        "content": "Return a compact, readable set of test cases. No unnecessary boilerplate.",
                    },
                    {"role": "user", "content": prompt},
                ],
                reasoning_effort="minimal",
            )
        )
        return resp.choices[0].message.content or ""

    def identify_gaps(testing_type: Optional[str] = None) -> str:
        """Analyze docs and return a SHORT natural-language gap summary with sections and actions."""
        bundle = _doc_service.read_docs_bundle(suite_id_value, max_chars_per_doc=12_000)
        if not bundle:
            return "No documents available for gap analysis."

        # Generate a concise, warm, natural-language summary listing Doc + Section + Gap + Action
        prompt = f"""
You are a warm, supportive QA analyst. Based ONLY on the documents, summarize gaps in a super friendly, human tone.

Write:
- A short, upbeat opener (you may use 1–2 light emojis like ✨🔧).
- Exactly 4 friendly points (bullets or short lines). Each point must naturally mention: the document name, the section (or "General" if unclear), what the gap is, and a short suggested action. Feel free to phrase it conversationally.
- End with one short, cheerful question that offers the choice to either skip the gaps and continue, or type extra details to supplement — wording can vary; do not use a fixed phrase.

Keep it warm, reassuring, and concise (~70–110 words). No JSON. No code blocks.

Documents:
{bundle}
""".strip()

        try:
            fr = _oai.chat.completions.create(
                model=global_settings.openai_model,
                messages=[
                    {
                        "role": "system",
                        "content": "Return plain text only in a super friendly tone: a short opener, exactly 4 friendly points (bullets or lines) each covering doc, section, gap, action, then a short cheerful closing question that offers either to skip the gaps and continue, or add/supplement details. Wording can vary. No JSON.",
                    },
                    {"role": "user", "content": prompt},
                ],
                reasoning_effort="minimal",
            )
            friendly_text = fr.choices[0].message.content or (
                "I found a few concise gaps with suggested actions. Shall I proceed and skip these, or would you like to add details?"
            )
            return ask_user(event_type="gaps_follow_up", response_to_user=friendly_text)
        except Exception as e:
            return f"Gap analysis error: {e}"

    def generate_test_design() -> str:
        """Generate Integration Testing Test Design artifacts as STRICT JSON.

        Inputs:
        - Requirement list (from in-memory cache or DB)
        - Uploaded .txt documents for additional context

        Output JSON shape (no status fields):
        {
          "flows": [
            {
              "id": "IT-FLOW-01",
              "name": "...",
              "links_artifacts": [
                {"table_name": "requirements", "link_key": "the field name of the id", "link_value": "the actual id value"},
                {"table_name": "requirements", "link_key": "the ", "link_value": "REQ-2"}
              ],
              "description": "A → B → C"
            }
          ]
        }
        """
        # Gather requirements (from cache, then DB best-effort)
        reqs = _SUITE_REQUIREMENTS.get(suite_id_value)
        if not reqs:
            try:
                data = (
                    supabase_client.table("requirements")
                    .select("req_code, content")
                    .eq("suite_id", suite_id_value)
                    .execute()
                    .data
                    or []
                )
                reqs = []
                for row in data:
                    content = row.get("content") or {}
                    if isinstance(content, dict):
                        # normalize minimal fields for context
                        reqs.append(
                            {
                                "id": content.get("id") or row.get("req_code"),
                                "text": content.get("text"),
                                "source": content.get("source"),
                            }
                        )
            except Exception:
                reqs = []

        # Read docs context via service
        docs_bundle = _doc_service.read_docs_bundle(
            suite_id_value, max_chars_per_doc=16_000
        )

        # Build prompt from user specification
        req_ctx = json.dumps(reqs or [], ensure_ascii=False)
        if len(req_ctx) > 12_000:
            req_ctx = req_ctx[:12_000] + "\n...truncated..."

        prompt = (
            "Integration Testing Test Design Specification\n\n"
            "Role & Task\n"
            "You are an expert test designer for Integration Testing (IT).\n"
            "Your task is to create test design flows based on the Requirement List and the uploaded Requirement Documents.\n\n"
            "Steps to Follow\n"
            "1. Input Understanding\n"
            "   - Read the provided Requirement List (grouped into Features → Functions → Screens).\n"
            "   - Cross-check with the uploaded Requirement Documents.\n"
            "2. Summarized but Not Limited to Requirements\n"
            "   - Summarize requirements into Integration Flows.\n"
            "   - Suggest additional flows where needed for full business coverage.\n"
            "3. Output Format (Mandatory)\n"
            "   - Return STRICT JSON ONLY with the following shape:\n"
            "   {\n"
            '     "flows": [\n'
            "       {\n"
            '         "id": "IT-FLOW-01",\n'
            '         "name": "...",\n'
            '         "links_artifacts": [\n'
            '           {"table_name": "requirements", "link_key": "the field name of the id", "link_value": "the actual id value"}\n'
            "         ],\n"
            '         "description": "A → B → C"\n'
            "       }\n"
            "     ]\n"
            "   }\n\n"
            "Clarity & Traceability\n"
            "- Represent all links via links_artifacts.\n"
            "- You may include suggested flows if needed for coverage, but do not add a status field.\n\n"
            f"Requirement List (JSON):\n{req_ctx}\n\n"
            f"Documents:\n{docs_bundle}\n"
        )

        resp = _oai.chat.completions.create(
            model=global_settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": "Return strict JSON only; no extra text.",
                },
                {"role": "user", "content": prompt},
            ],
            reasoning_effort="minimal",
        )
        raw = resp.choices[0].message.content or "{}"
        try:
            data = json.loads(raw)

            # Increment suite version first, then persist with this version
            version_now = _increment_suite_version("Generated test design")
            try:
                test_design_id = _results_writer.write_test_design(
                    session_id=suite_id_value,
                    suite_id=suite_id_value,
                    content=data,
                    testing_type="integration",
                    version=version_now,
                    active=True,
                )
                if test_design_id:
                    _SUITE_TEST_DESIGN_ID[suite_id_value] = str(test_design_id)
            except Exception:
                pass
            return "Test design generated successfully"
        except Exception as e:
            raise ValueError(f"Invalid JSON from test design generator: {e}")

    async def generate_viewpoints() -> Any:
        """Generate Integration Test Checklist (IT Viewpoints) with flow/requirement references.

        - Produces strict JSON containing a table-like "checklist" and a backward-compatible
          "viewpoints" array (per-requirement items) for persistence.
        """
        current_version = _increment_suite_version("Generated viewpoints")
        prev_version = current_version - 1
        viewpoints_processed = []

        # get all the requirements here per version and suite id from supabase
        requirements = (
            supabase_client.table("requirements")
            .select("*")
            .eq("version", prev_version)
            .eq("suite_id", bound_suite_id)
            .execute()
            .data
        )

        # get all the test designs here per version and suite id from supabase
        flows = []
        test_designs = (
            supabase_client.table("test_designs")
            .select("*")
            .eq("version", prev_version)
            .eq("suite_id", bound_suite_id)
            .execute()
            .data
        )
        if test_designs:
            flows += test_designs[0].get("content").get("flows")

        # link test designs to requirements through linked artifacts
        for requirement in requirements:
            requirement = requirement.get("content")
            requirement["linked_test_designs"] = []

            for flow in flows:
                flow_links_artifacts = flow.get("links_artifacts")

                for i in flow_links_artifacts:
                    if i.get("table_name") == "requirements" and requirement.get(
                        i.get("link_key")
                    ) == i.get("link_value"):
                        requirement.get("linked_test_designs").append(flow)

            # Build instruction prompt to produce a single unified "viewpoints" checklist (merged; no separate checklist key)
            prompt = (
                "# Instruction Prompt for AI\n\n"
                "You are an expert Integration Test (IT) designer. Your task is to create an IT Test Checklist (IT Viewpoints) based on the following inputs. Produce a cross-cutting baseline of integration test coverage across all modules.\n\n"
                "## Inputs\n"
                "1) Requirement Documents (uploaded by user)\n"
                "2) Requirement List (structured Features → Functions → Screens)\n"
                "3) IT Test Design (Sitemap + Integration Flows with requirement mapping)\n"
                "4) Domain Knowledge\n"
                "   - Identify additional viewpoints critical for coverage (security, compliance, interoperability, data integrity, etc.).\n"
                "   - Items with no direct requirement/flow mapping are allowed; leave references empty.\n\n"
                "## Objectives\n"
                "- Ensure system-wide coverage: success, failure/negative, boundary & edge, exception handling, security, performance & load, usability & accessibility, data integrity & consistency, interoperability, error recovery & resilience, compliance/regulatory, and others suggested by context.\n"
                "- Treat the checklist as cross-cutting (not tied to any one flow order).\n\n"
                "## Traceability\n"
                "- Use a generic array named links_artifacts for all linkages.\n"
                "- If an item is derived purely from domain knowledge, links_artifacts may be empty.\n\n"
                "## Output Format (STRICT JSON ONLY; no markdown)\n"
                'Return EXACTLY this shape. Use a single unified array named "viewpoints" representing table rows with these fields (no numbering, no suggested flag, no integration_test flag):\n'
                "{\n"
                '  "viewpoints": [\n'
                "    {\n"
                '      "id": "id of the viewpoint",\n'
                '      "level1": "<Feature/Module>",\n'
                '      "level2": "<Function>",\n'
                '      "level3": "<success|fail|boundary|security|...>",\n'
                '      "scenario": "<Scenario / Checkpoints; short sentences; bullets allowed using \\\n - >",\n'
                '      "links_artifacts": [{"table_name": "requirements/test_designs", "link_key": "the field of the id", "link_value": "the actual id value"}]\n'
                "    }\n"
                "  ],\n"
                "}\n\n"
                "Guidance:\n"
                "- Keep scenarios concise and actionable; use \\\n - bullets when listing checkpoints.\n\n"
                f"Requirement (JSON):\n{requirement}\n\n"
            )

            viewpoints_processed.append(
                _async_client.chat.completions.create(
                    model=global_settings.openai_model,
                    messages=[
                        {
                            "role": "system",
                            "content": "Return strict JSON only; no extra text.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    reasoning_effort="minimal",
                    response_format={"type": "json_object"},
                )
            )

        results = await asyncio.gather(*viewpoints_processed)
        viewpoints = []
        for result in results:
            result_json = result.choices[0].message.content or "{}"
            result_json = json.loads(result_json)
            viewpoints.append(result_json.get("viewpoints"))

        _results_writer.write_viewpoints(
            session_id=suite_id_value,
            suite_id=suite_id_value,
            data=viewpoints,
            version=current_version,
        )
        return "Viewpoints generated successfully"

    def ask_user(
        event_type: str, response_to_user: str, data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Log a user-facing question to events and terminate the flow.

        Parameters:
        - event_type: currently only supports "sample_confirmation".
        - response_to_user: a short, user-friendly message for the user.

        Returns a payload that includes the token "TERMINATE" to trigger termination.
        """
        allowed_types = {
            "sample_confirmation",
            "quality_confirmation",
            "requirements_feedback",
            "requirements_sample_offer",
            "testcases_sample_offer",
            "testing_type_choice",
            "gaps_follow_up",
        }
        if event_type not in allowed_types:
            raise ValueError(f"Unsupported event_type: {event_type}")

        event_payload = {
            "type": "ask_user",
            "event_type": event_type,
            "response_to_user": response_to_user,
            "suite_id": suite_id_value,
        }

        if data is not None:
            try:
                # Ensure the payload is JSON-serializable and compact
                _ = json.dumps(data)
                event_payload["data"] = data
            except Exception:
                pass

        _results_writer.write_event(
            suite_id=suite_id_value, event=event_payload, message_id=message_id
        )

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
                    supabase_client.table("requirements")
                    .select("content")
                    .eq("suite_id", suite_id_value)
                    .execute()
                    .data
                    or []
                )
                reqs = [
                    row.get("content")
                    for row in data
                    if isinstance(row.get("content"), dict)
                ]
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
                supabase_client.table("test_cases")
                .select("content")
                .eq("suite_id", suite_id_value)
                .execute()
                .data
                or []
            )
            testcases = [
                row.get("content")
                for row in data
                if isinstance(row.get("content"), dict)
            ]
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
        model_client=low_model_client,
        handoffs=["fetcher", "requirements_extractor", "testcase_writer"],
        tools=[
            ask_user,
            get_requirements_info,
            get_testcases_info,
            identify_gaps,
            restore_suite_version,
            chat_with_user,
        ],
        system_message=PLANNER_SYSTEM_MESSAGE,
    )

    fetcher_local = AssistantAgent(
        "fetcher",
        model_client=model_client,
        handoffs=["planner", "requirements_extractor"],
        tools=[store_docs_from_blob],
        system_message=FETCHER_SYSTEM_MESSAGE,
    )

    requirements_extractor_local = AssistantAgent(
        "requirements_extractor",
        model_client=model_client,
        handoffs=["testcase_writer", "planner"],
        tools=[
            extract_requirements,
            generate_test_design,
            generate_viewpoints,
            ask_user,
        ],
        system_message=REQUIREMENTS_EXTRACTOR_SYSTEM_MESSAGE,
    )

    testcase_writer_local = AssistantAgent(
        "testcase_writer",
        model_client=model_client,
        handoffs=["planner"],
        tools=[
            generate_preview,
            generate_direct_testcases_on_docs,
            edit_testcases,
            generate_test_cases,
        ],
        system_message=TESTCASE_WRITER_SYSTEM_MESSAGE,
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
    reasoning_effort="minimal",
)

low_model_client = OpenAIChatCompletionClient(
    model=global_settings.openai_model,
    parallel_tool_calls=False,
    api_key=global_settings.openai_api_key,
    reasoning_effort="minimal",
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


def _write_full_suite_state(
    suite_id: Optional[str],
    agent_state: Dict[str, Any],
    latest_version: Optional[int] = None,
    version_history: Optional[List[Dict[str, Any]]] = None,
) -> None:
    """Write both agent_state and a top-level latest_version into test_suites.state.

    - Reads existing state to merge.
    - Preserves other keys.
    - If latest_version is provided, writes it to top-level as latest_version.
    """
    if not suite_id:
        return
    try:
        data = (
            supabase_client.table("test_suites")
            .select("id, state")
            .eq("id", suite_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        current: Dict[str, Any] = {}
        if data:
            existing = data[0].get("state")
            if isinstance(existing, dict):
                current = existing
        current["agent_state"] = agent_state
        if latest_version is not None:
            try:
                current["latest_version"] = int(latest_version)
            except Exception:
                pass
        if version_history is not None:
            try:
                current["version_history"] = list(version_history)
            except Exception:
                pass
        supabase_client.table("test_suites").update({"state": current}).eq(
            "id", suite_id
        ).execute()
    except Exception as e:
        print(f"Error writing suite state: {e}")


async def run_stream_with_suite(
    task: str, suite_id: Optional[str], message_id: Optional[str] = None
):
    _message_id = message_id or str(uuid4())
    user_message_id = str(uuid4())
    local_team = make_team_for_suite(suite_id, _message_id)

    if suite_id:
        supabase_client.table("test_suites").update({"status": "chatting"}).eq(
            "id", suite_id
        ).execute()

    prior_state = _get_suite_agent_state(suite_id).get("agent_state")
    if prior_state:
        await local_team.load_state(prior_state)

    async for event in local_team.run_stream(task=task):
        print(event)
        _event_payload = json.loads(event.model_dump_json())
        _event_payload.pop("id", None)
        _event_payload.pop("created_at", None)
        _event_payload.pop("metadata", None)
        _event_payload.pop("models_usage", None)
        _event_payload.pop("results", None)
        if type(_event_payload.get("content")) == list:
            for i in _event_payload["content"]:
                i.pop("id", None)
                i.pop("call_id", None)

            if len(_event_payload["content"]) and (
                _event_payload["content"][0].get("name")
                == "ask_user"
                # or _event_payload["content"][0].get("name") == "generate_preview"
            ):
                continue
        for i in _event_payload.get("tool_calls", []):
            i.pop("id", None)
        inserted_message_id = (
            user_message_id if _event_payload.get("source") == "user" else _message_id
        )
        if (
            not _event_payload.get("messages")
            and not _event_payload.get("type") == "ToolCallSummaryMessage"
            and not _event_payload.get("type") == "HandoffMessage"
        ):
            _results_writer.write_event(
                suite_id=suite_id, event=_event_payload, message_id=inserted_message_id
            )
        yield event

    # Persist both agent_state and top-level latest_version (if present in agent_state)
    try:
        saved_state = await local_team.save_state()
        # If the saved_state carries a latest marker, set it at top-level too
        latest_marker = None
        try:
            lv = saved_state.get("latest_version")
            latest_marker = int(lv) if lv is not None else None
        except Exception:
            latest_marker = None
        _write_full_suite_state(
            suite_id=suite_id, agent_state=saved_state, latest_version=latest_marker
        )
    except Exception as e:
        print(f"Error saving suite state: {e}")
    # Back to idle when finished (best-effort)
    try:
        if suite_id:
            supabase_client.table("test_suites").update({"status": "idle"}).eq(
                "id", suite_id
            ).execute()
    except Exception as e:
        print(f"Error updating suite status to idle: {e}")
