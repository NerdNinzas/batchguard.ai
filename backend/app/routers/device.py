"""Public device API: POST /v1/telemetry and /v1/events, authenticated by X-Device-Key."""

from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from .. import bus
from ..auth import hash_api_key
from ..db import conn, row, tx
from ..detection import Signal
from ..ingest import ingest_readings
from ..ids import new_id, now
from ..incidents import handle_signals

router = APIRouter(prefix="/v1", tags=["device"])


class Reading(BaseModel):
    parameter: str = Field(min_length=1, max_length=48)
    value: float
    unit: str | None = None
    ts: float | None = None
    reading_id: str | None = None


class TelemetryIn(BaseModel):
    device_id: str
    readings: list[Reading] = Field(min_length=1, max_length=500)


class EventIn(BaseModel):
    device_id: str
    type: str = Field(min_length=1, max_length=48)
    message: str = ""
    severity: str = "info"
    ts: float | None = None


def _device(device_id: str, key: str | None) -> dict[str, Any]:
    if not key:
        raise HTTPException(401, "Missing X-Device-Key header")
    m = row(conn().execute("SELECT * FROM machines WHERE device_id=?", (device_id,)).fetchone())
    if not m or m["api_key_hash"] != hash_api_key(key):
        raise HTTPException(401, "Unknown device or wrong key")
    if not m["verified"]:
        raise HTTPException(403, "Machine spec not verified yet")
    return m


@router.post("/telemetry")
def telemetry(body: TelemetryIn, x_device_key: str | None = Header(default=None)) -> dict[str, Any]:
    m = _device(body.device_id, x_device_key)
    return ingest_readings(m, [r.model_dump() for r in body.readings])


@router.post("/events")
def events(body: EventIn, x_device_key: str | None = Header(default=None)) -> dict[str, Any]:
    m = _device(body.device_id, x_device_key)
    t = body.ts or now()
    eid = new_id("evt")
    with tx() as c:
        c.execute("INSERT INTO events (id, machine_id, type, message, severity, ts) VALUES (?,?,?,?,?,?)", (eid, m["id"], body.type, body.message, body.severity, t))
        c.execute("UPDATE machines SET last_seen=? WHERE id=?", (now(), m["id"]))
    bus.publish(m["org_id"], "event", {"id": eid, "machine_id": m["id"], "type": body.type, "message": body.message, "severity": body.severity, "ts": t})
    # safety events escalate straight to emergency
    if body.severity in ("critical", "emergency") or body.type.lower() in ("e-stop", "estop", "emergency_stop"):
        sev = "emergency" if body.type.lower().replace("_", "-") in ("e-stop", "estop", "emergency-stop") else "critical"
        handle_signals(m["id"], [Signal(m["id"], body.type, "event", sev, None, f"{body.type}: {body.message or 'safety event'}", {})])
    return {"ok": True, "id": eid}


@router.get("/ping")
def ping(x_device_key: str | None = Header(default=None), device_id: str = "") -> dict[str, Any]:
    m = _device(device_id, x_device_key)
    return {"ok": True, "machine": m["name"], "parameters": [r["name"] for r in conn().execute("SELECT name FROM parameters WHERE machine_id=?", (m["id"],)).fetchall()]}
