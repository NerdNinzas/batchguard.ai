#!/usr/bin/env python3
"""Quick fault trigger for testing the detection → agent pipeline on one machine.

  python scripts/trigger_fault.py --device <id> --key <key> [--url http://localhost:8000] [--baseline 35]

Posts `baseline` seconds of normal conveyor readings, then a bearing-wear ramp that crosses the
warning and critical limits (vibration first, temperature after — the signature the agent should
recognise). Prints the detection signals returned by the API.
"""

import argparse
import random
import time

import requests

NORMAL = {"motor_temp": (70, 0.5), "vibration_rms": (3.1, 0.12), "motor_current": (8.4, 0.15), "load": (38, 1.5), "belt_speed": (1.2, 0.02)}
RAMP = [  # (motor_temp, vibration_rms, motor_current) per second
    (71, 3.6, 8.5), (71, 4.1, 8.6), (72, 4.6, 8.7), (72, 5.1, 8.8), (73, 5.5, 8.9), (74, 5.9, 9.0), (76, 6.3, 9.1), (79, 6.6, 9.2),
    (82, 6.9, 9.3), (85, 7.0, 9.4), (88, 7.2, 9.5), (91, 7.3, 9.6), (93, 7.4, 9.7), (94, 7.5, 9.8), (95, 7.5, 9.8), (95, 7.6, 9.9),
]


def post(url: str, key: str, device: str, readings: dict[str, float]) -> dict:
    r = requests.post(f"{url}/v1/telemetry", headers={"X-Device-Key": key}, timeout=10,
                      json={"device_id": device, "readings": [{"parameter": p, "value": round(v, 3), "ts": time.time()} for p, v in readings.items()]})
    r.raise_for_status()
    return r.json()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--device", required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--baseline", type=int, default=35)
    a = ap.parse_args()
    print(f"baseline {a.baseline}s …")
    for _ in range(a.baseline):
        post(a.url, a.key, a.device, {p: m + random.gauss(0, s) for p, (m, s) in NORMAL.items()})
        time.sleep(1)
    print("ramp …")
    for temp, vib, amps in RAMP:
        res = post(a.url, a.key, a.device, {"motor_temp": temp, "vibration_rms": vib, "motor_current": amps, "load": 38 + random.gauss(0, 1), "belt_speed": 1.2})
        sig = [f"{s['layer']}:{s['severity']}" for s in res.get("signals", [])]
        print(f"  temp={temp:>3} vib={vib:.1f} → {sig or '-'}")
        time.sleep(1)
    print("done — the agent is investigating; open the incident in the dashboard.")


if __name__ == "__main__":
    main()
