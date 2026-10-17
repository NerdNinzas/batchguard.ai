import threading
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from ..agent import evidence, runner
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
def list_incidents(status: str | None = None, limit: int = 100, brief: int = 1, org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    """List incidents. `brief=1` (default) trims each report to its ranked causes + first check so lists stay small."""
    q = "SELECT * FROM incidents WHERE org_id=?" + (" AND status=?" if status else "") + " ORDER BY opened_at DESC LIMIT ?"
    args: tuple = (org["id"], status, limit) if status else (org["id"], limit)
    out = [_out(i) for i in rows(conn().execute(q, args).fetchall())]
    if brief:
        for o in out:
            r = o.get("report")
            if r:
                checks = sorted(r.get("checks") or [], key=lambda c: c.get("order", 99))
                o["report"] = {"summary": (r.get("summary") or "")[:200], "severity": r.get("severity"), "causes": [{"name": c.get("name"), "support": c.get("support")} for c in (r.get("causes") or [])[:3]],
                               "checks": checks[:1], "timeline": [], "missing_data": [], "call_script": ""}
    return out


@router.get("/{iid}")
def get_incident(iid: str, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    i = _get(org["id"], iid)
    out = _out(i)
    out["runs"] = [{**r, "tool_calls": uj(r["tool_calls"], [])} for r in rows(conn().execute("SELECT * FROM agent_runs WHERE incident_id=? ORDER BY started_at DESC", (iid,)).fetchall())]
    out["chat"] = rows(conn().execute("SELECT * FROM chat WHERE incident_id=? ORDER BY ts", (iid,)).fetchall())
    out["notifications"] = rows(conn().execute("SELECT * FROM notifications WHERE incident_id=? ORDER BY sent_at", (iid,)).fetchall())
    out["evidence"] = evidence.list_for_incident(iid)
    out["work_orders"] = rows(conn().execute("SELECT * FROM work_orders WHERE incident_id=? ORDER BY created_at", (iid,)).fetchall())
    return out


@router.post("/{iid}/ack")
def ack(iid: str, org: dict[str, Any] = Depends(current_org), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    _get(org["id"], iid)
    return _out(acknowledge(iid, user["email"]))


@router.post("/{iid}/cancel-shutdown")
def cancel_shutdown(iid: str, org: dict[str, Any] = Depends(current_org), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    from .. import shutdown as _sd

    _get(org["id"], iid)
    _sd.cancel(iid, f"Cancelled by {user.get('email') or 'user'}")
    return _out(_get(org["id"], iid))


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


# ---------- photo evidence ----------
@router.get("/{iid}/evidence")
def list_evidence(iid: str, org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    _get(org["id"], iid)
    return evidence.list_for_incident(iid)


@router.post("/{iid}/evidence")
async def add_evidence(iid: str, file: UploadFile = File(...), caption: str = Form(default=""), org: dict[str, Any] = Depends(current_org),
                       user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    inc = _get(org["id"], iid)
    mime = file.content_type or "image/jpeg"
    if not mime.startswith("image/"):
        raise HTTPException(400, "Upload an image (JPEG, PNG, WebP, HEIC)")
    data = await file.read()
    if len(data) > 12 * 1024 * 1024:
        raise HTTPException(413, "Image larger than 12 MB")
    return await __import__("asyncio").to_thread(evidence.add_photo, inc, data, file.filename or "photo.jpg", mime, caption[:300], user.get("email") or "user")


evidence_router = APIRouter(prefix="/api/evidence", tags=["incidents"])


@evidence_router.get("/{eid}/file")
def evidence_file(eid: str, org: dict[str, Any] = Depends(current_org)) -> Response:
    ev = row(conn().execute("SELECT * FROM evidence WHERE id=? AND org_id=?", (eid, org["id"])).fetchone())
    if not ev:
        raise HTTPException(404, "Not found")
    data = evidence.file_bytes(ev)
    if data is None:
        raise HTTPException(404, "File missing")
    return Response(content=data, media_type=ev.get("mime") or "image/jpeg", headers={"Cache-Control": "private, max-age=3600"})
