#!/usr/bin/env python3
"""Sample device client — what a PLC gateway or the copy-paste snippet does.

Posts realistic readings for a machine every second. Optionally injects a fault so the
detection + agent pipeline can be exercised without real hardware.

  python scripts/device_sample.py --device conv-01a --key bg_live_... [--fault bearing_wear] [--ramp 120]

Faults: bearing_wear | fan_failure | belt_slip | jam | sensor_failure | overfeed | sealer_heater
"""

import argparse
import math
import random
import time

import requests

PROFILES = {
    "conveyor": {"belt_speed": (1.2, 0.02), "motor_temp": (68, 0.6), "motor_current": (8.4, 0.15), "vibration_rms": (3.0, 0.12), "load": (38, 2.0)},
    "motor": {"temperature": (62, 0.6), "current": (8.0, 0.2), "vibration_rms": (2.8, 0.1), "rpm": (1460, 4)},
    "pump": {"discharge_pressure": (4.5, 0.08), "flow_rate": (30, 0.6), "bearing_temp": (48, 0.5), "vibration_rms": (2.5, 0.1)},
    "compressor": {"outlet_pressure": (7.0, 0.1), "oil_temp": (72, 0.6), "motor_current": (32, 0.8), "vibration_rms": (3.0, 0.1)},
    "hopper": {"feed_rate": (45, 1.5), "hopper_level": (70, 0.4), "vibration_rms": (2.2, 0.1)},
    "sealer": {"seal_temp": (165, 1.0), "cycle_time": (2.0, 0.05), "items_packed": (0, 0)},
    "inspection": {"item_weight": (500, 3), "reject_rate": (1.0, 0.2)},
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:3000")
    ap.add_argument("--device", required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--type", default="conveyor", choices=list(PROFILES))
    ap.add_argument("--fault", default=None)
    ap.add_argument("--ramp", type=int, default=120, help="seconds until the fault fully develops")
    ap.add_argument("--start", type=int, default=30, help="seconds of normal running before the fault starts")
    ap.add_argument("--interval", type=float, default=1.0)
    args = ap.parse_args()

    base = PROFILES[args.type]
    t0 = time.time()
    packed = 0
    headers = {"X-Device-Key": args.key}
    print(f"posting {args.type} telemetry for {args.device} → {args.url}/v1/telemetry  fault={args.fault or 'none'}")
    while True:
        t = time.time() - t0
        f = 0.0 if not args.fault or t < args.start else min(1.0, (t - args.start) / args.ramp)
        readings = []
        for p, (mean, noise) in base.items():
            v = mean + random.gauss(0, noise) + 0.3 * noise * math.sin(t / 7)
            if args.fault == "bearing_wear":
                if p == "vibration_rms": v += 4.5 * f
                if p in ("motor_temp", "temperature", "bearing_temp"): v += 26 * max(0.0, f - 0.25) / 0.75
                if p in ("motor_current", "current"): v += 1.2 * f
            elif args.fault == "fan_failure":
                if p in ("motor_temp", "temperature", "oil_temp"): v += 28 * f
            elif args.fault == "belt_slip":
                if p == "belt_speed": v -= 0.8 * f
                if p == "motor_current": v -= 2.5 * f
            elif args.fault == "jam":
                if p == "load": v += 80 * f
                if p == "motor_current": v += 6 * f
                if p == "belt_speed": v *= max(0.0, 1 - 1.3 * f)
            elif args.fault == "overfeed":
                if p == "feed_rate": v += 30 * f
                if p == "load": v += 60 * f
                if p == "motor_current": v += 4 * max(0.0, f - 0.2)
            elif args.fault == "sealer_heater":
                if p == "seal_temp": v -= 40 * f
                if p == "reject_rate": v += 8 * max(0.0, f - 0.3)
            elif args.fault == "sensor_failure":
                if p == list(base)[0]: v = 0.0 if f > 0 else v
            if p == "items_packed":
                packed += 1 if random.random() < 0.5 else 0
                v = packed
            readings.append({"parameter": p, "value": round(v, 3), "ts": time.time(), "reading_id": f"{args.device}-{p}-{int(time.time()*1000)}"})
        try:
            r = requests.post(f"{args.url}/v1/telemetry", headers=headers, json={"device_id": args.device, "readings": readings}, timeout=5)
            sig = r.json().get("signals", []) if r.ok else r.text[:120]
            print(f"t={t:6.0f}s fault={f:.2f} status={r.status_code} " + (f"signals={[s['layer']+':'+s['severity'] for s in sig]}" if isinstance(sig, list) and sig else ""))
            if args.fault == "jam" and f >= 0.9 and int(t) % 30 == 0:
                requests.post(f"{args.url}/v1/events", headers=headers, json={"device_id": args.device, "type": "jam_sensor", "message": "Belt jam sensor triggered", "severity": "warning"}, timeout=5)
        except Exception as e:  # noqa: BLE001
            print("post failed:", e)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
