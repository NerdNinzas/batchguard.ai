"""Escalation channels: in-app (always), email (Resend, Muse templates), voice (Dograh → Gemini Live realtime → TeleCMI)."""

from typing import Any

from . import bus, cloud, mail
from .config import settings
from .db import conn, rows, tx
from .ids import new_id, now

ACTION = {
    "info": "Dashboard only",
    "warning": "Dashboard + one incident email to the first contact on the ladder",
    "critical": "Dashboard + the one incident email + one call to contact #1",
    "emergency": "One call to the next contact; when the ladder is exhausted, the auto-shutdown countdown decides",
}

# Anti-spam rules (real-life testing showed every report/escalation/resolution mail landing in the same inbox):
#   - exactly ONE email per incident: the incident email, sent when it opens, to the first ladder contact with an address
#   - exactly ONE call per contact per incident: no answer / hung up / no acknowledgement → next contact, never a retry
#   - everything else is recorded in-app only


def _contacts(org_id: str) -> list[dict[str, Any]]:
    return rows(conn().execute("SELECT * FROM contacts WHERE org_id=? ORDER BY escalation_order", (org_id,)).fetchall())


def owner_recipient(org_id: str) -> dict[str, Any] | None:
    """The organisation owner (Settings & API → owner email) gets a copy of every notification email."""
    o = conn().execute("SELECT owner_name, owner_email FROM orgs WHERE id=?", (org_id,)).fetchone()
    if not o or not (o["owner_email"] or "").strip():
        return None
    return {"id": None, "name": o["owner_name"] or "there", "role": "Owner", "email": o["owner_email"].strip(), "phone": None}


def email_recipients(org_id: str, level: int = 0, limit: int = 1) -> list[dict[str, Any]]:
    """Who gets an email: the contact for this escalation level if they have an address (else the next contacts that do,
    up to `limit`), plus the owner email from settings. Deduplicated by address."""
    contacts = _contacts(org_id)
    ordered = contacts[level:] + contacts[:level] if contacts else []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ct in ordered:
        addr = (ct.get("email") or "").strip().lower()
        if addr and addr not in seen:
            out.append(ct)
            seen.add(addr)
            if len(out) >= limit:
                break
    owner = owner_recipient(org_id)
    if owner and owner["email"].lower() not in seen:
        out.append(owner)
    return out


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


def record(org_id: str, incident_id: str | None, channel: str, contact: dict[str, Any] | None, subject: str, body: str, status: str) -> dict[str, Any]:
    return _record(org_id, incident_id, channel, contact, subject, body, status)


def _email_already_sent(incident_id: str) -> bool:
    r = conn().execute(
        "SELECT 1 FROM notifications WHERE incident_id=? AND channel='email' AND (status LIKE 'sent%' OR status='simulated') LIMIT 1",
        (incident_id,),
    ).fetchone()
    return r is not None


def _already_called(incident_id: str, contact: dict[str, Any]) -> bool:
    if not contact.get("id"):
        return False
    r = conn().execute("SELECT 1 FROM voice_calls WHERE incident_id=? AND contact_id=? LIMIT 1", (incident_id, contact["id"])).fetchone()
    return r is not None


def on_shutdown(inc: dict[str, Any], m: dict[str, Any], reason: str) -> None:
    org_id = inc["org_id"]
    _record(org_id, inc["id"], "in_app", None, f"Emergency shutdown: {m.get('name')}", reason, "delivered")
    # no email: the one incident email already went out when the incident opened


def send_email(to_addr: str, subject: str, html_body: str) -> str:
    return mail.send(to_addr, subject, html_body)


def _is_stale(inc: dict[str, Any]) -> bool:
    from .db import uj as _uj

    sigs = _uj(inc.get("signals"), []) if isinstance(inc.get("signals"), str) else inc.get("signals") or []
    return bool(sigs) and all(s.get("layer") == "stale" for s in sigs)


def _incident_text(inc: dict[str, Any], m: dict[str, Any]) -> tuple[str, str]:
    subject = (f"[BatchGuard] {m.get('name')} is down — no telemetry ({m.get('device_id')})" if _is_stale(inc)
               else f"[BatchGuard] {inc['severity'].upper()} — {m.get('name')} ({m.get('device_id')})")
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
    if sev in ("warning", "critical", "emergency") and not _email_already_sent(inc["id"]):
        targets = email_recipients(org_id)[:1]  # the ONE email per incident: first ladder contact with an address (else the owner)
        for ct in targets:
            subj, html_body = mail.incident_opened(inc, m, ct)
            _record(org_id, inc["id"], "email", ct, subj, body, send_email(ct["email"], subj, html_body))
        if not targets:
            _record(org_id, inc["id"], "email", None, subject, body, "skipped: no contact or owner email")
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
    if level == 0 and not _email_already_sent(inc["id"]):
        # a warning that grew into a critical never had its email yet (warning mails go out too, so this is rare)
        for ct in email_recipients(org_id)[:1]:
            subj, html_body = mail.incident_escalated(inc, m, ct, level)
            _record(org_id, inc["id"], "email", ct, subj, body, send_email(ct["email"], subj, html_body))
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
    if _already_called(inc["id"], contact):
        _record(org_id, inc["id"], "voice", contact, subject, f"{contact['name']} was already called once for this incident — no retry, moving down the ladder", "skipped")
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
    # in-app only (one email per incident); the report is on the incident page and in the call brief
    _record(inc["org_id"], inc["id"], "in_app", None, f"Muse's report is ready: {m.get('name')}", (report.get("summary") or "")[:300], "delivered")


def on_incident_resolved(inc: dict[str, Any], m: dict[str, Any], feedback: dict[str, Any] | None) -> None:
    auto = (feedback or {}).get("verdict") == "auto"
    back_online = auto and (feedback or {}).get("actual_cause") == "telemetry resumed"
    subj = f"Back online: {m.get('name')}" if back_online else f"Back to normal: {m.get('name')}" if auto else f"Resolved: {inc['title']}"
    body = (f"{m.get('name')} is sending telemetry again" if back_online else
            f"{inc['title']} — parameters returned to normal; incident closed automatically" if auto else ((feedback or {}).get("actual_cause") or "closed"))
    _record(inc["org_id"], inc["id"], "in_app", None, subj, body, "delivered")
    # no email on resolution: one email per incident


def on_welcome(org: dict[str, Any], user: dict[str, Any]) -> None:
    to = user.get("email") or org.get("owner_email")
    subj, html_body = mail.welcome(org, user)
    _record(org["id"], None, "email", {"id": None, "email": to}, subj, "welcome", send_email(to, subj, html_body))


def on_voice_call_completed(call: dict[str, Any], transcript_lines: list[dict[str, str]], outcome: dict[str, Any]) -> None:
    # in-app only (one email per incident); the transcript and outcome live on the Voice AI page
    who = call.get("contact_name") or call.get("to_number")
    ack = outcome.get("acknowledged") in (True, "true", "yes", "1")
    _record(call["org_id"], call.get("incident_id"), "in_app", None, f"Call to {who}: {'acknowledged' if ack else call.get('status', 'ended')}",
            f"call summary {call['id']}", "delivered")


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
