"""Incident lifecycle: open/attach with cooldown + grouping, severity ladder, escalation, agent hand-off."""

import threading
from typing import Any

from . import bus, notify
from .config import settings
from .db import conn, j, row, rows, tx, uj
from .detection import Signal, health_score
from .ids import new_id, now

SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2, "emergency": 3}


def _open_incident_for(machine_id: str) -> dict[str, Any] | None:
    return row(
        conn()
        .execute(
            "SELECT * FROM incidents WHERE machine_id=? AND status IN ('open','acknowledged') ORDER BY opened_at DESC LIMIT 1",
            (machine_id,),
        )
        .fetchone()
    )


def _recent_signal(incident: dict[str, Any], sig: Signal, t: float) -> bool:
    for s in uj(incident.get("signals"), []):
        if s.get("parameter") == sig.parameter and s.get("layer") == sig.layer and t - s.get("ts", 0) < settings.incident_cooldown_seconds:
            return True
    return False


def _machine(machine_id: str) -> dict[str, Any]:
    return row(conn().execute("SELECT * FROM machines WHERE id=?", (machine_id,)).fetchone()) or {}


def _update_machine_status(machine_id: str) -> None:
    m = _machine(machine_id)
    if not m:
        return
    states = [r["state"] for r in conn().execute("SELECT state FROM latest WHERE machine_id=?", (machine_id,)).fetchall()]
    status = m["status"]
    if status not in ("offline", "stale"):
        status = "critical" if "critical" in states else "warning" if "warning" in states else "normal"
    with tx() as c:
        c.execute("UPDATE machines SET status=?, health=? WHERE id=?", (status, health_score(machine_id), machine_id))
    bus.publish(m["org_id"], "machine", {"id": machine_id, "status": status, "health": health_score(machine_id)})


def handle_signals(machine_id: str, signals: list[Signal]) -> None:
    """Group signals into one incident per machine. Cooldown: same parameter+layer within 5 min attaches silently."""
    if not signals:
        _update_machine_status(machine_id)
        return
    m = _machine(machine_id)
    if not m:
        return
    t = now()
    inc = _open_incident_for(machine_id)
    worst = max(signals, key=lambda s: SEVERITY_RANK[s.severity])

    if inc is None:
        # info-only signals (single anomaly inside limits) go to the dashboard as events, not incidents
        if worst.severity == "info":
            with tx() as c:
                for s in signals:
                    c.execute(
                        "INSERT INTO events (id, machine_id, type, message, severity, ts) VALUES (?,?,?,?,?,?)",
                        (new_id("evt"), machine_id, "anomaly", s.message, "info", t),
                    )
            bus.publish(m["org_id"], "event", {"machine_id": machine_id, "message": worst.message, "severity": "info"})
            _update_machine_status(machine_id)
            return
        inc_id = new_id("inc")
        sigs = [{**s.as_dict(), "ts": t} for s in signals]
        title = f"{m['name']}: {worst.parameter} {worst.layer} {worst.severity}"
        with tx() as c:
            c.execute(
                "INSERT INTO incidents (id, org_id, machine_id, severity, status, title, opened_at, signals) VALUES (?,?,?,?,?,?,?,?)",
                (inc_id, m["org_id"], machine_id, worst.severity, "open", title, t, j(sigs)),
            )
        inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (inc_id,)).fetchone())
        _update_machine_status(machine_id)
        bus.publish(m["org_id"], "incident", {**inc, "signals": sigs})
        notify.on_incident_opened(inc, m)
        _kick_agent(inc_id)
        return

    # attach to the open incident
    existing = uj(inc["signals"], [])
    new_sigs = [s for s in signals if not _recent_signal(inc, s, t)]
    if not new_sigs:
        _update_machine_status(machine_id)
        return
    existing += [{**s.as_dict(), "ts": t} for s in new_sigs]
    old_sev = inc["severity"]
    new_sev = old_sev
    # several parameters in warning together → critical
    warn_params = {s["parameter"] for s in existing if s["severity"] == "warning"}
    if SEVERITY_RANK[worst.severity] > SEVERITY_RANK[new_sev]:
        new_sev = worst.severity
    if new_sev == "warning" and len(warn_params) >= 2:
        new_sev = "critical"
    with tx() as c:
        c.execute("UPDATE incidents SET signals=?, severity=? WHERE id=?", (j(existing), new_sev, inc["id"]))
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (inc["id"],)).fetchone())
    _update_machine_status(machine_id)
    bus.publish(m["org_id"], "incident", {**inc, "signals": existing})
    if SEVERITY_RANK[new_sev] > SEVERITY_RANK[old_sev]:
        notify.on_incident_escalated(inc, m)
        _kick_agent(inc["id"])


def _kick_agent(incident_id: str) -> None:
    from .agent.runner import investigate_async

    threading.Thread(target=investigate_async, args=(incident_id,), daemon=True).start()


def acknowledge(incident_id: str, by: str) -> dict[str, Any]:
    with tx() as c:
        c.execute(
            "UPDATE incidents SET status='acknowledged', acknowledged_at=?, acknowledged_by=? WHERE id=? AND status='open'",
            (now(), by, incident_id),
        )
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone())
    if inc:
        bus.publish(inc["org_id"], "incident", {**inc, "signals": uj(inc["signals"], [])})
    return inc or {}


def resolve(incident_id: str, feedback: dict[str, Any] | None) -> dict[str, Any]:
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone())
    if not inc:
        return {}
    with tx() as c:
        c.execute(
            "UPDATE incidents SET status='resolved', resolved_at=?, feedback=? WHERE id=?",
            (now(), j(feedback or {}), incident_id),
        )
        c.execute("UPDATE latest SET state='normal' WHERE machine_id=?", (inc["machine_id"],))
    _update_machine_status(inc["machine_id"])
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone())
    bus.publish(inc["org_id"], "incident", {**inc, "signals": uj(inc["signals"], [])})
    return inc


def escalation_sweep() -> None:
    """Critical + unacknowledged for ESCALATION_TIMEOUT → emergency, next contact. Repeats until acknowledged."""
    t = now()
    due = rows(
        conn()
        .execute(
            "SELECT * FROM incidents WHERE status='open' AND severity IN ('critical','emergency') "
            "AND COALESCE(last_escalated_at, opened_at) < ?",
            (t - settings.escalation_timeout_seconds,),
        )
        .fetchall()
    )
    for inc in due:
        level = inc["escalation_level"] + 1
        with tx() as c:
            c.execute(
                "UPDATE incidents SET severity='emergency', escalation_level=?, last_escalated_at=? WHERE id=?",
                (level, t, inc["id"]),
            )
        inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (inc["id"],)).fetchone())
        m = _machine(inc["machine_id"])
        bus.publish(inc["org_id"], "incident", {**inc, "signals": uj(inc["signals"], [])})
        notify.on_incident_escalated(inc, m, level=level)


def staleness_sweep() -> None:
    """Machines that stop posting for STALE_AFTER_SECONDS become 'stale' and open an incident."""
    t = now()
    for m in rows(conn().execute("SELECT * FROM machines WHERE verified=1").fetchall()):
        if m["last_seen"] is None:
            continue
        stale = t - m["last_seen"] > settings.stale_after_seconds
        if stale and m["status"] not in ("stale", "offline"):
            with tx() as c:
                c.execute("UPDATE machines SET status='stale', health=? WHERE id=?", (40, m["id"]))
            bus.publish(m["org_id"], "machine", {"id": m["id"], "status": "stale", "health": 40})
            sig = Signal(m["id"], "telemetry", "stale", "warning", None,
                         f"No telemetry for {int(t - m['last_seen'])} s — machine offline or sensor failure", {})
            handle_signals(m["id"], [sig])
        elif not stale and m["status"] == "stale":
            with tx() as c:
                c.execute("UPDATE machines SET status='normal' WHERE id=?", (m["id"],))
            _update_machine_status(m["id"])
