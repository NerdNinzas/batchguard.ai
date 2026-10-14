"""In-process pub/sub for live updates (SSE). Swap for Pub/Sub + Firestore listeners at scale."""

import asyncio
import json
from collections import defaultdict
from typing import Any

_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
_loop: asyncio.AbstractEventLoop | None = None


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def subscribe(org_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    _subscribers[org_id].add(q)
    return q


def unsubscribe(org_id: str, q: asyncio.Queue) -> None:
    _subscribers[org_id].discard(q)


def publish(org_id: str, kind: str, data: Any) -> None:
    """Thread-safe: may be called from request threads."""
    if _loop is None:
        return
    msg = json.dumps({"type": kind, "data": data}, default=str)

    def _put() -> None:
        for q in list(_subscribers.get(org_id, ())):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass

    try:
        _loop.call_soon_threadsafe(_put)
    except RuntimeError:
        pass
