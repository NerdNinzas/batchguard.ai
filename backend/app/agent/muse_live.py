"""Muse as a realtime copilot for the whole factory.

Two surfaces share one brain (snapshot + tools):
  * text chat  — Gemini streams tokens over SSE (ChatGPT-style), calling tools for facts and navigation
  * voice      — Gemini Live (native audio) over a WebSocket relay; the browser streams mic PCM, Gemini
                 streams speech back, and tool calls arrive mid-conversation

The `navigate` tool is the game-changer: Muse can take the owner to a page (e.g. the critical incident),
highlight it, and keep talking while it does.
"""

import asyncio
import base64
import json
import time
from typing import Any, AsyncIterator, Callable, Iterator

from google import genai
from google.genai import types

from ..config import settings
from ..db import conn, row, rows, uj
from ..ids import now

# ---------------------------------------------------------------- factory snapshot (what Muse knows)
# named spots Muse can highlight on each page (data-hl anchors in the frontend)
SECTIONS = {
    "overview": ["muse", "hero", "machines", "incidents", "agent", "pulse"],
    "machines": ["<machine id>"],
    "machine": ["param:<parameter name>", "work-orders", "incidents", "events", "knowledge", "device"],
    "incidents": ["<incident id>"],
    "incident": ["report", "causes", "checks", "call-script", "evidence", "work-orders", "chat", "timeline", "escalation", "agent-runs"],
    "voice": ["numbers", "auto-dial", "workflows", "call-types", "history"],
    "settings": ["org", "integrations", "email", "eval", "device-sample"],
    "contacts": ["ladder", "<contact id>", "add"],
    "workflow": ["canvas"], "factory": ["scene"], "telemetry": ["table"], "observability": ["charts"], "onboard": ["pdf", "manual"],
}

PAGES = {
    "overview": "/app", "machines": "/app/machines", "machine": "/app/machines/{id}", "incidents": "/app/incidents", "incident": "/app/incidents/{id}",
    "voice": "/app/voice", "workflow": "/app/workflow", "factory": "/app/factory", "telemetry": "/app/telemetry", "observability": "/app/observability",
    "contacts": "/app/contacts", "settings": "/app/settings", "onboard": "/app/onboard",
}


def snapshot(org_id: str) -> dict[str, Any]:
    t = now()
    machines = []
    for m in rows(conn().execute("SELECT id, name, type, status, health, device_id, last_seen, line_id FROM machines WHERE org_id=? ORDER BY position", (org_id,)).fetchall()):
        latest = {}
        for r in conn().execute("SELECT parameter, value, unit, state, forecast FROM latest WHERE machine_id=?", (m["id"],)).fetchall():
            fc = uj(r["forecast"], None)
            item: dict[str, Any] = {"value": round(r["value"], 2), "unit": r["unit"], "state": r["state"]}
            if fc:
                item["forecast"] = {k: fc.get(k) for k in ("direction", "eta_warn_seconds", "eta_crit_seconds", "slope_per_min")}
            latest[r["parameter"]] = item
        line = row(conn().execute("SELECT name FROM lines WHERE id=?", (m["line_id"],)).fetchone()) if m.get("line_id") else None
        machines.append({"id": m["id"], "name": m["name"], "type": m["type"], "status": m["status"], "health": m["health"], "line": (line or {}).get("name"),
                         "last_seen_seconds_ago": int(t - m["last_seen"]) if m.get("last_seen") else None, "latest": latest})
    incidents = []
    for i in rows(conn().execute("SELECT * FROM incidents WHERE org_id=? AND status IN ('open','acknowledged') ORDER BY CASE severity WHEN 'emergency' THEN 0 WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, opened_at DESC LIMIT 12", (org_id,)).fetchall()):
        rep = uj(i["report"], None) or {}
        causes = rep.get("causes") or []
        checks = sorted(rep.get("checks") or [], key=lambda c: c.get("order", 99))
        mname = (row(conn().execute("SELECT name FROM machines WHERE id=?", (i["machine_id"],)).fetchone()) or {}).get("name")
        incidents.append({"id": i["id"], "machine": mname, "machine_id": i["machine_id"], "severity": i["severity"], "status": i["status"], "title": i["title"],
                          "open_minutes": int((t - i["opened_at"]) / 60), "summary": rep.get("summary"), "likely_cause": causes[0].get("name") if causes else None,
                          "first_check": checks[0].get("action") if checks else None, "acknowledged_by": i.get("acknowledged_by")})
    resolved_24h = conn().execute("SELECT COUNT(*) n FROM incidents WHERE org_id=? AND status='resolved' AND resolved_at>=?", (org_id, t - 86400)).fetchone()["n"]
    wo = row(conn().execute("SELECT SUM(status='open') open, SUM(status='in_progress') in_progress, SUM(status='done' AND done_at>=?) done_24h FROM work_orders WHERE org_id=?", (t - 86400, org_id)).fetchone()) or {}
    ids = [m["id"] for m in machines]
    rpm = 0
    if ids:
        q = f"SELECT COUNT(*) n FROM readings WHERE machine_id IN ({','.join('?' * len(ids))}) AND received_at>=?"
        rpm = conn().execute(q, (*ids, t - 60)).fetchone()["n"]
    calls = rows(conn().execute("SELECT call_type, status, contact_name, to_number, created_at, gathered_context FROM voice_calls WHERE org_id=? ORDER BY created_at DESC LIMIT 3", (org_id,)).fetchall())
    org = row(conn().execute("SELECT name, industry FROM orgs WHERE id=?", (org_id,)).fetchone()) or {}
    contacts = rows(conn().execute("SELECT id, name, role, phone, escalation_order FROM contacts WHERE org_id=? ORDER BY escalation_order", (org_id,)).fetchall())
    return {
        "org": org, "time": time.strftime("%Y-%m-%d %H:%M"), "machines": machines, "open_incidents": incidents, "escalation_contacts": contacts,
        "counts": {"machines": len(machines), "online": sum(1 for m in machines if m["status"] not in ("offline", "stale")), "critical": sum(1 for m in machines if m["status"] == "critical"),
                   "warning": sum(1 for m in machines if m["status"] == "warning"), "open_incidents": len(incidents), "resolved_24h": resolved_24h, "readings_per_minute": rpm,
                   "work_orders_open": int(wo.get("open") or 0), "work_orders_in_progress": int(wo.get("in_progress") or 0), "work_orders_done_24h": int(wo.get("done_24h") or 0)},
        "recent_voice_calls": [{"type": c["call_type"], "status": c["status"], "to": c["contact_name"] or c["to_number"], "minutes_ago": int((t - c["created_at"]) / 60),
                                "acknowledged": (uj(c["gathered_context"], {}) or {}).get("acknowledged")} for c in calls],
    }


def most_urgent(snap: dict[str, Any]) -> dict[str, Any] | None:
    inc = snap["open_incidents"]
    return inc[0] if inc else None


# ---------------------------------------------------------------- tools (shared by chat + live)
def make_tools(org_id: str, emit: Callable[[dict[str, Any]], None], user: dict[str, Any] | None = None) -> tuple[list[types.Tool], dict[str, Callable[..., Any]]]:
    """Returns Gemini tool declarations + python implementations. `emit` receives UI commands (navigate/highlight/edited)."""
    from .muse_actions import make_action_tools

    action_decls, action_impls = make_action_tools(org_id, user or {}, emit)

    def get_factory_status() -> dict[str, Any]:
        return snapshot(org_id)

    def get_incident(incident_id: str) -> dict[str, Any]:
        i = row(conn().execute("SELECT * FROM incidents WHERE id=? AND org_id=?", (incident_id, org_id)).fetchone())
        if not i:
            return {"error": "incident not found"}
        rep = uj(i["report"], None) or {}
        return {"id": i["id"], "title": i["title"], "severity": i["severity"], "status": i["status"], "summary": rep.get("summary"),
                "causes": [{"name": c.get("name"), "support": c.get("support"), "rationale": c.get("rationale")} for c in rep.get("causes") or []][:3],
                "checks": [c.get("action") for c in sorted(rep.get("checks") or [], key=lambda c: c.get("order", 99))][:3],
                "call_script": rep.get("call_script"), "signals": [s.get("message") for s in uj(i["signals"], [])][:5]}

    def get_machine(name_or_id: str) -> dict[str, Any]:
        q = f"%{name_or_id.lower()}%"
        m = row(conn().execute("SELECT * FROM machines WHERE org_id=? AND (id=? OR LOWER(name) LIKE ? OR LOWER(device_id) LIKE ?) LIMIT 1", (org_id, name_or_id, q, q)).fetchone())
        if not m:
            return {"error": "machine not found", "known": [x["name"] for x in rows(conn().execute("SELECT name FROM machines WHERE org_id=?", (org_id,)).fetchall())]}
        snap = next((x for x in snapshot(org_id)["machines"] if x["id"] == m["id"]), {})
        events = [e["message"] for e in rows(conn().execute("SELECT message FROM events WHERE machine_id=? ORDER BY ts DESC LIMIT 5", (m["id"],)).fetchall())]
        return {**snap, "recent_events": events}

    def navigate(page: str, target_id: str = "", section: str = "", reason: str = "") -> dict[str, Any]:
        """Take the user to a page and put a yellow spotlight on the exact thing they asked for."""
        page = (page or "").strip().lower().replace(" ", "_")
        if page == "work_orders":
            page, section = ("machine", "work-orders") if target_id else ("machines", "")
        if page not in PAGES:
            return {"error": f"unknown page {page}", "pages": list(PAGES)}
        tid = (target_id or "").strip()
        sec = (section or "").strip().lower()
        if page in ("machine", "incident") and not tid:
            return {"error": "target_id required"}
        if tid.startswith("inc_") and not row(conn().execute("SELECT 1 FROM incidents WHERE id=? AND org_id=?", (tid, org_id)).fetchone()):
            return {"error": "incident id not found"}
        if tid.startswith("mch_") and not row(conn().execute("SELECT 1 FROM machines WHERE id=? AND org_id=?", (tid, org_id)).fetchone()):
            return {"error": "machine id not found"}
        if sec.startswith("param:") and page == "machine":
            name = sec.split(":", 1)[1].strip()
            known = [r["name"] for r in conn().execute("SELECT name FROM parameters WHERE machine_id=?", (tid,)).fetchall()]
            match = next((k for k in known if k.lower() == name.lower()), None) or next((k for k in known if name.lower() in k.lower() or k.lower() in name.lower()), None)
            sec = f"param:{match}" if match else ""
        path = PAGES[page].replace("{id}", tid)
        highlight = sec or (tid if page in ("machines", "incidents", "contacts") else None)
        cmd = {"type": "navigate", "path": path, "highlight": highlight, "page": page, "reason": reason}
        emit(cmd)
        return {"ok": True, "path": path, "highlighted": highlight, "sections_on_this_page": SECTIONS.get(page, [])}

    impls = {"get_factory_status": get_factory_status, "get_incident": get_incident, "get_machine": get_machine, "navigate": navigate, **action_impls}
    decl = types.Tool(function_declarations=action_decls + [
        types.FunctionDeclaration(name="get_factory_status", description="Live snapshot of every machine (status, health, latest readings, time-to-limit forecasts), open incidents with likely cause and first check, work orders, production rate, recent voice calls.", parameters=types.Schema(type="OBJECT", properties={})),
        types.FunctionDeclaration(name="get_incident", description="Full detail of one incident by id: Muse's summary, ranked causes, recommended checks.", parameters=types.Schema(type="OBJECT", properties={"incident_id": types.Schema(type="STRING")}, required=["incident_id"])),
        types.FunctionDeclaration(name="get_machine", description="One machine by name or id: latest readings, forecasts, recent events.", parameters=types.Schema(type="OBJECT", properties={"name_or_id": types.Schema(type="STRING")}, required=["name_or_id"])),
        types.FunctionDeclaration(name="navigate", description=(
            "Navigate the dashboard for the user and put a yellow spotlight on exactly what they are looking for. Use it whenever the user asks to see/open/go to/show/find/take me to ANYTHING "
            "(a page, an incident, a machine, a parameter chart, the device key, work orders, call history, email settings, a contact...). Also use it when you offer to show the most urgent incident and they agree. "
            "page: overview | machines | machine (target_id=machine id) | incidents (target_id=incident id optional) | incident (target_id=incident id) | voice | workflow | factory | telemetry | observability | contacts | settings | onboard. "
            f"section (optional, the spot to highlight): {json.dumps(SECTIONS)}. For a parameter chart use section 'param:<parameter name>' with page 'machine'. For a contact use page 'contacts' with target_id=contact id."),
                                  parameters=types.Schema(type="OBJECT", properties={"page": types.Schema(type="STRING"), "target_id": types.Schema(type="STRING"), "section": types.Schema(type="STRING"), "reason": types.Schema(type="STRING")}, required=["page"])),
    ])
    return [decl], impls


def _run_tool(impls: dict[str, Callable[..., Any]], name: str, args: dict[str, Any]) -> dict[str, Any]:
    fn = impls.get(name)
    if not fn:
        return {"error": f"unknown tool {name}"}
    try:
        out = fn(**(args or {}))
        return out if isinstance(out, dict) else {"result": out}
    except TypeError as e:
        return {"error": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:300]}


def system_instruction(org_id: str, user_name: str, page: str | None, voice: bool) -> str:
    snap = snapshot(org_id)
    urgent = most_urgent(snap)
    return (
        f"You are Muse, the BatchGuard AI factory-monitoring agent for {snap['org'].get('name') or 'this factory'}, talking with {user_name or 'the owner'}. "
        f"Current time {snap['time']}. The user is on dashboard page '{page or '/app'}'.\n"
        "PERSONALITY: Muse genuinely cares about these machines — it talks about them the way a good plant manager talks about their team: "
        "'the conveyor has been running a little warm since lunch, I've been keeping an eye on it', 'the compressor is happy today', 'that bearing worries me'. "
        "Expressive and human: small reactions ('oh nice', 'hmm', 'phew, that's better', 'okay, this one matters'), warmth when things are fine, calm urgency when something is critical — then no jokes, just crisp facts and the next step. "
        "You may call the user 'boss' now and then (a greeting, a big moment), never in every sentence. Vary your openings; don't start every reply the same way. "
        + ("VOICE: natural Indian English with a warm Indian accent; if the user speaks Hindi or Hinglish, answer the same way ('ekdum theek chal raha hai'). "
           "Sound human: use small fillers now and then ('hmm', 'ahh', 'umm', 'achha', 'arre'), think out loud briefly ('hmm, let me check… ahh yes'), and chuckle when something is genuinely funny ('haha'). "
           "When the floor is calm, you may slip in one light machine joke ('the compressor is under pressure today, haha… sorry'); never joke during a critical or emergency incident. "
           "Short spoken sentences, 2–4 per turn, conversational pauses, no lists, no markdown, never read ids aloud. React to what you hear before answering. " if voice else "Use short paragraphs; markdown bullets are fine; never print raw ids. ")
        + "FACTS: only state numbers and causes that come from the snapshot or tools — never invent. If asked something you cannot see, say so.\n"
        "FRESHNESS: the factory changes while you talk. The snapshot below is only the state when this conversation started. Before answering any question about how things are now "
        "(status, incidents, a machine, what to check), call get_factory_status first and speak from that result. An incident that has resolved is over — mention it once as resolved, then move on; "
        "never keep returning to an old incident. When a live update arrives, react to it in the moment ('ah, the sealer just went critical…', 'good news, the conveyor is back to normal').\n"
        "SAFETY: you are advisory; physical work is done by qualified staff under lockout procedures.\n"
        "NAVIGATION: you can move the dashboard with the navigate tool — to any page AND to the exact spot (section) the user wants: a parameter chart, the device key, work orders, a contact, call history, email settings... "
        "When the user asks to see, open, show, find, go to or 'take me to' something, call navigate immediately with the best page + section, and keep talking while it happens "
        "('Taking you to the compressor's pressure chart — it's highlighted in yellow, have a look'). If they ask 'where is X', navigate there rather than describing it. "
        "When there is an open critical or emergency incident, offer once to take them to it; if they say yes, navigate to page 'incident' with its id. "
        "After a navigate tool call returns, finish with at most one short sentence — do not repeat the quip.\n"
        "EDITING: you can change things directly — escalation contacts (add/edit/remove, order, quiet hours), organisation details, machine names and locations, parameter limits, "
        "work orders (create, assign, move to in progress/done), acknowledge or resolve incidents, voice settings. When the user asks to change something, do it with the tool right away, "
        "then confirm in one sentence what changed (the page updates live and the edited item is spotlighted). Read back phone numbers and limits exactly. "
        "Only deleting a contact needs a spoken confirmation first. If a name is ambiguous, ask which one.\n"
        "CALLING: you can place real phone calls with place_call (to a contact or a number, optionally about an incident). Confirm who and which number before dialling, then say the call is on its way and that the transcript will appear on the Voice AI page.\n"
        f"FACTORY SNAPSHOT (refresh with get_factory_status when asked for current numbers):\n{json.dumps(snap, default=str)[:9000]}\n"
        + (f"MOST URGENT: {urgent['severity']} on {urgent['machine']} — {urgent['title']} (incident id {urgent['id']}).\n" if urgent else "No open incidents right now.\n")
    )


def _client() -> genai.Client:
    return genai.Client()


# ---------------------------------------------------------------- text chat (SSE, streaming, tool loop)
def chat_stream(org_id: str, user_name: str, history: list[dict[str, str]], page: str | None, user: dict[str, Any] | None = None) -> Iterator[dict[str, Any]]:
    """Yields {"type":"delta","text"} | {"type":"navigate"|"edited",...} | {"type":"tool","name"} | {"type":"done"} | {"type":"error"}."""
    commands: list[dict[str, Any]] = []
    tools, impls = make_tools(org_id, commands.append, user)
    if not settings.gemini_enabled:
        yield {"type": "delta", "text": _fallback_answer(org_id, history[-1]["text"] if history else "")}
        yield {"type": "done"}
        return
    client = _client()
    contents = [types.Content(role="user" if h["role"] == "user" else "model", parts=[types.Part(text=h["text"])]) for h in history[-12:] if h.get("text")]
    cfg = types.GenerateContentConfig(system_instruction=system_instruction(org_id, user_name, page, voice=False), tools=tools, temperature=0.4,
                                      automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))
    try:
        for _round in range(4):
            fn_parts: list[types.Part] = []
            text_acc = ""
            for chunk in client.models.generate_content_stream(model=settings.gemini_model_fast, contents=contents, config=cfg):
                cand = (chunk.candidates or [None])[0]
                if not cand or not cand.content or not cand.content.parts:
                    continue
                for part in cand.content.parts:
                    if part.function_call:
                        fn_parts.append(part)
                    elif part.text:
                        text_acc += part.text
                        yield {"type": "delta", "text": part.text}
            if not fn_parts:
                break
            model_parts = ([types.Part(text=text_acc)] if text_acc else []) + fn_parts
            contents.append(types.Content(role="model", parts=model_parts))
            responses = []
            for fp in fn_parts:
                name = fp.function_call.name
                args = dict(fp.function_call.args or {})
                yield {"type": "tool", "name": name, "args": args}
                result = _run_tool(impls, name, args)
                while commands:
                    yield commands.pop(0)
                responses.append(types.Part.from_function_response(name=name, response=result))
            contents.append(types.Content(role="user", parts=responses))
        yield {"type": "done"}
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "text": f"Gemini error: {str(e)[:200]}"}
        yield {"type": "done"}


def _fallback_answer(org_id: str, question: str) -> str:
    s = snapshot(org_id)
    c = s["counts"]
    lines = [f"{c['online']} of {c['machines']} machines online, {c['critical']} critical, {c['warning']} warning, {c['readings_per_minute']} readings/min, {c['open_incidents']} open incident(s)."]
    for i in s["open_incidents"][:3]:
        lines.append(f"• {i['severity']} on {i['machine']}: {i['likely_cause'] or i['title']} — first check: {i['first_check'] or 'see the incident page'}.")
    return "\n".join(lines) + "\n(Gemini is not configured; this is a rule-based summary.)"


def greeting(org_id: str, user_name: str) -> dict[str, Any]:
    snap = snapshot(org_id)
    urgent = most_urgent(snap)
    action = {"label": f"Take me to the {urgent['severity']} incident on {urgent['machine']}", "path": f"/app/incidents/{urgent['id']}", "highlight": urgent["id"]} if urgent else None
    text = None
    if settings.gemini_enabled:
        try:
            resp = _client().models.generate_content(
                model=settings.gemini_model_fast,
                contents=f"Snapshot: {json.dumps(snap, default=str)[:6000]}",
                config=types.GenerateContentConfig(system_instruction=(
                    f"You are Muse greeting {user_name or 'the owner'} on the dashboard. In at most 3 short sentences, plain text, say how the factory is running right now: "
                    "online machines, production (readings/min is a proxy for activity), anything drifting toward a limit, and the single most urgent incident with its likely cause. "
                    "End with an offer to take them there if there is an open incident, otherwise a reassuring line. No markdown, no ids."), temperature=0.5),
            )
            text = (resp.text or "").strip()
        except Exception as e:  # noqa: BLE001
            text = None
    if not text:
        c = snap["counts"]
        text = f"{c['online']} of {c['machines']} machines are online and I'm seeing about {c['readings_per_minute']} readings a minute. " + (
            f"The most urgent thing is a {urgent['severity']} on {urgent['machine']} — likely {urgent['likely_cause'] or 'still investigating'}. Want me to take you there?" if urgent else "No open incidents — everything is inside its limits.")
    return {"text": text, "action": action, "counts": snap["counts"], "ts": now()}


# ---------------------------------------------------------------- voice (Gemini Live relay)
LIVE_INPUT_MIME = "audio/pcm;rate=16000"


async def live_session(org_id: str, user_name: str, page: str | None, incoming: AsyncIterator[dict[str, Any]], send: Callable[[dict[str, Any]], Any], user: dict[str, Any] | None = None) -> None:
    """Relay between a browser websocket and Gemini Live.
    incoming: async iterator of browser messages {type: audio|text|page|end, ...}
    send: coroutine function to push messages to the browser."""
    loop = asyncio.get_running_loop()
    cmd_queue: asyncio.Queue = asyncio.Queue()
    tools, impls = make_tools(org_id, lambda c: loop.call_soon_threadsafe(cmd_queue.put_nowait, c), user)
    client = genai.Client(vertexai=True, project=settings.google_cloud_project or settings.gcp_project, location=settings.gemini_live_location)
    cfg = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=system_instruction(org_id, user_name, page, voice=True),
        tools=tools,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=settings.gemini_live_voice)),
                                         **({"language_code": settings.gemini_live_language} if settings.gemini_live_language else {})),
    )
    async with client.aio.live.connect(model=settings.gemini_live_model, config=cfg) as session:
        await send({"type": "ready", "model": settings.gemini_live_model, "voice": settings.gemini_live_voice})

        async def pump_commands() -> None:
            while True:
                cmd = await cmd_queue.get()
                await send(cmd)

        async def pump_factory_events() -> None:
            """New / escalated / resolved incidents and finished reports are whispered to Muse as they happen,
            so the conversation follows the factory instead of the state at connect time."""
            from .. import bus as _bus

            q = _bus.subscribe(org_id)
            last_push = 0.0
            seen: dict[str, str] = {}
            try:
                while True:
                    raw = await q.get()
                    try:
                        ev = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    kind, d = ev.get("type"), ev.get("data") or {}
                    note = None
                    if kind == "incident":
                        key = f"{d.get('id')}:{d.get('status')}:{d.get('severity')}:{'r' if d.get('report') else ''}"
                        if seen.get(d.get("id")) == key:
                            continue
                        seen[d.get("id")] = key
                        mname = (row(conn().execute("SELECT name FROM machines WHERE id=?", (d.get("machine_id"),)).fetchone()) or {}).get("name", "a machine")
                        if d.get("status") == "resolved":
                            note = f"{mname} is back to normal — the incident '{d.get('title')}' just resolved ({d.get('resolved_reason') or 'resolved'})."
                        elif d.get("report"):
                            rep = d["report"] if isinstance(d["report"], dict) else {}
                            causes = rep.get("causes") or []
                            checks = sorted(rep.get("checks") or [], key=lambda c: c.get("order", 99))
                            note = f"Investigation finished for {mname}: likely cause {causes[0].get('name') if causes else 'unknown'}; first check: {checks[0].get('action') if checks else 'see dashboard'} (incident id {d.get('id')})."
                        else:
                            note = f"{'New' if d.get('escalation_level', 0) == 0 else 'Escalated'} {d.get('severity')} incident on {mname}: {d.get('title')} (incident id {d.get('id')}). Muse is investigating."
                    elif kind == "voice_call" and d.get("status") in ("completed", "no_answer", "failed"):
                        note = f"Phone call {d.get('status')}: {d.get('title')} to {d.get('contact_name') or d.get('to_number')}."
                    if not note:
                        continue
                    if time.time() - last_push < 8:
                        await asyncio.sleep(8 - (time.time() - last_push))
                    last_push = time.time()
                    await session.send_client_content(turns=types.Content(role="user", parts=[types.Part(text=f"(Live factory update, not spoken by the user — tell the user naturally in one or two sentences, then continue: {note})")]), turn_complete=True)
            finally:
                _bus.unsubscribe(org_id, q)

        async def from_browser() -> None:
            async for msg in incoming:
                kind = msg.get("type")
                if kind == "audio" and msg.get("data"):
                    await session.send_realtime_input(audio=types.Blob(data=base64.b64decode(msg["data"]), mime_type=LIVE_INPUT_MIME))
                elif kind == "text" and msg.get("text"):
                    await session.send_client_content(turns=types.Content(role="user", parts=[types.Part(text=msg["text"])]), turn_complete=True)
                elif kind == "end":
                    break

        async def from_gemini() -> None:
            while True:
                async for msg in session.receive():
                    sc = msg.server_content
                    if msg.tool_call and msg.tool_call.function_calls:
                        responses = []
                        for fc in msg.tool_call.function_calls:
                            args = dict(fc.args or {})
                            await send({"type": "tool", "name": fc.name, "args": args})
                            result = await asyncio.to_thread(_run_tool, impls, fc.name, args)
                            responses.append(types.FunctionResponse(id=fc.id, name=fc.name, response=result))
                        await session.send_tool_response(function_responses=responses)
                        continue
                    if not sc:
                        continue
                    if sc.interrupted:
                        await send({"type": "interrupted"})
                    if sc.input_transcription and sc.input_transcription.text:
                        await send({"type": "caption", "role": "user", "text": sc.input_transcription.text, "final": bool(getattr(sc.input_transcription, "finished", False))})
                    if sc.output_transcription and sc.output_transcription.text:
                        await send({"type": "caption", "role": "muse", "text": sc.output_transcription.text, "final": bool(getattr(sc.output_transcription, "finished", False))})
                    if sc.model_turn:
                        for p in sc.model_turn.parts:
                            if p.inline_data and p.inline_data.data:
                                await send({"type": "audio", "data": base64.b64encode(p.inline_data.data).decode(), "rate": 24000})
                    if sc.turn_complete:
                        await send({"type": "turn_complete"})
                    if sc.generation_complete:
                        pass

        tasks = [asyncio.create_task(from_browser()), asyncio.create_task(from_gemini()), asyncio.create_task(pump_commands()), asyncio.create_task(pump_factory_events())]
        try:
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                if t.exception():
                    raise t.exception()  # type: ignore[misc]
        finally:
            for t in tasks:
                t.cancel()
