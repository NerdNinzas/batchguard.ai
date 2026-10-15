"""Demo factory: a seeded organisation with six machines and a built-in telemetry producer.

Enabled with DEMO_MODE=true. Sign in with demo@batchguard.ai / demo1234. The producer feeds the
same ingestion path as real devices and runs a bearing-wear cycle on the main conveyor every
few minutes so detection, the agent and escalation have something to do.
"""

import math
import random
import threading
import time
from typing import Any

from .agent.extract import GENERIC_KNOWLEDGE, TEMPLATES
from .auth import hash_api_key, hash_password
from .config import settings
from .db import conn, j, row, rows, tx
from .ids import new_api_key, new_device_id, new_id, now
from .ingest import ingest_readings

DEMO_EMAIL = "demo@batchguard.ai"
DEMO_PASSWORD = "demo1234"

MACHINES: list[dict[str, Any]] = [
    {"name": "Feeder hopper", "type": "hopper", "location": "Line A · bay 1"},
    {"name": "Main conveyor", "type": "conveyor", "location": "Line A · bay 2"},
    {"name": "Inspection station", "type": "inspection", "location": "Line A · bay 3"},
    {"name": "Sealer / packer", "type": "sealer", "location": "Line A · bay 4"},
    {"name": "Air compressor", "type": "compressor", "location": "Utilities"},
    {"name": "Coolant pump", "type": "pump", "location": "Utilities"},
]
EDGES = [("Feeder hopper", "Main conveyor"), ("Main conveyor", "Inspection station"), ("Inspection station", "Sealer / packer"), ("Air compressor", "Sealer / packer"), ("Coolant pump", "Main conveyor")]

# nominal value and noise per parameter (by type)
PROFILES: dict[str, dict[str, tuple[float, float]]] = {
    "conveyor": {"belt_speed": (1.2, 0.02), "motor_temp": (68, 0.6), "motor_current": (8.4, 0.15), "vibration_rms": (3.0, 0.12), "load": (38, 2.0)},
    "hopper": {"feed_rate": (45, 1.5), "hopper_level": (70, 0.4), "vibration_rms": (2.2, 0.1)},
    "inspection": {"item_weight": (500, 3), "reject_rate": (1.0, 0.2)},
    "sealer": {"seal_temp": (165, 1.0), "cycle_time": (2.0, 0.05), "items_packed": (0, 0)},
    "compressor": {"outlet_pressure": (7.0, 0.1), "oil_temp": (72, 0.6), "motor_current": (32, 0.8), "vibration_rms": (3.0, 0.1)},
    "pump": {"discharge_pressure": (4.5, 0.08), "flow_rate": (30, 0.6), "bearing_temp": (48, 0.5), "vibration_rms": (2.5, 0.1)},
}

# fault cycle on the conveyor: normal → ramp → hold → recover, repeated
CYCLE = 1800
RAMP_START, RAMP_END, HOLD_END, RECOVER_END = 900, 1020, 1140, 1200


def ensure_seeded() -> dict[str, Any] | None:
    u = row(conn().execute("SELECT * FROM users WHERE email=?", (DEMO_EMAIL,)).fetchone())
    if u and u.get("org_id"):
        return row(conn().execute("SELECT * FROM orgs WHERE id=?", (u["org_id"],)).fetchone())
    t = now()
    uid, oid, lid = new_id("usr"), new_id("org"), new_id("line")
    with tx() as c:
        if not u:
            c.execute("INSERT INTO users (id, email, name, password_hash, provider, created_at) VALUES (?,?,?,?,?,?)",
                      (uid, DEMO_EMAIL, "Demo Owner", hash_password(DEMO_PASSWORD), "password", t))
        else:
            uid = u["id"]
        c.execute("INSERT INTO orgs (id, name, owner_name, owner_email, phone, industry, size, timezone, use_cases, onboarded, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)",
                  (oid, "Demo Packaging Co", "Demo Owner", DEMO_EMAIL, "+65 9000 0001", "Packaging", "11-50", "Asia/Singapore", j(["predictive_maintenance", "quality", "escalation"]), uid, t))
        c.execute("UPDATE users SET org_id=? WHERE id=?", (oid, uid))
        c.execute("INSERT INTO lines (id, org_id, name, created_at) VALUES (?,?,?,?)", (lid, oid, "Line A", t))
        for i, (name, role, phone, email) in enumerate([("Demo Owner", "Owner", "+65 9000 0001", DEMO_EMAIL), ("Maintenance lead", "Maintenance", "+65 9000 0002", "maintenance@example.com"), ("Shift supervisor", "Operations", "+65 9000 0003", "shift@example.com")]):
            c.execute("INSERT INTO contacts (id, org_id, name, role, phone, email, escalation_order, created_at) VALUES (?,?,?,?,?,?,?,?)",
                      (new_id("ctc"), oid, name, role, phone, email, i + 1, t))
        ids: dict[str, str] = {}
        for pos, m in enumerate(MACHINES):
            mid = new_id("mch")
            ids[m["name"]] = mid
            key = new_api_key()
            c.execute(
                "INSERT INTO machines (id, org_id, line_id, name, type, location, status, device_id, api_key_hash, api_key_prefix, manual_name, knowledge, source, verified, verified_at, position, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (mid, oid, lid, m["name"], m["type"], m["location"], "offline", new_device_id(m["name"]), hash_api_key(key), key[:12],
                 f"{m['type']}-datasheet.pdf", j(GENERIC_KNOWLEDGE), "pdf", 1, t, pos, t),
            )
            for p in TEMPLATES[m["type"]]:
                c.execute(
                    "INSERT INTO parameters (id, machine_id, name, unit, normal_min, normal_max, warn_low, warn_high, crit_low, crit_high, sample_rate, source_page, source_snippet, confidence, verified) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
                    (new_id("prm"), mid, p["name"], p.get("unit"), p.get("normal_min"), p.get("normal_max"), p.get("warn_low"), p.get("warn_high"), p.get("crit_low"), p.get("crit_high"), p.get("sample_rate", 1), 12 + len(p["name"]) % 7, f"{p['name']}: see datasheet table", 0.92),
                )
        nodes = [{"id": ids[m["name"]], "type": "machine", "position": {"x": 60 + i * 290, "y": 140 + (0 if i < 4 else 260)}} for i, m in enumerate(MACHINES)]
        edges = [{"id": f"e{i}", "source": ids[a], "target": ids[b]} for i, (a, b) in enumerate(EDGES)]
        c.execute("INSERT INTO workflows (org_id, nodes, edges, updated_at) VALUES (?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET nodes=excluded.nodes, edges=excluded.edges, updated_at=excluded.updated_at",
                  (oid, j(nodes), j(edges), t))
    print(f"demo factory seeded · sign in with {DEMO_EMAIL} / {DEMO_PASSWORD}")
    return row(conn().execute("SELECT * FROM orgs WHERE id=?", (oid,)).fetchone())


def _fault_level(t: float) -> float:
    x = t % CYCLE
    if x < RAMP_START:
        return 0.0
    if x < RAMP_END:
        return (x - RAMP_START) / (RAMP_END - RAMP_START)
    if x < HOLD_END:
        return 1.0
    if x < RECOVER_END:
        return 1.0 - (x - HOLD_END) / (RECOVER_END - HOLD_END)
    return 0.0


def _readings(m: dict[str, Any], t: float, packed: dict[str, int]) -> list[dict[str, Any]]:
    prof = PROFILES.get(m["type"], {})
    f = _fault_level(t) if m["type"] == "conveyor" else 0.0
    out = []
    for p, (mean, noise) in prof.items():
        v = mean + random.gauss(0, noise) + 0.3 * noise * math.sin(t / 7 + hash(m["id"]) % 10)
        if m["type"] == "conveyor":
            if p == "vibration_rms":
                v += 4.5 * f
            elif p == "motor_temp":
                v += 26 * max(0.0, f - 0.25) / 0.75
            elif p == "motor_current":
                v += 1.2 * f
        if p == "items_packed":
            packed[m["id"]] = packed.get(m["id"], 0) + (1 if random.random() < 0.5 else 0)
            v = packed[m["id"]]
        out.append({"parameter": p, "value": round(v, 3), "ts": t})
    return out


_started = False


def start_producer() -> None:
    global _started
    if _started:
        return
    _started = True

    def loop() -> None:
        packed: dict[str, int] = {}
        time.sleep(1)
        while True:
            t = now()
            try:
                org = row(conn().execute("SELECT org_id FROM users WHERE email=?", (DEMO_EMAIL,)).fetchone())
                if org and org["org_id"]:
                    for m in rows(conn().execute("SELECT * FROM machines WHERE org_id=? AND verified=1", (org["org_id"],)).fetchall()):
                        ingest_readings(m, _readings(m, t, packed))
            except Exception as e:  # noqa: BLE001
                print("demo producer error:", e)
            time.sleep(max(0.2, 1.0 - (now() - t)))

    threading.Thread(target=loop, daemon=True, name="demo-producer").start()
    print(f"demo producer running (conveyor bearing-wear cycle every {CYCLE // 60} min)")
