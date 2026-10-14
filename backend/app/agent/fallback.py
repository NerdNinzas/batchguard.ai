"""Rule-based investigator used when Gemini is not configured or fails schema validation twice.

It calls the same tools as the ADK agent and matches the fault library's signatures, so the
report shape and evidence discipline are identical — just less nuanced.
"""

from typing import Any

from . import tools


FAULTS = [
    {"name": "Bearing wear", "needs": {"vibration_rms": "up", "motor_temp": "up"}, "leads": ("vibration_rms", "motor_temp"), "check": "IR-gun the drive-end bearing housing; if hot, inspect bearing and lubrication"},
    {"name": "Cooling fan failure", "needs": {"motor_temp": "up"}, "flat": ["vibration_rms", "motor_current"], "check": "Confirm the cooling fan is spinning and the shroud is clear of debris"},
    {"name": "Belt slip / low tension", "needs": {"belt_speed": "down", "motor_current": "down"}, "check": "Check belt tension and look for glazing on the drive drum"},
    {"name": "Overload / jam", "needs": {"load": "up", "motor_current": "up"}, "events": ["jam", "e-stop"], "check": "Inspect the belt for a jammed item; check upstream feed rate"},
    {"name": "Upstream over-feed", "needs": {"load": "up"}, "upstream": "feed_rate", "check": "Compare feeder rate set-point with the conveyor's rated capacity"},
    {"name": "Sealer heater degradation", "needs": {"seal_temp": "down"}, "downstream": "reject_rate", "check": "Measure heater element resistance; verify thermocouple reading with a reference probe"},
    {"name": "Sensor failure", "needs": {}, "check": "Compare the flat-lined or impossible reading against a handheld instrument"},
]


def _dir(stats: dict[str, Any]) -> str:
    if not stats or stats.get("n", 0) < 3:
        return "none"
    first, last = stats["first"], stats["last"]
    span = max(abs(stats["max"] - stats["min"]), 1e-9)
    if last - first > 0.25 * span and stats["slope_per_min"] > 0:
        return "up"
    if first - last > 0.25 * span and stats["slope_per_min"] < 0:
        return "down"
    return "flat"


def investigate(machine_id: str, signals: list[dict[str, Any]], severity: str) -> dict[str, Any]:
    params = sorted({s["parameter"] for s in signals if s.get("parameter") and s["parameter"] != "telemetry"})
    all_params = [r["name"] for r in tools.conn().execute("SELECT name FROM parameters WHERE machine_id=?", (machine_id,)).fetchall()]
    readings = tools.get_readings(machine_id, all_params or params, 300)
    dirs = {p: _dir(readings.get(p, {})) for p in readings}
    events = tools.get_events(machine_id, 900)
    neigh = tools.get_line_neighbours(machine_id)
    manual = tools.get_manual_sections(machine_id, " ".join(params + ["bearing", "troubleshooting", "maintenance"]))
    history = tools.get_past_incidents(machine_id)

    # sensor failure heuristic
    flat_or_impossible = [p for p, r in readings.items() if r.get("n", 0) > 10 and (r["max"] - r["min"]) < 1e-9]
    readings = {p: r for p, r in readings.items() if r.get("n", 0) > 0} or readings

    causes: list[dict[str, Any]] = []
    for f in FAULTS:
        score = 0
        ev_for, ev_against, missing = [], [], []
        if f["name"] == "Sensor failure":
            if flat_or_impossible:
                score += 3
                ev_for.append({"observation": f"{', '.join(flat_or_impossible)} flat-lined for the whole window", "supports": True, "source": "readings"})
            else:
                continue
        for p, want in f.get("needs", {}).items():
            d = dirs.get(p)
            if d is None:
                missing.append(f"{p} is not monitored on this machine")
                continue
            if d == "none":
                missing.append(f"no recent {p} readings")
                continue
            r = readings[p]
            if d == want:
                score += 2
                ev_for.append({"observation": f"{p} moved {r['first']} → {r['last']} {r.get('unit') or ''} ({d}) over 5 min", "supports": True, "parameter": p, "value": r["last"], "source": "readings"})
            else:
                score -= 1
                ev_against.append({"observation": f"{p} is {d} ({r['first']} → {r['last']}), expected {want}", "supports": False, "parameter": p, "value": r["last"], "source": "readings"})
        for p in f.get("flat", []):
            d = dirs.get(p)
            if d in (None, "none"):
                missing.append(f"no recent {p} readings")
            elif d == "flat":
                score += 1
                ev_for.append({"observation": f"{p} stayed flat while the fault developed", "supports": True, "parameter": p, "source": "readings"})
            elif d in ("up", "down"):
                score -= 1
                ev_against.append({"observation": f"{p} is {d}, which this cause would not explain", "supports": False, "parameter": p, "source": "readings"})
        if f.get("leads"):
            a, b = f["leads"]
            if a in readings and b in readings:
                corr = tools.compute_correlation(machine_id, a, b, 600)
                if "r" in corr:
                    if corr["lag_seconds"] > 0 and corr["r"] > 0.5:
                        score += 2
                        ev_for.append({"observation": f"{corr['interpretation']} (r = {corr['r']})", "supports": True, "source": "correlation"})
                    elif corr["lag_seconds"] < 0:
                        score -= 1
                        ev_against.append({"observation": corr["interpretation"], "supports": False, "source": "correlation"})
        if f.get("events"):
            hits = [e for e in events if any(k in (e.get("message") or "").lower() for k in f["events"])]
            if hits:
                score += 2
                ev_for.append({"observation": f"Event logged: {hits[0]['message']}", "supports": True, "source": "events"})
            else:
                ev_against.append({"observation": "No jam / E-stop event logged", "supports": False, "source": "events"})
        if f.get("upstream"):
            up = neigh.get("upstream") or {}
            lv = (up.get("latest") or {}).get(f["upstream"])
            if lv and lv.get("state") != "normal":
                score += 2
                ev_for.append({"observation": f"Upstream {up.get('name')} {f['upstream']} is {lv['state']} ({lv['value']})", "supports": True, "source": "neighbours"})
            elif up:
                ev_against.append({"observation": f"Upstream {up.get('name')} {f['upstream']} is normal", "supports": False, "source": "neighbours"})
            else:
                missing.append("No upstream machine on this line")
        if f.get("downstream"):
            dn = neigh.get("downstream") or {}
            lv = (dn.get("latest") or {}).get(f["downstream"])
            if lv and lv.get("state") != "normal":
                score += 1
                ev_for.append({"observation": f"Downstream {dn.get('name')} {f['downstream']} is {lv['state']}", "supports": True, "source": "neighbours"})
        for h in history:
            if h.get("confirmed_cause") and f["name"].lower() in h["confirmed_cause"].lower():
                score += 1
                ev_for.append({"observation": f"Confirmed before on this machine ({h['id']})", "supports": True, "source": "history"})
        if score <= 0 and not ev_for:
            continue
        support = "strong" if score >= 4 else "plausible" if score >= 2 else "weak" if score >= 1 else "inconclusive"
        causes.append({"name": f["name"], "support": support, "rationale": f"Signature match score {score}", "evidence_for": ev_for, "evidence_against": ev_against, "missing_data": missing, "_score": score, "_check": f["check"]})

    if not causes:
        causes.append({"name": "Unexplained drift", "support": "inconclusive", "rationale": "No fault signature matched the observed pattern", "evidence_for": [], "evidence_against": [], "missing_data": ["More parameters or a longer window"], "_score": 0, "_check": "Walk the machine and compare readings with handheld instruments"})
    causes.sort(key=lambda c: -c["_score"])
    causes = causes[:3]

    checks = [{"order": i + 1, "action": c["_check"], "discriminates": c["name"]} for i, c in enumerate(causes)]
    for c in causes:
        c.pop("_score")
        c.pop("_check")

    m = tools.conn().execute("SELECT name, device_id FROM machines WHERE id=?", (machine_id,)).fetchone()
    top = causes[0]
    worst = max(signals, key=lambda s: ["info", "warning", "critical", "emergency"].index(s.get("severity", "info")))
    import time as _time
    timeline = [{"t": _time.strftime("%H:%M:%S", _time.localtime(s.get("ts", 0))), "what": s.get("message", "")} for s in signals[-6:]]
    manual_ref = f" See manual: {manual[0].get('title')} (p.{manual[0].get('page')})." if manual else ""
    return {
        "summary": f"{m['name']}: {worst.get('message')}. Most likely {top['name'].lower()} ({top['support']}).{manual_ref}",
        "severity": severity,
        "timeline": timeline,
        "causes": causes,
        "checks": checks,
        "missing_data": sorted({md for c in causes for md in c["missing_data"]}),
        "call_script": f"{m['name']} {m['device_id']} is {severity}. {top['name']} likely. First check: {checks[0]['action'].split(';')[0]}. Press 1 to acknowledge.",
        "cross_machine": (f"Upstream {neigh['upstream']['name']} may be contributing" if neigh.get("upstream") and any(v.get("state") != "normal" for v in (neigh["upstream"].get("latest") or {}).values()) else None),
    }
