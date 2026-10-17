"""Muse copilot endpoints: streaming chat, greeting, and the Gemini Live voice relay (WebSocket)."""

import asyncio
import json
import time
from typing import Any

import jwt
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from ..agent import muse_live
from ..auth import current_org, current_user
from ..config import settings
from ..db import conn, row

router = APIRouter(prefix="/api/muse", tags=["muse"])


class ChatIn(BaseModel):
    messages: list[dict[str, str]] = Field(default_factory=list)  # [{role: user|muse, text}]
    page: str | None = None
    lang: str = "en"  # en | hi | hinglish


@router.post("/chat")
async def chat(body: ChatIn, org: dict[str, Any] = Depends(current_org), user: dict[str, Any] = Depends(current_user)):
    """Server-sent events: delta / tool / navigate / done. Runs the Gemini stream in a worker thread."""
    q: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def worker() -> None:
        try:
            for ev in muse_live.chat_stream(org["id"], user.get("name") or "", body.messages, body.page, user, body.lang if body.lang in ("en", "hi", "hinglish") else "en"):
                loop.call_soon_threadsafe(q.put_nowait, ev)
        except Exception as e:  # noqa: BLE001
            loop.call_soon_threadsafe(q.put_nowait, {"type": "error", "text": str(e)[:200]})
        finally:
            loop.call_soon_threadsafe(q.put_nowait, None)

    loop.run_in_executor(None, worker)

    async def gen():
        while True:
            ev = await q.get()
            if ev is None:
                break
            yield {"event": "message", "data": json.dumps(ev)}

    return EventSourceResponse(gen(), ping=15)


@router.get("/greeting")
def greeting(org: dict[str, Any] = Depends(current_org), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return muse_live.greeting(org["id"], user.get("name") or "")


@router.get("/snapshot")
def snapshot(org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    return muse_live.snapshot(org["id"])


@router.get("/live-token")
def live_token(org: dict[str, Any] = Depends(current_org), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    """Short-lived token for the voice websocket (the session cookie does not cross to the backend origin in production)."""
    if not settings.gemini_enabled:
        raise HTTPException(503, "Gemini is not configured")
    token = jwt.encode({"sub": user["id"], "org": org["id"], "scope": "live", "exp": int(time.time()) + 1800}, settings.auth_secret, algorithm="HS256")
    return {"token": token, "model": settings.gemini_live_model, "voice": settings.gemini_live_voice, "expires_in": 1800}


@router.websocket("/live")
async def live(ws: WebSocket):
    token = ws.query_params.get("token", "")
    page = ws.query_params.get("page")
    lang = ws.query_params.get("lang", "en")
    if lang not in ("en", "hi", "hinglish"):
        lang = "en"
    try:
        data = jwt.decode(token, settings.auth_secret, algorithms=["HS256"])
        if data.get("scope") != "live":
            raise ValueError("bad scope")
    except Exception:  # noqa: BLE001
        await ws.close(code=4401)
        return
    user = row(conn().execute("SELECT * FROM users WHERE id=?", (data["sub"],)).fetchone()) or {}
    await ws.accept()

    async def incoming():
        try:
            while True:
                raw = await ws.receive_text()
                try:
                    yield json.loads(raw)
                except json.JSONDecodeError:
                    continue
        except WebSocketDisconnect:
            return

    async def send(msg: dict[str, Any]) -> None:
        try:
            await ws.send_text(json.dumps(msg))
        except Exception:  # noqa: BLE001
            pass

    try:
        await muse_live.live_session(data["org"], user.get("name") or "", page, incoming(), send, user, lang)
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        await send({"type": "error", "text": f"Live session error: {str(e)[:200]}"})
    finally:
        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass
