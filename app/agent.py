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
            prior_val = prior_state.get("latest_testcases_version")
            try:
                prior_int = int(prior_val) if prior_val is not None else None
            except Exception:
                prior_int = None
            if prior_int is None or int(new_version) > prior_int:
                merged_state = dict(prior_state)
                merged_state["latest_testcases_version"] = int(new_version)
                _write_full_suite_state(
                    suite_id=suite_id_value,
                    agent_state=merged_state,
                    latest_version=int(new_version),
                )
        except Exception:
            pass

    def _increment_suite_version(description: Optional[str] = None) -> Optional[int]:
        """Atomically increment suite-level latest_testcases_version by 1.

        - Reads prior agent_state via results_writer.get_suite_state (best-effort)
        - Computes new_version = (prior or 0) + 1
        - Writes merged state with updated latest_testcases_version
        - Appends a short entry to version_history with timestamp and description
        - Returns the new version if successful, else None
        """
        try:
            prior_state = _get_suite_agent_state(suite_id_value) or {}
            prior_val = prior_state.get("latest_testcases_version")
            try:
                prior_int = int(prior_val) if prior_val is not None else 0
            except Exception:
                prior_int = 0
            new_version = prior_int + 1
            merged_state = dict(prior_state)
            merged_state["latest_testcases_version"] = int(new_version)
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
            # Emit a new_version event
            try:
                _results_writer.write_event(
                    suite_id=suite_id_value,
                    event={
                        "type": "new_version",
                        "suite_id": suite_id_value,
                        "version": int(new_version),
                        "description": str(description or ""),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
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

        return {
            "requirements_artifact": f"db://requirements/{suite_id_value}",
        }

    def list_requirement_ids() -> Dict[str, Any]:
        reqs = _SUITE_REQUIREMENTS.get(suite_id_value) or []
        ids = [r.get("id") for r in reqs if isinstance(r, dict) and r.get("id")]
        return {"ids": ids}

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

            def _worker(t: tuple[str, str, str]) -> Dict[str, Any]:
                _rid, _src, _txt = t
                # Reuse the same prompt structure as single path
                prompt_local = f"""
You are an expert Integration Testing engineer. Create concise, high-value INTEGRATION test cases for the requirement below.

Return ONLY a JSON object with EXACTLY the following fields and types (no markdown):
{{
  "requirement_id": "{_rid}",
  "source": "{_src}",
  "testing_type": "integration",
  "test_design_id": "{_SUITE_TEST_DESIGN_ID.get(suite_id_value) or ''}",
  "linked_flows": ["<Flow-ID>"],
  "linked_viewpoints": ["<Viewpoint-Name>"],
  "cases": [
    {{"id": "<short id>", "type": "happy|edge|negative|alt", "title": "<short>", "preconditions": ["..."], "steps": ["..."], "expected": "...", "links": {{"flows": ["<Flow-ID>"], "viewpoints": ["<Viewpoint-Name>"]}}}}
  ]
}}

Requirement Text:
{_txt}
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
                    .select(
                        "id, requirement_id, name, rationale, content, test_design_id"
                    )
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
                        {
                            "id": r.get("id"),
                            "name": r.get("name"),
                            "rationale": r.get("rationale"),
                        }
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
You are an expert Integration Testing engineer. Create concise, high-value INTEGRATION test cases for the requirement below.

Use ALL provided context (requirement text, linked flows from the Integration Test Design, and per-requirement viewpoints). Where appropriate, align cases to flows and viewpoints.

Return ONLY a JSON object with EXACTLY the following fields and types (no markdown):
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

    def edit_testcases_for_req(user_edit_request: str) -> Dict[str, Any]:
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

        # 1) Load requirements for this suite
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

        # 2) Load current test cases for this suite
        try:
            tc_rows = (
                supabase_client.table("test_cases")
                .select("id, requirement_id, suite_id, content, version")
                .eq("suite_id", suite_id_value)
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

        # 3) Build LLM prompt (sorted by req_code, fallback to requirement_id)
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
        # Increment suite version once for this bulk edit operation with LLM-provided note
        edit_suite_version = _increment_suite_version(
            version_note or "Edited test cases (bulk)"
        )

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
                old_version = (
                    int((latest_row or {}).get("version"))
                    if (latest_row or {}).get("version") is not None
                    else None
                )
            except Exception:
                old_version = None

            # Ensure version embedded equals the suite edit version
            try:
                if isinstance(new_testcases, dict):
                    new_testcases = {**new_testcases, "version": edit_suite_version}
            except Exception:
                pass

            inserted_row_id: Optional[str] = None
            # Persist via results writer to enforce version/active behavior
            try:
                _results_writer.write_testcases(
                    session_id=suite_id_value,
                    req_code=str(req_row.get("req_code")),
                    testcases=new_testcases,
                    suite_id=suite_id_value,
                    version=edit_suite_version,
                    active=True,
                )
            except Exception:
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

        # 5) Record one bulk event (best-effort)
        _results_writer.write_event(
            suite_id=suite_id_value,
            event={
                "type": "testcases_edited_bulk",
                "suite_id": suite_id_value,
                "edits": event_edits,
                "summary": summary,
                "version_note": version_note,
                "user_edit_request": user_edit_request,
            },
            message_id=message_id,
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
                "- Preview REQUIREMENTS ONLY.\n"
                "- List a few atomic, verifiable items with brief text and doc names."
            )
        elif mode == "testcases":
            guidelines = (
                "- Preview TEST CASES ONLY.\n"
                "- Provide a few short titles, 1-3 bullet steps, and expected outcomes.\n"
                "- Reference source doc names where helpful."
            )
        else:
            guidelines = (
                "- Decide whether to preview requirements, test cases, or both, based on what seems most helpful.\n"
                "- If requirements: list a few atomic, verifiable items with brief text and doc names.\n"
                "- If test cases: provide a few short titles, 1-3 bullet steps, and expected outcomes."
            )

        prompt = f"""
You are assisting with a SHORT PREVIEW for a test suite.

Guidelines:
{guidelines}
- Keep it under ~200 words, easy to skim.
- Do not include large excerpts from the docs.

{user_ask_section}Documents:
{bundle}
""".strip()

        resp = _oai.chat.completions.create(
            model=global_settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": "Return a compact, readable preview. No code blocks unless necessary.",
                },
                {"role": "user", "content": prompt},
            ],
            reasoning_effort="minimal",
        )
        return ask_user(
            event_type="sample_confirmation",
            response_to_user=resp.choices[0].message.content,
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
        """Analyze fetched documents to identify requirement/test gaps or ambiguities.

        Behavior:
        - Reads .txt docs from the suite session directory (already fetched by fetcher).
        - Uses the model to identify missing requirements, ambiguities, conflicts, and test coverage gaps.
        - Returns a SHORT human-readable summary.
        - IMPORTANT: If any gaps are found, the returned text MUST include the token 'TERMINATE'
          so the global termination condition ends the run immediately.
        """
        sdir = SESSIONS_ROOT / suite_id_value
        docs_dir = sdir / "docs"
        blocks = []
        for p in sorted(docs_dir.glob("*.txt")):
            txt = _read_text(p, max_chars=12_000)
            blocks.append(f"DOC_NAME: {p.name}\nDOC_TEXT:\n{txt}\nEND_DOC")
        if not blocks:
            # No docs → no gaps can be assessed
            return "No documents available for gap analysis."
        bundle = "\n\n".join(blocks)

        normalized_type = (testing_type or "").strip().lower() or None
        type_hint = ""
        if normalized_type in {"unit", "integration", "system"}:
            type_hint = f"\n\nUser testing focus: {normalized_type} testing. Adjust the gaps and recommendations to emphasize {normalized_type}-testing concerns."

        prompt = f"""
You are a QA analyst. Based ONLY on the documents, identify gaps that would block clean requirements and testing.

Return ONLY JSON (no markdown):
{{
  "has_gaps": <true|false>,
  "gaps": ["<concise gap/ambiguity/assumption>", "..."] ,
  "recommendations": ["<short action>", "..."],
  "testing_type_needed": <true|false>,
  "testing_type_options": ["unit", "integration", "system"],
  "follow_up": "<if testing_type_needed is true, ask user to choose unit, integration, or system>"
}}

Consider: missing acceptance criteria, undefined terms, conflicting statements, non-testable language, unclear boundaries, missing error handling, and data/role/permission gaps.

Documents:
{bundle}
{type_hint}
""".strip()

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
            data = json.loads(raw)
            has_gaps = bool(data.get("has_gaps"))
            gaps = data.get("gaps") or []
            recs = data.get("recommendations") or []
            testing_type_needed = bool(data.get("testing_type_needed"))
            follow_up = data.get("follow_up") or ""
            if not isinstance(gaps, list):
                gaps = [str(gaps)]
            if not isinstance(recs, list):
                recs = [str(recs)]

            if has_gaps and gaps:
                lines = ["Gap analysis results:"]
                for g in gaps[:10]:
                    lines.append(f"- {str(g)}")
                if recs:
                    lines.append("\nRecommended actions:")
                    for r in recs[:10]:
                        lines.append(f"- {str(r)}")
                if testing_type_needed:
                    lines.append("\nAdditional info needed:")
                    lines.append(
                        f"- {follow_up or 'Please choose a testing focus: Unit testing, Integration testing, or System testing.'}"
                    )
                # Append TERMINATE so the run stops per termination condition
                lines.append("\nTERMINATE")
                return "\n".join(lines)
            else:
                if testing_type_needed:
                    msg = (
                        follow_up
                        or "Please choose a testing focus: Unit testing, Integration testing, or System testing."
                    )
                    return msg
                return "No significant gaps detected in documents."
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
            return json.dumps(data, ensure_ascii=False)
        except Exception as e:
            raise ValueError(f"Invalid JSON from test design generator: {e}")

    def generate_viewpoints(style: str = "json") -> Any:
        """Generate per-requirement Test Viewpoints (no status field).

        Definition: A test viewpoint is the perspective or focus area that helps
        test engineers grasp the big picture of the test design. Viewpoints are
        abstractions and the source of test cases. Types vary by organization and test.

        Returns JSON by default with shape (no status field in items):
        {
          "viewpoints": [
            {
              "req_code": "REQ-1",
              "req_text": "...",
              "items": [
                {"name": "Functional", "rationale": "..."},
                {"name": "Security", "rationale": "..."}
              ]
            }
          ],
          "summary": "short overview"
        }
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

        prompt = (
            "You are a senior test designer. Create per-requirement TEST VIEWPOINTS for Integration Testing.\n"
            "Definition: Test viewpoint is a point where test engineers focus attention to grasp the big picture of test design — it is an abstraction and a source of test cases. Types of test viewpoints depend on organizations and/or test.\n\n"
            "Guidelines:\n"
            "- Use common categories when relevant: Functional, Data Validation, Error Handling, Security/Privacy, Roles/Permissions/Access Control, Integration Interfaces/APIs, Performance/Scalability, Usability/UX, State/Workflow, Configuration/Environment.\n"
            "- For each requirement, list 3–7 most relevant viewpoints.\n"
            "- Do not include any status field.\n"
            "- Provide a one-line rationale per viewpoint to aid traceability.\n"
            "- Ensure coverage breadth but keep it concise.\n\n"
            "Return STRICT JSON ONLY with this shape:\n"
            '{\n  "viewpoints": [\n    {\n      "req_code": "REQ-1",\n      "req_text": "...",\n      "items": [\n        {"name": "Functional", "rationale": "..."}\n      ]\n    }\n  ],\n  "summary": "<short>"\n}\n\n'
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
            version_now = _increment_suite_version("Generated viewpoints")
            try:
                _results_writer.write_viewpoints(
                    session_id=suite_id_value,
                    suite_id=suite_id_value,
                    content=data,
                    test_design_id=_SUITE_TEST_DESIGN_ID.get(suite_id_value),
                    testing_type="integration",
                    version=version_now,
                    active=True,
                )
            except Exception:
                pass
            # Always return a JSON string for UI rendering and downstream parsing
            return json.dumps(data, ensure_ascii=False)
        except Exception as e:
            raise ValueError(f"Invalid JSON from viewpoints generator: {e}")

    def ask_user(event_type: str, response_to_user: str) -> Dict[str, Any]:
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
        }
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
                suite_id=suite_id_value, event=event_payload, message_id=message_id
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
        model_client=model_client,
        handoffs=["fetcher", "requirements_extractor", "testcase_writer"],
        tools=[
            generate_preview,
            ask_user,
            get_requirements_info,
            get_testcases_info,
            identify_gaps,
        ],
        system_message=(
            "You are the planner. Keep outputs tiny.\n"
            "Flow:\n"
            "  1) Parse doc names from the user's message.\n"
            "  2) Handoff to fetcher to load the docs.\n"
            "  4) Decide the path based on the user's original intent:\n"
            "     - If the ask requested to generate test cases from the document straight away:\n"
            '       You must ask for a quality choice via ask_user(event_type=\\"quality_confirmation\\", response_to_user=\\"Extract requirements first for better quality?\\").\n'
            "       On the next reply: if it's 'Yes please', handoff to requirements_extractor. If it's 'CONTINUE', handoff to testcase_writer to generate cases directly from docs.\n"
            "     - Otherwise (no explicit direct test-case request): handoff to requirements_extractor by default.\n"
            "     - If the user's request is to EDIT or UPDATE existing test cases (phrases like 'edit', 'update', 'revise', 'modify', 'tweak steps/titles/expected'):\n"
            "       Immediately handoff to testcase_writer to run edit_testcases_for_req(user_edit_request).\n"
            '       If additional clarification is needed, ask the user to specify the scope or examples using ask_user(event_type=\\"sample_confirmation\\", response_to_user=\\"Please describe which areas to adjust (titles, steps, expected outcomes, or specific requirements).\\").\n'
            '  5) After requirements_extractor finishes, it will ask ask_user(event_type=\\"requirements_feedback\\"). Wait for the next user reply.\n'
            "     If the reply is 'Generate test cases', handoff to testcase_writer to generate full test cases; then summarize and write TERMINATE.\n"
            "     If the reply indicates changes or hesitation (anything other than 'Generate test cases'), respond briefly and write TERMINATE.\n"
            "  6) After testcase_writer finishes, respond briefly with a bit of content and the word TERMINATE\n"
            "Notes: After fetcher loads the documents, RUN identify_gaps(). If gaps are found, you must return a short summary that includes the word TERMINATE to end the flow. If no gaps, proceed to the next steps.\n"
            "Also: Before handing off to requirements_extractor or testcase_writer, run generate_preview then ask_user sample_confirmation (after any quality_confirmation).\n"
            'Always confirm immediate next steps with the user via ask_user BEFORE proceeding, EXCEPT when the user explicitly requests to edit test cases—then handoff directly to testcase_writer. For example: ask_user(event_type="quality_confirmation", response_to_user="Should I extract requirements first for easier tracking before generating test cases?").\n'
            "If the user has specified a testing focus (e.g., unit or integration), call identify_gaps(testing_type=...). If not, identify_gaps will include 'testing_type_needed' and a follow-up prompt in its JSON/text output.\n"
            "If the user asks questions about existing requirements or test cases, use get_requirements_info(question=...) or get_testcases_info(question=...) to answer conciesly then write TERMINATE.\n"
            "If the user asks to edit test cases, you must handoff/transfer to testcase_writer.\n"
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
        tools=[
            extract_and_store_requirements,
            generate_test_design,
            generate_viewpoints,
            ask_user,
        ],
        system_message=(
            "Call extract_and_store_requirements().\n"
            "Reply only: requirements_artifact.\n"
            "Next, generate Integration Testing artifacts: call generate_test_design() and generate_viewpoints().\n"
            'Then call ask_user(event_type="requirements_feedback", response_to_user="Requirements extracted and test design + viewpoints prepared. Proceed to generate test cases now?") to request confirmation; this writes an event and TERMINATE.\n'
            "After every ask_user(...) call, immediately transfer back to planner (handoff to planner).\n"
            "If the user asks about requirements or test cases information at any time, do not answer; handoff to planner so it can respond using its info tools."
        ),
    )

    testcase_writer_local = AssistantAgent(
        "testcase_writer",
        model_client=model_client,
        handoffs=["planner"],
        tools=[
            generate_and_store_testcases_for_req,
            generate_direct_testcases_on_docs,
            edit_testcases_for_req,
            generate_integration_testcases_for_req,
        ],
        system_message=(
            "You MUST call a tool to act. Never reply with free text.\n"
            "- To generate directly from docs: call generate_direct_testcases_on_docs() and then handoff back to planner.\n"
            "- To generate from extracted requirements: if no specific requirement id is provided, call generate_and_store_testcases_for_req() (all requirements, concurrently).\n"
            "- If a specific requirement id is provided, call generate_and_store_testcases_for_req(req_id).\n"
            "- To generate Integration test cases leveraging Test Design and Viewpoints, call generate_integration_testcases_for_req(req_id?) and then handoff back to planner.\n"
            "- To edit existing cases suite-wide, call edit_testcases_for_req(user_edit_request).\n"
            "After any tool call, immediately handoff back to planner.\n"
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
    """Write both agent_state and a top-level latest_testcases_version into test_suites.state.

    - Reads existing state to merge.
    - Preserves other keys.
    - If latest_version is provided, writes it to top-level as latest_testcases_version.
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
                current["latest_testcases_version"] = int(latest_version)
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
        _event_payload = json.loads(event.model_dump_json())
        inserted_message_id = (
            _message_id if _event_payload.get("source") == "user" else user_message_id
        )
        if not _event_payload.get("messages"):
            _results_writer.write_event(
                suite_id=suite_id, event=_event_payload, message_id=inserted_message_id
            )
        yield event

    # Persist both agent_state and top-level latest_testcases_version (if present in agent_state)
    try:
        saved_state = await local_team.save_state()
        # If the saved_state carries a latest marker, set it at top-level too
        latest_marker = None
        try:
            lv = saved_state.get("latest_testcases_version")
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
