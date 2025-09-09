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
from openai import OpenAI
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

    def _update_suite_latest_version(new_version: int) -> None:
        """Persist suite-level latest_version into test_suites.state while preserving existing agent_state.

        - Reads prior agent_state via results_writer.get_suite_state (best-effort)
        - If new_version is greater than existing latest_version, updates it
        - Otherwise leaves state unchanged
        """
        try:
            prior_state = _get_suite_agent_state(suite_id_value) or {}
            prior_val = prior_state.get("latest_version")
            try:
                prior_int = int(prior_val) if prior_val is not None else None
            except Exception:
                prior_int = None
            if prior_int is None or int(new_version) > prior_int:
                merged_state = dict(prior_state)
                merged_state["latest_version"] = int(new_version)
                _write_full_suite_state(
                    suite_id=suite_id_value,
                    agent_state=merged_state,
                    latest_version=int(new_version),
                )
        except Exception:
            pass

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
                        int(source_version) if source_version is not None else int(new_version - 1)
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
  - text: Requirement description (summarized)
  - source: Source Document Name (filename)
  - source_section: Source section / ID (e.g., heading, paragraph number, or requirement ID)

Output Format:
Return STRICT JSON ONLY (no markdown) with EXACTLY this shape:
{{
  "requirements": [
    {{
      "id": "REQ-1",
      "feature": "<Feature / Module>",
      "function": "<Function>",
      "screen": "<Screen / Interface>",
      "text": "<Requirement Description>",
      "source": "<Source Document Name>",
      "source_section": "<Source Section / ID>"
    }}
  ]
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
            if isinstance(parsed, dict) and isinstance(parsed.get("requirements"), list):
                reqs = parsed.get("requirements")
            elif isinstance(parsed, list):
                # Backward-compat: accept a plain array of items
                reqs = parsed
            else:
                raise ValueError("Unexpected JSON shape; expected {requirements:[...]}")
        except Exception as e:
            raise ValueError(f"Invalid JSON from extractor: {e}")

        # Cache per suite
        _SUITE_REQUIREMENTS[suite_id_value] = reqs

        # Increment suite version and persist requirements (best-effort)
        version_now = _increment_suite_version("Requirements extracted")
        try:
            _results_writer.write_requirements(
                session_id=suite_id_value,
                requirements=reqs,
                suite_id=suite_id_value,
                version=version_now,
                active=True,
            )
        except Exception:
            pass

        return "Requirements extracted successfully"

    def _clone_current_artifacts_to_version(source_version: int, target_version: int) -> None:
        """Clone artifacts from a specific source_version to target_version so all artifact types have rows for the target."""
        # 1) Requirements → copy rows that match source_version into target_version if not already present
        exists_reqs = (
            supabase_client.table("requirements")
            .select("id")
            .eq("suite_id", suite_id_value)
            .eq("version", target_version)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not exists_reqs:
            rows = (
                supabase_client.table("requirements")
                .select("content")
                .eq("suite_id", suite_id_value)
                .eq("version", source_version)
                .execute()
                .data
                or []
            )
            reqs = [
                r.get("content") for r in rows if isinstance(r.get("content"), dict)
            ]
            if reqs:
                _results_writer.write_requirements(
                    session_id=suite_id_value,
                    requirements=reqs,
                    suite_id=suite_id_value,
                    version=target_version,
                    active=True,
                )

        # 2) Test Cases → copy rows that match source_version into target_version if not already present
        exists_tcs = (
            supabase_client.table("test_cases")
            .select("id")
            .eq("suite_id", suite_id_value)
            .eq("version", target_version)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not exists_tcs:
            # Build map from requirement DB id -> req_code for lookup when writing
            req_map_rows = (
                supabase_client.table("requirements")
                .select("id, req_code")
                .eq("suite_id", suite_id_value)
                .execute()
                .data
                or []
            )
            req_id_to_code: Dict[str, str] = {}
            for r in req_map_rows:
                rid = r.get("id")
                code = r.get("req_code")
                if rid and code:
                    req_id_to_code[str(rid)] = str(code)

            # Pull test_cases for the source_version
            tc_rows = (
                supabase_client.table("test_cases")
                .select("requirement_id, content, version")
                .eq("suite_id", suite_id_value)
                .eq("version", source_version)
                .execute()
                .data
                or []
            )
            bulk_rows: List[Dict[str, Any]] = []
            for row in tc_rows:
                rid = (
                    str(row.get("requirement_id"))
                    if row.get("requirement_id") is not None
                    else None
                )
                if not rid:
                    continue
                req_code = req_id_to_code.get(rid)
                if not req_code:
                    continue
                content = row.get("content")
                if not isinstance(content, dict):
                    continue
                content_with_version = dict(content)
                content_with_version["version"] = target_version
                bulk_rows.append(
                    {
                        "req_code": str(req_code),
                        "testcases": content_with_version,
                        "version": target_version,
                    }
                )
            if bulk_rows:
                _results_writer.write_testcases_bulk(
                    session_id=suite_id_value,
                    suite_id=suite_id_value,
                    rows=bulk_rows,
                    version=target_version,
                    active=True,
                )

        # 3) Test Design → copy rows that match source_version
        exists_td = (
            supabase_client.table("test_designs")
            .select("id")
            .eq("suite_id", suite_id_value)
            .eq("version", target_version)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not exists_td:
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
                        "testing_type": str(td.get("testing_type") or "integration"),
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

        # 4) Viewpoints → copy rows that match source_version
        exists_vp = (
            supabase_client.table("viewpoints")
            .select("id")
            .eq("suite_id", suite_id_value)
            .eq("version", target_version)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not exists_vp:
            vp_rows = (
                supabase_client.table("viewpoints")
                .select("content, test_design_id, requirement_id")
                .eq("suite_id", suite_id_value)
                .eq("version", source_version)
                .execute()
                .data
                or []
            )
            if vp_rows:
                items = [
                    {
                        "content": (vp.get("content") or {}),
                        "test_design_id": vp.get("test_design_id"),
                        "requirement_id": vp.get("requirement_id"),
                        "version": target_version,
                    }
                    for vp in vp_rows
                ]
                _results_writer.write_viewpoints_bulk(
                    session_id=suite_id_value,
                    suite_id=suite_id_value,
                    items=items,
                    version=target_version,
                    active=True,
                )

    def generate_and_store_testcases_for_req(
        req_id: Optional[str] = None, style: str = "json"
    ) -> Dict[str, Any]:
        reqs = _SUITE_REQUIREMENTS.get(suite_id_value) or []

        # If no req_id is provided, generate for all requirements concurrently
        if req_id is None:
            targets = [
                (r.get("id"), r.get("source", "unknown.txt"), r.get("text", ""))
                for r in reqs
                if isinstance(r, dict) and r.get("id")
            ]
            if not targets:
                raise ValueError(
                    "No requirements available. Extract requirements first."
                )

            # Increment suite version once for this bulk generation and reuse for all inserts
            version_now = _increment_suite_version(
                "Generated test cases for all requirements"
            )

            def _worker(t: tuple[str, str, str]) -> Dict[str, Any]:
                _rid, _src, _txt = t
                # Build prompt per requirement and persist with shared version
                prompt_local = f"""
You are a precise QA engineer. Write three concise, testable cases (happy, edge, negative) for the requirement below.

Return ONLY a JSON object (no markdown, no commentary). Use EXACTLY these fields and types:
{{
  "requirement_id": "{_rid}",
  "source": "{_src}",
  "requirement_text": "<brief restatement of the requirement>",
  "cases": [
    {{"id": "<short id>", "type": "happy", "title": "<short title>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}},
    {{"id": "<short id>", "type": "edge", "title": "<short title>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}},
    {{"id": "<short id>", "type": "negative", "title": "<short title>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}}
  ]
}}

Requirement text:
{_txt}
""".strip()
                resp_local = _oai.chat.completions.create(
                    model=global_settings.openai_model,
                    messages=[
                        {
                            "role": "system",
                            "content": "Return exact JSON only; no extra text. Generate compact, testable QA cases with clear steps and expectations.",
                        },
                        {"role": "user", "content": prompt_local},
                    ],
                    reasoning_effort="minimal",
                )
                raw_local = resp_local.choices[0].message.content or "{}"
                try:
                    tc_obj_local = json.loads(raw_local)
                    assert isinstance(tc_obj_local, dict)
                    # Normalize like the single path
                    try:
                        cases_local = tc_obj_local.get("cases")
                        if isinstance(cases_local, list):
                            normalized_cases_local = []
                            for c in cases_local:
                                if not isinstance(c, dict):
                                    normalized_cases_local.append(
                                        {
                                            "id": "",
                                            "type": "info",
                                            "title": str(c),
                                            "preconditions": "",
                                            "steps": str(c),
                                            "expected": "",
                                        }
                                    )
                                    continue
                                normalized_case_local = dict(c)
                                for key in ("preconditions", "steps"):
                                    val = normalized_case_local.get(key)
                                    if isinstance(val, list):
                                        normalized_case_local[key] = "; ".join(
                                            str(x) for x in val
                                        )
                                    elif val is None:
                                        normalized_case_local[key] = ""
                                    else:
                                        normalized_case_local[key] = str(val)
                                for key in ("id", "title", "type", "expected"):
                                    val = normalized_case_local.get(key)
                                    if val is None:
                                        normalized_case_local[key] = ""
                                    elif not isinstance(val, str):
                                        normalized_case_local[key] = str(val)
                                normalized_cases_local.append(normalized_case_local)
                            # Ensure unique ids
                            used_ids_local = set()
                            for idx_local, case_local in enumerate(
                                normalized_cases_local, start=1
                            ):
                                raw_id_local = case_local.get("id")
                                new_id_local = (
                                    raw_id_local.strip()
                                    if isinstance(raw_id_local, str)
                                    else ""
                                )
                                if not new_id_local:
                                    new_id_local = f"{_rid}-TC-{idx_local}"
                                uniq_id_local = new_id_local
                                counter_local = 2
                                while uniq_id_local in used_ids_local:
                                    uniq_id_local = f"{new_id_local}-{counter_local}"
                                    counter_local += 1
                                case_local["id"] = uniq_id_local
                                used_ids_local.add(uniq_id_local)
                            tc_obj_local["cases"] = normalized_cases_local
                        for key in ("requirement_id", "source", "requirement_text"):
                            if key in tc_obj_local and not isinstance(
                                tc_obj_local[key], str
                            ):
                                tc_obj_local[key] = str(tc_obj_local[key])
                        # Ensure id/source if missing
                        tc_obj_local.setdefault("requirement_id", str(_rid))
                        tc_obj_local.setdefault("source", str(_src))
                    except Exception:
                        pass
                except Exception as e_local:
                    raise ValueError(f"Invalid JSON from testcase writer: {e_local}")

                # Persist with shared version
                try:
                    _results_writer.write_testcases(
                        session_id=suite_id_value,
                        req_code=str(_rid),
                        testcases=tc_obj_local,
                        suite_id=suite_id_value,
                        version=version_now,
                        active=True,
                    )
                except Exception:
                    pass
                return {"req_id": _rid, "status": "ok"}

            results: List[Dict[str, Any]] = []
            errors: List[Dict[str, Any]] = []
            max_workers = min(6, max(1, len(targets)))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {executor.submit(_worker, t): t for t in targets}
                for f in as_completed(futures):
                    _t = futures[f]
                    try:
                        results.append(f.result())
                    except Exception as e:
                        errors.append({"req_id": _t[0], "error": str(e)})
            return {
                "generated": len(results),
                "failed": len(errors),
                "results": results,
                "errors": errors,
            }

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
    {{"id": "<short id>", "type": "happy", "title": "<short title>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}},
    {{"id": "<short id>", "type": "edge", "title": "<short title>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}},
    {{"id": "<short id>", "type": "negative", "title": "<short title>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}}
  ]
}}

Rules for ids:
- Provide a concise string id per case (e.g., "TC-1", "TC-2", "TC-3").
- Ids must be unique within this requirement.

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
                            normalized_cases.append(
                                {
                                    "id": "",
                                    "type": "info",
                                    "title": str(c),
                                    "preconditions": "",
                                    "steps": str(c),
                                    "expected": "",
                                }
                            )
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
                        for key in ("id", "title", "type", "expected"):
                            val = normalized_case.get(key)
                            if val is None:
                                normalized_case[key] = ""
                            elif not isinstance(val, str):
                                normalized_case[key] = str(val)
                        normalized_cases.append(normalized_case)
                    tc_obj["cases"] = normalized_cases
                    # Ensure each case has a unique id; assign fallback if missing/blank
                    used_ids = set()
                    for idx, case in enumerate(tc_obj["cases"], start=1):
                        raw_id = case.get("id")
                        new_id = raw_id.strip() if isinstance(raw_id, str) else ""
                        if not new_id:
                            new_id = f"{req_id}-TC-{idx}"
                        uniq_id = new_id
                        counter = 2
                        while uniq_id in used_ids:
                            uniq_id = f"{new_id}-{counter}"
                            counter += 1
                        case["id"] = uniq_id
                        used_ids.add(uniq_id)
                # Ensure top-level strings as well
                for key in ("requirement_id", "source", "requirement_text"):
                    if key in tc_obj and not isinstance(tc_obj[key], str):
                        tc_obj[key] = str(tc_obj[key])
            except Exception:
                # If normalization fails, keep original but continue
                pass
        except Exception as e:
            raise ValueError(f"Invalid JSON from testcase writer: {e}")

        # Persist testcases (best-effort) with the suite stage version
        try:
            version_now = _increment_suite_version("Generated test cases")
            _results_writer.write_testcases(
                session_id=suite_id_value,
                req_code=req_id,
                testcases=tc_obj,
                suite_id=suite_id_value,
                version=version_now,
                active=True,
            )
        except Exception:
            pass

        return "Test cases generated successfully"

    def generate_integration_testcases_for_req(
        req_id: Optional[str] = None,
        style: str = "json",
        limit_cases_per_req: int = 4,
    ) -> Dict[str, Any]:
        """Generate Integration Testing cases per requirement using requirements, test design, and viewpoints.

        - If req_id is None, generate for all requirements (concurrently), else only for that requirement.
        - Leverages linked flows from the latest Integration Test Design and per-requirement Viewpoints.
        - Persists results; embeds linkage metadata inside the JSON for downstream consumers.
        """

        # Load requirements list (from cache first, else DB)
        reqs = _SUITE_REQUIREMENTS.get(suite_id_value) or []
        if not reqs:
            try:
                data = (
                    supabase_client.table("requirements")
                    .select("id, req_code, content, source_doc")
                    .eq("suite_id", suite_id_value)
                    .execute()
                    .data
                    or []
                )
                reqs = []
                for row in data:
                    content = row.get("content") or {}
                    if isinstance(content, dict):
                        reqs.append(
                            {
                                "id": content.get("id") or row.get("req_code"),
                                "text": content.get("text"),
                                "source": content.get("source")
                                or row.get("source_doc"),
                            }
                        )
            except Exception:
                reqs = []

        # If generating suite-wide
        if req_id is None:
            targets = [
                (r.get("id"), r.get("source", "unknown.txt"), r.get("text", ""))
                for r in reqs
                if isinstance(r, dict) and r.get("id")
            ]
            if not targets:
                raise ValueError(
                    "No requirements available. Extract requirements first."
                )

            version_now = _increment_suite_version(
                "Generated integration test cases for all requirements"
            )

            # Load latest Integration Test Design (flows) once for bulk path
            test_design_content_all: Dict[str, Any] = {}
            test_design_id_value_all: Optional[str] = _SUITE_TEST_DESIGN_ID.get(
                suite_id_value
            )
            try:
                if test_design_id_value_all:
                    td_rows_all = (
                        supabase_client.table("test_designs")
                        .select("id, content")
                        .eq("id", test_design_id_value_all)
                        .limit(1)
                        .execute()
                        .data
                        or []
                    )
                else:
                    td_rows_all = (
                        supabase_client.table("test_designs")
                        .select("id, content")
                        .eq("suite_id", suite_id_value)
                        .eq("testing_type", "integration")
                        .order("created_at", desc=True)
                        .limit(1)
                        .execute()
                        .data
                        or []
                    )
                if td_rows_all:
                    test_design_id_value_all = str(
                        (td_rows_all[0] or {}).get("id") or test_design_id_value_all
                    )
                    cd_all = (td_rows_all[0] or {}).get("content")
                    if isinstance(cd_all, dict):
                        test_design_content_all = cd_all
            except Exception:
                pass

            def _worker(t: tuple[str, str, str]) -> Dict[str, Any]:
                _rid, _src, _txt = t
                try:
                    # Resolve flows linked to this requirement (subset for context)
                    all_flows_all = (
                        test_design_content_all.get("flows")
                        if isinstance(test_design_content_all, dict)
                        else None
                    )
                    linked_flows_local: List[Dict[str, Any]] = []
                    if isinstance(all_flows_all, list):
                        for f in all_flows_all:
                            if not isinstance(f, dict):
                                continue
                            req_links = f.get("requirements_linked")
                            if isinstance(req_links, list) and any(
                                str(x) == str(_rid) for x in req_links
                            ):
                                linked_flows_local.append(
                                    {
                                        "id": f.get("id"),
                                        "name": f.get("name"),
                                        "description": f.get("description"),
                                    }
                                )

                    # Load viewpoints for this requirement as checklist seeds
                    linked_viewpoints_local: List[Dict[str, Any]] = []
                    rr = (
                        supabase_client.table("requirements")
                        .select("id")
                        .eq("suite_id", suite_id_value)
                        .eq("req_code", str(_rid))
                        .limit(1)
                        .execute()
                        .data
                        or []
                    )
                    requirement_row_id_local = (
                        str((rr[0] or {}).get("id")) if rr else None
                    )
                    if requirement_row_id_local:
                        vp_rows_local = (
                            supabase_client.table("viewpoints")
                            .select("name")
                            .eq("suite_id", suite_id_value)
                            .eq("requirement_id", requirement_row_id_local)
                            .execute()
                            .data
                            or []
                        )
                        for rvp in vp_rows_local:
                            if isinstance(rvp, dict):
                                linked_viewpoints_local.append(
                                    {
                                        "name": rvp.get("name"),
                                    }
                                )
                except Exception as e:
                    import logging

                    logger = logging.getLogger(__name__)
                    logger.exception(e)

                # Build adapted context JSON snippets for prompt
                try:
                    flows_ctx_local = json.dumps(
                        linked_flows_local[:8], ensure_ascii=False
                    )
                except Exception:
                    flows_ctx_local = "[]"
                try:
                    vps_ctx_local = json.dumps(
                        linked_viewpoints_local[:10], ensure_ascii=False
                    )
                except Exception:
                    vps_ctx_local = "[]"

                # Reuse the same prompt structure as single path
                prompt_local = f"""
 You are an expert test designer for Integration Testing (IT).
 
 Input Sources you may use:
 - Requirement Text (below)
 - IT Test Design (flows) if provided in context (not always present)
 - IT Checklist (Viewpoints) if provided in context (not always present)
@@
 Return ONLY a JSON object (no markdown) with EXACTLY this shape. The array key must be "cases":
 {{
   "requirement_id": "{_rid}",
   "source": "{_src}",
   "testing_type": "integration",
   "test_design_id": "{_SUITE_TEST_DESIGN_ID.get(suite_id_value) or ''}",
   "linked_flows": ["<Flow-ID>"],
   "linked_viewpoints": ["<Viewpoint-Name>"],
   "cases": [
     {{
       "id": "<short id>",
       "type": "happy|edge|negative|alt",
       "title": "<short>",
       "preconditions": ["..."],
       "steps": ["..."],
       "expected": "...",
       "links": {{"flows": ["<Flow-ID>"], "viewpoints": ["<Viewpoint-Name>"]}},
       "flow_description": "<optional: flow description if known>",
       "scenario": "<optional: checklist scenario/checkpoint>",
       "name": "<optional: descriptive test case name>",
       "test_data": [{{"field": "...", "value": "..."}}]
     }}
   ]
 }}
 
 Requirement Text:
 {_txt}
 
 Linked Flows (subset):
 {flows_ctx_local}
 
 Viewpoints (subset):
 {vps_ctx_local}
 """.strip()
                resp_local = _oai.chat.completions.create(
                    model=global_settings.openai_model,
                    messages=[
                        {
                            "role": "system",
                            "content": "Return strict JSON only; no extra text. Generate compact integration test cases with clear steps and explicit linkage to flows and viewpoints.",
                        },
                        {"role": "user", "content": prompt_local},
                    ],
                    reasoning_effort="minimal",
                    response_format={"type": "json_object"},
                )
                raw_local = resp_local.choices[0].message.content or "{}"
                try:
                    tc_obj_local = json.loads(raw_local)
                    assert isinstance(tc_obj_local, dict)
                except Exception as e_local:
                    raise ValueError(
                        f"Invalid JSON from integration testcase writer: {e_local}"
                    )
                # Persist with shared version
                try:
                    _results_writer.write_testcases(
                        session_id=suite_id_value,
                        req_code=str(_rid),
                        testcases=tc_obj_local,
                        suite_id=suite_id_value,
                        version=version_now,
                        active=True,
                    )
                except Exception:
                    pass
                return {"req_id": _rid, "status": "ok"}

            results: List[Dict[str, Any]] = []
            errors: List[Dict[str, Any]] = []
            max_workers = min(6, max(1, len(targets)))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {executor.submit(_worker, t): t for t in targets}
                for f in as_completed(futures):
                    _t = futures[f]
                    try:
                        results.append(f.result())
                    except Exception as e:
                        errors.append({"req_id": _t[0], "error": str(e)})
            return {
                "generated": len(results),
                "failed": len(errors),
                "results": results,
                "errors": errors,
            }

        # For a single requirement, resolve its text/source
        match = next(
            (r for r in reqs if isinstance(r, dict) and r.get("id") == req_id), None
        )
        if not match:
            raise ValueError(f"Requirement {req_id} not found.")
        source = match.get("source", "unknown.txt")
        text = match.get("text", "")

        # Resolve requirement DB row id (for linking viewpoints)
        requirement_row_id: Optional[str] = None
        try:
            rr = (
                supabase_client.table("requirements")
                .select("id")
                .eq("suite_id", suite_id_value)
                .eq("req_code", str(req_id))
                .limit(1)
                .execute()
                .data
                or []
            )
            if rr:
                requirement_row_id = str((rr[0] or {}).get("id"))
        except Exception:
            requirement_row_id = None

        # Load latest Integration Test Design for the suite
        test_design_content: Dict[str, Any] = {}
        test_design_id_value: Optional[str] = _SUITE_TEST_DESIGN_ID.get(suite_id_value)
        try:
            if test_design_id_value:
                td_rows = (
                    supabase_client.table("test_designs")
                    .select("id, content")
                    .eq("id", test_design_id_value)
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
            else:
                td_rows = (
                    supabase_client.table("test_designs")
                    .select("id, content")
                    .eq("suite_id", suite_id_value)
                    .eq("testing_type", "integration")
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
            if td_rows:
                test_design_id_value = str(
                    (td_rows[0] or {}).get("id") or test_design_id_value
                )
                cd = (td_rows[0] or {}).get("content")
                if isinstance(cd, dict):
                    test_design_content = cd
        except Exception:
            pass

        # Determine flows linked to this requirement
        linked_flows: List[Dict[str, Any]] = []
        try:
            all_flows = (
                test_design_content.get("flows")
                if isinstance(test_design_content, dict)
                else None
            )
            if isinstance(all_flows, list):
                for f in all_flows:
                    if not isinstance(f, dict):
                        continue
                    req_links = f.get("requirements_linked")
                    if isinstance(req_links, list) and any(
                        str(x) == str(req_id) for x in req_links
                    ):
                        linked_flows.append(f)
        except Exception:
            linked_flows = []
        linked_flow_ids = [str(f.get("id")) for f in linked_flows if f.get("id")]

        # Load viewpoints for this requirement
        linked_viewpoints: List[Dict[str, Any]] = []
        try:
            if requirement_row_id:
                vp_rows = (
                    supabase_client.table("viewpoints")
                    .select("id, requirement_id, name, content, test_design_id")
                    .eq("suite_id", suite_id_value)
                    .eq("requirement_id", requirement_row_id)
                    .execute()
                    .data
                    or []
                )
            else:
                vp_rows = []
            for r in vp_rows:
                if isinstance(r, dict):
                    linked_viewpoints.append(
                        {"id": r.get("id"), "name": r.get("name")}
                    )
        except Exception:
            linked_viewpoints = []
        linked_viewpoint_ids = [
            str(v.get("id")) for v in linked_viewpoints if v.get("id")
        ]
        linked_viewpoint_names = [
            str(v.get("name")) for v in linked_viewpoints if v.get("name")
        ]

        # Trim contexts for prompt
        try:
            flows_ctx = json.dumps(linked_flows[:6], ensure_ascii=False)
        except Exception:
            flows_ctx = "[]"
        try:
            vps_ctx = json.dumps(linked_viewpoints[:8], ensure_ascii=False)
        except Exception:
            vps_ctx = "[]"

        # Compose prompt for Integration test case generation
        prompt = f"""
You are an expert test designer for Integration Testing (IT).

Input Sources you may use:
- Requirement Text (below)
- IT Test Design (flows) if provided in context (not always present)
- IT Checklist (Viewpoints) if provided in context (not always present)

Rules for Test Case Creation:
- Coverage: include success, failure, boundary, exception, and non-functional (security, performance, data integrity, interoperability, error recovery, compliance) perspectives where relevant.
- Traceability: each test case must reference a Flow (by id) and a Checklist item (by viewpoint name) when available.
- Granularity: a single flow or checklist scenario may yield multiple cases; avoid duplication; keep variations explicit.
- Clarity: steps must be actionable; expected results measurable; provide test data especially for boundary/negative cases.
- Validation: if inputs are incomplete or ambiguous, include a short clarification question instead of guessing.

Return ONLY a JSON object (no markdown) with EXACTLY this shape. The array key must be "cases":
{{
  "requirement_id": "{req_id}",
  "source": "{source}",
  "testing_type": "integration",
  "test_design_id": "{test_design_id_value or ''}",
  "linked_flows": ["<Flow-ID>"],
  "linked_viewpoints": ["<Viewpoint-Name>"],
  "cases": [
    {{"id": "<short id>", "type": "happy|edge|negative|alt", "title": "<short>", "preconditions": ["..."], "steps": ["..."], "expected": "...", "links": {{"flows": ["<Flow-ID>"], "viewpoints": ["<Viewpoint-Name>"]}}}}
  ]
}}

Guidelines:
- Provide {limit_cases_per_req} focused cases, each exercising inter-component behavior, interfaces/APIs, data flow, and error handling.
- Prefer referencing flows by id and viewpoints by name when relevant.
- Keep steps very short; ensure each case is independently executable.
- Do NOT invent additional requirements; stick to the given text and artifacts.

Requirement Text:
{text}

Linked Flows (subset):
{flows_ctx}

Viewpoints (subset):
{vps_ctx}
""".strip()

        resp = _oai.chat.completions.create(
            model=global_settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": "Return strict JSON only; no extra text. Generate compact integration test cases with clear steps and explicit linkage to flows and viewpoints.",
                },
                {"role": "user", "content": prompt},
            ],
            reasoning_effort="minimal",
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"

        try:
            tc_obj = json.loads(raw)
            assert isinstance(tc_obj, dict)
            # Normalize core fields
            if "requirement_id" not in tc_obj:
                tc_obj["requirement_id"] = str(req_id)
            if "source" not in tc_obj:
                tc_obj["source"] = str(source)
            tc_obj["testing_type"] = "integration"
            if test_design_id_value and not tc_obj.get("test_design_id"):
                tc_obj["test_design_id"] = str(test_design_id_value)
            # Ensure linkage arrays
            for link_key, default_vals in (
                ("linked_flows", linked_flow_ids),
                ("linked_viewpoints", linked_viewpoint_names),
            ):
                vals = tc_obj.get(link_key)
                if not isinstance(vals, list):
                    tc_obj[link_key] = list(default_vals)
                else:
                    tc_obj[link_key] = [str(v) for v in vals]

            # Normalize cases similar to the other generator
            try:
                cases = tc_obj.get("cases")
                if isinstance(cases, list):
                    normalized_cases: List[Dict[str, Any]] = []
                    for c in cases:
                        if not isinstance(c, dict):
                            normalized_cases.append(
                                {
                                    "id": "",
                                    "type": "info",
                                    "title": str(c),
                                    "preconditions": "",
                                    "steps": str(c),
                                    "expected": "",
                                }
                            )
                            continue
                        normalized_case = dict(c)
                        for key in ("preconditions", "steps"):
                            val = normalized_case.get(key)
                            if isinstance(val, list):
                                normalized_case[key] = "; ".join(str(x) for x in val)
                            elif val is None:
                                normalized_case[key] = ""
                            else:
                                normalized_case[key] = str(val)
                        for key in ("id", "title", "type", "expected"):
                            val = normalized_case.get(key)
                            if val is None:
                                normalized_case[key] = ""
                            elif not isinstance(val, str):
                                normalized_case[key] = str(val)
                        normalized_cases.append(normalized_case)
                    # Ensure unique ids
                    used_ids = set()
                    for idx, case in enumerate(normalized_cases, start=1):
                        raw_id = case.get("id")
                        new_id = raw_id.strip() if isinstance(raw_id, str) else ""
                        if not new_id:
                            new_id = f"{req_id}-ITC-{idx}"
                        uniq_id = new_id
                        counter = 2
                        while uniq_id in used_ids:
                            uniq_id = f"{new_id}-{counter}"
                            counter += 1
                        case["id"] = uniq_id
                        used_ids.add(uniq_id)
                    tc_obj["cases"] = normalized_cases
            except Exception:
                pass
        except Exception as e:
            raise ValueError(f"Invalid JSON from integration testcase writer: {e}")

        # Persist testcases (best-effort) with suite stage version
        try:
            version_now = _increment_suite_version("Generated integration test cases")
            _results_writer.write_testcases(
                session_id=suite_id_value,
                req_code=str(req_id),
                testcases=tc_obj,
                suite_id=suite_id_value,
                version=version_now,
                active=True,
            )
        except Exception:
            pass

        return "Integration test cases generated successfully"

    def restore_suite_version(source_version: int) -> Dict[str, Any]:
        """Create a new version by cloning artifacts from source_version.

        - Increments the suite version with an auto-generated note, cloning from source_version.
        - Returns {new_version, restored_from}.
        """
        description = f"Restored from v{int(source_version)}"
        new_version = _increment_suite_version(description, source_version=int(source_version))
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

    def edit_testcases_for_req(
        user_edit_request: str, version_note: str
    ) -> Dict[str, Any]:
        """Edit existing test cases suite-wide based on a freeform user edit request.

        Behavior:
        - Fetch ALL requirements and ALL current test_cases for this suite.
        - Ask the LLM to select impacted requirements and compute diffs plus a complete updated
          testcases JSON per impacted requirement (schema may be dynamic; preserve unknown fields).
        - For each impacted requirement, insert a new row in test_cases with an incremented version
          (if the version column exists); fallback to update/insert without version if unavailable.
        - Embed the computed version inside each new_testcases content for robustness.
        - Return a compact payload including per-requirement versions and diffs.
        """

        # Local natural key sorter for human-friendly ordering like REQ-9 < REQ-10
        def _natural_key(value: Any):
            s = str(value or "")
            parts = re.split(r"(\d+)", s)
            return tuple(int(p) if p.isdigit() else p for p in parts)

        # 1) Bump suite version FIRST, so edits target the latest cloned artifacts
        try:
            raw_note = (version_note or "").strip()
            words = [w for w in re.split(r"\s+", raw_note) if w]
            if not words:
                raise ValueError("version_note is required (3 words)")
            eff_note = " ".join(words[:3])
        except Exception:
            raise ValueError("version_note is required (3 words)")
        edit_suite_version = _increment_suite_version(eff_note)

        # 2) Load requirements for this suite
        try:
            req_rows = (
                supabase_client.table("requirements")
                .select("id, req_code, content")
                .eq("suite_id", suite_id_value)
                .execute()
                .data
                or []
            )
        except Exception as e:
            raise ValueError(f"Failed to load requirements: {e}")

        if not req_rows:
            return {
                "status": "no_requirements",
                "message": "No requirements found for this suite.",
            }

        # Sort requirements by requirement id (natural/lexicographic)
        try:
            req_rows = sorted(
                req_rows, key=lambda r: _natural_key(r.get("id") or r.get("req_code"))
            )
        except Exception:
            pass

        # Build requirement maps
        req_by_id: Dict[str, Dict[str, Any]] = {}
        req_by_code: Dict[str, Dict[str, Any]] = {}
        brief_requirements: List[Dict[str, Any]] = []
        for r in req_rows:
            rid = r.get("id")
            rcode = r.get("req_code")
            rcontent = r.get("content") or {}
            brief_requirements.append(
                {
                    "requirement_id": rid,
                    "req_code": rcode,
                    "text": (rcontent or {}).get("text"),
                    "source": (rcontent or {}).get("source"),
                }
            )
            if rid:
                req_by_id[str(rid)] = r
            if rcode:
                req_by_code[str(rcode)] = r

        # 3) Load test cases for the JUST-INCREMENTED version (cloned base)
        try:
            tc_rows = (
                supabase_client.table("test_cases")
                .select("id, requirement_id, suite_id, content, version")
                .eq("suite_id", suite_id_value)
                .eq("version", edit_suite_version)
                .execute()
                .data
                or []
            )
        except Exception as e:
            tc_rows = []

        # Latest test cases per requirement_id
        latest_tc_by_req_id: Dict[str, Dict[str, Any]] = {}
        for row in tc_rows:
            rid = str(row.get("requirement_id"))
            curr = latest_tc_by_req_id.get(rid)
            try:
                row_ver = (
                    int(row.get("version")) if row.get("version") is not None else None
                )
            except Exception:
                row_ver = None
            if curr is None:
                latest_tc_by_req_id[rid] = row
            else:
                try:
                    curr_ver = (
                        int(curr.get("version"))
                        if curr.get("version") is not None
                        else None
                    )
                except Exception:
                    curr_ver = None
                if (row_ver or 0) >= (curr_ver or 0):
                    latest_tc_by_req_id[rid] = row

        # Brief test cases for context (sorted by requirement id, then by test case id inside content)
        brief_testcases: List[Dict[str, Any]] = []
        try:
            sorted_req_ids = sorted(latest_tc_by_req_id.keys(), key=_natural_key)
        except Exception:
            sorted_req_ids = list(latest_tc_by_req_id.keys())

        for rid in sorted_req_ids:
            row = latest_tc_by_req_id[rid]
            req_row = req_by_id.get(rid)
            content = row.get("content")
            # If content has a cases list, sort it by case id
            if isinstance(content, dict):
                try:
                    cases = content.get("cases")
                    if isinstance(cases, list):
                        sorted_cases = sorted(
                            cases, key=lambda c: _natural_key((c or {}).get("id"))
                        )
                        content = {**content, "cases": sorted_cases}
                except Exception:
                    pass
            brief_testcases.append(
                {
                    "requirement_id": rid,
                    "req_code": (req_row or {}).get("req_code"),
                    "content": content,
                    "version": row.get("version"),
                }
            )

        # 4) Build LLM prompt (sorted by req_code, fallback to requirement_id)
        brief_requirements_sorted = sorted(
            brief_requirements, key=lambda r: _natural_key(r.get("req_code"))
        )
        brief_testcases_sorted = sorted(
            brief_testcases, key=lambda r: _natural_key(r.get("req_code"))
        )

        req_ctx = json.dumps(brief_requirements_sorted, ensure_ascii=False)
        tc_ctx = json.dumps(brief_testcases_sorted, ensure_ascii=False)
        if len(req_ctx) > 12000:
            req_ctx = req_ctx[:12000] + "\n...truncated..."
        if len(tc_ctx) > 12000:
            tc_ctx = tc_ctx[:12000] + "\n...truncated..."

        prompt = (
            "You are a senior QA test case editor.\n"
            "You will process a suite-wide user edit request and update impacted test cases.\n"
            "Schema may be dynamic; preserve unknown fields and structure.\n\n"
            "Return ONLY strict JSON (no markdown) with the following shape:\n"
            "{\n"
            '  "edits": [\n'
            "    {\n"
            '      "req_code": "<REQ-...>",\n'
            '      "requirement_id": "<uuid or null>",\n'
            '      "diff": {\n'
            '        "added": [<JSON case>],\n'
            '        "removed": [<JSON case or identifier>],\n'
            '        "edited": [{\n'
            '          "before": <JSON case>,\n'
            '          "after": <JSON case>,\n'
            '          "change_note": "<short note>"\n'
            "        }]\n"
            "      },\n"
            '      "new_testcases": <FULL JSON for the updated test cases for this requirement>\n'
            "    }\n"
            "  ],\n"
            '  "summary": "<1-2 sentences>",\n'
            '  "version_note": "<3-10 words describing this bulk edit>"\n'
            "}\n\n"
            "Guidance:\n"
            "- Choose impacted requirements using req_code and/or requirement_id.\n"
            "- Keep steps/preconditions formatting consistent; do not drop unknown fields.\n"
            '- Provide version_note as a concise history entry (e.g., "Refined negative paths").\n'
            '- If nothing applies, return "edits": [] and set version_note to an empty string.\n\n'
            f"Requirements Context:\n{req_ctx}\n\n"
            f"Current Test Cases Context (latest per requirement):\n{tc_ctx}\n\n"
            f"User Edit Request:\n{user_edit_request}\n"
        )

        try:
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
            llm_out = json.loads(raw)
            assert isinstance(llm_out, dict)
        except Exception as e:
            raise ValueError(f"Invalid JSON from bulk edit generator: {e}")

        edits = llm_out.get("edits") or []
        summary = llm_out.get("summary") or ""
        version_note = llm_out.get("version_note") or ""
        if not isinstance(version_note, str):
            try:
                version_note = str(version_note)
            except Exception:
                version_note = ""
        if not isinstance(edits, list):
            edits = []

        results: List[Dict[str, Any]] = []
        event_edits: List[Dict[str, Any]] = []
        # Version already incremented; edits will target edit_suite_version

        # 4) Apply edits per requirement
        for e in edits:
            if not isinstance(e, dict):
                continue
            req_code = e.get("req_code")
            target_req_id = e.get("requirement_id")
            new_testcases = e.get("new_testcases")
            diff = e.get("diff") or {}

            # Resolve requirement id via code if needed
            req_row = None
            if target_req_id and str(target_req_id) in req_by_id:
                req_row = req_by_id[str(target_req_id)]
            elif req_code and str(req_code) in req_by_code:
                req_row = req_by_code[str(req_code)]
            if not req_row:
                # Skip unknown requirement reference
                event_edits.append(
                    {"req_code": req_code, "error": "requirement_not_found"}
                )
                continue

            resolved_req_id = req_row.get("id")
            latest_row = latest_tc_by_req_id.get(str(resolved_req_id))
            try:
                old_version = int(edit_suite_version) if edit_suite_version is not None else None
            except Exception:
                old_version = None

            # Ensure version embedded equals the suite edit version
            try:
                if isinstance(new_testcases, dict):
                    new_testcases = {**new_testcases, "version": edit_suite_version}
            except Exception:
                pass

            inserted_row_id: Optional[str] = None
            # Persist via results writer to enforce version/active behavior (overwrite base clone)
            try:
                # Remove any existing test_cases rows for this requirement at the current edit version
                try:
                    supabase_client.table("test_cases").delete().eq("requirement_id", resolved_req_id).eq("version", edit_suite_version).execute()
                except Exception:
                    pass
                _results_writer.write_testcases(
                    session_id=suite_id_value,
                    req_code=str(req_row.get("req_code")),
                    testcases=new_testcases,
                    suite_id=suite_id_value,
                    version=edit_suite_version,
                    active=True,
                )
            except Exception as e:
                pass

            results.append(
                {
                    "requirement_id": resolved_req_id,
                    "req_code": req_row.get("req_code"),
                    "old_version": old_version or (1 if latest_row else 0),
                    "new_version": edit_suite_version,
                    "row_id": inserted_row_id,
                }
            )
            event_edits.append(
                {
                    "requirement_id": resolved_req_id,
                    "req_code": req_row.get("req_code"),
                    "diff": diff,
                    "new_testcases": new_testcases,
                    "old_version": old_version or (1 if latest_row else 0),
                    "new_version": edit_suite_version,
                    "row_id": inserted_row_id,
                }
            )

        # Suite version already incremented at start of edits

        return {
            "edited_count": len(results),
            "results": results,
            "summary": summary,
            "status": "ok",
        }

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
                    "content": "Return a friendly, user-facing preview that mirrors the upcoming artifacts. Use bullet lists and short sentences. No code blocks. Keep under ~160 words.",
                },
                {"role": "user", "content": prompt},
            ],
            reasoning_effort="minimal",
        )
        preview_text = resp.choices[0].message.content or ""

        # Build a small structured preview list for modal table display in the UI
        preview_data: Dict[str, Any] = {"preview_mode": mode or "auto"}

        # Generate a tiny requirements sample (3–6 items) similar to extract_and_store_requirements
        try:
            req_sample_prompt = f"""
You are a strict requirements extractor.
From the provided documents, output a SMALL list of 3–6 atomic, verifiable requirements.

Rules:
- Each item must be testable and standalone.
- Keep original meaning; do not add new constraints.
- Include the source doc name for each requirement.
- IDs must be REQ-1, REQ-2, ... in order of appearance.

Return STRICT JSON only:
{{
  "requirements_sample": [
    {{"id":"REQ-1","source":"<doc_name>","text":"<requirement>"}}
  ]
}}

Documents:
{bundle}
""".strip()
            req_resp = _oai.chat.completions.create(
                model=global_settings.openai_model,
                messages=[
                    {"role": "system", "content": "Return strict JSON only; no extra text."},
                    {"role": "user", "content": req_sample_prompt},
                ],
                reasoning_effort="minimal",
                response_format={"type": "json_object"},
            )
            req_raw = req_resp.choices[0].message.content or "{}"
            req_obj = json.loads(req_raw)
            req_sample = req_obj.get("requirements_sample") or []
            if not isinstance(req_sample, list):
                req_sample = []
        except Exception:
            req_sample = []

        req_rows = [
            {"id": str((r or {}).get("id")), "source": str((r or {}).get("source")), "text": str((r or {}).get("text"))}
            for r in (req_sample or [])
            if isinstance(r, dict)
        ][:6]

        # Generate a tiny test cases sample aligned with generate_and_store_testcases_for_req
        # Use the first requirement sample if available, otherwise let the model propose a plausible requirement.
        try:
            sample_req = next((r for r in (req_rows or []) if isinstance(r, dict)), None)
            sample_req_id = (sample_req or {}).get("id") or "REQ-1"
            sample_req_src = (sample_req or {}).get("source") or "unknown.txt"
            sample_req_text = (sample_req or {}).get("text") or "A core functional requirement derived from the documents."

            tc_sample_prompt = f"""
You are a precise QA engineer. Write three concise, testable cases (happy, edge, negative) for the requirement below.

Return STRICT JSON only with EXACTLY this shape:
{{
  "requirement_id": "{sample_req_id}",
  "source": "{sample_req_src}",
  "requirement_text": "<brief restatement>",
  "cases": [
    {{"id": "TC-1", "type": "happy", "title": "<short>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}},
    {{"id": "TC-2", "type": "edge", "title": "<short>", "preconditions": ["..."], "steps": ["..."], "expected": ""}},
    {{"id": "TC-3", "type": "negative", "title": "<short>", "preconditions": ["..."], "steps": ["..."], "expected": "..."}}
  ]
}}

Requirement text:
{sample_req_text}
""".strip()
            tc_resp = _oai.chat.completions.create(
                model=global_settings.openai_model,
                messages=[
                    {
                        "role": "system",
                        "content": "Return strict JSON only; no extra text. Generate compact, testable QA cases with clear steps and expectations.",
                    },
                    {"role": "user", "content": tc_sample_prompt},
                ],
                reasoning_effort="minimal",
                response_format={"type": "json_object"},
            )
            tc_raw = tc_resp.choices[0].message.content or "{}"
            tc_obj = json.loads(tc_raw)
            if not isinstance(tc_obj, dict):
                tc_obj = {}
        except Exception:
            tc_obj = {}

        # Normalize and flatten test case rows for an easy table display
        def _flatten_tc_rows(obj: Dict[str, Any]) -> List[Dict[str, Any]]:
            try:
                rid = str(obj.get("requirement_id") or "")
                src = str(obj.get("source") or "")
                cases = obj.get("cases") or []
                rows: List[Dict[str, Any]] = []
                if isinstance(cases, list):
                    for c in cases:
                        if not isinstance(c, dict):
                            continue
                        pre = c.get("preconditions")
                        st = c.get("steps")
                        pre_s = "\n".join(str(x) for x in pre) if isinstance(pre, list) else (str(pre) if pre is not None else "")
                        st_s = "\n".join(str(x) for x in st) if isinstance(st, list) else (str(st) if st is not None else "")
                        rows.append(
                            {
                                "requirement_id": rid,
                                "source": src,
                                "case_id": str(c.get("id") or ""),
                                "type": str(c.get("type") or ""),
                                "title": str(c.get("title") or ""),
                                "preconditions": pre_s,
                                "steps": st_s,
                                "expected": str(c.get("expected") or ""),
                            }
                        )
                return rows
            except Exception:
                return []

        tc_rows = _flatten_tc_rows(tc_obj)[:6]

        # Generate a small Viewpoints sample (only when requested)
        vp_rows: List[Dict[str, Any]] = []
        if mode == "viewpoints":
            try:
                vp_sample_prompt = f"""
You are creating a SMALL Integration Test Viewpoints sample from the documents.
Return STRICT JSON only:
{{
  "viewpoints_sample": [
    {{"name": "Security", "scenario": "Auth + data protection checks", "references": {{"requirements": ["REQ-1"], "flows": ["IT-FLOW-01"]}}}}
  ]
}}

Documents:
{bundle}
""".strip()
                vp_resp = _oai.chat.completions.create(
                    model=global_settings.openai_model,
                    messages=[
                        {"role": "system", "content": "Return strict JSON only; no extra text."},
                        {"role": "user", "content": vp_sample_prompt},
                    ],
                    reasoning_effort="minimal",
                    response_format={"type": "json_object"},
                )
                vp_raw = vp_resp.choices[0].message.content or "{}"
                vp_obj = json.loads(vp_raw)
                vps = vp_obj.get("viewpoints_sample") or []
                if isinstance(vps, list):
                    for v in vps[:6]:
                        if not isinstance(v, dict):
                            continue
                        refs = v.get("references") or {}
                        reqs = ", ".join(str(x) for x in (refs.get("requirements") or []) if x is not None)
                        flows = ", ".join(str(x) for x in (refs.get("flows") or []) if x is not None)
                        vp_rows.append({
                            "name": str(v.get("name") or ""),
                            "scenario": str(v.get("scenario") or ""),
                            "requirements": reqs,
                            "flows": flows,
                        })
            except Exception as e:

                vp_rows = []

        # Generate a small Test Design flows sample (only when requested)
        flow_rows: List[Dict[str, Any]] = []
        if mode == "test_design":
            try:
                td_sample_prompt = f"""
You are creating a SMALL Integration Test Design sample (flows) from the documents.
Return STRICT JSON only:
{{
  "flows": [
    {{"id": "IT-FLOW-01", "name": "Login success", "description": "User enters valid credentials → token issued", "requirements_linked": ["REQ-1"]}}
  ]
}}

Documents:
{bundle}
""".strip()
                td_resp = _oai.chat.completions.create(
                    model=global_settings.openai_model,
                    messages=[
                        {"role": "system", "content": "Return strict JSON only; no extra text."},
                        {"role": "user", "content": td_sample_prompt},
                    ],
                    reasoning_effort="minimal",
                    response_format={"type": "json_object"},
                )
                td_raw = td_resp.choices[0].message.content or "{}"
                td_obj = json.loads(td_raw)
                flows = td_obj.get("flows") or []
                if isinstance(flows, list):
                    for f in flows[:6]:
                        if not isinstance(f, dict):
                            continue
                        reqs = ", ".join(str(x) for x in (f.get("requirements_linked") or []) if x is not None)
                        flow_rows.append({
                            "id": str(f.get("id") or ""),
                            "name": str(f.get("name") or ""),
                            "description": str(f.get("description") or ""),
                            "requirements": reqs,
                        })
            except Exception as e:
                import traceback
                flow_rows = []

        # Include only data for the selected preview mode
        try:
            if mode == "requirements":
                preview_data["requirements"] = req_rows
            elif mode == "testcases":
                preview_data["testcases"] = tc_rows
            elif mode == "viewpoints":
                preview_data["viewpoints"] = vp_rows
            elif mode == "test_design":
                preview_data["flows"] = flow_rows
            else:
                # Auto: prefer requirements if available, otherwise testcases
                if req_rows:
                    preview_data["requirements"] = req_rows
                elif tc_rows:
                    preview_data["testcases"] = tc_rows
        except Exception:
            pass

        return ask_user(
            event_type="sample_confirmation",
            response_to_user=preview_text,
            data=preview_data,
        )

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
        sdir = SESSIONS_ROOT / suite_id_value
        docs_dir = sdir / "docs"
        blocks = []
        for p in sorted(docs_dir.glob("*.txt")):
            txt = _read_text(p, max_chars=12_000)
            blocks.append(f"DOC_NAME: {p.name}\nDOC_TEXT:\n{txt}\nEND_DOC")
        if not blocks:
            return "No documents available for gap analysis."
        bundle = "\n\n".join(blocks)

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
          "sitemap_mermaid": "mermaid\nflowchart TD\n...",
          "flows": [
            {
              "id": "IT-FLOW-01",
              "name": "...",
              "requirements_linked": ["REQ-1", "REQ-2"],
              "description": "A → B → C",
              "diagram_mermaid": "mermaid\nflowchart TD\n..."
            }
          ],
          "clarifying_questions": ["..."],
          "notes": "..."
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

        # Read docs context
        sdir = SESSIONS_ROOT / suite_id_value
        docs_dir = sdir / "docs"
        blocks: List[str] = []
        for p in sorted(docs_dir.glob("*.txt")):
            try:
                txt = _read_text(p, max_chars=16_000)
            except Exception:
                txt = ""
            blocks.append(f"DOC_NAME: {p.name}\nDOC_TEXT:\n{txt}\nEND_DOC")
        docs_bundle = "\n\n".join(blocks) if blocks else ""

        # Build prompt from user specification
        req_ctx = json.dumps(reqs or [], ensure_ascii=False)
        if len(req_ctx) > 12_000:
            req_ctx = req_ctx[:12_000] + "\n...truncated..."

        prompt = (
            "Integration Testing Test Design Specification\n\n"
            "Role & Task\n"
            "You are an expert test designer for Integration Testing (IT).\n"
            "Your task is to create test design artifacts (Sitemap + Screen Flow Diagrams) based on the Requirement List and the uploaded Requirement Documents.\n\n"
            "Steps to Follow\n"
            "1. Input Understanding\n"
            "   - Read the provided Requirement List (grouped into Features → Functions → Screens).\n"
            "   - Cross-check with the uploaded Requirement Documents.\n"
            "2. Summarized but Not Limited to Requirements\n"
            "   - Summarize requirements into Integration Flows.\n"
            "   - If requirements are unclear → raise clarifying questions.\n"
            "   - Suggest additional flows where needed for full business coverage.\n"
            "3. Output Format (Mandatory)\n"
            "   - Return STRICT JSON ONLY with the following shape:\n"
            "   {\n"
            '     "sitemap_mermaid": "mermaid\\nflowchart TD\\n...",\n'
            '     "flows": [\n'
            "       {\n"
            '         "id": "IT-FLOW-01",\n'
            '         "name": "...",\n'
            '         "requirements_linked": ["REQ-1"],\n'
            '         "description": "A → B → C",\n'
            '         "diagram_mermaid": "mermaid\\nflowchart TD\\n..."\n'
            "       }\n"
            "     ],\n"
            '     "clarifying_questions": [],\n'
            '     "notes": ""\n'
            "   }\n\n"
            "Clarity & Traceability\n"
            "- Every flow must map to Requirement IDs (use the IDs from the list).\n"
            "- You may include suggested flows if needed for coverage, but do not add a status field.\n"
            "- Keep diagrams simple.\n\n"
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
            assert isinstance(data, dict)
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

    def generate_viewpoints(style: str = "json") -> Any:
        """Generate Integration Test Checklist (IT Viewpoints) with flow/requirement references.

        - Produces strict JSON containing a table-like "checklist" and a backward-compatible
          "viewpoints" array (per-requirement items) for persistence.
        """
        # Gather requirements
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
                        reqs.append(
                            {
                                "id": content.get("id") or row.get("req_code"),
                                "text": content.get("text"),
                                "source": content.get("source"),
                            }
                        )
            except Exception:
                reqs = []

        # Load latest Integration Test Design (flows) for cross-references
        test_design_content: Dict[str, Any] = {}
        test_design_id_value: Optional[str] = _SUITE_TEST_DESIGN_ID.get(suite_id_value)
        try:
            if test_design_id_value:
                td_rows = (
                    supabase_client.table("test_designs")
                    .select("id, content")
                    .eq("id", test_design_id_value)
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
            else:
                td_rows = (
                    supabase_client.table("test_designs")
                    .select("id, content")
                    .eq("suite_id", suite_id_value)
                    .eq("testing_type", "integration")
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
            if td_rows:
                test_design_id_value = str(
                    (td_rows[0] or {}).get("id") or test_design_id_value
                )
                cd = (td_rows[0] or {}).get("content")
                if isinstance(cd, dict):
                    test_design_content = cd
        except Exception:
            pass

        sdir = SESSIONS_ROOT / suite_id_value
        docs_dir = sdir / "docs"
        blocks: List[str] = []
        for p in sorted(docs_dir.glob("*.txt")):
            try:
                txt = _read_text(p, max_chars=10_000)
            except Exception:
                txt = ""
            blocks.append(f"DOC_NAME: {p.name}\nDOC_TEXT:\n{txt}\nEND_DOC")
        docs_bundle = "\n\n".join(blocks) if blocks else ""

        req_ctx = json.dumps(reqs or [], ensure_ascii=False)
        if len(req_ctx) > 10_000:
            req_ctx = req_ctx[:10_000] + "\n...truncated..."
        try:
            flows_ctx = json.dumps(
                (test_design_content or {}).get("flows", [])[:30], ensure_ascii=False
            )
        except Exception:
            flows_ctx = "[]"

        # Build user-provided instruction prompt to produce a structured checklist and viewpoints
        prompt = (
            "You are an expert Integration Test (IT) designer.\n"
            "Create an IT Test Checklist (IT Viewpoints) based on: (1) Requirement Documents, (2) Requirement List (Features → Functions → Screens), (3) IT Test Design (Sitemap + Integration Flows with requirement mapping), and (4) Domain Knowledge.\n\n"
            "Objectives:\n"
            "- Ensure system-wide coverage including success paths, failure/negative, boundary & edge, exception handling, security, performance & load, usability & accessibility, data integrity & consistency, interoperability, error recovery & resilience, compliance/regulatory, and any other context-relevant perspectives.\n"
            "\n"
            "Traceability:\n"
            "- Every checklist item must link to at least one Requirement ID and/or Integration Flow ID. If no mapping exists, leave the reference arrays empty.\n"
            "- Treat the checklist as a cross-cutting baseline across modules (not tied to flow order).\n\n"
            "Return STRICT JSON ONLY with this shape (no markdown, no code blocks):\n"
            "{\n"
            '  "checklist": [\n'
            "    {\n"
            '      "no": 1,\n'
            '      "level1": "<Feature/Module>",\n'
            '      "level2": "<Function>",\n'
            '      "level3": "<success|fail|boundary|security|...>",\n'
            '      "scenario": "<Scenario / Checkpoints; use short sentences; bullets may be separated by \\n-">",\n'
            '      "requirement_references": ["REQ-1"],\n'
            '      "test_design_references": ["IT-FLOW-01"],\n'
            '      "integration_test": true\n'
            "    }\n"
            "  ],\n"
            '  "viewpoints": [\n'
            "    {\n"
            '      "req_code": "REQ-1",\n'
            '      "req_text": "...",\n'
            '      "items": [\n'
            "        {\n"
            '          "name": "Security",\n'
            '          "references": {"requirements": ["REQ-1"], "flows": ["IT-FLOW-01"]}\n'
            "        }\n"
            "      ]\n"
            "    }\n"
            "  ],\n"
            '  "summary": "<short overview>"\n'
            "}\n\n"
            f"Requirement List (JSON):\n{req_ctx}\n\n"
            f"IT Test Design (flows excerpt JSON):\n{flows_ctx}\n\n"
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
            assert isinstance(data, dict)
            # Ensure viewpoints exist for persistence; synthesize minimal if missing
            vp = data.get("viewpoints")
            if not isinstance(vp, list) or not vp:
                synthesized: List[Dict[str, Any]] = []
                for r in (reqs or [])[:30]:
                    if not isinstance(r, dict):
                        continue
                    synthesized.append(
                        {
                            "req_code": r.get("id"),
                            "req_text": r.get("text"),
                            "items": [
                                {
                                    "name": "Integration",
                                    "references": {
                                        "requirements": [r.get("id")],
                                        "flows": [],
                                    },
                                }
                            ],
                        }
                    )
                data["viewpoints"] = synthesized
            # Increment suite version first, then persist with this version
            version_now = _increment_suite_version("Generated viewpoints")
            try:
                _results_writer.write_viewpoints(
                    session_id=suite_id_value,
                    suite_id=suite_id_value,
                    content=data,
                    test_design_id=test_design_id_value
                    or _SUITE_TEST_DESIGN_ID.get(suite_id_value),
                    testing_type="integration",
                    version=version_now,
                    active=True,
                )
            except Exception:
                pass
            return "Viewpoints generated successfully"
        except Exception as e:
            raise ValueError(f"Invalid JSON from viewpoints generator: {e}")

    def ask_user(event_type: str, response_to_user: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
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
            generate_preview,
            extract_and_store_requirements,
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
            generate_and_store_testcases_for_req,
            generate_direct_testcases_on_docs,
            edit_testcases_for_req,
            generate_integration_testcases_for_req,
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
    reasoning_effort="low",
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
                _event_payload["content"][0].get("name") == "ask_user"
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
            print(_event_payload)
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
