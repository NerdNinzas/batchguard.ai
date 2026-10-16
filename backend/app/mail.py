"""Transactional email via Resend (HTTPS API) with Muse-branded HTML templates.

`send()` returns a status string that is stored on the notification row:
  "sent:<resend id>" · "simulated" (no RESEND_API_KEY) · "failed: <reason>".
Every template is built by `render(kind, **ctx)` and can be previewed at GET /api/email/preview/{kind}.
"""

import html
from typing import Any

import requests

from .config import settings

RESEND_URL = "https://api.resend.com/emails"
SEV_COLOR = {"info": "#1e6fff", "warning": "#f59e0b", "critical": "#ef4444", "emergency": "#b91c1c", "normal": "#16c784", "resolved": "#16c784"}


def enabled() -> bool:
    return settings.email_enabled


def send(to: str, subject: str, html_body: str, text: str = "") -> str:
    if not to:
        return "skipped: no address"
    if not enabled():
        return "simulated"
    try:
        r = requests.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}", "Content-Type": "application/json"},
            json={"from": settings.resend_from, "to": [to], "subject": subject, "html": html_body, "text": text or _strip(html_body)},
            timeout=20,
        )
        if r.status_code >= 400:
            try:
                msg = r.json().get("message") or r.text[:200]
            except Exception:  # noqa: BLE001
                msg = r.text[:200]
            return f"failed: {msg}"
        return f"sent:{(r.json() or {}).get('id', '')}"
    except requests.RequestException as e:
        return f"failed: {e}"


# ---------------------------------------------------------------- layout helpers
def _e(v: Any) -> str:
    return html.escape("" if v is None else str(v))


def _strip(h: str) -> str:
    import re

    t = re.sub(r"<style.*?</style>", "", h, flags=re.S)
    t = re.sub(r"<br\s*/?>", "\n", t)
    t = re.sub(r"</(p|tr|h1|h2|h3|li|div)>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(t)).strip()


def _asset(path: str) -> str:
    return f"{settings.email_asset_base.rstrip('/')}/{path.lstrip('/')}"


def _button(label: str, url: str, color: str = "#1e6fff") -> str:
    return (
        f'<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 6px"><tr><td style="border-radius:12px;background:{color}">'
        f'<a href="{_e(url)}" style="display:inline-block;padding:13px 22px;font:600 15px Arial,Helvetica,sans-serif;color:#fff;text-decoration:none;border-radius:12px">{_e(label)}</a></td></tr></table>'
    )


def _kv(rows: list[tuple[str, Any]]) -> str:
    cells = "".join(
        f'<tr><td style="padding:7px 10px;font:12px/1.4 Menlo,Consolas,monospace;color:#5b6b85;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;vertical-align:top;border-bottom:1px solid #eaf1fb">{_e(k)}</td>'
        f'<td style="padding:7px 10px;font:14px/1.45 Arial,Helvetica,sans-serif;color:#0b1a33;border-bottom:1px solid #eaf1fb">{_e(v)}</td></tr>'
        for k, v in rows if v not in (None, "")
    )
    return f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dbe6f7;border-radius:12px;border-collapse:separate;overflow:hidden;background:#fff">{cells}</table>'


def _list(items: list[str], numbered: bool = False) -> str:
    tag = "ol" if numbered else "ul"
    return f'<{tag} style="margin:8px 0 0;padding-left:20px;font:14px/1.55 Arial,Helvetica,sans-serif;color:#0b1a33">' + "".join(f"<li style='margin:4px 0'>{_e(i)}</li>" for i in items) + f"</{tag}>"


def _p(text: str, muted: bool = False) -> str:
    return f'<p style="margin:0 0 12px;font:15px/1.6 Arial,Helvetica,sans-serif;color:{"#5b6b85" if muted else "#0b1a33"}">{text}</p>'


def _h(text: str) -> str:
    return f'<p style="margin:22px 0 8px;font:700 11px/1 Menlo,Consolas,monospace;letter-spacing:.2em;text-transform:uppercase;color:#1e6fff">{_e(text)}</p>'


def layout(title: str, eyebrow: str, body: str, accent: str = "#1e6fff", muse_line: str = "Muse, your factory-monitoring agent") -> str:
    """Muse-branded shell: light-blue background, white card, Muse portrait + eyebrow + title, body, advisory footer."""
    muse = _asset("email/muse.png")
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{_e(title)}</title></head>
<body style="margin:0;padding:0;background:#f6f9ff">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f9ff"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%">
  <tr><td style="padding:0 6px 14px">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr>
      <td style="vertical-align:middle"><img src="{_asset('email/mark.png')}" width="28" height="28" alt="" style="display:block;border-radius:8px" onerror="this.style.display='none'"></td>
      <td style="vertical-align:middle;padding-left:10px;font:700 18px Arial,Helvetica,sans-serif;color:#0b1a33;letter-spacing:-.01em">BatchGuard <span style="color:#1e6fff">AI</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;border:1px solid #dbe6f7;border-radius:22px;overflow:hidden">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr><td style="height:6px;background:{accent};font-size:0;line-height:0">&nbsp;</td></tr>
      <tr><td style="padding:26px 30px 6px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
          <td style="vertical-align:top">
            <p style="margin:0 0 8px;font:700 11px/1 Menlo,Consolas,monospace;letter-spacing:.22em;text-transform:uppercase;color:{accent}">{_e(eyebrow)}</p>
            <h1 style="margin:0 0 6px;font:700 26px/1.2 Arial,Helvetica,sans-serif;color:#0b1a33;letter-spacing:-.01em">{_e(title)}</h1>
            <p style="margin:0;font:13px/1.5 Arial,Helvetica,sans-serif;color:#5b6b85">{_e(muse_line)}</p>
          </td>
          <td width="112" style="vertical-align:top;text-align:right"><img src="{muse}" width="104" alt="Muse" style="display:inline-block;width:104px;height:auto;border:0"></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:14px 30px 28px">{body}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 10px 0;font:12px/1.6 Arial,Helvetica,sans-serif;color:#5b6b85;text-align:center">
    BatchGuard AI is advisory only. Recommendations are for qualified personnel following site safety and lockout procedures.<br>
    <a href="{_e(settings.app_url)}/app" style="color:#1e6fff;text-decoration:none">Open the dashboard</a> · <a href="{_e(settings.app_url)}/app/contacts" style="color:#1e6fff;text-decoration:none">Escalation contacts</a>
  </td></tr>
</table></td></tr></table></body></html>"""


# ---------------------------------------------------------------- templates
def _inc_link(inc: dict[str, Any]) -> str:
    return f"{settings.app_url}/app/incidents/{inc['id']}"


def _sig_lines(inc: dict[str, Any]) -> list[str]:
    from .db import uj

    sigs = uj(inc.get("signals"), []) if isinstance(inc.get("signals"), str) else inc.get("signals") or []
    return [s.get("message", "") for s in sigs if s.get("message")][:5]


def incident_opened(inc: dict[str, Any], m: dict[str, Any], contact: dict[str, Any] | None = None) -> tuple[str, str]:
    sev = inc["severity"]
    accent = SEV_COLOR.get(sev, "#1e6fff")
    subject = f"[BatchGuard] {sev.upper()} — {m.get('name')} ({m.get('device_id')})"
    who = (contact or {}).get("name") or "there"
    body = (
        _p(f"Hi {_e(who)}, I opened a <strong style='color:{accent}'>{_e(sev)}</strong> incident on <strong>{_e(m.get('name'))}</strong>. I'm already gathering evidence: readings, baseline, the manual, neighbouring machines.")
        + _kv([("Machine", f"{m.get('name')} · {m.get('device_id')}"), ("Type", m.get("type")), ("Severity", sev), ("Incident", inc.get("title"))])
        + _h("What tripped")
        + _list(_sig_lines(inc) or ["See the dashboard for the signal detail."])
        + _button("Acknowledge on the dashboard", _inc_link(inc), accent)
        + _p("If nobody acknowledges within two minutes I move to the next contact on the ladder" + (" and ring them." if sev in ("critical", "emergency") else "."), muted=True)
    )
    return subject, layout(f"{m.get('name')} needs attention", f"{sev} incident", body, accent)


def incident_escalated(inc: dict[str, Any], m: dict[str, Any], contact: dict[str, Any] | None, level: int) -> tuple[str, str]:
    sev = inc["severity"]
    accent = SEV_COLOR.get(sev, "#ef4444")
    subject = f"[BatchGuard] {sev.upper()} escalation · {m.get('name')} ({m.get('device_id')})"
    who = (contact or {}).get("name") or "there"
    body = (
        _p(f"Hi {_e(who)}, nobody acknowledged the incident on <strong>{_e(m.get('name'))}</strong>, so I'm escalating to you (level {level}). The machine is now <strong style='color:{accent}'>{_e(sev)}</strong>.")
        + _kv([("Machine", f"{m.get('name')} · {m.get('device_id')}"), ("Severity", sev), ("Escalation level", level), ("Incident", inc.get("title"))])
        + _h("Signals so far")
        + _list(_sig_lines(inc) or ["See the dashboard for the signal detail."])
        + _button("Take ownership", _inc_link(inc), accent)
        + _p("Acknowledging stops the escalation ladder. The investigation report with ranked causes and first checks is on the incident page.", muted=True)
    )
    return subject, layout("Escalation: please take this", f"level {level} · {sev}", body, accent)


def report_ready(inc: dict[str, Any], m: dict[str, Any], report: dict[str, Any], contact: dict[str, Any] | None = None) -> tuple[str, str]:
    accent = SEV_COLOR.get(inc["severity"], "#1e6fff")
    subject = f"[BatchGuard] Muse's report · {m.get('name')}: {(report.get('causes') or [{}])[0].get('name', 'investigation complete')}"
    causes = report.get("causes") or []
    checks = sorted(report.get("checks") or [], key=lambda c: c.get("order", 99))
    body = (
        _p(f"Hi {_e((contact or {}).get('name') or 'there')}, my investigation of <strong>{_e(m.get('name'))}</strong> is done. Here is what the evidence says.")
        + _p(_e(report.get("summary", "")))
        + _h("Ranked causes")
        + _list([f"{c.get('name')} — {c.get('support', '')}: {c.get('rationale', '')}" for c in causes[:3]], numbered=True)
        + _h("Check first")
        + _list([f"{c.get('action')} (separates: {c.get('discriminates', '')})" for c in checks[:3]], numbered=True)
        + (_h("Cross-machine") + _p(_e(report["cross_machine"])) if report.get("cross_machine") else "")
        + _button("Open the full report", _inc_link(inc), accent)
        + _p("Numbers in this report were verified against the manual and live telemetry; anything unverified was removed by the guardrail.", muted=True)
    )
    return subject, layout("Investigation report", "evidence-backed diagnosis", body, accent, "Muse · Google ADK + Gemini")


def incident_resolved(inc: dict[str, Any], m: dict[str, Any], feedback: dict[str, Any] | None) -> tuple[str, str]:
    fb = feedback or {}
    subject = f"[BatchGuard] Resolved · {m.get('name')} ({m.get('device_id')})"
    body = (
        _p(f"The incident on <strong>{_e(m.get('name'))}</strong> is closed. Thank you — the verdict goes into my memory for the next time this machine misbehaves.")
        + _kv([("Incident", inc.get("title")), ("Verdict on my diagnosis", fb.get("verdict")), ("Actual cause", fb.get("actual_cause")), ("Fix applied", fb.get("fix")), ("Closed by", fb.get("source"))])
        + _button("View incident", _inc_link(inc), "#16c784")
    )
    return subject, layout("Resolved", "incident closed", body, "#16c784")


def daily_digest(org: dict[str, Any], machines: list[dict[str, Any]], incidents: list[dict[str, Any]]) -> tuple[str, str]:
    subject = f"[BatchGuard] Daily digest · {org.get('name')} · {len(incidents)} incident(s)"
    worst = {m["status"] for m in machines}
    accent = "#ef4444" if "critical" in worst else "#f59e0b" if "warning" in worst or "stale" in worst else "#16c784"
    body = (
        _p(f"Good morning. {len(incidents)} incident(s) in the last 24 hours across {len(machines)} machine(s).")
        + _h("Fleet")
        + _kv([(m["name"], f"{m['status']} · health {m.get('health')}") for m in machines])
        + _h("Incidents")
        + (_list([f"[{i['severity']}] {i['title']} — {i['status']}" for i in incidents]) if incidents else _p("None. Quiet day.", muted=True))
        + _button("Open overview", f"{settings.app_url}/app", accent)
    )
    return subject, layout("Daily digest", org.get("name") or "your factory", body, accent)


def welcome(org: dict[str, Any], user: dict[str, Any]) -> tuple[str, str]:
    subject = f"Welcome to BatchGuard AI, {user.get('name') or org.get('owner_name') or ''}".rstrip(", ")
    body = (
        _p(f"Hi {_e(user.get('name') or org.get('owner_name') or 'there')}, <strong>{_e(org.get('name'))}</strong> is set up. I'm Muse — I watch every machine you connect, investigate when something drifts, and call the right person when it matters.")
        + _h("Next three steps")
        + _list([
            "Onboard a machine from its PDF manual — I extract the parameters and limits for you to verify.",
            "Point the device at its telemetry endpoint with the key from the machine page.",
            "Add escalation contacts and pick a TeleCMI number on the Voice AI page.",
        ], numbered=True)
        + _button("Open the dashboard", f"{settings.app_url}/app")
        + _p("Sign-in email: " + _e(user.get("email", "")), muted=True)
    )
    return subject, layout("You're in.", "welcome", body, "#1e6fff", "Muse, your factory-monitoring agent")


def voice_summary(call: dict[str, Any], transcript_lines: list[dict[str, str]], outcome: dict[str, Any], contact: dict[str, Any] | None = None) -> tuple[str, str]:
    acked = str(outcome.get("acknowledged", "")).lower() == "true"
    accent = "#16c784" if acked else "#7c6cff"
    subject = f"[BatchGuard] Call summary · {call.get('title')} → {call.get('contact_name') or call.get('to_number')}"
    turns = "".join(
        f'<tr><td style="padding:6px 0;font:13px/1.5 Arial,Helvetica,sans-serif;color:#0b1a33"><span style="display:inline-block;min-width:64px;font:700 10px/1 Menlo,Consolas,monospace;letter-spacing:.1em;text-transform:uppercase;color:{"#1e6fff" if t["role"] == "assistant" else "#5b6b85"}">{"Muse" if t["role"] == "assistant" else "Contact"}</span> {_e(t["text"])}</td></tr>'
        for t in transcript_lines[:14]
    )
    body = (
        _p(f"Hi {_e((contact or {}).get('name') or 'there')}, here is what happened on the call to <strong>{_e(call.get('contact_name') or call.get('to_number'))}</strong> ({int(call.get('duration_seconds') or 0)} s).")
        + _kv([("Outcome", "Acknowledged" if acked else "Not acknowledged"), ("ETA", f"{outcome.get('eta_minutes')} min" if outcome.get("eta_minutes") not in (None, "") else None),
               ("Hand-off", outcome.get("handoff_to")), ("Verdict", outcome.get("verdict")), ("Notes", outcome.get("notes")), ("Disposition", call.get("disposition"))])
        + _h("Transcript")
        + f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f9ff;border-radius:12px;padding:6px 12px">{turns or "<tr><td style=\'font:13px Arial\'>No transcript.</td></tr>"}</table>'
        + _button("Open call history", f"{settings.app_url}/app/voice", accent)
    )
    return subject, layout("Voice call summary", "gemini live · telecmi", body, accent, "Muse called with Gemini Live")


def test_email(user: dict[str, Any]) -> tuple[str, str]:
    body = (
        _p(f"Hi {_e(user.get('name') or 'there')}, this is a test from your BatchGuard workspace. If you can read this, Resend is wired up and every alert below will arrive looking like this.")
        + _h("Templates in use")
        + _list(["Incident opened (warning / critical)", "Escalation to the next contact", "Muse's investigation report", "Incident resolved", "Voice call summary", "Daily digest", "Welcome"])
        + _button("Open settings", f"{settings.app_url}/app/settings")
    )
    return "[BatchGuard] Test email — Muse says hello", layout("Email is working", "test", body)


SAMPLE_INC = {"id": "inc_sample", "severity": "critical", "title": "Filler F-200: bearing_temp limit critical", "signals": [{"message": "bearing_temp 92.4 °C above critical limit 85 °C"}, {"message": "vibration rising 0.8 → 4.1 mm/s over 6 min (R² 0.91)"}]}
SAMPLE_M = {"name": "Filler F-200", "device_id": "filler-f-200-01a", "type": "filler"}
SAMPLE_REPORT = {"summary": "Bearing temperature crossed its critical limit while vibration rose with it; the pattern matches drive-end bearing wear rather than ambient heat.",
                 "causes": [{"name": "Bearing wear on the main drive", "support": "strong", "rationale": "temperature and vibration rose together; neighbours normal"}, {"name": "Lubrication starvation", "support": "plausible", "rationale": "same signature early on"}],
                 "checks": [{"order": 1, "action": "Feel the drive-end bearing housing for heat; compare with the non-drive end", "discriminates": "bearing vs ambient"}, {"order": 2, "action": "Check grease point and last lubrication date", "discriminates": "wear vs starvation"}]}


def render(kind: str, user: dict[str, Any] | None = None, org: dict[str, Any] | None = None) -> tuple[str, str]:
    """Sample-data render for previews and the test button."""
    user = user or {"name": "Demo Owner", "email": "demo@batchguard.ai"}
    org = org or {"name": "Demo Packaging Co", "owner_name": "Demo Owner"}
    contact = {"name": user.get("name") or "there"}
    if kind == "incident_opened":
        return incident_opened(SAMPLE_INC, SAMPLE_M, contact)
    if kind == "incident_escalated":
        return incident_escalated({**SAMPLE_INC, "severity": "emergency"}, SAMPLE_M, contact, 1)
    if kind == "report_ready":
        return report_ready(SAMPLE_INC, SAMPLE_M, SAMPLE_REPORT, contact)
    if kind == "incident_resolved":
        return incident_resolved(SAMPLE_INC, SAMPLE_M, {"verdict": "correct", "actual_cause": "worn drive-end bearing", "fix": "bearing replaced, re-greased", "source": "voice: Maintenance lead"})
    if kind == "daily_digest":
        return daily_digest(org, [{"name": "Filler F-200", "status": "critical", "health": 41}, {"name": "Capper C-10", "status": "normal", "health": 98}], [{"severity": "critical", "title": SAMPLE_INC["title"], "status": "acknowledged"}])
    if kind == "welcome":
        return welcome(org, user)
    if kind == "voice_summary":
        return voice_summary({"title": "Critical incident · acknowledge call", "contact_name": "Maintenance lead", "to_number": "+91 98765 43210", "duration_seconds": 92, "disposition": "user_hangup"},
                             [{"role": "assistant", "text": "Hello, this is Muse… am I speaking with the maintenance lead?"}, {"role": "user", "text": "Yes."}, {"role": "assistant", "text": "Filler F-200 on Line 1 is critical…"}, {"role": "user", "text": "Acknowledged, I'll be there in ten minutes."}],
                             {"acknowledged": "true", "eta_minutes": 10}, contact)
    return test_email(user)


TEMPLATES = ["incident_opened", "incident_escalated", "report_ready", "incident_resolved", "voice_summary", "daily_digest", "welcome", "test"]
