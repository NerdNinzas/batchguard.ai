import threading
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..agent import runner
from ..auth import current_org, current_user
from ..db import conn, row, rows, uj
from ..incidents import acknowledge, resolve

router = APIRouter(prefix="/api/incidents", tags=["incidents"])


class FeedbackIn(BaseModel):
    verdict: str  # correct | partly | wrong
    actual_cause: str = ""
    fix: str = ""


class AskIn(BaseModel):
    question: str


def _out(i: dict[str, Any]) -> dict[str, Any]:
    m = row(conn().execute("SELECT name, device_id, type FROM machines WHERE id=?", (i["machine_id"],)).fetchone()) or {}
    return {**i, "signals": uj(i["signals"], []), "report": uj(i["report"], None), "feedback": uj(i["feedback"], None), "machine": m}


def _get(org_id: str, iid: str) -> dict[str, Any]:
    i = row(conn().execute("SELECT * FROM incidents WHERE id=? AND org_id=?", (iid, org_id)).fetchone())
    if not i:
        raise HTTPException(404, "Incident not found")
    return i


@router.get("")
def list_incidents(status: str | None = None, limit: int = 100, org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    q = "SELECT * FROM incidents WHERE org_id=?" + (" AND status=?" if status else "") + " ORDER BY opened_at DESC LIMIT ?"
    args: tuple = (org["id"], status, limit) if status else (org["id"], limit)
    return [_out(i) for i in rows(conn().execute(q, args).fetchall())]


@router.get("/{iid}")
def get_incident(iid: str, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    i = _get(org["id"], iid)
    out = _out(i)
    out["runs"] = [{**r, "tool_calls": uj(r["tool_calls"], [])} for r in rows(conn().execute("SELECT * FROM agent_runs WHERE incident_id=? ORDER BY started_at DESC", (iid,)).fetchall())]
    out["chat"] = rows(conn().execute("SELECT * FROM chat WHERE incident_id=? ORDER BY ts", (iid,)).fetchall())
    out["notifications"] = rows(conn().execute("SELECT * FROM notifications WHERE incident_id=? ORDER BY sent_at", (iid,)).fetchall())
    return out


@router.post("/{iid}/ack")
def ack(iid: str, org: dict[str, Any] = Depends(current_org), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    _get(org["id"], iid)
    return _out(acknowledge(iid, user["email"]))


@router.post("/{iid}/resolve")
def resolve_incident(iid: str, body: FeedbackIn, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    _get(org["id"], iid)
    return _out(resolve(iid, body.model_dump()))


@router.post("/{iid}/investigate")
def reinvestigate(iid: str, org: dict[str, Any] = Depends(current_org)) -> dict[str, bool]:
    _get(org["id"], iid)
    threading.Thread(target=runner.investigate_async, args=(iid,), daemon=True).start()
    return {"ok": True}


@router.post("/{iid}/ask")
def ask(iid: str, body: AskIn, org: dict[str, Any] = Depends(current_org)) -> dict[str, str]:
    _get(org["id"], iid)
    return {"answer": runner.ask(iid, body.question.strip())}
