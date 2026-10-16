"""Maintenance work orders: the 'action' end of detect → diagnose → act. Kanban per machine; created by hand or
from an incident's recommended checks."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import bus, cloud
from ..auth import current_org, current_user
from ..db import conn, row, rows, tx, uj
from ..ids import new_id, now

router = APIRouter(prefix="/api/work-orders", tags=["work-orders"])

STATUSES = ("open", "in_progress", "done")
PRIORITIES = ("low", "medium", "high", "urgent")
PRIORITY_BY_SEVERITY = {"info": "low", "warning": "medium", "critical": "high", "emergency": "urgent"}
DUE_HOURS = {"low": 72, "medium": 24, "high": 4, "urgent": 1}


class WorkOrderIn(BaseModel):
    machine_id: str
    incident_id: str | None = None
    title: str
    description: str = ""
    priority: str = "medium"
    assignee: str | None = None
    due_at: float | None = None


class WorkOrderPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    assignee: str | None = None
    due_at: float | None = None
    position: int | None = None


def _out(w: dict[str, Any]) -> dict[str, Any]:
    m = row(conn().execute("SELECT name, device_id FROM machines WHERE id=?", (w["machine_id"],)).fetchone()) or {}
    return {**w, "machine": m}


def _get(org_id: str, wid: str) -> dict[str, Any]:
    w = row(conn().execute("SELECT * FROM work_orders WHERE id=? AND org_id=?", (wid, org_id)).fetchone())
    if not w:
        raise HTTPException(404, "Work order not found")
    return w


def _publish(w: dict[str, Any], deleted: bool = False) -> None:
    bus.publish(w["org_id"], "work_order", {**_out(w), "deleted": deleted})
    if deleted:
        cloud.delete("work_orders", w["id"])
    else:
        cloud.mirror("work_orders", w["id"], w)


def _insert(org_id: str, body: dict[str, Any], by: str) -> dict[str, Any]:
    pr = body.get("priority") if body.get("priority") in PRIORITIES else "medium"
    t = now()
    w = {
        "id": new_id("wo"), "org_id": org_id, "machine_id": body["machine_id"], "incident_id": body.get("incident_id"), "title": body["title"][:200],
        "description": body.get("description") or "", "status": "open", "priority": pr, "assignee": body.get("assignee"),
        "due_at": body.get("due_at") or t + DUE_HOURS[pr] * 3600, "source": body.get("source") or "manual", "position": int(t), "created_by": by,
        "created_at": t, "updated_at": t, "done_at": None,
    }
    with tx() as c:
        c.execute("INSERT INTO work_orders (id, org_id, machine_id, incident_id, title, description, status, priority, assignee, due_at, source, position, created_by, created_at, updated_at, done_at) "
                  "VALUES (:id,:org_id,:machine_id,:incident_id,:title,:description,:status,:priority,:assignee,:due_at,:source,:position,:created_by,:created_at,:updated_at,:done_at)", w)
        c.execute("INSERT INTO events (id, machine_id, type, message, severity, ts) VALUES (?,?,?,?,?,?)",
                  (new_id("evt"), w["machine_id"], "work_order", f"Work order opened: {w['title']} ({pr})", "info", t))
    _publish(w)
    return w


@router.get("")
def list_work_orders(machine_id: str | None = None, incident_id: str | None = None, status: str | None = None, limit: int = 200,
                     org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    q, args = "SELECT * FROM work_orders WHERE org_id=?", [org["id"]]
    if machine_id:
        q += " AND machine_id=?"; args.append(machine_id)
    if incident_id:
        q += " AND incident_id=?"; args.append(incident_id)
    if status:
        q += " AND status=?"; args.append(status)
    q += " ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, position, created_at LIMIT ?"
    args.append(limit)
    return [_out(w) for w in rows(conn().execute(q, args).fetchall())]


@router.post("")
def create(body: WorkOrderIn, org: dict[str, Any] = Depends(current_org), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if not row(conn().execute("SELECT 1 FROM machines WHERE id=? AND org_id=?", (body.machine_id, org["id"])).fetchone()):
        raise HTTPException(404, "Machine not found")
    return _out(_insert(org["id"], body.model_dump(), user.get("email") or "user"))


@router.post("/from-incident/{iid}")
def from_incident(iid: str, org: dict[str, Any] = Depends(current_org), user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    """One work order per recommended check in Muse's report (skips checks that already have one)."""
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=? AND org_id=?", (iid, org["id"])).fetchone())
    if not inc:
        raise HTTPException(404, "Incident not found")
    report = uj(inc["report"], None) or {}
    checks = sorted(report.get("checks") or [], key=lambda c: c.get("order", 99))
    if not checks:
        raise HTTPException(400, "No recommended checks on this incident yet")
    existing = {w["title"] for w in rows(conn().execute("SELECT title FROM work_orders WHERE incident_id=?", (iid,)).fetchall())}
    pr = PRIORITY_BY_SEVERITY.get(inc["severity"], "medium")
    top = (report.get("causes") or [{}])[0].get("name", "")
    made = []
    for i, ch in enumerate(checks):
        title = f"Check {ch.get('order', i + 1)}: {ch.get('action', '')}"[:200]
        if title in existing:
            continue
        desc = f"Separates: {ch.get('discriminates', '')}\nSafety: {ch.get('safety', '')}\nSuspected: {top}\nIncident: {inc['title']}"
        made.append(_out(_insert(org["id"], {"machine_id": inc["machine_id"], "incident_id": iid, "title": title, "description": desc, "priority": pr, "source": "muse"}, user.get("email") or "user")))
    return made


@router.put("/{wid}")
def update(wid: str, body: WorkOrderPatch, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    w = _get(org["id"], wid)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if "status" in patch and patch["status"] not in STATUSES:
        raise HTTPException(400, "Bad status")
    if "priority" in patch and patch["priority"] not in PRIORITIES:
        raise HTTPException(400, "Bad priority")
    if patch.get("status") == "done" and w["status"] != "done":
        patch["done_at"] = now()
    elif "status" in patch and patch["status"] != "done":
        patch["done_at"] = None
    patch["updated_at"] = now()
    with tx() as c:
        c.execute(f"UPDATE work_orders SET {', '.join(f'{k}=:{k}' for k in patch)} WHERE id=:id", {**patch, "id": wid})
        if patch.get("status") == "done" and w["status"] != "done":
            c.execute("INSERT INTO events (id, machine_id, type, message, severity, ts) VALUES (?,?,?,?,?,?)",
                      (new_id("evt"), w["machine_id"], "work_order", f"Work order done: {w['title']}", "info", now()))
    w = _get(org["id"], wid)
    _publish(w)
    return _out(w)


@router.delete("/{wid}")
def delete(wid: str, org: dict[str, Any] = Depends(current_org)) -> dict[str, bool]:
    w = _get(org["id"], wid)
    with tx() as c:
        c.execute("DELETE FROM work_orders WHERE id=?", (wid,))
    _publish(w, deleted=True)
    return {"ok": True}
