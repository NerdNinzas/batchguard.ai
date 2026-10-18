"""Incident lifecycle: open/attach with cooldown + grouping, severity ladder, escalation, agent hand-off."""

import threading
from typing import Any

from . import bus, cloud, notify
from .config import settings
from .db import conn, j, row, rows, tx, uj
from .detection import Signal, health_score
from .ids import new_id, now

_STARTED_AT = now()

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
    """Same parameter + layer inside the cooldown is a repeat — unless it is MORE severe (warning → critical must attach)."""
    for s in uj(incident.get("signals"), []):
        if s.get("parameter") == sig.parameter and s.get("layer") == sig.layer and t - s.get("ts", 0) < settings.incident_cooldown_seconds:
            if SEVERITY_RANK.get(sig.severity, 0) > SEVERITY_RANK.get(s.get("severity", "info"), 0):
                return False
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
    health = health_score(machine_id)
    if status == m["status"] and health == (m.get("health") if m.get("health") is not None else -1):
        return  # nothing changed: no write, no live event, no mirror (this runs on every telemetry post)
    with tx() as c:
        c.execute("UPDATE machines SET status=?, health=? WHERE id=?", (status, health, machine_id))
    bus.publish(m["org_id"], "machine", {"id": machine_id, "status": status, "health": health})
    cloud.mirror("machines", machine_id, {"status": status, "health": health, "org_id": m["org_id"]})


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
                "INSERT INTO incidents (id, org_id, machine_id, severity, status, title, opened_at, signals, last_abnormal_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (inc_id, m["org_id"], machine_id, worst.severity, "open", title, t, j(sigs), t),
            )
        inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (inc_id,)).fetchone())
        _update_machine_status(machine_id)
        bus.publish(m["org_id"], "incident", {**inc, "signals": sigs})
        cloud.mirror("incidents", inc["id"], inc)
        notify.on_incident_opened(inc, m)
        _kick_agent(inc_id)
        from . import shutdown as _sd

        _sd.arm(inc)
        return

    # attach to the open incident; warning+ signals mean the machine is still abnormal (even inside the cooldown).
    # info-level anomalies (z-score blips while the value settles) must not keep the incident alive.
    if any(s.severity != "info" for s in signals):
        with tx() as c:
            c.execute("UPDATE incidents SET last_abnormal_at=? WHERE id=?", (t, inc["id"]))
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
    cloud.mirror("incidents", inc["id"], inc)
    if SEVERITY_RANK[new_sev] > SEVERITY_RANK[old_sev]:
        notify.on_incident_escalated(inc, m)
        _kick_agent(inc["id"])
        from . import shutdown as _sd

        _sd.arm(inc)


def _kick_agent(incident_id: str) -> None:
    from .agent.runner import investigate_async

    threading.Thread(target=investigate_async, args=(incident_id,), daemon=True).start()


def acknowledge(incident_id: str, by: str) -> dict[str, Any]:
    with tx() as c:
        c.execute(
            "UPDATE incidents SET status='acknowledged', acknowledged_at=?, acknowledged_by=? WHERE id=? AND status='open'",
            (now(), by, incident_id),
        )
    from . import shutdown as _sd

    _sd.cancel(incident_id, f"Acknowledged by {by}")
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone())
    if inc:
        bus.publish(inc["org_id"], "incident", {**inc, "signals": uj(inc["signals"], [])})
    return inc or {}


def resolve(incident_id: str, feedback: dict[str, Any] | None, reason: str | None = None) -> dict[str, Any]:
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone())
    if not inc:
        return {}
    from . import shutdown as _sd

    _sd.cancel(incident_id, f"Incident resolved ({reason or 'manual'})")
    with tx() as c:
        c.execute(
            "UPDATE incidents SET status='resolved', resolved_at=?, feedback=?, resolved_reason=? WHERE id=?",
            (now(), j(feedback or {}), reason or (feedback or {}).get("source") or "manual", incident_id),
        )
        c.execute("UPDATE latest SET state='normal' WHERE machine_id=?", (inc["machine_id"],))
    _update_machine_status(inc["machine_id"])
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone())
    bus.publish(inc["org_id"], "incident", {**inc, "signals": uj(inc["signals"], [])})
    try:
        notify.on_incident_resolved(inc, _machine(inc["machine_id"]), feedback)
    except Exception as e:  # noqa: BLE001
        print("resolve mail error:", e)
    return inc


def escalation_sweep() -> None:
    """Critical/emergency incident, not acknowledged → one call per contact, down the ladder, never a retry.
    The next contact is dialled as soon as the previous call ended without an acknowledgement (no answer, hung up,
    or talked but did not acknowledge), or after ESCALATION_TIMEOUT if no call could be placed. When the ladder is
    exhausted nothing more is dialled: the auto-shutdown countdown decides."""
    t = now()
    due = rows(
        conn()
        .execute(
            "SELECT * FROM incidents WHERE status='open' AND severity IN ('critical','emergency') AND ladder_done_at IS NULL"
        )
        .fetchall()
    )
    terminal = ("completed", "failed", "no_answer")
    for inc in due:
        contacts = notify._contacts(inc["org_id"])
        since_ts = inc["last_escalated_at"] or inc["opened_at"]
        last_call = row(conn().execute(
            "SELECT * FROM voice_calls WHERE incident_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 1", (inc["id"], since_ts - 5)
        ).fetchone())
        waited = t - since_ts
        if last_call and last_call["status"] in terminal:
            ready = True  # the call for this rung is over and nobody acknowledged (an acknowledgement would have closed this path)
        elif last_call:
            ready = waited >= 600  # still ringing / talking: wait for it, with a safety valve
        else:
            ready = waited >= settings.escalation_timeout_seconds
        if not ready:
            continue
        level = inc["escalation_level"] + 1
        if level >= len(contacts):
            m = _machine(inc["machine_id"])
            with tx() as c:
                c.execute("UPDATE incidents SET ladder_done_at=?, last_escalated_at=? WHERE id=?", (t, t, inc["id"]))
            tail = ("waiting for the auto-shutdown countdown" if inc.get("shutdown_state") in ("pending", "warned")
                    else "auto-shutdown is off, so the machine keeps running until someone acts")
            notify.record(inc["org_id"], inc["id"], "in_app", None, f"Nobody acknowledged: {m.get('name')}",
                          f"Every contact on the ladder was called once without an acknowledgement — {tail}", "delivered")
            bus.publish(inc["org_id"], "incident", {**row(conn().execute("SELECT * FROM incidents WHERE id=?", (inc["id"],)).fetchone()), "signals": uj(inc["signals"], [])})
            continue
        with tx() as c:
            c.execute(
                "UPDATE incidents SET severity='emergency', escalation_level=?, last_escalated_at=? WHERE id=?",
                (level, t, inc["id"]),
            )
        inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (inc["id"],)).fetchone())
        m = _machine(inc["machine_id"])
        bus.publish(inc["org_id"], "incident", {**inc, "signals": uj(inc["signals"], [])})
        notify.on_incident_escalated(inc, m, level=level)


RECOVERY_SECONDS = 60


def recovery_sweep() -> None:
    """A machine whose parameters have all been back inside their normal band for RECOVERY_SECONDS closes its
    incident as 'back to normal' — the report and timeline stay for the record."""
    t = now()
    for inc in rows(conn().execute("SELECT * FROM incidents WHERE status IN ('open','acknowledged')").fetchall()):
        sigs = uj(inc["signals"], [])
        if sigs and all(s.get("layer") == "stale" for s in sigs):
            continue  # stale-only incidents are closed by resume_from_stale
        last_abnormal = inc.get("last_abnormal_at") or max([s.get("ts", inc["opened_at"]) for s in sigs] or [inc["opened_at"]])
        if t - last_abnormal < RECOVERY_SECONDS:
            continue
        states = [r["state"] for r in conn().execute("SELECT state, ts FROM latest WHERE machine_id=?", (inc["machine_id"],)).fetchall()]
        m = _machine(inc["machine_id"])
        if not states or any(st != "normal" for st in states) or m.get("status") in ("stale", "offline"):
            continue
        if (m.get("last_seen") or 0) < t - 15:
            continue  # not receiving data → cannot claim recovery
        mins = max(1, int((t - inc["opened_at"]) / 60))
        resolve(inc["id"], {"verdict": "auto", "actual_cause": "Parameters returned to their normal band", "fix": f"Recovered — back to normal after {mins} min; no manual action recorded"}, reason="back to normal")


def resume_from_stale(machine_id: str) -> None:
    """Telemetry is back: a stale-only incident closes itself; anything else stays open."""
    inc = _open_incident_for(machine_id)
    if inc and all(sig.get("layer") == "stale" for sig in uj(inc["signals"], [])):
        resolve(inc["id"], {"verdict": "auto", "actual_cause": "telemetry resumed", "fix": "auto-resolved"}, reason="back online")


def staleness_sweep() -> None:
    """Machines that stop posting for STALE_AFTER_SECONDS become 'stale' and open an incident."""
    t = now()
    if t - _STARTED_AT < 90:  # grace after a restart/redeploy: devices and the simulator reconnect and re-issue keys
        return
    for m in rows(conn().execute("SELECT * FROM machines WHERE verified=1").fetchall()):
        if m["last_seen"] is None or m["status"] == "shutdown":  # a machine Muse stopped is silent on purpose
            continue
        stale = t - m["last_seen"] > settings.stale_after_seconds
        if stale and m["status"] not in ("stale", "offline"):
            with tx() as c:
                c.execute("UPDATE machines SET status='stale', health=? WHERE id=?", (40, m["id"]))
            bus.publish(m["org_id"], "machine", {"id": m["id"], "status": "stale", "health": 40})
            sig = Signal(m["id"], "telemetry", "stale", "warning", None,
                         f"No telemetry for {int(t - m['last_seen'])} s — machine offline or sensor failure", {})
            handle_signals(m["id"], [sig])
        elif not stale:
            if m["status"] == "stale":
                with tx() as c:
                    c.execute("UPDATE machines SET status='normal' WHERE id=?", (m["id"],))
                _update_machine_status(m["id"])
            resume_from_stale(m["id"])  # self-heal: a stale-only incident never outlives resumed telemetry
