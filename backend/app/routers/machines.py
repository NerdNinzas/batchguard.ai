"""Machines: manual + PDF onboarding, verification, device keys, live data and history."""

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import bus
from ..agent.extract import TEMPLATES, extract
from ..auth import current_org, hash_api_key
from ..config import settings
from ..db import conn, j, row, rows, tx, uj
from ..ids import new_api_key, new_device_id, new_id, now

router = APIRouter(prefix="/api/machines", tags=["machines"])

MACHINE_TYPES = ["conveyor", "motor", "pump", "compressor", "hopper", "sealer", "inspection", "other"]


class ParameterIn(BaseModel):
    name: str = Field(min_length=1, max_length=48)
    unit: str | None = None
    normal_min: float | None = None
    normal_max: float | None = None
    warn_low: float | None = None
    warn_high: float | None = None
    crit_low: float | None = None
    crit_high: float | None = None
    sample_rate: float | None = 1
    source_page: int | None = None
    source_snippet: str | None = None
    confidence: float | None = None
    verified: bool = False


class KnowledgeIn(BaseModel):
    title: str
    page: int | None = None
    kind: str = "other"
    text: str


class MachineIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: str = "conveyor"
    location: str = ""
    line_id: str | None = None
    parameters: list[ParameterIn] = Field(default_factory=list)
    knowledge: list[KnowledgeIn] = Field(default_factory=list)
    source: str = "manual"  # manual | pdf | template
    manual_name: str | None = None
    manual_path: str | None = None
    verified: bool = False  # the "I verified these values" tick box


class VerifyIn(BaseModel):
    parameters: list[ParameterIn]
    confirmed: bool = True


def _machine_out(m: dict[str, Any]) -> dict[str, Any]:
    params = rows(conn().execute("SELECT * FROM parameters WHERE machine_id=? ORDER BY name", (m["id"],)).fetchall())
    latest = {r["parameter"]: {"value": r["value"], "unit": r["unit"], "ts": r["ts"], "state": r["state"]} for r in conn().execute("SELECT * FROM latest WHERE machine_id=?", (m["id"],)).fetchall()}
    out = {k: v for k, v in m.items() if k not in ("api_key_hash", "manual_text")}
    out["knowledge"] = uj(m.get("knowledge"), [])
    out["parameters"] = params
    out["latest"] = latest
    return out


def _get(org_id: str, mid: str) -> dict[str, Any]:
    m = row(conn().execute("SELECT * FROM machines WHERE id=? AND org_id=?", (mid, org_id)).fetchone())
    if not m:
        raise HTTPException(404, "Machine not found")
    return m


def _issue_key(mid: str) -> str:
    key = new_api_key()
    with tx() as c:
        c.execute("UPDATE machines SET api_key_hash=?, api_key_prefix=? WHERE id=?", (hash_api_key(key), key[:12], mid))
    return key


def _code_samples(m: dict[str, Any], key: str | None) -> dict[str, str]:
    base = settings.app_url.rstrip("/")
    k = key or f"{m.get('api_key_prefix') or 'bg_live_'}…"
    params = [r["name"] for r in conn().execute("SELECT name FROM parameters WHERE machine_id=? ORDER BY name", (m["id"],)).fetchall()] or ["motor_temp"]
    sample = ", ".join(f'{{"parameter": "{p}", "value": 0, "unit": ""}}' for p in params[:3])
    return {
        "curl": f"""curl -X POST {base}/v1/telemetry \\
  -H "X-Device-Key: {k}" -H "Content-Type: application/json" \\
  -d '{{"device_id": "{m['device_id']}", "readings": [{sample}]}}'""",
        "python": f"""import requests, time
URL = "{base}/v1/telemetry"
HEADERS = {{"X-Device-Key": "{k}"}}
while True:
    requests.post(URL, headers=HEADERS, json={{
        "device_id": "{m['device_id']}",
        "readings": [{{"parameter": "{params[0]}", "value": read_sensor(), "unit": "", "ts": time.time()}}],
    }}, timeout=5)
    time.sleep(1)""",
        "node": f"""setInterval(async () => {{
  await fetch("{base}/v1/telemetry", {{
    method: "POST",
    headers: {{ "X-Device-Key": "{k}", "Content-Type": "application/json" }},
    body: JSON.stringify({{ device_id: "{m['device_id']}", readings: [{{ parameter: "{params[0]}", value: readSensor(), unit: "" }}] }}),
  }});
}}, 1000);""",
    }


@router.get("/types")
def types() -> dict[str, Any]:
    return {"types": MACHINE_TYPES, "templates": TEMPLATES}


@router.get("")
def list_machines(org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    return [_machine_out(m) for m in rows(conn().execute("SELECT * FROM machines WHERE org_id=? ORDER BY position, created_at", (org["id"],)).fetchall())]


@router.post("")
def create_machine(body: MachineIn, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    if body.type not in MACHINE_TYPES:
        raise HTTPException(422, f"type must be one of {MACHINE_TYPES}")
    mid = new_id("mch")
    line = body.line_id or (row(conn().execute("SELECT id FROM lines WHERE org_id=? ORDER BY created_at LIMIT 1", (org["id"],)).fetchone()) or {}).get("id")
    pos = (conn().execute("SELECT COALESCE(MAX(position),-1)+1 p FROM machines WHERE org_id=?", (org["id"],)).fetchone() or {"p": 0})["p"]
    verified = body.verified and all(p.verified for p in body.parameters) and len(body.parameters) > 0
    with tx() as c:
        c.execute(
            "INSERT INTO machines (id, org_id, line_id, name, type, location, status, device_id, manual_name, manual_path, knowledge, source, verified, verified_at, position, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (mid, org["id"], line, body.name, body.type, body.location, "offline", new_device_id(body.name), body.manual_name, body.manual_path,
             j([k.model_dump() for k in body.knowledge]), body.source, 1 if verified else 0, now() if verified else None, pos, now()),
        )
        for p in body.parameters:
            c.execute(
                "INSERT INTO parameters (id, machine_id, name, unit, normal_min, normal_max, warn_low, warn_high, crit_low, crit_high, sample_rate, source_page, source_snippet, confidence, verified) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (new_id("prm"), mid, p.name, p.unit, p.normal_min, p.normal_max, p.warn_low, p.warn_high, p.crit_low, p.crit_high, p.sample_rate, p.source_page, p.source_snippet, p.confidence, 1 if p.verified else 0),
            )
    key = _issue_key(mid) if verified else None
    m = _get(org["id"], mid)
    bus.publish(org["id"], "machine", {"id": mid, "status": "offline", "health": 100, "created": True})
    return {**_machine_out(m), "api_key": key, "endpoint": f"{settings.app_url.rstrip('/')}/v1/telemetry", "code": _code_samples(m, key)}


@router.post("/extract")
async def extract_manual(file: UploadFile = File(...), hint_type: str | None = Form(default=None), org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "File too large (25 MB max)")
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in (file.filename or "manual.pdf"))
    path = settings.upload_path / f"{org['id']}_{int(now())}_{safe}"
    path.write_bytes(data)
    spec, source = extract(data, file.filename or safe, file.content_type or "application/pdf", hint_type)
    return {"spec": spec, "source": source, "manual_name": file.filename, "manual_path": str(path), "gemini_enabled": settings.gemini_enabled}


@router.get("/{mid}")
def get_machine(mid: str, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    m = _get(org["id"], mid)
    return {**_machine_out(m), "endpoint": f"{settings.app_url.rstrip('/')}/v1/telemetry", "code": _code_samples(m, None)}


@router.put("/{mid}")
def update_machine(mid: str, body: MachineIn, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    _get(org["id"], mid)
    with tx() as c:
        c.execute("UPDATE machines SET name=?, type=?, location=?, knowledge=? WHERE id=?", (body.name, body.type, body.location, j([k.model_dump() for k in body.knowledge]), mid))
        c.execute("DELETE FROM parameters WHERE machine_id=?", (mid,))
        for p in body.parameters:
            c.execute(
                "INSERT INTO parameters (id, machine_id, name, unit, normal_min, normal_max, warn_low, warn_high, crit_low, crit_high, sample_rate, source_page, source_snippet, confidence, verified) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (new_id("prm"), mid, p.name, p.unit, p.normal_min, p.normal_max, p.warn_low, p.warn_high, p.crit_low, p.crit_high, p.sample_rate, p.source_page, p.source_snippet, p.confidence, 1 if p.verified else 0),
            )
    return _machine_out(_get(org["id"], mid))


@router.post("/{mid}/verify")
def verify(mid: str, body: VerifyIn, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    """Confirm the spec; issues the device key (shown once)."""
    m = _get(org["id"], mid)
    if not body.confirmed or not body.parameters or not all(p.verified for p in body.parameters):
        raise HTTPException(422, "Every parameter must be ticked as verified before going live")
    with tx() as c:
        c.execute("DELETE FROM parameters WHERE machine_id=?", (mid,))
        for p in body.parameters:
            c.execute(
                "INSERT INTO parameters (id, machine_id, name, unit, normal_min, normal_max, warn_low, warn_high, crit_low, crit_high, sample_rate, source_page, source_snippet, confidence, verified) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
                (new_id("prm"), mid, p.name, p.unit, p.normal_min, p.normal_max, p.warn_low, p.warn_high, p.crit_low, p.crit_high, p.sample_rate, p.source_page, p.source_snippet, p.confidence),
            )
        c.execute("UPDATE machines SET verified=1, verified_at=? WHERE id=?", (now(), mid))
    key = _issue_key(mid)
    m = _get(org["id"], mid)
    bus.publish(org["id"], "machine", {"id": mid, "status": m["status"], "health": m["health"], "verified": True})
    return {**_machine_out(m), "api_key": key, "endpoint": f"{settings.app_url.rstrip('/')}/v1/telemetry", "code": _code_samples(m, key)}


@router.post("/{mid}/rotate-key")
def rotate_key(mid: str, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    m = _get(org["id"], mid)
    if not m["verified"]:
        raise HTTPException(409, "Verify the machine first")
    key = _issue_key(mid)
    return {"api_key": key, "api_key_prefix": key[:12], "code": _code_samples(_get(org["id"], mid), key)}


@router.delete("/{mid}")
def delete_machine(mid: str, org: dict[str, Any] = Depends(current_org)) -> dict[str, bool]:
    _get(org["id"], mid)
    with tx() as c:
        for t in ("parameters", "readings", "latest", "events"):
            c.execute(f"DELETE FROM {t} WHERE machine_id=?", (mid,))
        c.execute("DELETE FROM machines WHERE id=?", (mid,))
    bus.publish(org["id"], "machine", {"id": mid, "deleted": True})
    return {"ok": True}


@router.get("/{mid}/readings")
def readings(mid: str, parameter: str | None = None, seconds: int = 600, points: int = 300, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    _get(org["id"], mid)
    t = now()
    out: dict[str, list[dict[str, float]]] = {}
    names = [parameter] if parameter else [r["name"] for r in conn().execute("SELECT name FROM parameters WHERE machine_id=?", (mid,)).fetchall()]
    for p in names:
        rs = conn().execute("SELECT ts, value FROM readings WHERE machine_id=? AND parameter=? AND ts>=? ORDER BY ts", (mid, p, t - seconds)).fetchall()
        step = max(1, len(rs) // points)
        out[p] = [{"t": r["ts"], "v": r["value"]} for r in rs[::step]]
    return {"series": out, "now": t}


@router.get("/{mid}/events")
def events(mid: str, limit: int = 100, org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    _get(org["id"], mid)
    return rows(conn().execute("SELECT * FROM events WHERE machine_id=? ORDER BY ts DESC LIMIT ?", (mid, limit)).fetchall())
