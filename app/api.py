from __future__ import annotations
import asyncio
import json
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.agent import model_client, run_stream_with_suite
from autogen_agentchat.ui import Console


app = FastAPI(title="Agentic Tester API")

# Permissive CORS (allow all). Consider restricting in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    task: str
    suite_id: str | None = None


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/run")
async def run_agent(req: RunRequest) -> StreamingResponse:
    """Trigger the agent flow and stream minimal JSON lines of progress."""

    async def _event_stream() -> AsyncGenerator[str, None]:
        async for event in run_stream_with_suite(task=req.task, suite_id=req.suite_id):
            try:
                payload = {
                    "type": getattr(event, "type", None),
                    "from": getattr(event, "source", None),
                    "to": getattr(event, "target", None),
                    "message": getattr(event, "message", None),
                }
                yield json.dumps(payload, ensure_ascii=False) + "\n"
            except Exception:
                yield json.dumps({"event": "progress"}) + "\n"
        yield json.dumps({"event": "done"}) + "\n"

    return StreamingResponse(_event_stream(), media_type="text/plain")


@app.post("/run/stream")
async def run_agent_stream(req: RunRequest) -> StreamingResponse:
    """Trigger the agent flow and stream minimal JSON lines of progress.

    Each line is a JSON object representing a lightweight event. This avoids
    coupling to any specific UI while providing visibility to the caller.
    """

    async def _event_stream() -> AsyncGenerator[str, None]:
        # We lightly wrap the stream and surface only small event summaries.
        # The Console UI is not used here to avoid writing to stdout.
        async for event in run_stream_with_suite(task=req.task, suite_id=req.suite_id):
            try:
                # Best-effort compact serialization of event metadata
                payload = {
                    "type": getattr(event, "type", None),
                    "from": getattr(event, "source", None),
                    "to": getattr(event, "target", None),
                    "message": getattr(event, "message", None),
                }
                yield json.dumps(payload, ensure_ascii=False) + "\n"
            except Exception:
                # Fall back to a simple heartbeat if unknown event shape
                yield json.dumps({"event": "progress"}) + "\n"
        yield json.dumps({"event": "done"}) + "\n"

    return StreamingResponse(_event_stream(), media_type="text/plain")


@app.on_event("shutdown")
async def shutdown_event() -> None:
    # Ensure the shared model client is closed cleanly on server shutdown
    try:
        await model_client.close()
    except Exception:
        pass


