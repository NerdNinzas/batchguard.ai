"""Notifications, workflow (node builder), dashboard overview, observability, SSE stream, evaluation."""

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from fastapi.responses import HTMLResponse

from .. import bus, mail
from ..auth import current_org, current_user
from ..config import settings
from ..db import conn, j, row, rows, tx, uj
from ..ids import new_id, now

router = APIRouter(prefix="/api", tags=["app"])


# ---------- notifications ----------
@router.get("/notifications")
def notifications(limit: int = 50, org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    return rows(conn().execute("SELECT * FROM notifications WHERE org_id=? ORDER BY sent_at DESC LIMIT ?", (org["id"], limit)).fetchall())


@router.post("/notifications/read")
def mark_read(org: dict[str, Any] = Depends(current_org)) -> dict[str, bool]:
    with tx() as c:
        c.execute("UPDATE notifications SET read=1 WHERE org_id=?", (org["id"],))
    return {"ok": True}


@router.post("/notifications/test-email")
def test_email(org: dict[str, Any] = Depends(current_org), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    subj, html_body = mail.test_email(user)
    status = mail.send(user["email"], subj, html_body)
    n = {"id": new_id("ntf"), "org_id": org["id"], "incident_id": None, "channel": "email", "contact_id": None, "to_addr": user["email"],
         "subject": subj, "body": "test email", "status": status, "sent_at": now(), "read": 1}
    with tx() as c:
        c.execute("INSERT INTO notifications (id, org_id, incident_id, channel, contact_id, to_addr, subject, body, status, sent_at, read) "
                  "VALUES (:id,:org_id,:incident_id,:channel,:contact_id,:to_addr,:subject,:body,:status,:sent_at,:read)", n)
    return {"status": status, "to": user["email"], "enabled": mail.enabled(), "from": settings.resend_from}


@router.get("/email/templates")
def email_templates(org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    return {"enabled": mail.enabled(), "from": settings.resend_from, "templates": mail.TEMPLATES, "asset_base": settings.email_asset_base}


@router.get("/email/preview/{kind}", response_class=HTMLResponse)
def email_preview(kind: str, org: dict[str, Any] = Depends(current_org), user: dict[str, Any] = Depends(current_user)) -> str:
    _, html_body = mail.render(kind, user, org)
    return html_body


# ---------- workflow ----------
class WorkflowIn(BaseModel):
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)


@router.get("/workflow")
def get_workflow(org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    w = row(conn().execute("SELECT * FROM workflows WHERE org_id=?", (org["id"],)).fetchone()) or {"nodes": "[]", "edges": "[]", "updated_at": 0}
    return {"nodes": uj(w["nodes"], []), "edges": uj(w["edges"], []), "updated_at": w["updated_at"]}


@router.put("/workflow")
def put_workflow(body: WorkflowIn, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    with tx() as c:
        c.execute("INSERT INTO workflows (org_id, nodes, edges, updated_at) VALUES (?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET nodes=excluded.nodes, edges=excluded.edges, updated_at=excluded.updated_at",
                  (org["id"], j(body.nodes), j(body.edges), now()))
        # machine order on the line follows the edges (upstream → downstream)
        order: list[str] = []
        succ = {e["source"]: e["target"] for e in body.edges if e.get("source") and e.get("target")}
        targets = set(succ.values())
        heads = [n["id"] for n in body.nodes if n.get("id") not in targets and n.get("type") == "machine"]
        for h in heads:
            cur = h
            seen = set()
            while cur and cur not in seen:
                seen.add(cur)
                order.append(cur)
                cur = succ.get(cur)
        for i, mid in enumerate(order):
            c.execute("UPDATE machines SET position=? WHERE id=? AND org_id=?", (i, mid, org["id"]))
    return {"ok": True, "order": order}


# ---------- dashboard ----------
@router.get("/overview")
def overview(org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    t = now()
    machines = rows(conn().execute("SELECT id, name, type, status, health, device_id, last_seen, verified FROM machines WHERE org_id=? ORDER BY position", (org["id"],)).fetchall())
    open_inc = rows(conn().execute("SELECT * FROM incidents WHERE org_id=? AND status IN ('open','acknowledged') ORDER BY opened_at DESC", (org["id"],)).fetchall())
    day = rows(conn().execute("SELECT severity, status, opened_at, acknowledged_at FROM incidents WHERE org_id=? AND opened_at>=?", (org["id"], t - 86400)).fetchall())
    ack_times = [i["acknowledged_at"] - i["opened_at"] for i in day if i.get("acknowledged_at")]
    rate = conn().execute("SELECT COUNT(*) n FROM readings WHERE received_at>=? AND machine_id IN (SELECT id FROM machines WHERE org_id=?)", (t - 60, org["id"])).fetchone()["n"]
    # incidents per hour for the last 24h
    buckets = [0] * 24
    for i in day:
        buckets[min(23, int((t - i["opened_at"]) // 3600))] += 1
    # per-machine sparkline of its first parameter (last 40 points) + primary latest values
    sparks: dict[str, dict[str, Any]] = {}
    for m in machines:
        p = conn().execute("SELECT name, unit FROM parameters WHERE machine_id=? ORDER BY name LIMIT 1", (m["id"],)).fetchone()
        if not p:
            continue
        pts = [r["value"] for r in conn().execute("SELECT value FROM readings WHERE machine_id=? AND parameter=? ORDER BY ts DESC LIMIT 40", (m["id"], p["name"])).fetchall()][::-1]
        latest = {r["parameter"]: {"value": r["value"], "unit": r["unit"], "state": r["state"], "forecast": uj(r["forecast"], None)} for r in conn().execute("SELECT * FROM latest WHERE machine_id=?", (m["id"],)).fetchall()}
        sparks[m["id"]] = {"parameter": p["name"], "unit": p["unit"], "points": pts, "latest": latest}
    ingest = [0] * 30
    for r in conn().execute("SELECT received_at FROM readings WHERE received_at>=? AND machine_id IN (SELECT id FROM machines WHERE org_id=?)", (t - 1800, org["id"])).fetchall():
        ingest[min(29, int((t - r["received_at"]) // 60))] += 1
    recent = rows(conn().execute("SELECT i.id, i.severity, i.status, i.title, i.opened_at, i.report_source, i.machine_id, m.name machine_name FROM incidents i JOIN machines m ON m.id=i.machine_id WHERE i.org_id=? ORDER BY i.opened_at DESC LIMIT 6", (org["id"],)).fetchall())
    runs = rows(conn().execute("SELECT r.source, r.ok, r.started_at, r.finished_at, i.title FROM agent_runs r JOIN incidents i ON i.id=r.incident_id WHERE i.org_id=? ORDER BY r.started_at DESC LIMIT 5", (org["id"],)).fetchall())
    contacts = conn().execute("SELECT COUNT(*) n FROM contacts WHERE org_id=?", (org["id"],)).fetchone()["n"]
    resolved_24h = sum(1 for i in day if i["status"] == "resolved")
    return {
        "machines": machines,
        "sparks": sparks,
        "ingest_per_minute": list(reversed(ingest)),
        "recent_incidents": recent,
        "agent_runs": runs,
        "contacts": contacts,
        "org": {"name": org["name"], "industry": org.get("industry"), "timezone": org.get("timezone")},
        "counts": {"machines": len(machines), "online": sum(1 for m in machines if m["status"] not in ("offline", "stale")), "resolved_24h": resolved_24h,
                   "open_incidents": len(open_inc), "critical": sum(1 for i in open_inc if i["severity"] in ("critical", "emergency")),
                   "readings_per_min": rate, "mean_ack_seconds": round(sum(ack_times) / len(ack_times)) if ack_times else None},
        "open_incidents": [{**i, "signals": uj(i["signals"], []), "report": None} for i in open_inc[:10]],
        "incidents_per_hour": list(reversed(buckets)),
        "gemini_enabled": settings.gemini_enabled, "smtp_enabled": settings.email_enabled,
    }


# ---------- observability ----------
@router.get("/observability")
def observability(org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    t = now()
    mids = [r["id"] for r in conn().execute("SELECT id FROM machines WHERE org_id=?", (org["id"],)).fetchall()]
    ph = ",".join("?" * len(mids)) or "''"
    # ingestion per minute, last 30 min
    ingest = [0] * 30
    for r in conn().execute(f"SELECT received_at FROM readings WHERE received_at>=? AND machine_id IN ({ph})", (t - 1800, *mids)).fetchall():
        ingest[min(29, int((t - r["received_at"]) // 60))] += 1
    api = rows(conn().execute("SELECT route, method, status, ms, ts FROM api_logs WHERE ts>=? ORDER BY ts DESC LIMIT 300", (t - 3600,)).fetchall())
    by_route: dict[str, dict[str, Any]] = {}
    for a in api:
        b = by_route.setdefault(a["route"], {"route": a["route"], "n": 0, "errors": 0, "ms": []})
        b["n"] += 1
        b["errors"] += 1 if a["status"] >= 400 else 0
        b["ms"].append(a["ms"])
    routes = [{"route": k, "n": v["n"], "errors": v["errors"], "p50_ms": round(sorted(v["ms"])[len(v["ms"]) // 2], 1), "p95_ms": round(sorted(v["ms"])[int(len(v["ms"]) * 0.95) - 1 if len(v["ms"]) > 1 else 0], 1)} for k, v in by_route.items()]
    runs = rows(conn().execute("SELECT r.*, i.title FROM agent_runs r JOIN incidents i ON i.id=r.incident_id WHERE i.org_id=? ORDER BY r.started_at DESC LIMIT 20", (org["id"],)).fetchall())
    for r in runs:
        r["tool_calls"] = uj(r["tool_calls"], [])
        r["duration_s"] = round((r["finished_at"] or t) - r["started_at"], 1)
    # detection latency: incident opened_at - first signal ts ≈ 0 in-process; report latency = run duration
    stale = [m for m in rows(conn().execute("SELECT name, status, last_seen FROM machines WHERE org_id=?", (org["id"],)).fetchall()) if m["status"] in ("stale", "offline")]
    return {
        "ingest_per_minute": list(reversed(ingest)),
        "routes": sorted(routes, key=lambda x: -x["n"]),
        "agent_runs": runs,
        "stale_machines": stale,
        "db_rows": {t_: conn().execute(f"SELECT COUNT(*) n FROM {t_}").fetchone()["n"] for t_ in ("readings", "events", "incidents", "notifications")},
        "config": {"gemini": settings.gemini_enabled, "smtp": settings.email_enabled, "stale_after_s": settings.stale_after_seconds, "cooldown_s": settings.incident_cooldown_seconds, "escalation_timeout_s": settings.escalation_timeout_seconds},
        "recent_logs": api[:60],
    }


# ---------- telemetry snapshot ----------
@router.get("/telemetry/latest")
def latest(org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    return rows(conn().execute(
        "SELECT l.*, m.name machine_name, m.device_id FROM latest l JOIN machines m ON m.id=l.machine_id WHERE m.org_id=? ORDER BY m.position, l.parameter", (org["id"],)
    ).fetchall())


@router.get("/telemetry/recent")
def recent(limit: int = 200, org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    return rows(conn().execute(
        "SELECT r.id, r.machine_id, m.name machine_name, r.parameter, r.value, r.unit, r.ts, r.received_at FROM readings r JOIN machines m ON m.id=r.machine_id WHERE m.org_id=? ORDER BY r.id DESC LIMIT ?",
        (org["id"], limit),
    ).fetchall())


# ---------- evaluation (blind runs) ----------
class EvalRunIn(BaseModel):
    machine_id: str
    injected_fault: str
    injected_at: float | None = None
    note: str = ""


@router.post("/eval/runs")
def add_eval_run(body: EvalRunIn, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    """Record the hidden ground-truth label. Stored in its own table the agent's tools never read."""
    with tx() as c:
        c.execute("CREATE TABLE IF NOT EXISTS eval_runs (id TEXT PRIMARY KEY, org_id TEXT, machine_id TEXT, injected_fault TEXT, injected_at REAL, note TEXT, incident_id TEXT, scored_at REAL, top1 INTEGER, top3 INTEGER, detect_delay REAL)")
        rid = new_id("eval")
        c.execute("INSERT INTO eval_runs (id, org_id, machine_id, injected_fault, injected_at, note) VALUES (?,?,?,?,?,?)",
                  (rid, org["id"], body.machine_id, body.injected_fault, body.injected_at or now(), body.note))
    return {"id": rid}


@router.get("/eval/scoreboard")
def scoreboard(org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    conn().execute("CREATE TABLE IF NOT EXISTS eval_runs (id TEXT PRIMARY KEY, org_id TEXT, machine_id TEXT, injected_fault TEXT, injected_at REAL, note TEXT, incident_id TEXT, scored_at REAL, top1 INTEGER, top3 INTEGER, detect_delay REAL)")
    runs = rows(conn().execute("SELECT * FROM eval_runs WHERE org_id=? ORDER BY injected_at DESC", (org["id"],)).fetchall())
    scored = []
    for r in runs:
        inc = row(conn().execute("SELECT * FROM incidents WHERE machine_id=? AND opened_at>=? ORDER BY opened_at LIMIT 1", (r["machine_id"], r["injected_at"] - 5)).fetchone())
        rep = uj(inc["report"], {}) if inc else {}
        names = [c["name"].lower() for c in rep.get("causes", [])] if rep else []
        label = r["injected_fault"].lower().replace("_", " ")
        hit = [i for i, n in enumerate(names) if label.split()[0] in n]
        scored.append({**r, "incident_id": inc["id"] if inc else None, "detected": bool(inc), "detect_delay": round(inc["opened_at"] - r["injected_at"], 1) if inc else None,
                       "top1": bool(hit and hit[0] == 0), "top3": bool(hit), "predicted": names[:3], "report_source": inc["report_source"] if inc else None})
    n = len(scored) or 1
    return {"runs": scored, "summary": {"runs": len(scored), "detected": sum(1 for s in scored if s["detected"]) / n, "top1": sum(1 for s in scored if s["top1"]) / n, "top3": sum(1 for s in scored if s["top3"]) / n,
                                       "mean_detect_delay": round(sum(s["detect_delay"] for s in scored if s["detect_delay"] is not None) / max(1, sum(1 for s in scored if s["detect_delay"] is not None)), 1)}}


# ---------- live stream ----------
@router.get("/stream")
async def stream(request: Request, org: dict[str, Any] = Depends(current_org)):
    q = bus.subscribe(org["id"])

    async def gen():
        try:
            yield {"event": "hello", "data": json.dumps({"org": org["id"], "ts": now()})}
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                    yield {"event": "message", "data": msg}
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
        finally:
            bus.unsubscribe(org["id"], q)

    return EventSourceResponse(gen())
