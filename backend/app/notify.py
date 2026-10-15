"""Escalation channels: in-app (always), email (SMTP or simulated). Voice is planned (TeleCMI + Gemini Live)."""

import smtplib
from email.message import EmailMessage
from typing import Any

from . import bus, cloud
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


def send_email(to_addr: str, subject: str, body: str) -> str:
    if not settings.smtp_enabled or not to_addr:
        return "simulated"
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as s:
            s.starttls()
            s.login(settings.smtp_user, settings.smtp_pass)
            s.send_message(msg)
        return "sent"
    except Exception as e:  # noqa: BLE001
        return f"failed: {e}"


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
            _record(org_id, inc["id"], "email", primary, subject, body, send_email(primary["email"], subject, body))
        else:
            _record(org_id, inc["id"], "email", None, subject, body, "skipped: no primary contact")
    if sev in ("critical", "emergency"):
        contacts = _contacts(org_id)
        primary = contacts[0] if contacts else None
        _record(org_id, inc["id"], "voice", primary, subject, "Voice call planned (TeleCMI + Gemini Live) — not wired yet", "planned")


def on_incident_escalated(inc: dict[str, Any], m: dict[str, Any], level: int = 0) -> None:
    org_id = inc["org_id"]
    subject, body = _incident_text(inc, m)
    contacts = _contacts(org_id)
    target = contacts[min(level, len(contacts) - 1)] if contacts else None
    _record(org_id, inc["id"], "in_app", None, subject, f"Escalated to {inc['severity']}: {inc['title']}", "delivered")
    if target and target.get("email"):
        _record(org_id, inc["id"], "email", target, subject, body, send_email(target["email"], subject, body))
    if inc["severity"] in ("critical", "emergency"):
        _record(org_id, inc["id"], "voice", target, subject, f"Voice escalation level {level} planned — not wired yet", "planned")


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
