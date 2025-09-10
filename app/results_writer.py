from __future__ import annotations
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

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

    # Bulk: persist multiple testcases rows at once
    def write_testcases_bulk(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        rows: List[Dict[str, Any]],
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

    # Bulk: persist multiple test_design rows at once
    def write_test_design_bulk(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        items: List[Dict[str, Any]],
        version: Optional[int] = None,
        active: bool = True,
    ) -> List[str]:
        raise NotImplementedError

    # New: persist per-requirement viewpoints linked to test_design and requirement
    def write_viewpoints(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        requirement_id: Optional[str] = None,
        content: Dict[str, Any],
        test_design_id: Optional[str],
        testing_type: str = "integration",
        version: Optional[int] = None,
        active: bool = True,
    ) -> List[str]:
        raise NotImplementedError

    # Bulk: persist multiple viewpoints groups/items at once
    def write_viewpoints_bulk(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        items: List[Dict[str, Any]],
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

    def write_testcases_bulk(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        rows: List[Dict[str, Any]],
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

    def write_test_design_bulk(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        items: List[Dict[str, Any]],
        version: Optional[int] = None,
        active: bool = True,
    ) -> List[str]:
        return []

    def write_viewpoints(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        requirement_id: Optional[str] = None,
        content: Dict[str, Any],
        test_design_id: Optional[str],
        testing_type: str = "integration",
        version: Optional[int] = None,
        active: bool = True,
    ) -> List[str]:
        return []

    def write_viewpoints_bulk(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        items: List[Dict[str, Any]],
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
    def write_testcases_bulk(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        rows: List[Dict[str, Any]],
        version: Optional[int] = None,
        active: bool = True,
    ) -> None:
        # rows: [{ req_code: str, testcases: dict, version?: int }]
        if not rows:
            return None
        max_workers = min(8, max(1, len(rows)))
        def _task(row: Dict[str, Any]) -> None:
            try:
                req_code_local = str(row.get("req_code") or "").strip()
                if not req_code_local:
                    return None
                tc_local = row.get("testcases") or {}
                ver_local = (
                    row.get("version") if row.get("version") is not None else version
                )
                self.write_testcases(
                    session_id=session_id,
                    req_code=req_code_local,
                    testcases=tc_local,
                    suite_id=suite_id,
                    version=ver_local,  # type: ignore[arg-type]
                    active=active,
                )
            except Exception:
                return None
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futures = [ex.submit(_task, r) for r in rows]
            for f in as_completed(futures):
                try:
                    f.result()
                except Exception:
                    pass


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

    def write_test_design_bulk(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        items: List[Dict[str, Any]],
        version: Optional[int] = None,
        active: bool = True,
    ) -> List[str]:
        inserted_ids: List[str] = []
        if not items:
            return inserted_ids
        max_workers = min(8, max(1, len(items)))
        def _task(item: Dict[str, Any]) -> Optional[str]:
            try:
                content_local = item.get("content") or {}
                ttype_local = str(item.get("testing_type") or "integration")
                ver_local = (
                    item.get("version") if item.get("version") is not None else version
                )
                return self.write_test_design(
                    session_id=session_id,
                    suite_id=suite_id,
                    content=content_local,
                    testing_type=ttype_local,
                    version=ver_local,  # type: ignore[arg-type]
                    active=active,
                )
            except Exception:
                return None
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futures = [ex.submit(_task, it) for it in items]
            for f in as_completed(futures):
                try:
                    rid = f.result()
                    if rid:
                        inserted_ids.append(rid)
                except Exception:
                    pass
        return inserted_ids

    def write_viewpoints(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        requirement_id: Optional[str] = None,
        content: Dict[str, Any],
        test_design_id: Optional[str],
        testing_type: str = "integration",
        version: Optional[int] = None,
        active: bool = True,
    ) -> List[str]:
        inserted_ids: List[str] = []

        def _resolve_requirement_id_from_item(item: Dict[str, Any]) -> Optional[str]:
            try:
                refs = item.get("references") or {}
                reqs = refs.get("requirements") if isinstance(refs, dict) else None
                first_code = None
                if isinstance(reqs, list) and reqs:
                    first_code = reqs[0]
                if first_code is None:
                    reqs2 = item.get("requirement_references")
                    if isinstance(reqs2, list) and reqs2:
                        first_code = reqs2[0]
                if first_code:
                    return self._get_requirement_row_id(
                        suite_id=suite_id, req_code=str(first_code)
                    )
            except Exception:
                return None
            return None

        def _derive_item_name(item: Dict[str, Any]) -> str:
            name_val = item.get("name")
            if isinstance(name_val, str) and name_val.strip():
                return name_val
            l1 = str(item.get("level1") or "").strip()
            l2 = str(item.get("level2") or "").strip()
            l3 = str(item.get("level3") or "").strip()
            scen = str(item.get("scenario") or "").replace("\n", " ").strip()
            parts = [p for p in [l1, l2, l3] if p]
            base = " / ".join(parts)
            if scen:
                short = scen if len(scen) <= 80 else scen[:77] + "..."
                return f"{base}: {short}" if base else short
            return base or "Viewpoint"

        # Normalize "content" to an iterable of items with an optional req_code
        items_to_write: List[Dict[str, Any]] = []
        if isinstance(content, dict) and isinstance(content.get("viewpoints"), list):
            vp_list = content.get("viewpoints")
            has_group_shape = any(
                isinstance(g, dict) and isinstance(g.get("items"), list) for g in vp_list
            )
            if has_group_shape:
                # Original grouped format
                for group in vp_list:
                    if not isinstance(group, dict):
                        continue
                    req_code_group = group.get("req_code")
                    items = group.get("items") if isinstance(group.get("items"), list) else []
                    for it in items:
                        if isinstance(it, dict):
                            it_copy = dict(it)
                            if req_code_group is not None:
                                it_copy["__req_code"] = req_code_group
                            items_to_write.append(it_copy)
            else:
                # New unified array of row-like viewpoint objects
                for it in vp_list:
                    if isinstance(it, dict):
                        items_to_write.append(dict(it))
        elif isinstance(content, dict) and isinstance(content.get("items"), list):
            # Single group with items, possibly with req_code
            req_code_group = content.get("req_code")
            for it in content.get("items"):
                if isinstance(it, dict):
                    it_copy = dict(it)
                    if req_code_group is not None:
                        it_copy["__req_code"] = req_code_group
                    items_to_write.append(it_copy)
        elif isinstance(content, list):
            # Already a list of items
            for it in content:
                if isinstance(it, dict):
                    items_to_write.append(dict(it))
        elif isinstance(content, dict):
            # Single item
            items_to_write.append(dict(content))

        for it in items_to_write:
            if not isinstance(it, dict):
                continue
            # Determine requirement_id: prefer explicit __req_code; else derive from references
            requirement_id_local: Optional[str] = requirement_id
            req_code_hint = it.pop("__req_code", None)
            if requirement_id_local is None and req_code_hint is not None:
                try:
                    requirement_id_local = self._get_requirement_row_id(
                        suite_id=suite_id, req_code=str(req_code_hint)
                    )
                except Exception:
                    requirement_id_local = None
            if requirement_id_local is None:
                requirement_id_local = _resolve_requirement_id_from_item(it)

            # Deactivate prior active with same natural key (suite, requirement, name)
            name_value = _derive_item_name(it)
            try:
                self._client.table("viewpoints").update({"active": False}).eq("suite_id", suite_id).eq("requirement_id", requirement_id_local).eq("name", name_value).eq("active", True).execute()
            except Exception:
                pass
            row = {
                "suite_id": suite_id,
                "test_design_id": test_design_id,
                "requirement_id": requirement_id_local,
                "name": name_value,
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

    def write_viewpoints_bulk(
        self,
        *,
        session_id: str,
        suite_id: Optional[str],
        items: List[Dict[str, Any]],
        version: Optional[int] = None,
        active: bool = True,
    ) -> List[str]:
        # items: [{ content: dict, test_design_id?: str, version?: int }]
        all_inserted: List[str] = []
        if not items:
            return all_inserted
        max_workers = min(8, max(1, len(items)))
        def _task(item: Dict[str, Any]) -> List[str]:
            try:
                content_local = item.get("content") or {}
                tdesign_local = item.get("test_design_id")
                requirement_id_local = item.get("requirement_id")
                ver_local = (
                    item.get("version") if item.get("version") is not None else version
                )
                return self.write_viewpoints(
                    session_id=session_id,
                    suite_id=suite_id,
                    requirement_id=requirement_id_local,
                    content=content_local,
                    test_design_id=tdesign_local,
                    version=ver_local,  # type: ignore[arg-type]
                    active=active,
                )
            except Exception:
                return []
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futures = [ex.submit(_task, it) for it in items]
            for f in as_completed(futures):
                try:
                    inserted = f.result() or []
                    all_inserted.extend(inserted)
                except Exception:
                    pass
        return all_inserted
