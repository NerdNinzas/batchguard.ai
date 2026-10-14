"""Deterministic detection. Runs inline on every ingested reading; never waits on an LLM.

Layers: limits (verified warn/crit), trend (linear fit → time-to-limit), anomaly (z-score vs the
machine's own baseline + cross-signal check), staleness (sweeper task in main.py).
"""

from dataclasses import dataclass
from typing import Any

import numpy as np

from .config import settings
from .db import conn

Severity = str  # info | warning | critical | emergency


@dataclass
class Signal:
    machine_id: str
    parameter: str
    layer: str  # limits | trend | anomaly | stale | event
    severity: Severity
    value: float | None
    message: str
    extra: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "machine_id": self.machine_id,
            "parameter": self.parameter,
            "layer": self.layer,
            "severity": self.severity,
            "value": self.value,
            "message": self.message,
            **self.extra,
        }


def _param(machine_id: str, name: str) -> dict[str, Any] | None:
    r = conn().execute("SELECT * FROM parameters WHERE machine_id=? AND name=?", (machine_id, name)).fetchone()
    return dict(r) if r else None


def _series(machine_id: str, parameter: str, since: float) -> tuple[np.ndarray, np.ndarray]:
    rs = conn().execute(
        "SELECT ts, value FROM readings WHERE machine_id=? AND parameter=? AND ts>=? ORDER BY ts",
        (machine_id, parameter, since),
    ).fetchall()
    if not rs:
        return np.array([]), np.array([])
    a = np.array([(r["ts"], r["value"]) for r in rs], dtype=float)
    return a[:, 0], a[:, 1]


def limit_state(p: dict[str, Any], v: float) -> str:
    def gt(a: float | None) -> bool:
        return a is not None and v > a

    def lt(a: float | None) -> bool:
        return a is not None and v < a

    if gt(p.get("crit_high")) or lt(p.get("crit_low")):
        return "critical"
    if gt(p.get("warn_high")) or lt(p.get("warn_low")):
        return "warning"
    return "normal"


def check_limits(machine_id: str, p: dict[str, Any], v: float, unit: str | None) -> Signal | None:
    state = limit_state(p, v)
    if state == "normal":
        return None
    hi = p.get("crit_high") if state == "critical" else p.get("warn_high")
    lo = p.get("crit_low") if state == "critical" else p.get("warn_low")
    bound = hi if (hi is not None and v > hi) else lo
    return Signal(
        machine_id, p["name"], "limits", state, v,
        f"{p['name']} {v:g} {unit or p.get('unit') or ''} {'>' if bound == hi else '<'} {state} limit {bound:g}",
        {"limit": bound, "unit": unit or p.get("unit")},
    )


def check_trend(machine_id: str, p: dict[str, Any], now: float) -> Signal | None:
    """Linear fit over the trend window; warn when a critical limit is projected within 10 min."""
    ts, vs = _series(machine_id, p["name"], now - settings.trend_window_seconds)
    if len(ts) < 30 or (ts[-1] - ts[0]) < settings.trend_window_seconds * 0.8:
        return None
    x = ts - ts[0]
    slope, intercept = np.polyfit(x, vs, 1)  # units per second
    if abs(slope) < 1e-9:
        return None
    # the fit must explain the data (R²) and the projected move must beat the noise
    resid = vs - (slope * x + intercept)
    ss_res, ss_tot = float((resid**2).sum()), float(((vs - vs.mean()) ** 2).sum())
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    if r2 < 0.6 or abs(slope) * (x[-1] - x[0]) < 3 * float(resid.std() or 1e-9):
        return None
    current = float(vs[-1])
    target = None
    if slope > 0 and p.get("crit_high") is not None and current < p["crit_high"]:
        target = p["crit_high"]
    elif slope < 0 and p.get("crit_low") is not None and current > p["crit_low"]:
        target = p["crit_low"]
    if target is None:
        return None
    eta = (target - current) / slope
    if eta <= 0 or eta > 600:
        return None
    # and a meaningful move relative to the normal band
    band = abs((p.get("normal_max") or current) - (p.get("normal_min") or current)) or abs(current) or 1.0
    if abs(slope) * settings.trend_window_seconds < 0.08 * band:
        return None
    return Signal(
        machine_id, p["name"], "trend", "warning", current,
        f"{p['name']} trending toward {target:g} — limit reached in ~{int(eta // 60)} min {int(eta % 60)} s",
        {"eta_seconds": round(eta), "slope_per_min": round(float(slope) * 60, 4), "target": target, "r2": round(r2, 2)},
    )


def baseline(machine_id: str, parameter: str, now: float) -> dict[str, float] | None:
    """Mean/std over the 2 min before the last 60 s (so a fresh fault doesn't pollute its own baseline)."""
    ts, vs = _series(machine_id, parameter, now - 180)
    mask = ts < now - 60
    if mask.sum() < 20:
        return None
    b = vs[mask]
    return {"mean": float(b.mean()), "std": float(b.std()), "min": float(b.min()), "max": float(b.max()), "n": int(mask.sum())}


def check_anomaly(machine_id: str, p: dict[str, Any], v: float, now: float) -> Signal | None:
    b = baseline(machine_id, p["name"], now)
    if not b or b["std"] < 1e-9:
        return None
    z = (v - b["mean"]) / b["std"]
    if abs(z) < 3.5:
        return None
    return Signal(
        machine_id, p["name"], "anomaly", "info", v,
        f"{p['name']} {v:g} is {z:+.1f}σ from its own baseline ({b['mean']:.2f} ± {b['std']:.2f})",
        {"z": round(float(z), 2), "baseline_mean": round(b["mean"], 3), "baseline_std": round(b["std"], 3)},
    )


def run_detection(machine_id: str, parameter: str, value: float, unit: str | None, now: float) -> list[Signal]:
    p = _param(machine_id, parameter)
    if not p:
        return []
    out: list[Signal] = []
    s = check_limits(machine_id, p, value, unit)
    if s:
        out.append(s)
    else:
        t = check_trend(machine_id, p, now)
        if t:
            out.append(t)
    a = check_anomaly(machine_id, p, value, now)
    if a and not s:
        out.append(a)
    return out


def health_score(machine_id: str) -> int:
    """0–100: starts at 100, minus 15 per warning parameter, 40 per critical, 60 if offline."""
    m = conn().execute("SELECT status FROM machines WHERE id=?", (machine_id,)).fetchone()
    if not m:
        return 0
    if m["status"] in ("offline", "stale"):
        return 40
    score = 100
    for r in conn().execute("SELECT state FROM latest WHERE machine_id=?", (machine_id,)).fetchall():
        score -= 40 if r["state"] == "critical" else 15 if r["state"] == "warning" else 0
    return max(0, score)
