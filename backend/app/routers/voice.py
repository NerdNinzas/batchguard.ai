"""Voice AI (Gemini Live realtime via Dograh, dialling through TeleCMI): call types, numbers, calls, history."""

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import current_org, current_user
from ..config import settings
from ..db import conn, row, rows
from ..voice import calls, dograh

router = APIRouter(prefix="/api/voice", tags=["voice"])

_numbers_cache: dict[str, Any] = {"at": 0.0, "data": None}


def _telephony(force: bool = False) -> dict[str, Any]:
    """Telephony configurations + their numbers from Dograh (cached 60 s; fail-soft)."""
    if not dograh.enabled():
        return {"configs": [], "numbers": [], "error": "DOGRAH_API_KEY not set"}
    if not force and _numbers_cache["data"] and time.time() - _numbers_cache["at"] < 60:
        return _numbers_cache["data"]
    try:
        configs = dograh.telephony_configs()
        numbers: list[dict[str, Any]] = []
        for c in configs:
            if not c.get("phone_number_count"):
                continue
            for n in dograh.phone_numbers(int(c["id"])):
                numbers.append({
                    "id": n["id"], "config_id": c["id"], "config_name": c["name"], "provider": c["provider"],
                    "number": n.get("address"), "label": n.get("label"), "country": n.get("country_code"),
                    "active": bool(n.get("is_active")), "default_caller": bool(n.get("is_default_caller_id")),
                    "telecmi": "telecmi" in (c.get("name", "") + " " + (n.get("label") or "")).lower(),
                })
        data = {"configs": [{k: c.get(k) for k in ("id", "name", "provider", "connectivity", "is_default_outbound", "is_ready_for_outbound", "phone_number_count", "outbound_blocked_reason")} for c in configs],
                "numbers": numbers, "error": None}
    except dograh.DographError as e:
        data = {"configs": [], "numbers": [], "error": str(e)}
    _numbers_cache.update(at=time.time(), data=data)
    return data


def _call_types(org: dict[str, Any]) -> list[dict[str, Any]]:
    st = calls.get_settings(org["id"])
    return [{**calls.CALL_TYPES[k], "synced": st["workflows"].get(k), "scenarios": calls.scenarios_for(k)} for k in calls.ORDER if k in calls.CALL_TYPES]


@router.get("/status")
def status(org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    st = calls.get_settings(org["id"])
    tel = _telephony()
    return {
        "enabled": dograh.enabled(), "host": dograh.host() if dograh.enabled() else None, "realtime_model": "Gemini Live (realtime audio) via Dograh",
        "settings": st, "telephony": tel,
        "call_types": [{"key": c["key"], "title": c["title"], "synced": c["synced"]} for c in _call_types(org)],
        "contacts": rows(conn().execute("SELECT id, name, role, phone, escalation_order FROM contacts WHERE org_id=? ORDER BY escalation_order", (org["id"],)).fetchall()),
    }


@router.get("/call-types")
def call_types(org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    return _call_types(org)


@router.post("/call-types/{key}/sync")
def sync_one(key: str, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    if key not in calls.CALL_TYPES:
        raise HTTPException(404, "Unknown call type")
    try:
        return calls.sync(org, key)
    except dograh.DographError as e:
        raise HTTPException(502, str(e)) from e


@router.post("/sync")
def sync_all(org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k in calls.ORDER:
        try:
            out[k] = calls.sync(org, k)
        except dograh.DographError as e:
            out[k] = {"error": str(e)}
    return out


class SettingsIn(BaseModel):
    telephony_configuration_id: int | None = None
    from_phone_number_id: int | None = None
    auto_dial: bool | None = None


@router.put("/settings")
def put_settings(body: SettingsIn, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    if body.from_phone_number_id is not None:
        tel = _telephony()
        n = next((x for x in tel["numbers"] if x["id"] == body.from_phone_number_id), None)
        if not n:
            raise HTTPException(400, "Unknown phone number id")
        patch.update(from_phone_number_id=n["id"], from_number=n["number"], telephony_configuration_id=n["config_id"])
    elif body.telephony_configuration_id is not None:
        patch["telephony_configuration_id"] = body.telephony_configuration_id
    if body.auto_dial is not None:
        patch["auto_dial"] = 1 if body.auto_dial else 0
    return calls.save_settings(org["id"], patch)


class CallIn(BaseModel):
    call_type: str
    phone: str | None = None
    contact_id: str | None = None
    incident_id: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    scenario: str | None = None
    draft: bool = False


@router.post("/calls")
def place(body: CallIn, org: dict[str, Any] = Depends(current_org), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if not dograh.enabled():
        raise HTTPException(503, "Voice AI is not configured (DOGRAH_API_KEY)")
    if body.call_type not in calls.CALL_TYPES:
        raise HTTPException(404, "Unknown call type")
    contact = row(conn().execute("SELECT * FROM contacts WHERE id=? AND org_id=?", (body.contact_id, org["id"])).fetchone()) if body.contact_id else None
    incident = row(conn().execute("SELECT * FROM incidents WHERE id=? AND org_id=?", (body.incident_id, org["id"])).fetchone()) if body.incident_id else None
    if body.incident_id and not incident:
        raise HTTPException(404, "Incident not found")
    if not contact and not body.contact_id and incident and not body.phone:
        contact = row(conn().execute("SELECT * FROM contacts WHERE org_id=? ORDER BY escalation_order LIMIT 1", (org["id"],)).fetchone())
    phone = body.phone or (contact or {}).get("phone") or ""
    try:
        return calls.place_call(org, body.call_type, phone, contact=contact, incident=incident, overrides=body.context, placed_by=user.get("email") or "user", draft=body.draft, scenario=body.scenario)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/calls")
def list_calls(limit: int = 50, org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    items = rows(conn().execute("SELECT * FROM voice_calls WHERE org_id=? ORDER BY created_at DESC LIMIT ?", (org["id"], limit)).fetchall())
    out = []
    for c in items:
        if c["status"] not in calls.TERMINAL and c.get("run_id"):
            try:
                c = calls.refresh_call(c)
            except Exception:  # noqa: BLE001
                pass
        out.append(calls.public(c))
    return out


@router.get("/calls/{cid}")
def call_detail(cid: str, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    c = row(conn().execute("SELECT * FROM voice_calls WHERE id=? AND org_id=?", (cid, org["id"])).fetchone())
    if not c:
        raise HTTPException(404, "Call not found")
    if c["status"] not in calls.TERMINAL and c.get("run_id"):
        c = calls.refresh_call(c)
    out = calls.public(c)
    out["transcript"] = dograh.fetch_text(c["transcript_url"]) if c.get("transcript_url") else ""
    out["incident"] = row(conn().execute("SELECT id, title, severity, status FROM incidents WHERE id=?", (c["incident_id"],)).fetchone()) if c.get("incident_id") else None
    return out


@router.get("/runs")
def recent_runs(limit: int = 15, org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    """Latest runs on the Dograh account (any workflow), for the operations view."""
    if not dograh.enabled():
        return []
    try:
        runs = dograh.list_runs(1, limit).get("runs", [])
    except dograh.DographError:
        return []
    keep = ("id", "workflow_id", "workflow_name", "name", "created_at", "call_duration_seconds", "caller_number", "called_number", "call_type", "mode", "disposition", "transcript_public_url", "recording_public_url", "gathered_context")
    return [{k: r.get(k) for k in keep} for r in runs]


@router.get("/config")
def voice_config() -> dict[str, Any]:
    return {"enabled": dograh.enabled(), "base_url": settings.dograh_base_url if dograh.enabled() else None, "auto_dial_default": settings.voice_auto_dial}
