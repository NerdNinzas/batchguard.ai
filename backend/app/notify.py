"""Escalation channels: in-app (always), email (Resend, Muse templates), voice (Dograh → Gemini Live realtime → TeleCMI)."""

from typing import Any

from . import bus, cloud, mail
from .config import settings
from .db import conn, rows, tx
from .ids import new_id, now

ACTION = {
    "info": "Dashboard only",
    "warning": "Dashboard + email to primary contact",
    "critical": "Dashboard + email + voice call to primary contact",
    "emergency": "Call next contact in order; repeat until acknowledged",
}


def _contacts(org_id: str) -> list[dict[str, Any]]:
    return rows(conn().execute("SELECT * FROM contacts WHERE org_id=? ORDER BY escalation_order", (org_id,)).fetchall())


def _record(org_id: str, incident_id: str | None, channel: str, contact: dict[str, Any] | None, subject: str, body: str, status: str) -> dict[str, Any]:
    n = {
        "id": new_id("ntf"), "org_id": org_id, "incident_id": incident_id, "channel": channel,
        "contact_id": contact["id"] if contact else None,
        "to_addr": (contact or {}).get("email") if channel == "email" else (contact or {}).get("phone"),
        "subject": subject, "body": body, "status": status, "sent_at": now(), "read": 0,
    }
    with tx() as c:
        c.execute(
            "INSERT INTO notifications (id, org_id, incident_id, channel, contact_id, to_addr, subject, body, status, sent_at, read) "
            "VALUES (:id,:org_id,:incident_id,:channel,:contact_id,:to_addr,:subject,:body,:status,:sent_at,:read)",
            n,
        )
    bus.publish(org_id, "notification", n)
    cloud.mirror("notifications", n["id"], n)
    return n


def send_email(to_addr: str, subject: str, html_body: str) -> str:
    return mail.send(to_addr, subject, html_body)


def _incident_text(inc: dict[str, Any], m: dict[str, Any]) -> tuple[str, str]:
    subject = f"[BatchGuard] {inc['severity'].upper()} — {m.get('name')} ({m.get('device_id')})"
    link = f"{settings.app_url}/app/incidents/{inc['id']}"
    body = (
        f"{inc['title']}\n\nSeverity: {inc['severity']}\nMachine: {m.get('name')} · {m.get('device_id')}\n"
        f"Opened: {inc['opened_at']}\n\nAcknowledge: {link}\n\n— BatchGuard AI (advisory only; recommendations are for qualified personnel)"
    )
    return subject, body


def on_incident_opened(inc: dict[str, Any], m: dict[str, Any]) -> None:
    org_id = inc["org_id"]
    subject, body = _incident_text(inc, m)
    _record(org_id, inc["id"], "in_app", None, subject, inc["title"], "delivered")
    sev = inc["severity"]
    if sev in ("warning", "critical", "emergency"):
        contacts = _contacts(org_id)
        primary = contacts[0] if contacts else None
        if primary and primary.get("email"):
            subj, html_body = mail.incident_opened(inc, m, primary)
            _record(org_id, inc["id"], "email", primary, subj, body, send_email(primary["email"], subj, html_body))
        else:
            _record(org_id, inc["id"], "email", None, subject, body, "skipped: no primary contact")
    if sev in ("critical", "emergency"):
        contacts = _contacts(org_id)
        primary = contacts[0] if contacts else None
        _voice(org_id, inc, m, primary, level=0)


def on_incident_escalated(inc: dict[str, Any], m: dict[str, Any], level: int = 0) -> None:
    org_id = inc["org_id"]
    subject, body = _incident_text(inc, m)
    contacts = _contacts(org_id)
    target = contacts[min(level, len(contacts) - 1)] if contacts else None
    _record(org_id, inc["id"], "in_app", None, subject, f"Escalated to {inc['severity']}: {inc['title']}", "delivered")
    if target and target.get("email"):
        subj, html_body = mail.incident_escalated(inc, m, target, level)
        _record(org_id, inc["id"], "email", target, subj, body, send_email(target["email"], subj, html_body))
    if inc["severity"] in ("critical", "emergency"):
        _voice(org_id, inc, m, target, level=level)


def _voice(org_id: str, inc: dict[str, Any], m: dict[str, Any], contact: dict[str, Any] | None, level: int) -> None:
    """Critical/emergency → Muse calls the contact over TeleCMI (Gemini Live) when the org switched auto-dial on;
    otherwise the call is one click away on the incident page (recorded as 'ready')."""
    from .voice import calls, dograh

    subject, _ = _incident_text(inc, m)
    if not dograh.enabled():
        _record(org_id, inc["id"], "voice", contact, subject, "Voice AI not configured (DOGRAH_API_KEY)", "skipped")
        return
    if not contact or not contact.get("phone"):
        _record(org_id, inc["id"], "voice", contact, subject, "No phone number on the contact", "skipped")
        return
    queued = calls.auto_dial(inc, m, contact, level=level)
    if queued:
        _record(org_id, inc["id"], "voice", contact, subject, f"Muse is calling {contact['name']} ({queued['call_type']}) via TeleCMI · Gemini Live", "dialing")
    else:
        _record(org_id, inc["id"], "voice", contact, subject, f"Auto-dial off — call {contact['name']} from the incident page (Gemini Live via TeleCMI)", "ready")


def on_report_ready(inc: dict[str, Any], m: dict[str, Any], report: dict[str, Any]) -> None:
    """Muse finished investigating: mail the evidence-backed report to the primary contact (warning and above)."""
    if inc.get("severity") not in ("warning", "critical", "emergency"):
        return
    contacts = _contacts(inc["org_id"])
    primary = contacts[0] if contacts else None
    if not primary or not primary.get("email"):
        return
    subj, html_body = mail.report_ready(inc, m, report, primary)
    _record(inc["org_id"], inc["id"], "email", primary, subj, (report.get("summary") or "")[:300], send_email(primary["email"], subj, html_body))


def on_incident_resolved(inc: dict[str, Any], m: dict[str, Any], feedback: dict[str, Any] | None) -> None:
    contacts = _contacts(inc["org_id"])
    primary = contacts[0] if contacts else None
    _record(inc["org_id"], inc["id"], "in_app", None, f"Resolved: {inc['title']}", (feedback or {}).get("actual_cause") or "closed", "delivered")
    if primary and primary.get("email") and (feedback or {}).get("verdict") != "auto":
        subj, html_body = mail.incident_resolved(inc, m, feedback)
        _record(inc["org_id"], inc["id"], "email", primary, subj, "resolved", send_email(primary["email"], subj, html_body))


def on_welcome(org: dict[str, Any], user: dict[str, Any]) -> None:
    to = user.get("email") or org.get("owner_email")
    subj, html_body = mail.welcome(org, user)
    _record(org["id"], None, "email", {"id": None, "email": to}, subj, "welcome", send_email(to, subj, html_body))


def on_voice_call_completed(call: dict[str, Any], transcript_lines: list[dict[str, str]], outcome: dict[str, Any]) -> None:
    contacts = _contacts(call["org_id"])
    primary = contacts[0] if contacts else None
    if not primary or not primary.get("email"):
        return
    subj, html_body = mail.voice_summary(call, transcript_lines, outcome, primary)
    _record(call["org_id"], call.get("incident_id"), "email", primary, subj, f"call summary {call['id']}", send_email(primary["email"], subj, html_body))


def daily_digest_text(org_id: str) -> str:
    t = now()
    incs = rows(conn().execute("SELECT * FROM incidents WHERE org_id=? AND opened_at>=?", (org_id, t - 86400)).fetchall())
    machines = rows(conn().execute("SELECT name, status, health FROM machines WHERE org_id=?", (org_id,)).fetchall())
    lines = [f"BatchGuard daily digest — {len(incs)} incident(s) in the last 24 h", ""]
    for m in machines:
        lines.append(f"- {m['name']}: {m['status']} (health {m['health']})")
    lines.append("")
    for i in incs:
        lines.append(f"- [{i['severity']}] {i['title']} — {i['status']}")
    return "\n".join(lines)
