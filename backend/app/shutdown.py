"""Auto-shutdown: when a critical/emergency incident gets no acknowledgement and no answered call within the
org's window (default 5 min), Muse sends the machine a `shutdown` command (devices poll /v1/commands), marks it
`shutdown`, and tells everyone why. Acknowledging or resolving cancels the countdown; `restart` sends `start`."""

from typing import Any

from . import bus, cloud, notify
from .db import conn, j, row, rows, tx, uj
from .ids import new_id, now

WARN_BEFORE = 60  # a last warning this many seconds before the shutdown


def _settings(org_id: str) -> dict[str, Any]:
    from .voice import calls

    return calls.get_settings(org_id)


def _machine(mid: str) -> dict[str, Any]:
    return row(conn().execute("SELECT * FROM machines WHERE id=?", (mid,)).fetchone()) or {}


def _publish_incident(inc_id: str) -> None:
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (inc_id,)).fetchone())
    if inc:
        bus.publish(inc["org_id"], "incident", {**inc, "signals": uj(inc["signals"], []), "report": uj(inc["report"], None)})
        cloud.mirror("incidents", inc_id, inc)


def arm(inc: dict[str, Any]) -> None:
    """Start the countdown for a critical/emergency incident (idempotent)."""
    if inc.get("severity") not in ("critical", "emergency") or inc.get("status") != "open":
        return
    if inc.get("shutdown_state") in ("pending", "warned", "done", "cancelled"):
        return
    st = _settings(inc["org_id"])
    if not st.get("auto_shutdown", 1):
        return
    after = int(st.get("shutdown_after_seconds") or 300)
    with tx() as c:
        c.execute("UPDATE incidents SET shutdown_at=?, shutdown_state='pending' WHERE id=? AND status='open'", (now() + after, inc["id"]))
    _publish_incident(inc["id"])


def cancel(inc_id: str, reason: str) -> None:
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (inc_id,)).fetchone())
    if not inc or inc.get("shutdown_state") not in ("pending", "warned"):
        return
    with tx() as c:
        c.execute("UPDATE incidents SET shutdown_state='cancelled', shutdown_at=NULL WHERE id=?", (inc_id,))
    m = _machine(inc["machine_id"])
    notify.record(inc["org_id"], inc_id, "in_app", None, f"Auto-shutdown cancelled: {m.get('name')}", reason, "delivered")
    _publish_incident(inc_id)


def send_command(machine: dict[str, Any], kind: str, reason: str, incident_id: str | None = None, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    cmd = {"id": new_id("cmd"), "machine_id": machine["id"], "type": kind, "payload": j(payload or {}), "reason": reason, "status": "pending", "incident_id": incident_id, "created_at": now(), "acked_at": None}
    with tx() as c:
        c.execute("UPDATE device_commands SET status='superseded' WHERE machine_id=? AND status='pending'", (machine["id"],))
        c.execute("INSERT INTO device_commands (id, machine_id, type, payload, reason, status, incident_id, created_at, acked_at) VALUES (:id,:machine_id,:type,:payload,:reason,:status,:incident_id,:created_at,:acked_at)", cmd)
        c.execute("INSERT INTO events (id, machine_id, type, message, severity, ts) VALUES (?,?,?,?,?,?)",
                  (new_id("evt"), machine["id"], "command", f"Command sent to device: {kind} — {reason}", "warning" if kind == "shutdown" else "info", now()))
    return cmd


def _answered(inc_id: str) -> bool:
    for c in rows(conn().execute("SELECT gathered_context, status FROM voice_calls WHERE incident_id=?", (inc_id,)).fetchall()):
        g = uj(c["gathered_context"], {}) or {}
        if str(g.get("acknowledged", "")).lower() == "true":
            return True
    return False


def execute(inc: dict[str, Any]) -> None:
    m = _machine(inc["machine_id"])
    if not m:
        return
    calls_n = conn().execute("SELECT COUNT(*) n FROM voice_calls WHERE incident_id=?", (inc["id"],)).fetchone()["n"]
    mins = max(1, int((now() - inc["opened_at"]) / 60))
    reason = (f"No one acknowledged the {inc['severity']} incident and " + (f"{calls_n} call{'s' if calls_n != 1 else ''} went unanswered" if calls_n else "no one answered")
              + f" within {mins} min — Muse is shutting {m['name']} down to protect it.")
    send_command(m, "shutdown", reason, inc["id"])
    with tx() as c:
        c.execute("UPDATE incidents SET shutdown_state='done', shutdown_at=? WHERE id=?", (now(), inc["id"]))
        c.execute("UPDATE machines SET status='shutdown', health=20 WHERE id=?", (m["id"],))
    bus.publish(inc["org_id"], "machine", {"id": m["id"], "status": "shutdown", "health": 20, "action": "shutdown", "reason": reason})
    cloud.mirror("machines", m["id"], {"status": "shutdown", "health": 20, "org_id": inc["org_id"]})
    notify.on_shutdown(inc, m, reason)
    _publish_incident(inc["id"])


def sweep() -> None:
    """Called every 5 s: send the 60 s warning, then execute due shutdowns (unless a call was answered meanwhile)."""
    t = now()
    due = rows(conn().execute("SELECT * FROM incidents WHERE status='open' AND shutdown_state IN ('pending','warned') AND shutdown_at IS NOT NULL").fetchall())
    for inc in due:
        if _answered(inc["id"]):
            cancel(inc["id"], "A contact acknowledged on the phone")
            continue
        remaining = inc["shutdown_at"] - t
        if inc["shutdown_state"] == "pending" and remaining <= WARN_BEFORE:
            m = _machine(inc["machine_id"])
            with tx() as c:
                c.execute("UPDATE incidents SET shutdown_state='warned' WHERE id=?", (inc["id"],))
            notify.record(inc["org_id"], inc["id"], "in_app", None, f"Shutting down {m.get('name')} in {int(max(1, remaining))} s",
                          "Nobody has acknowledged or answered the call. Acknowledge the incident to keep the machine running.", "delivered")
            _publish_incident(inc["id"])
        if remaining <= 0:
            execute(inc)


def restart(machine: dict[str, Any], by: str) -> dict[str, Any]:
    cmd = send_command(machine, "start", f"Restart requested by {by}")
    with tx() as c:
        c.execute("UPDATE machines SET status='offline' WHERE id=? AND status='shutdown'", (machine["id"],))
    bus.publish(machine["org_id"], "machine", {"id": machine["id"], "status": "offline", "health": machine.get("health", 100), "action": "restart"})
    notify.record(machine["org_id"], None, "in_app", None, f"Restart sent to {machine['name']}", f"by {by} — telemetry resumes once the machine comes back", "delivered")
    return cmd


# ---------------- device side ----------------
def pending_for(machine_id: str) -> list[dict[str, Any]]:
    out = rows(conn().execute("SELECT * FROM device_commands WHERE machine_id=? AND status='pending' ORDER BY created_at", (machine_id,)).fetchall())
    return [{**c, "payload": uj(c["payload"], {})} for c in out]


def ack(machine_id: str, cmd_id: str) -> bool:
    with tx() as c:
        r = c.execute("UPDATE device_commands SET status='acked', acked_at=? WHERE id=? AND machine_id=? AND status='pending'", (now(), cmd_id, machine_id))
    return r.rowcount > 0
