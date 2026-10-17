"""Write tools for the Muse copilot: edit contacts, organisation, machines, parameter limits, work orders,
incidents and voice settings by voice or chat. Every change is persisted, broadcast on the SSE bus (so the
open page updates live), mirrored to Firestore, and reported back to the UI as an `edited` command that
spotlights the thing that changed."""

from typing import Any, Callable

from google.genai import types

from .. import bus, cloud
from ..db import conn, row, rows, tx
from ..ids import new_id, now


def _find_contact(org_id: str, ref: str) -> dict[str, Any] | None:
    ref = (ref or "").strip()
    if not ref:
        return None
    c = row(conn().execute("SELECT * FROM contacts WHERE org_id=? AND id=?", (org_id, ref)).fetchone())
    if c:
        return c
    q = f"%{ref.lower()}%"
    cs = rows(conn().execute("SELECT * FROM contacts WHERE org_id=? AND (LOWER(name) LIKE ? OR LOWER(role) LIKE ? OR phone LIKE ?) ORDER BY escalation_order", (org_id, q, q, q)).fetchall())
    exact = [c for c in cs if c["name"].lower() == ref.lower()]
    return (exact or cs or [None])[0]


def _find_machine(org_id: str, ref: str) -> dict[str, Any] | None:
    ref = (ref or "").strip()
    m = row(conn().execute("SELECT * FROM machines WHERE org_id=? AND id=?", (org_id, ref)).fetchone())
    if m:
        return m
    q = f"%{ref.lower()}%"
    ms = rows(conn().execute("SELECT * FROM machines WHERE org_id=? AND (LOWER(name) LIKE ? OR LOWER(device_id) LIKE ? OR LOWER(type) LIKE ?) ORDER BY position", (org_id, q, q, q)).fetchall())
    exact = [m for m in ms if m["name"].lower() == ref.lower()]
    return (exact or ms or [None])[0]


def _clean(v: Any) -> Any:
    return None if v in ("", None, "null", "none") else v


def make_action_tools(org_id: str, user: dict[str, Any], emit: Callable[[dict[str, Any]], None]) -> tuple[list[types.FunctionDeclaration], dict[str, Callable[..., Any]]]:
    by = user.get("email") or "muse"

    def edited(what: str, label: str, path: str, highlight: str | None, data: dict[str, Any]) -> dict[str, Any]:
        emit({"type": "edited", "what": what, "label": label, "path": path, "highlight": highlight})
        return {"ok": True, "what": what, "label": label, **data}

    # ---------------- contacts ----------------
    def add_contact(name: str, role: str = "", phone: str = "", email: str = "", escalation_order: int | None = None, quiet_start: str | None = None, quiet_end: str | None = None) -> dict[str, Any]:
        if not (name or "").strip():
            return {"error": "name required"}
        n = conn().execute("SELECT COUNT(*) n FROM contacts WHERE org_id=?", (org_id,)).fetchone()["n"]
        order = int(escalation_order or n + 1)
        cid = new_id("ctc")
        with tx() as c:
            c.execute("INSERT INTO contacts (id, org_id, name, role, phone, email, escalation_order, quiet_start, quiet_end, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                      (cid, org_id, name.strip(), role or "", phone or "", email or "", order, _clean(quiet_start), _clean(quiet_end), now()))
        ct = row(conn().execute("SELECT * FROM contacts WHERE id=?", (cid,)).fetchone())
        cloud.mirror("contacts", cid, ct)
        bus.publish(org_id, "contact", {**ct, "action": "added"})
        return edited("contact", f"Added {ct['name']} as contact #{order}", "/app/contacts", cid, {"contact": ct})

    def update_contact(contact: str, name: str | None = None, role: str | None = None, phone: str | None = None, email: str | None = None,
                       escalation_order: int | None = None, quiet_start: str | None = None, quiet_end: str | None = None) -> dict[str, Any]:
        ct = _find_contact(org_id, contact)
        if not ct:
            return {"error": f"no contact matching '{contact}'", "contacts": [c["name"] for c in rows(conn().execute("SELECT name FROM contacts WHERE org_id=?", (org_id,)).fetchall())]}
        patch = {k: v for k, v in {"name": name, "role": role, "phone": phone, "email": email, "escalation_order": escalation_order, "quiet_start": quiet_start, "quiet_end": quiet_end}.items() if v is not None}
        if not patch:
            return {"error": "nothing to change"}
        with tx() as c:
            c.execute(f"UPDATE contacts SET {', '.join(f'{k}=:{k}' for k in patch)} WHERE id=:id", {**patch, "id": ct["id"]})
        new = row(conn().execute("SELECT * FROM contacts WHERE id=?", (ct["id"],)).fetchone())
        cloud.mirror("contacts", ct["id"], new)
        bus.publish(org_id, "contact", {**new, "action": "updated"})
        changes = ", ".join(f"{k} → {v}" for k, v in patch.items())
        return edited("contact", f"{new['name']}: {changes}", "/app/contacts", ct["id"], {"contact": new})

    def delete_contact(contact: str, confirmed: bool = False) -> dict[str, Any]:
        ct = _find_contact(org_id, contact)
        if not ct:
            return {"error": f"no contact matching '{contact}'"}
        if not confirmed:
            return {"needs_confirmation": True, "contact": {"id": ct["id"], "name": ct["name"], "role": ct["role"]}, "message": "Ask the user to confirm, then call again with confirmed=true"}
        with tx() as c:
            c.execute("DELETE FROM contacts WHERE id=?", (ct["id"],))
        cloud.delete("contacts", ct["id"])
        bus.publish(org_id, "contact", {"id": ct["id"], "action": "deleted"})
        return edited("contact", f"Removed {ct['name']} from the escalation ladder", "/app/contacts", "ladder", {"deleted": ct["id"]})

    # ---------------- organisation ----------------
    def update_org(name: str | None = None, owner_name: str | None = None, owner_email: str | None = None, phone: str | None = None, industry: str | None = None, timezone: str | None = None) -> dict[str, Any]:
        patch = {k: v for k, v in {"name": name, "owner_name": owner_name, "owner_email": owner_email, "phone": phone, "industry": industry, "timezone": timezone}.items() if v is not None}
        if not patch:
            return {"error": "nothing to change"}
        with tx() as c:
            c.execute(f"UPDATE orgs SET {', '.join(f'{k}=:{k}' for k in patch)} WHERE id=:id", {**patch, "id": org_id})
        org = row(conn().execute("SELECT * FROM orgs WHERE id=?", (org_id,)).fetchone())
        cloud.mirror("orgs", org_id, org)
        bus.publish(org_id, "org", {**org, "action": "updated"})
        return edited("org", "Organisation: " + ", ".join(f"{k} → {v}" for k, v in patch.items()), "/app/settings", "org", {"org": {k: org[k] for k in ("name", "owner_name", "owner_email", "phone", "industry", "timezone")}})

    # ---------------- machines + limits ----------------
    def update_machine(machine: str, name: str | None = None, location: str | None = None) -> dict[str, Any]:
        m = _find_machine(org_id, machine)
        if not m:
            return {"error": f"no machine matching '{machine}'"}
        patch = {k: v for k, v in {"name": name, "location": location}.items() if v is not None}
        if not patch:
            return {"error": "nothing to change"}
        with tx() as c:
            c.execute(f"UPDATE machines SET {', '.join(f'{k}=:{k}' for k in patch)} WHERE id=:id", {**patch, "id": m["id"]})
        new = row(conn().execute("SELECT * FROM machines WHERE id=?", (m["id"],)).fetchone())
        cloud.mirror("machines", m["id"], {k: new[k] for k in ("name", "location", "org_id")})
        bus.publish(org_id, "machine", {"id": m["id"], "name": new["name"], "location": new["location"], "status": new["status"], "health": new["health"], "action": "updated"})
        return edited("machine", f"{m['name']}: " + ", ".join(f"{k} → {v}" for k, v in patch.items()), f"/app/machines/{m['id']}", None, {"machine": {"id": m["id"], "name": new["name"], "location": new["location"]}})

    def update_parameter_limits(machine: str, parameter: str, normal_min: float | None = None, normal_max: float | None = None, warn_low: float | None = None,
                                warn_high: float | None = None, crit_low: float | None = None, crit_high: float | None = None) -> dict[str, Any]:
        m = _find_machine(org_id, machine)
        if not m:
            return {"error": f"no machine matching '{machine}'"}
        ps = rows(conn().execute("SELECT * FROM parameters WHERE machine_id=?", (m["id"],)).fetchall())
        p = next((x for x in ps if x["name"].lower() == parameter.lower()), None) or next((x for x in ps if parameter.lower() in x["name"].lower()), None)
        if not p:
            return {"error": f"no parameter matching '{parameter}' on {m['name']}", "parameters": [x["name"] for x in ps]}
        patch = {k: float(v) for k, v in {"normal_min": normal_min, "normal_max": normal_max, "warn_low": warn_low, "warn_high": warn_high, "crit_low": crit_low, "crit_high": crit_high}.items() if v is not None}
        if not patch:
            return {"error": "nothing to change"}
        merged = {**{k: p[k] for k in ("warn_low", "warn_high", "crit_low", "crit_high")}, **patch}
        if merged.get("warn_high") is not None and merged.get("crit_high") is not None and merged["warn_high"] > merged["crit_high"]:
            return {"error": "warn_high must be ≤ crit_high"}
        if merged.get("warn_low") is not None and merged.get("crit_low") is not None and merged["warn_low"] < merged["crit_low"]:
            return {"error": "warn_low must be ≥ crit_low"}
        with tx() as c:
            c.execute(f"UPDATE parameters SET {', '.join(f'{k}=:{k}' for k in patch)} WHERE id=:id", {**patch, "id": p["id"]})
        bus.publish(org_id, "parameter", {"machine_id": m["id"], "parameter": p["name"], **patch, "action": "updated"})
        return edited("parameter", f"{m['name']} · {p['name']}: " + ", ".join(f"{k} → {v:g}" for k, v in patch.items()), f"/app/machines/{m['id']}", f"param:{p['name']}", {"parameter": p["name"], "limits": {k: (patch.get(k, p[k])) for k in ("normal_min", "normal_max", "warn_low", "warn_high", "crit_low", "crit_high")}})

    # ---------------- work orders ----------------
    def create_work_order(machine: str, title: str, priority: str = "medium", assignee: str | None = None, due_hours: float | None = None, incident_id: str | None = None) -> dict[str, Any]:
        from ..routers.work_orders import DUE_HOURS, PRIORITIES, _insert

        m = _find_machine(org_id, machine)
        if not m:
            return {"error": f"no machine matching '{machine}'"}
        pr = priority if priority in PRIORITIES else "medium"
        w = _insert(org_id, {"machine_id": m["id"], "incident_id": incident_id or None, "title": title, "priority": pr, "assignee": assignee,
                             "due_at": now() + float(due_hours or DUE_HOURS[pr]) * 3600, "source": "muse"}, by)
        return edited("work_order", f"Work order on {m['name']}: {title} ({pr}{', ' + assignee if assignee else ''})", f"/app/machines/{m['id']}", "work-orders", {"work_order": {"id": w["id"], "title": w["title"], "status": w["status"]}})

    def update_work_order(work_order: str, status: str | None = None, assignee: str | None = None, priority: str | None = None, title: str | None = None) -> dict[str, Any]:
        from ..routers.work_orders import PRIORITIES, STATUSES, _publish

        ref = (work_order or "").strip()
        w = row(conn().execute("SELECT * FROM work_orders WHERE org_id=? AND id=?", (org_id, ref)).fetchone())
        if not w:
            ws = rows(conn().execute("SELECT * FROM work_orders WHERE org_id=? AND LOWER(title) LIKE ? ORDER BY created_at DESC", (org_id, f"%{ref.lower()}%")).fetchall())
            w = ws[0] if ws else None
        if not w:
            return {"error": f"no work order matching '{work_order}'", "open": [x["title"] for x in rows(conn().execute("SELECT title FROM work_orders WHERE org_id=? AND status!='done' ORDER BY created_at DESC LIMIT 8", (org_id,)).fetchall())]}
        st = (status or "").replace(" ", "_").replace("-", "_").lower() or None
        if st in ("inprogress", "started", "doing"):
            st = "in_progress"
        if st in ("closed", "complete", "completed", "finished"):
            st = "done"
        if st and st not in STATUSES:
            return {"error": f"status must be one of {STATUSES}"}
        if priority and priority not in PRIORITIES:
            return {"error": f"priority must be one of {PRIORITIES}"}
        patch = {k: v for k, v in {"status": st, "assignee": assignee, "priority": priority, "title": title}.items() if v is not None}
        if not patch:
            return {"error": "nothing to change"}
        patch["updated_at"] = now()
        if st == "done":
            patch["done_at"] = now()
        with tx() as c:
            c.execute(f"UPDATE work_orders SET {', '.join(f'{k}=:{k}' for k in patch)} WHERE id=:id", {**patch, "id": w["id"]})
        new = row(conn().execute("SELECT * FROM work_orders WHERE id=?", (w["id"],)).fetchone())
        _publish(new)
        return edited("work_order", f"Work order '{new['title']}': " + ", ".join(f"{k} → {v}" for k, v in patch.items() if k not in ("updated_at", "done_at")), f"/app/machines/{new['machine_id']}", "work-orders", {"work_order": {"id": new["id"], "status": new["status"], "assignee": new["assignee"]}})

    # ---------------- incidents ----------------
    def acknowledge_incident(incident_id: str) -> dict[str, Any]:
        from .. import incidents as inc_mod

        inc = row(conn().execute("SELECT * FROM incidents WHERE id=? AND org_id=?", (incident_id, org_id)).fetchone())
        if not inc:
            return {"error": "incident not found"}
        if inc["status"] != "open":
            return {"error": f"incident is already {inc['status']}"}
        inc_mod.acknowledge(incident_id, f"voice: {user.get('name') or by}")
        return edited("incident", f"Acknowledged: {inc['title']}", f"/app/incidents/{incident_id}", None, {"incident": incident_id, "status": "acknowledged"})

    def resolve_incident(incident_id: str, verdict: str, actual_cause: str = "", fix: str = "") -> dict[str, Any]:
        from .. import incidents as inc_mod

        inc = row(conn().execute("SELECT * FROM incidents WHERE id=? AND org_id=?", (incident_id, org_id)).fetchone())
        if not inc:
            return {"error": "incident not found"}
        if inc["status"] == "resolved":
            return {"error": "already resolved"}
        v = (verdict or "").lower()
        if v not in ("correct", "partly", "wrong"):
            return {"error": "verdict must be correct, partly or wrong"}
        inc_mod.resolve(incident_id, {"verdict": v, "actual_cause": actual_cause, "fix": fix, "source": f"voice: {user.get('name') or by}"})
        return edited("incident", f"Resolved: {inc['title']} ({v})", f"/app/incidents/{incident_id}", None, {"incident": incident_id, "status": "resolved"})

    # ---------------- voice settings ----------------
    def set_voice_settings(auto_dial: bool | None = None, from_phone_number_id: int | None = None) -> dict[str, Any]:
        from ..voice import calls

        patch: dict[str, Any] = {}
        if auto_dial is not None:
            patch["auto_dial"] = 1 if auto_dial else 0
        if from_phone_number_id is not None:
            patch["from_phone_number_id"] = int(from_phone_number_id)
        if not patch:
            return {"error": "nothing to change"}
        st = calls.save_settings(org_id, patch)
        bus.publish(org_id, "voice_settings", {"auto_dial": st["auto_dial"], "from_number": st.get("from_number")})
        return edited("voice", f"Voice settings: auto-dial {'on' if st['auto_dial'] else 'off'}" + (f", caller id #{st['from_phone_number_id']}" if from_phone_number_id is not None else ""), "/app/voice", "auto-dial" if auto_dial is not None else "numbers", {"settings": {"auto_dial": st["auto_dial"]}})

    # ---------------- phone calls (Dograh → Gemini Live → TeleCMI) ----------------
    def place_call(call_type: str = "critical_alert", contact: str | None = None, phone: str | None = None, incident_id: str | None = None) -> dict[str, Any]:
        from ..voice import calls, dograh

        if not dograh.enabled():
            return {"error": "voice calling is not configured (DOGRAH_API_KEY)"}
        key = (call_type or "critical_alert").strip().lower().replace(" ", "_").replace("-", "_")
        aliases = {"critical": "critical_alert", "alert": "critical_alert", "emergency": "emergency_escalation", "escalation": "emergency_escalation", "warning": "warning_notice", "advisory": "warning_notice",
                   "followup": "resolution_followup", "follow_up": "resolution_followup", "resolution": "resolution_followup", "test": "test_call"}
        key = aliases.get(key, key)
        if key not in calls.CALL_TYPES:
            return {"error": f"unknown call type; use one of {list(calls.CALL_TYPES)}"}
        ct = _find_contact(org_id, contact) if contact else None
        inc = row(conn().execute("SELECT * FROM incidents WHERE id=? AND org_id=?", (incident_id, org_id)).fetchone()) if incident_id else None
        if incident_id and not inc:
            return {"error": "incident not found"}
        if not ct and not phone and inc:
            ct = row(conn().execute("SELECT * FROM contacts WHERE org_id=? ORDER BY escalation_order LIMIT 1", (org_id,)).fetchone())
        to = (phone or (ct or {}).get("phone") or "").strip()
        if not to:
            return {"error": "need a contact with a phone number or an explicit phone number"}
        org = row(conn().execute("SELECT * FROM orgs WHERE id=?", (org_id,)).fetchone()) or {"id": org_id, "name": "the factory"}
        try:
            c = calls.place_call(org, key, to, contact=ct, incident=inc, placed_by=f"muse:{by}")
        except ValueError as e:
            return {"error": str(e)}
        if c.get("status") == "failed":
            return {"error": f"call failed: {c.get('error')}"}
        label = f"Calling {ct['name'] if ct else to} · {c.get('title')}" + (f" · from {c.get('from_number')}" if c.get("from_number") else "")
        return edited("call", label, "/app/voice", "history", {"call": {"id": c["id"], "status": c["status"], "to": c["to_number"], "run": c.get("run_name")}})

    impls = {
        "place_call": place_call,
        "add_contact": add_contact, "update_contact": update_contact, "delete_contact": delete_contact, "update_org": update_org,
        "update_machine": update_machine, "update_parameter_limits": update_parameter_limits, "create_work_order": create_work_order,
        "update_work_order": update_work_order, "acknowledge_incident": acknowledge_incident, "resolve_incident": resolve_incident, "set_voice_settings": set_voice_settings,
    }
    S = types.Schema
    decls = [
        types.FunctionDeclaration(name="place_call", description="Place a real phone call through Muse's voice line (Gemini Live over TeleCMI). call_type: critical_alert | emergency_escalation | warning_notice | resolution_followup | test_call. Give a contact (name/role) or an explicit phone number; pass incident_id so the brief comes from that incident's report. Confirm the number with the user before calling.",
                                  parameters=S(type="OBJECT", properties={"call_type": S(type="STRING"), "contact": S(type="STRING"), "phone": S(type="STRING"), "incident_id": S(type="STRING")})),
        types.FunctionDeclaration(name="add_contact", description="Add an escalation contact (name required; role, phone in international format, email, escalation_order 1=first to be called, quiet hours HH:MM).",
                                  parameters=S(type="OBJECT", properties={"name": S(type="STRING"), "role": S(type="STRING"), "phone": S(type="STRING"), "email": S(type="STRING"), "escalation_order": S(type="INTEGER"), "quiet_start": S(type="STRING"), "quiet_end": S(type="STRING")}, required=["name"])),
        types.FunctionDeclaration(name="update_contact", description="Edit an escalation contact found by name, role or id. Only pass the fields to change (name, role, phone, email, escalation_order, quiet_start, quiet_end).",
                                  parameters=S(type="OBJECT", properties={"contact": S(type="STRING"), "name": S(type="STRING"), "role": S(type="STRING"), "phone": S(type="STRING"), "email": S(type="STRING"), "escalation_order": S(type="INTEGER"), "quiet_start": S(type="STRING"), "quiet_end": S(type="STRING")}, required=["contact"])),
        types.FunctionDeclaration(name="delete_contact", description="Remove a contact from the escalation ladder. Destructive: first call without confirmed to get the match, ask the user to confirm by voice, then call with confirmed=true.",
                                  parameters=S(type="OBJECT", properties={"contact": S(type="STRING"), "confirmed": S(type="BOOLEAN")}, required=["contact"])),
        types.FunctionDeclaration(name="update_org", description="Edit organisation details: name, owner_name, owner_email, phone, industry, timezone. Only pass what changes.",
                                  parameters=S(type="OBJECT", properties={"name": S(type="STRING"), "owner_name": S(type="STRING"), "owner_email": S(type="STRING"), "phone": S(type="STRING"), "industry": S(type="STRING"), "timezone": S(type="STRING")})),
        types.FunctionDeclaration(name="update_machine", description="Rename a machine or change its location (machine by name, device id or id).",
                                  parameters=S(type="OBJECT", properties={"machine": S(type="STRING"), "name": S(type="STRING"), "location": S(type="STRING")}, required=["machine"])),
        types.FunctionDeclaration(name="update_parameter_limits", description="Change a parameter's limits on a machine (normal_min/normal_max, warn_low/warn_high, crit_low/crit_high). Repeat the new numbers back to the user; limits drive detection.",
                                  parameters=S(type="OBJECT", properties={"machine": S(type="STRING"), "parameter": S(type="STRING"), "normal_min": S(type="NUMBER"), "normal_max": S(type="NUMBER"), "warn_low": S(type="NUMBER"), "warn_high": S(type="NUMBER"), "crit_low": S(type="NUMBER"), "crit_high": S(type="NUMBER")}, required=["machine", "parameter"])),
        types.FunctionDeclaration(name="create_work_order", description="Create a maintenance work order on a machine (title required; priority low|medium|high|urgent; assignee = a contact's name; due_hours; incident_id to link it).",
                                  parameters=S(type="OBJECT", properties={"machine": S(type="STRING"), "title": S(type="STRING"), "priority": S(type="STRING"), "assignee": S(type="STRING"), "due_hours": S(type="NUMBER"), "incident_id": S(type="STRING")}, required=["machine", "title"])),
        types.FunctionDeclaration(name="update_work_order", description="Move or edit a work order found by title or id: status open|in_progress|done, assignee, priority, title.",
                                  parameters=S(type="OBJECT", properties={"work_order": S(type="STRING"), "status": S(type="STRING"), "assignee": S(type="STRING"), "priority": S(type="STRING"), "title": S(type="STRING")}, required=["work_order"])),
        types.FunctionDeclaration(name="acknowledge_incident", description="Acknowledge an open incident on the user's behalf (stops the escalation ladder).",
                                  parameters=S(type="OBJECT", properties={"incident_id": S(type="STRING")}, required=["incident_id"])),
        types.FunctionDeclaration(name="resolve_incident", description="Resolve an incident with the technician's verdict on Muse's diagnosis (correct|partly|wrong), the actual cause and the fix.",
                                  parameters=S(type="OBJECT", properties={"incident_id": S(type="STRING"), "verdict": S(type="STRING"), "actual_cause": S(type="STRING"), "fix": S(type="STRING")}, required=["incident_id", "verdict"])),
        types.FunctionDeclaration(name="set_voice_settings", description="Turn automatic escalation calls on/off (auto_dial) or pick the TeleCMI caller number by id.",
                                  parameters=S(type="OBJECT", properties={"auto_dial": S(type="BOOLEAN"), "from_phone_number_id": S(type="INTEGER")})),
    ]
    return decls, impls
