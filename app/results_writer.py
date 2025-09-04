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
    ) -> None:
        raise NotImplementedError

    def write_testcases(
        self,
        *,
        session_id: str,
        req_code: str,
        testcases: Dict[str, Any],
        suite_id: Optional[str] = None,
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


class NoopResultsWriter(ResultsWriter):
    def write_requirements(
        self,
        *,
        session_id: str,
        requirements: List[Dict[str, Any]],
        suite_id: Optional[str] = None,
    ) -> None:
        return None

    def write_testcases(
        self,
        *,
        session_id: str,
        req_code: str,
        testcases: Dict[str, Any],
        suite_id: Optional[str] = None,
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
                }
            )

        # Upsert manually: update if exists, else insert
        for row in rows:
            existing_id = self._get_requirement_row_id(
                suite_id=row["suite_id"], req_code=row["req_code"]
            )
            if existing_id:
                self._client.table("requirements").update(
                    {"source_doc": row["source_doc"], "content": row["content"]}
                ).eq("id", existing_id).execute()
            else:
                self._client.table("requirements").insert(row).execute()

    def write_testcases(
        self,
        *,
        session_id: str,
        req_code: str,
        testcases: Dict[str, Any],
        suite_id: Optional[str] = None,
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
                    },
                }
            ).execute()
            req_row_id = self._get_requirement_row_id(
                suite_id=suite_id, req_code=req_code
            )
            if not req_row_id:
                return

        # Upsert test_cases by unique(requirement_id)
        existing = (
            self._client.table("test_cases")
            .select("id, requirement_id, suite_id")
            .eq("requirement_id", req_row_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if existing:
            self._client.table("test_cases").update(
                {"content": testcases, "suite_id": suite_id}
            ).eq("id", existing[0]["id"]).execute()
        else:
            self._client.table("test_cases").insert(
                {
                    "requirement_id": req_row_id,
                    "suite_id": suite_id,
                    "content": testcases,
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
