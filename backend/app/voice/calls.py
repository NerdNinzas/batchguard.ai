"""Call types (JSON workflow files) → Dograh sync → outbound calls → outcomes applied back to incidents.

Flow: incident turns critical → `auto_dial` (if the org switched it on) or a human presses "Call" →
`place_call` fills the workflow's {{template}} variables from the incident report, triggers Dograh
(Gemini Live speaks over the TeleCMI trunk) → `poll_pending` pulls the run's gathered_context and
applies it: `acknowledged` acknowledges the incident, a follow-up `verdict` resolves it with feedback.
"""

import json
import re
import threading
from pathlib import Path
from typing import Any

from .. import bus
from ..config import settings
from ..db import conn, j, row, rows, tx, uj
from ..ids import new_id, now
from . import dograh

WORKFLOW_DIR = Path(__file__).resolve().parent / "workflows"
TEMPLATE_RE = re.compile(r"\{\{\s*([^|\s}]+)(?:\s*\|[^}]*)?\s*\}\}")
_SKIP_VARS = ("current_time", "current_weekday", "initial_context.", "gathered_context.")
TERMINAL = ("completed", "failed", "no_answer")
BY_SEVERITY = {"critical": "critical_alert", "emergency": "emergency_escalation", "warning": "warning_notice"}


def load_call_types() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for f in sorted(WORKFLOW_DIR.glob("*.json")):
        d = json.loads(f.read_text())
        d["template_variables"] = template_variables(d["workflow_definition"])
        out[d["key"]] = d
    return out


def template_variables(definition: dict[str, Any]) -> list[dict[str, str]]:
    """Every {{name | default}} used anywhere in the node prompts, like the reference app's PlaceCall page."""
    seen: dict[str, str] = {}
    for n in definition.get("nodes", []):
        for v in n.get("data", {}).values():
            if not isinstance(v, str):
                continue
            for m in re.finditer(r"\{\{\s*([^|\s}]+)(?:\s*\|\s*([^}]*))?\s*\}\}", v):
                name = m.group(1)
                if name.startswith(_SKIP_VARS):
                    continue
                seen.setdefault(name, (m.group(2) or "").strip())
    return [{"name": k, "default": v} for k, v in seen.items()]


SCENARIOS: list[dict[str, Any]] = json.loads((Path(__file__).resolve().parent / "scenarios.json").read_text())
# emergency calls also need the escalation story; follow-ups reuse the same machine conditions
_SCENARIO_EXTRA = {"emergency_escalation": {"previous_contact": "Maintenance lead", "escalation_minutes": "2", "open_minutes": "6"}}


def scenarios_for(key: str) -> list[dict[str, Any]]:
    """Condition presets a test call can be placed with (by the call type's severity)."""
    sev = set(CALL_TYPES.get(key, {}).get("severity") or [])
    if key == "test_call":
        return []
    want = {"critical"} if sev & {"critical", "emergency"} else {"warning"} if sev & {"warning"} else {"critical", "warning"}
    out = []
    for sc in SCENARIOS:
        if sc["severity"] in want:
            ctx = {**sc["context"], **_SCENARIO_EXTRA.get(key, {})}
            if key == "emergency_escalation":
                ctx["severity"] = "emergency"
            out.append({"key": sc["key"], "label": sc["label"], "severity": ctx["severity"], "context": ctx})
    return out


CALL_TYPES = load_call_types()
ORDER = ["critical_alert", "emergency_escalation", "warning_notice", "resolution_followup", "test_call"]


# ---------- per-org settings ----------
def get_settings(org_id: str) -> dict[str, Any]:
    r = row(conn().execute("SELECT * FROM voice_settings WHERE org_id=?", (org_id,)).fetchone())
    if not r:
        r = {"org_id": org_id, "telephony_configuration_id": settings.dograh_telephony_config_id,
             "from_phone_number_id": settings.dograh_from_phone_number_id, "from_number": None,
             "auto_dial": 1 if settings.voice_auto_dial else 0, "workflows": "{}", "updated_at": 0, "auto_shutdown": 1, "shutdown_after_seconds": 300}
    r["workflows"] = uj(r["workflows"], {})
    return r


def save_settings(org_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    cur = get_settings(org_id)
    cur.update({k: v for k, v in patch.items() if k in ("telephony_configuration_id", "from_phone_number_id", "from_number", "auto_dial", "workflows", "auto_shutdown", "shutdown_after_seconds")})
    with tx() as c:
        c.execute(
            "INSERT INTO voice_settings (org_id, telephony_configuration_id, from_phone_number_id, from_number, auto_dial, workflows, updated_at, auto_shutdown, shutdown_after_seconds) VALUES (?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(org_id) DO UPDATE SET telephony_configuration_id=excluded.telephony_configuration_id, from_phone_number_id=excluded.from_phone_number_id, "
            "from_number=excluded.from_number, auto_dial=excluded.auto_dial, workflows=excluded.workflows, updated_at=excluded.updated_at, auto_shutdown=excluded.auto_shutdown, shutdown_after_seconds=excluded.shutdown_after_seconds",
            (org_id, cur["telephony_configuration_id"], cur["from_phone_number_id"], cur["from_number"], int(bool(cur["auto_dial"])), j(cur["workflows"]), now(),
             int(bool(cur.get("auto_shutdown", 1))), int(cur.get("shutdown_after_seconds") or 300)),
        )
    return get_settings(org_id)


# ---------- Dograh sync ----------
def workflow_name(org: dict[str, Any], key: str) -> str:
    return f"BatchGuard · {CALL_TYPES[key]['title']} · {org['name']}"


def sync(org: dict[str, Any], key: str) -> dict[str, Any]:
    """Create (first time) or update the Dograh workflow for this call type, then publish it.

    Dograh semantics (verified against the live API): create → version 1 is published at once;
    PUT → a new draft version; POST publish → promotes that draft ("No draft to publish" = nothing changed)."""
    if key not in CALL_TYPES:
        raise KeyError(key)
    st = get_settings(org["id"])
    existing = st["workflows"].get(key) or {}
    definition = CALL_TYPES[key]["workflow_definition"]
    name = workflow_name(org, key)
    wid = existing.get("id")
    if not wid:  # reuse a workflow of the same name (e.g. settings wiped, or created by an earlier attempt)
        for w in dograh.list_workflows():
            if w.get("name") == name and (w.get("status") in (None, "active")):
                wid = w["id"]
                break
    wf: dict[str, Any] | None = None
    if wid:
        try:
            wf = dograh.update_workflow(int(wid), name, definition)
            try:
                dograh.publish_workflow(int(wf["id"]))
            except dograh.DographError as e:
                if "No draft" not in str(e):
                    raise
        except dograh.DographError as e:
            if "404" not in str(e):
                raise
    if wf is None:
        wf = dograh.create_workflow(name, definition)
    if not wf.get("workflow_uuid"):  # create/update responses omit the uuid; fetch carries it
        wf = {**wf, **{k: v for k, v in dograh.get_workflow(int(wf["id"])).items() if k in ("workflow_uuid", "version_number")}}
    entry = {"id": wf["id"], "uuid": wf.get("workflow_uuid"), "name": wf.get("name"), "synced_at": now(), "version": wf.get("version_number") or 1}
    st["workflows"][key] = entry
    save_settings(org["id"], {"workflows": st["workflows"]})
    return entry


def ensure_synced(org: dict[str, Any], key: str) -> dict[str, Any]:
    st = get_settings(org["id"])
    entry = st["workflows"].get(key)
    if entry and entry.get("uuid"):
        return entry
    return sync(org, key)


# ---------- context ----------
def _first_sentence(s: str, limit: int = 240) -> str:
    s = " ".join((s or "").split())
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def build_context(org: dict[str, Any], key: str, contact: dict[str, Any] | None, incident: dict[str, Any] | None,
                  machine: dict[str, Any] | None, st: dict[str, Any], overrides: dict[str, Any] | None = None, scenario: str | None = None) -> dict[str, str]:
    """Template variables for the call, from the incident's investigation report when it exists (or a test scenario)."""
    ctx: dict[str, Any] = {
        "org_name": org.get("name") or "the factory",
        "contact_name": (contact or {}).get("name") or "the on-call contact",
        "contact_role": (contact or {}).get("role") or "on-call",
        "dashboard_url": f"{settings.app_url}/app/voice",
        "lang": "English",
        "from_number": st.get("from_number") or "the configured number",
    }
    if machine:
        line = row(conn().execute("SELECT name FROM lines WHERE id=?", (machine.get("line_id"),)).fetchone()) if machine.get("line_id") else None
        ctx.update({"machine_name": machine.get("name"), "device_id": machine.get("device_id"), "line_name": (line or {}).get("name") or "the line"})
    if incident:
        report = uj(incident.get("report"), None) if isinstance(incident.get("report"), str) else incident.get("report")
        sigs = uj(incident.get("signals"), []) if isinstance(incident.get("signals"), str) else incident.get("signals") or []
        worst = max(sigs, key=lambda s: {"info": 0, "warning": 1, "critical": 2, "emergency": 3}.get(s.get("severity"), 0)) if sigs else None
        opened = incident.get("opened_at") or now()
        mins = max(0, int((now() - opened) / 60))
        ctx.update({
            "severity": incident.get("severity"),
            "incident_id": incident.get("id"),
            "dashboard_url": f"{settings.app_url}/app/incidents/{incident.get('id')}",
            "opened_ago": "just now" if mins == 0 else f"{mins} minute{'s' if mins != 1 else ''} ago",
            "open_minutes": str(mins),
            "escalation_minutes": str(max(1, settings.escalation_timeout_seconds // 60)),
            "problem": _first_sentence((report or {}).get("summary") or (worst or {}).get("message") or incident.get("title") or ""),
        })
        if report:
            causes = report.get("causes") or []
            checks = sorted(report.get("checks") or [], key=lambda c: c.get("order", 99))
            ctx["likely_cause"] = (causes[0].get("name") if causes else "") or "still being investigated"
            ctx["first_check"] = _first_sentence((checks[0].get("action") if checks else "") or "see the dashboard for the recommended check", 200)
            ctx["call_script"] = report.get("call_script") or ""
        else:
            ctx["likely_cause"] = "still being investigated — Muse is gathering evidence"
            ctx["first_check"] = "open the incident on the dashboard; the checklist appears as soon as the investigation finishes"
    if scenario:
        sc = next((x for x in scenarios_for(key) if x["key"] == scenario), None)
        if sc:
            ctx.update(sc["context"])
    for k, v in (overrides or {}).items():
        if v not in (None, ""):
            ctx[k] = v
    return {k: str(v) for k, v in ctx.items() if v is not None}


# ---------- placing calls ----------
def _normalise_phone(p: str) -> str:
    p = re.sub(r"[^\d+]", "", p or "")
    if p and not p.startswith("+"):
        p = "+" + p
    return p


def place_call(org: dict[str, Any], key: str, to_number: str, *, contact: dict[str, Any] | None = None, incident: dict[str, Any] | None = None,
               overrides: dict[str, Any] | None = None, placed_by: str = "system", draft: bool = False, scenario: str | None = None) -> dict[str, Any]:
    if key not in CALL_TYPES:
        raise ValueError(f"unknown call type {key}")
    phone = _normalise_phone(to_number)
    if len(phone) < 8:
        raise ValueError("A phone number in international format is required, e.g. +91 98765 43210")
    st = get_settings(org["id"])
    machine = row(conn().execute("SELECT * FROM machines WHERE id=?", (incident["machine_id"],)).fetchone()) if incident else None
    ctx = build_context(org, key, contact, incident, machine, st, overrides, scenario=scenario)
    call = {
        "id": new_id("call"), "org_id": org["id"], "incident_id": (incident or {}).get("id"), "contact_id": (contact or {}).get("id"),
        "contact_name": (contact or {}).get("name"), "call_type": key, "to_number": phone, "from_number": st.get("from_number"),
        "workflow_id": None, "workflow_uuid": None, "run_id": None, "run_name": None, "status": "dialing", "duration_seconds": None,
        "disposition": None, "initial_context": j(ctx), "gathered_context": None, "transcript_url": None, "recording_url": None,
        "error": None, "placed_by": placed_by, "applied": 0, "created_at": now(), "updated_at": now(),
    }
    try:
        entry = ensure_synced(org, key)
        call["workflow_id"], call["workflow_uuid"] = entry["id"], entry["uuid"]
        res = dograh.trigger_call(entry["uuid"], phone, ctx, st.get("telephony_configuration_id"), st.get("from_phone_number_id"), draft=draft)
        call["run_id"], call["run_name"] = res.get("workflow_run_id"), res.get("workflow_run_name")
        call["status"] = "ringing"
    except Exception as e:  # noqa: BLE001
        call["status"], call["error"] = "failed", str(e)[:400]
    with tx() as c:
        c.execute(
            "INSERT INTO voice_calls (id, org_id, incident_id, contact_id, contact_name, call_type, to_number, from_number, workflow_id, workflow_uuid, run_id, run_name, "
            "status, duration_seconds, disposition, initial_context, gathered_context, transcript_url, recording_url, error, placed_by, applied, created_at, updated_at) "
            "VALUES (:id,:org_id,:incident_id,:contact_id,:contact_name,:call_type,:to_number,:from_number,:workflow_id,:workflow_uuid,:run_id,:run_name,:status,"
            ":duration_seconds,:disposition,:initial_context,:gathered_context,:transcript_url,:recording_url,:error,:placed_by,:applied,:created_at,:updated_at)",
            call,
        )
    out = public(call)
    bus.publish(org["id"], "voice_call", out)
    return out


def public(call: dict[str, Any]) -> dict[str, Any]:
    c = dict(call)
    c["initial_context"] = uj(c.get("initial_context"), {}) if isinstance(c.get("initial_context"), str) else c.get("initial_context") or {}
    c["gathered_context"] = uj(c.get("gathered_context"), None) if isinstance(c.get("gathered_context"), str) else c.get("gathered_context")
    c["title"] = CALL_TYPES.get(c["call_type"], {}).get("title", c["call_type"])
    c["outcome"], c["telemetry"] = split_gathered(c["gathered_context"])
    return c


# ---------- transcript + outcome extraction ----------
TELEMETRY_KEYS = {"provider", "triggered_by", "call_id", "channel_name", "ext_channel_id", "bridge_id", "nodes_visited", "call_status",
                  "call_disposition", "mapped_call_disposition", "call_tags", "hangup_cause", "sip_call_id"}
_LINE_RE = re.compile(r"^\[(?P<ts>[^\]]+)\]\s*(?P<role>assistant|user|system|bot|agent)\s*:\s*(?P<text>.*)$", re.I)


def parse_transcript(text: str) -> list[dict[str, str]]:
    """Dograh transcript lines look like `[2026-10-16T11:54:08+00:00] assistant: Hello…`."""
    out: list[dict[str, str]] = []
    for raw in (text or "").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        m = _LINE_RE.match(raw)
        if m:
            role = m.group("role").lower()
            out.append({"ts": m.group("ts"), "role": "assistant" if role in ("assistant", "bot", "agent") else role, "text": m.group("text").strip()})
        elif out:
            out[-1]["text"] += " " + raw
        else:
            out.append({"ts": "", "role": "system", "text": raw})
    return out


def _extraction_spec(key: str) -> tuple[str, list[dict[str, str]]]:
    for n in CALL_TYPES.get(key, {}).get("workflow_definition", {}).get("nodes", []):
        if n.get("type") == "endCall":
            return n["data"].get("extraction_prompt", ""), n["data"].get("extraction_variables", [])
    return "", []


def _heuristic_outcome(key: str, lines: list[dict[str, str]]) -> dict[str, Any]:
    user_text = " ".join(l["text"].lower() for l in lines if l["role"] == "user")
    out: dict[str, Any] = {"reached_contact": any(l["role"] == "user" for l in lines)}
    yes = any(w in user_text for w in ("acknowledge", "acknowledged", "i'll take", "i will take", "on my way", "taking it", "okay i will", "yes i will", "confirmed", "हाँ", "ठीक है"))
    if key in ("critical_alert", "emergency_escalation", "warning_notice"):
        out["acknowledged"] = yes
        m = re.search(r"(\d{1,3})\s*(min|minute)", user_text)
        if m:
            out["eta_minutes"] = int(m.group(1))
    if key == "test_call":
        out["confirmed"] = yes or "yes" in user_text
    if key == "resolution_followup":
        for v in ("correct", "partly", "wrong"):
            if v in user_text:
                out["verdict"] = v
                break
        out["resolved"] = any(w in user_text for w in ("running normally", "running fine", "it's fine", "resolved", "working now"))
    out["_extracted_by"] = "heuristic"
    return out


def extract_outcome(key: str, lines: list[dict[str, str]]) -> dict[str, Any]:
    """Fill the endCall extraction variables from the transcript with Gemini (Vertex), falling back to keyword rules."""
    if not lines:
        return {}
    prompt, variables = _extraction_spec(key)
    if not variables:
        return {}
    if settings.gemini_enabled:
        try:
            from google import genai
            from google.genai import types

            spec = "\n".join(f"- {v['name']} ({v.get('type', 'string')}): {v.get('prompt', '')}" for v in variables)
            convo = "\n".join(f"{l['role']}: {l['text']}" for l in lines)
            client = genai.Client()
            resp = client.models.generate_content(
                model=settings.gemini_model_fast,
                contents=f"{prompt}\n\nReturn a JSON object with exactly these keys:\n{spec}\n\nUse null when the transcript does not support a value. "
                         f"The contact may answer in Hindi or Hinglish; speech-to-text noise is possible, judge intent.\n\nTRANSCRIPT:\n{convo}",
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0),
            )
            data = json.loads(resp.text or "{}")
            if isinstance(data, dict):
                data["_extracted_by"] = f"gemini:{settings.gemini_model_fast}"
                return {k: v for k, v in data.items() if v is not None}
        except Exception as e:  # noqa: BLE001
            print("voice extraction via gemini failed:", e)
    return _heuristic_outcome(key, lines)


def split_gathered(g: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, Any]]:
    """(outcome variables, Dograh call telemetry)."""
    g = g or {}
    return {k: v for k, v in g.items() if k not in TELEMETRY_KEYS}, {k: v for k, v in g.items() if k in TELEMETRY_KEYS}


# ---------- outcomes ----------
def refresh_call(call: dict[str, Any]) -> dict[str, Any]:
    """Pull the Dograh run; when it completes, store the gathered variables and apply them to the incident."""
    if call["status"] in TERMINAL or not call.get("run_id") or not call.get("workflow_id"):
        return call
    try:
        run = dograh.run_detail(int(call["workflow_id"]), int(call["run_id"]))
    except dograh.DographError as e:
        if "404" in str(e):
            with tx() as c:
                c.execute("UPDATE voice_calls SET status='failed', error=?, updated_at=? WHERE id=?", (str(e)[:400], now(), call["id"]))
        return call
    gathered = run.get("gathered_context") or {}
    usage = run.get("usage_info") or {}
    duration = usage.get("call_duration_seconds") or run.get("call_duration_seconds")
    completed = bool(run.get("is_completed"))
    age = now() - call["created_at"]
    status = call["status"]
    if completed:
        status = "completed" if (duration or gathered or run.get("transcript_url")) else "no_answer"
    elif age > 60 and status == "ringing":
        status = "in_progress"
    if age > 1800 and not completed:
        status = "failed"
    patch = {
        "status": status, "duration_seconds": duration, "gathered_context": j(gathered) if gathered else None,
        "transcript_url": run.get("transcript_public_url") or call.get("transcript_url"),
        "recording_url": run.get("recording_public_url") or call.get("recording_url"),
        "updated_at": now(), "id": call["id"],
    }
    with tx() as c:
        c.execute("UPDATE voice_calls SET status=:status, duration_seconds=:duration_seconds, gathered_context=:gathered_context, transcript_url=:transcript_url, "
                  "recording_url=:recording_url, updated_at=:updated_at WHERE id=:id", patch)
    call = {**call, **patch}
    if completed and not call.get("applied"):
        outcome, _tele = split_gathered(gathered)
        lines = parse_transcript(dograh.fetch_text(call["transcript_url"])) if call.get("transcript_url") else []
        if not any(k in outcome for k in ("acknowledged", "confirmed", "verdict", "resolved")):
            # Dograh's post-call extraction did not run (e.g. its Gemini quota) → extract here
            extracted = extract_outcome(call["call_type"], lines)
            gathered = {**gathered, **extracted}
            with tx() as c:
                c.execute("UPDATE voice_calls SET gathered_context=? WHERE id=?", (j(gathered), call["id"]))
            call["gathered_context"] = j(gathered)
        _apply_outcome(call, gathered)
        try:
            from .. import notify

            notify.on_voice_call_completed(call, lines, split_gathered(gathered)[0])
        except Exception as e:  # noqa: BLE001
            print("voice summary mail error:", e)
    bus.publish(call["org_id"], "voice_call", public(call))
    return call


def _truthy(v: Any) -> bool:
    return v is True or str(v).strip().lower() in ("true", "yes", "1")


def _apply_outcome(call: dict[str, Any], gathered: dict[str, Any]) -> None:
    from .. import incidents as inc_mod

    iid = call.get("incident_id")
    if iid:
        inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (iid,)).fetchone())
        who = f"voice: {call.get('contact_name') or call['to_number']}"
        if inc and _truthy(gathered.get("acknowledged")) and inc["status"] == "open":
            inc_mod.acknowledge(iid, who)
        if inc and call["call_type"] == "resolution_followup" and _truthy(gathered.get("resolved")) and inc["status"] != "resolved":
            verdict = str(gathered.get("verdict") or "").lower()
            inc_mod.resolve(iid, {"verdict": verdict if verdict in ("correct", "partly", "wrong") else "partly",
                                  "actual_cause": str(gathered.get("actual_cause") or ""), "fix": str(gathered.get("fix") or ""), "source": who})
    with tx() as c:
        c.execute("UPDATE voice_calls SET applied=1 WHERE id=?", (call["id"],))
        c.execute("UPDATE notifications SET status=? WHERE channel='voice' AND body LIKE ?",
                  (f"{call['status']}" + (" · acknowledged" if _truthy(gathered.get("acknowledged")) else ""), f"%{call['id']}%"))


def poll_pending() -> int:
    """Called from the sweeper: refresh calls that are still in flight (cheap when there are none)."""
    if not dograh.enabled():
        return 0
    pending = rows(conn().execute("SELECT * FROM voice_calls WHERE status NOT IN ('completed','failed','no_answer') AND created_at > ?", (now() - 3600,)).fetchall())
    for call in pending:
        try:
            refresh_call(call)
        except Exception as e:  # noqa: BLE001
            print("voice poll error:", e)
    return len(pending)


# ---------- automatic dialling from the escalation ladder ----------
def auto_dial(inc: dict[str, Any], m: dict[str, Any], contact: dict[str, Any] | None, level: int = 0) -> dict[str, Any] | None:
    """Returns the call record, or None when voice is off / auto-dial is off / no phone on the contact."""
    if not dograh.enabled():
        return None
    org = row(conn().execute("SELECT * FROM orgs WHERE id=?", (inc["org_id"],)).fetchone())
    if not org:
        return None
    st = get_settings(org["id"])
    if not st.get("auto_dial") or not contact or not contact.get("phone"):
        return None
    key = BY_SEVERITY.get(inc["severity"])
    if not key:
        return None
    overrides: dict[str, Any] = {}
    if key == "emergency_escalation":
        contacts = rows(conn().execute("SELECT * FROM contacts WHERE org_id=? ORDER BY escalation_order", (org["id"],)).fetchall())
        prev = contacts[max(0, min(level - 1, len(contacts) - 1))] if contacts else None
        overrides["previous_contact"] = (prev or {}).get("name") or "the previous contact"
    result: dict[str, Any] = {}

    def _go() -> None:
        try:
            result.update(place_call(org, key, contact["phone"], contact=contact, incident=inc, overrides=overrides, placed_by="auto-dial"))
        except Exception as e:  # noqa: BLE001
            print("auto-dial error:", e)

    threading.Thread(target=_go, daemon=True).start()
    return {"queued": True, "call_type": key, "to": contact["phone"]}
