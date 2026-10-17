"""Shared ingestion path: used by /v1/telemetry and by the built-in demo producer."""

from typing import Any

from . import bus, cloud
from .db import conn, tx
from .db import j
from .detection import Signal, forecast, limit_state, run_detection
from .ids import now
from .incidents import handle_signals, resume_from_stale

_forecast_at: dict[tuple[str, str], float] = {}
FORECAST_EVERY = 5.0  # s per (machine, parameter)


def ingest_readings(m: dict[str, Any], readings: list[dict[str, Any]]) -> dict[str, Any]:
    """`readings`: [{parameter, value, unit?, ts?, reading_id?}]. Validates against the verified spec,
    stores, updates latest/state, runs detection and hands signals to the incident engine."""
    t = now()
    known = {r["name"]: dict(r) for r in conn().execute("SELECT * FROM parameters WHERE machine_id=?", (m["id"],)).fetchall()}
    accepted, rejected, duplicates = 0, [], 0
    latest_payload: dict[str, Any] = {}
    stored: list[dict[str, Any]] = []
    with tx() as c:
        for r in readings:
            p = known.get(r["parameter"])
            if not p:
                rejected.append({"parameter": r["parameter"], "reason": "not in verified spec"})
                continue
            unit = r.get("unit") or p["unit"]
            if r.get("unit") and p["unit"] and r["unit"].lower() != p["unit"].lower():
                rejected.append({"parameter": r["parameter"], "reason": f"unit {r['unit']} != spec {p['unit']}"})
                continue
            ts = r.get("ts") or t
            rid = r.get("reading_id")
            if rid and c.execute("SELECT 1 FROM readings WHERE machine_id=? AND reading_id=?", (m["id"], rid)).fetchone():
                duplicates += 1
                continue
            c.execute("INSERT INTO readings (machine_id, parameter, value, unit, ts, received_at, reading_id) VALUES (?,?,?,?,?,?,?)",
                      (m["id"], r["parameter"], r["value"], unit, ts, t, rid))
            stored.append({"parameter": r["parameter"], "value": r["value"], "unit": unit, "ts": ts, "received_at": t, "reading_id": rid})
            state = limit_state(p, r["value"])
            c.execute("INSERT INTO latest (machine_id, parameter, value, unit, ts, state) VALUES (?,?,?,?,?,?) "
                      "ON CONFLICT(machine_id, parameter) DO UPDATE SET value=excluded.value, unit=excluded.unit, ts=excluded.ts, state=excluded.state",
                      (m["id"], r["parameter"], r["value"], unit, ts, state))
            latest_payload[r["parameter"]] = {"value": r["value"], "unit": unit, "ts": ts, "state": state}
            accepted += 1
        was_offline = m["status"] in ("offline", "stale")
        c.execute("UPDATE machines SET last_seen=?, status=CASE WHEN status IN ('offline','stale') THEN 'normal' ELSE status END WHERE id=?", (t, m["id"]))
    signals: list[Signal] = []
    for r in readings:
        if r["parameter"] in latest_payload:
            signals += run_detection(m["id"], r["parameter"], r["value"], r.get("unit"), t)
    # predicted time-to-limit, refreshed every few seconds per parameter and carried on the live event
    for name in list(latest_payload):
        key = (m["id"], name)
        if t - _forecast_at.get(key, 0) >= FORECAST_EVERY:
            _forecast_at[key] = t
            fc = forecast(m["id"], known[name], t)
            latest_payload[name]["forecast"] = fc
            with tx() as c:
                c.execute("UPDATE latest SET forecast=? WHERE machine_id=? AND parameter=?", (j(fc) if fc else None, m["id"], name))
    bus.publish(m["org_id"], "telemetry", {"machine_id": m["id"], "device_id": m["device_id"], "latest": latest_payload, "ts": t})
    cloud.buffer_readings(m["id"], stored)
    cloud.publish_readings(m, [{**r, "state": latest_payload[r["parameter"]]["state"]} for r in readings if r["parameter"] in latest_payload], t)
    if was_offline:
        bus.publish(m["org_id"], "machine", {"id": m["id"], "status": "normal", "health": m["health"]})
        resume_from_stale(m["id"])
    handle_signals(m["id"], signals)
    return {"accepted": accepted, "rejected": rejected, "duplicates": duplicates, "signals": [s.as_dict() for s in signals]}
