from __future__ import annotations
from typing import Any, Dict, List, Optional

from supabase import Client, create_client


class ResultsWriter:
    def write_requirements(
        self,
        *,
        session_id: str,
        requirements: List[Dict[str, Any]],
        suite_id: Optional[str] = None,
        version: Optional[int] = None,
        active: bool = True,
    ) -> None:
        raise NotImplementedError

    def write_testcases(
        self,
        *,
        session_id: str,
        req_code: str,
        testcases: Dict[str, Any],
        suite_id: Optional[str] = None,
        version: Optional[int] = None,
        active: bool = True,
    ) -> None:
        raise NotImplementedError

    def write_event(
        self,
        *,
        suite_id: Optional[str],
        event: Dict[str, Any],
    ) -> None:
        raise NotImplementedError

    def write_suite_state(
        self,
        *,
        suite_id: Optional[str],
        state: Dict[str, Any],
    ) -> None:
        raise NotImplementedError

    def get_suite_state(
        self,
        *,
        suite_id: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        """Return the latest saved suite state (prefer nested agent_state).

        Implementations should return:
        - state["agent_state"] if present and a dict
        - else the raw state if it is a dict
        - else None
        """
        raise NotImplementedError

    # New: persist Integration Test Design JSON
    def write_test_design(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        content: Dict[str, Any],
        testing_type: str = "integration",
        version: Optional[int] = None,
        active: bool = True,
    ) -> Optional[str]:
        raise NotImplementedError

    # New: persist per-requirement viewpoints linked to test_design and requirement
    def write_viewpoints(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        content: Dict[str, Any],
        test_design_id: Optional[str],
        testing_type: str = "integration",
        version: Optional[int] = None,
        active: bool = True,
    ) -> List[str]:
        raise NotImplementedError


class NoopResultsWriter(ResultsWriter):
    def write_requirements(
        self,
        *,
        session_id: str,
        requirements: List[Dict[str, Any]],
        suite_id: Optional[str] = None,
        version: Optional[int] = None,
        active: bool = True,
    ) -> None:
        return None

    def write_testcases(
        self,
        *,
        session_id: str,
        req_code: str,
        testcases: Dict[str, Any],
        suite_id: Optional[str] = None,
        version: Optional[int] = None,
        active: bool = True,
    ) -> None:
        return None

    def write_event(
        self,
        *,
        suite_id: Optional[str],
        event: Dict[str, Any],
        message_id: Optional[str] = None,
    ) -> None:
        return None

    def write_suite_state(
        self,
        *,
        suite_id: Optional[str],
        state: Dict[str, Any],
    ) -> None:
        return None

    def get_suite_state(
        self,
        *,
        suite_id: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        return None

    def write_test_design(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        content: Dict[str, Any],
        testing_type: str = "integration",
        version: Optional[int] = None,
        active: bool = True,
    ) -> Optional[str]:
        return None

    def write_viewpoints(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        content: Dict[str, Any],
        test_design_id: Optional[str],
        testing_type: str = "integration",
        version: Optional[int] = None,
        active: bool = True,
    ) -> List[str]:
        return []


class SupabaseResultsWriter(ResultsWriter):
    def __init__(
        self,
        client: Client | None = None,
        url: str | None = None,
        key: str | None = None,
    ) -> None:
        if client is not None:
            self._client = client
        elif url and key:
            self._client = create_client(url, key)
        else:
            raise ValueError("Provide either a Supabase client or url+key")

    def _get_requirement_row_id(
        self, *, suite_id: Optional[str], req_code: str
    ) -> Optional[str]:
        q = (
            self._client.table("requirements")
            .select("id, suite_id, req_code")
            .eq("req_code", req_code)
        )
        if suite_id is None:
            q = q.is_("suite_id", None)
        else:
            q = q.eq("suite_id", suite_id)
        data = q.limit(1).execute().data or []
        if data:
            return data[0]["id"]
        return None

    def write_requirements(
        self,
        *,
        session_id: str,
        requirements: List[Dict[str, Any]],
        suite_id: Optional[str] = None,
        version: Optional[int] = None,
        active: bool = True,
    ) -> None:
        rows: List[Dict[str, Any]] = []
        for r in requirements:
            req_code = r.get("id") or ""
            source_doc = r.get("source") or ""
            if not req_code:
                continue
            rows.append(
                {
                    "suite_id": suite_id,
                    "req_code": req_code,
                    "source_doc": source_doc,
                    "content": r,
                    "version": version,
                    "active": bool(active),
                }
            )

        # Store as new versioned rows: deactivate prior active then insert
        for row in rows:
            # Deactivate previous active row(s) for this key
            try:
                q = self._client.table("requirements").update(
                    {"active": False}
                ).eq("suite_id", row["suite_id"]).eq("req_code", row["req_code"]).eq("active", True)
                q.execute()
            except Exception:
                pass
            # Insert new active row with version
            self._client.table("requirements").insert(row).execute()

    def write_testcases(
        self,
        *,
        session_id: str,
        req_code: str,
        testcases: Dict[str, Any],
        suite_id: Optional[str] = None,
        version: Optional[int] = None,
        active: bool = True,
    ) -> None:
        # Find requirement row by (suite_id, req_code)
        req_row_id = self._get_requirement_row_id(suite_id=suite_id, req_code=req_code)
        if not req_row_id:
            # If requirement row not present, create a minimal one first
            self._client.table("requirements").insert(
                {
                    "suite_id": suite_id,
                    "req_code": req_code,
                    "source_doc": testcases.get("source", ""),
                    "content": {
                        "id": req_code,
                        "source": testcases.get("source", ""),
                        "text": testcases.get("requirement_text", ""),
                        "version": version,
                        "active": bool(active),
                    },
                    "version": version,
                    "active": bool(active),
                }
            ).execute()
            req_row_id = self._get_requirement_row_id(
                suite_id=suite_id, req_code=req_code
            )
            if not req_row_id:
                return

        # Deactivate existing active test_cases for this requirement_id
        try:
            self._client.table("test_cases").update({"active": False}).eq("requirement_id", req_row_id).eq("active", True).execute()
        except Exception:
            pass
        # Insert new versioned active row
        self._client.table("test_cases").insert(
            {
                "requirement_id": req_row_id,
                "suite_id": suite_id,
                "content": testcases,
                "version": version,
                "active": bool(active),
            }
        ).execute()

    def write_event(
        self,
        *,
        suite_id: Optional[str],
        event: Dict[str, Any],
        message_id: Optional[str] = None,
    ) -> None:
        # Assumes a table public.team_events(suite_id uuid, payload jsonb, created_at timestamptz default now())
        # print({"suite_id": suite_id, "payload": event, "message_id": message_id})
        self._client.table("team_events").insert(
            {"suite_id": suite_id, "payload": event, "message_id": message_id}
        ).execute()

    def write_suite_state(
        self,
        *,
        suite_id: Optional[str],
        state: Dict[str, Any],
    ) -> None:
        if not suite_id:
            return
        # Fetch existing state to merge to avoid clobbering other keys
        data = (
            self._client.table("test_suites")
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
        current["agent_state"] = state
        self._client.table("test_suites").update({"state": current}).eq(
            "id", suite_id
        ).execute()

    def get_suite_state(
        self,
        *,
        suite_id: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        if not suite_id:
            return None
        data = (
            self._client.table("test_suites")
            .select("id, state")
            .eq("id", suite_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not data:
            return None
        state_obj = data[0].get("state")
        return state_obj

    def write_test_design(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        content: Dict[str, Any],
        testing_type: str = "integration",
        version: Optional[int] = None,
        active: bool = True,
    ) -> Optional[str]:
        # Deactivate prior active for (suite_id, testing_type)
        try:
            self._client.table("test_designs").update({"active": False}).eq("suite_id", suite_id).eq("testing_type", testing_type).eq("active", True).execute()
        except Exception:
            pass
        row = {
            "suite_id": suite_id,
            "testing_type": testing_type,
            "content": content,
            "version": version,
            "active": bool(active),
        }
        res = self._client.table("test_designs").insert(row).execute()
        try:
            return ((res.data or [])[0] or {}).get("id")
        except Exception:
            return None

    def write_viewpoints(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        content: Dict[str, Any],
        test_design_id: Optional[str],
        testing_type: str = "integration",
        version: Optional[int] = None,
        active: bool = True,
    ) -> List[str]:
        inserted_ids: List[str] = []
        vp_groups = content.get("viewpoints") if isinstance(content, dict) else None
        if not isinstance(vp_groups, list):
            return inserted_ids
        for group in vp_groups:
            if not isinstance(group, dict):
                continue
            req_code = group.get("req_code")
            items = group.get("items") if isinstance(group.get("items"), list) else []
            requirement_id = None
            if req_code:
                requirement_id = self._get_requirement_row_id(
                    suite_id=suite_id, req_code=str(req_code)
                )
            for it in items:
                if not isinstance(it, dict):
                    continue
                # Deactivate prior active with same natural key (suite, requirement, name)
                try:
                    self._client.table("viewpoints").update({"active": False}).eq("suite_id", suite_id).eq("requirement_id", requirement_id).eq("name", it.get("name")).eq("active", True).execute()
                except Exception:
                    pass
                row = {
                    "suite_id": suite_id,
                    "test_design_id": test_design_id,
                    "requirement_id": requirement_id,
                    "name": it.get("name"),
                    "rationale": it.get("rationale"),
                    "content": it,
                    "version": version,
                    "active": bool(active),
                }
                res = self._client.table("viewpoints").insert(row).execute()
                try:
                    rid = ((res.data or [])[0] or {}).get("id")
                    if rid:
                        inserted_ids.append(rid)
                except Exception:
                    pass
        return inserted_ids
