"""ADK function tools. Plain functions with docstrings + type hints: ADK derives the schema.

None of these can change a machine. In blind-test mode the fault label lives in a table these
tools never read.
"""

from typing import Any

import numpy as np

from ..db import conn, rows, uj
from ..detection import baseline as _baseline
from ..ids import now


def _mid(machine: str) -> str | None:
    r = conn().execute("SELECT id FROM machines WHERE id=? OR device_id=? OR name=?", (machine, machine, machine)).fetchone()
    return r["id"] if r else None


def get_readings(machine: str, parameters: list[str], window_seconds: int = 300) -> dict[str, Any]:
    """Time series and summary stats for the given parameters over the last `window_seconds`.

    Args:
        machine: machine id, device id or name.
        parameters: parameter names, e.g. ["motor_temp", "vibration_rms"].
        window_seconds: how far back to look (default 300 = 5 minutes).
    """
    mid = _mid(machine)
    if not mid:
        return {"error": f"unknown machine {machine}"}
    t = now()
    out: dict[str, Any] = {}
    for p in parameters:
        rs = conn().execute(
            "SELECT ts, value, unit FROM readings WHERE machine_id=? AND parameter=? AND ts>=? ORDER BY ts",
            (mid, p, t - window_seconds),
        ).fetchall()
        if not rs:
            out[p] = {"n": 0}
            continue
        vs = np.array([r["value"] for r in rs], dtype=float)
        ts = np.array([r["ts"] for r in rs], dtype=float)
        step = max(1, len(rs) // 24)
        out[p] = {
            "n": int(len(rs)), "unit": rs[0]["unit"],
            "first": round(float(vs[0]), 3), "last": round(float(vs[-1]), 3),
            "min": round(float(vs.min()), 3), "max": round(float(vs.max()), 3), "mean": round(float(vs.mean()), 3),
            "slope_per_min": round(float(np.polyfit(ts - ts[0], vs, 1)[0] * 60), 4) if len(rs) > 2 else 0.0,
            "samples": [{"t": round(float(ts[i] - t), 1), "v": round(float(vs[i]), 3)} for i in range(0, len(rs), step)],
        }
    return out


def get_baseline(machine: str, parameter: str) -> dict[str, Any]:
    """Normal operating mean, std-dev and range for a parameter, plus its verified limits."""
    mid = _mid(machine)
    if not mid:
        return {"error": f"unknown machine {machine}"}
    p = conn().execute("SELECT * FROM parameters WHERE machine_id=? AND name=?", (mid, parameter)).fetchone()
    b = _baseline(mid, parameter, now())
    return {
        "parameter": parameter,
        "baseline": b or "not enough history",
        "limits": {k: p[k] for k in ("normal_min", "normal_max", "warn_low", "warn_high", "crit_low", "crit_high", "unit")} if p else None,
    }


def get_events(machine: str, window_seconds: int = 900) -> list[dict[str, Any]]:
    """Machine events and logs (E-stop, jam sensor, anomalies) in the window."""
    mid = _mid(machine)
    if not mid:
        return []
    t = now()
    return [
        {"ts": round(r["ts"] - t, 1), "type": r["type"], "message": r["message"], "severity": r["severity"]}
        for r in conn().execute(
            "SELECT * FROM events WHERE machine_id=? AND ts>=? ORDER BY ts DESC LIMIT 50", (mid, t - window_seconds)
        ).fetchall()
    ]


def get_line_neighbours(machine: str) -> dict[str, Any]:
    """Upstream and downstream machines on the same line with their status and latest values."""
    mid = _mid(machine)
    if not mid:
        return {"error": f"unknown machine {machine}"}
    m = conn().execute("SELECT * FROM machines WHERE id=?", (mid,)).fetchone()
    line = rows(conn().execute(
        "SELECT id, name, device_id, status, health, position FROM machines WHERE org_id=? AND COALESCE(line_id,'')=COALESCE(?,'') ORDER BY position",
        (m["org_id"], m["line_id"]),
    ).fetchall())
    idx = next((i for i, x in enumerate(line) if x["id"] == mid), -1)

    def latest(x: dict[str, Any]) -> dict[str, Any]:
        return {r["parameter"]: {"value": r["value"], "state": r["state"]} for r in conn().execute("SELECT * FROM latest WHERE machine_id=?", (x["id"],)).fetchall()}

    def pack(x: dict[str, Any] | None) -> dict[str, Any] | None:
        return {**x, "latest": latest(x)} if x else None

    return {
        "upstream": pack(line[idx - 1]) if idx > 0 else None,
        "downstream": pack(line[idx + 1]) if 0 <= idx < len(line) - 1 else None,
        "line_order": [x["name"] for x in line],
    }


def get_manual_sections(machine: str, query: str) -> list[dict[str, Any]]:
    """Troubleshooting / maintenance passages from the machine's own manual that match the query."""
    mid = _mid(machine)
    if not mid:
        return []
    m = conn().execute("SELECT knowledge, manual_text FROM machines WHERE id=?", (mid,)).fetchone()
    sections = uj(m["knowledge"], []) if m else []
    words = {w.lower() for w in query.replace(",", " ").split() if len(w) > 2}
    scored = []
    for s in sections:
        text = f"{s.get('title','')} {s.get('text','')}".lower()
        score = sum(1 for w in words if w in text)
        if score:
            scored.append((score, s))
    scored.sort(key=lambda x: -x[0])
    return [s for _, s in scored[:5]] or sections[:3]


def get_past_incidents(machine: str) -> list[dict[str, Any]]:
    """Previous incidents on this machine with the engineer-confirmed cause when available."""
    mid = _mid(machine)
    if not mid:
        return []
    out = []
    for r in conn().execute(
        "SELECT id, severity, title, opened_at, status, report, feedback FROM incidents WHERE machine_id=? AND status='resolved' ORDER BY opened_at DESC LIMIT 5",
        (mid,),
    ).fetchall():
        rep = uj(r["report"], {})
        fb = uj(r["feedback"], {})
        out.append({
            "id": r["id"], "severity": r["severity"], "title": r["title"],
            "top_cause": (rep.get("causes") or [{}])[0].get("name") if rep else None,
            "confirmed_cause": fb.get("actual_cause"), "verdict": fb.get("verdict"),
        })
    return out


def compute_correlation(machine: str, a: str, b: str, window_seconds: int = 600) -> dict[str, Any]:
    """Pearson correlation and lead/lag (seconds, positive = `a` leads `b`) between two signals."""
    mid = _mid(machine)
    if not mid:
        return {"error": f"unknown machine {machine}"}
    t = now()

    def series(p: str) -> tuple[np.ndarray, np.ndarray]:
        rs = conn().execute(
            "SELECT ts, value FROM readings WHERE machine_id=? AND parameter=? AND ts>=? ORDER BY ts", (mid, p, t - window_seconds)
        ).fetchall()
        if len(rs) < 10:
            return np.array([]), np.array([])
        arr = np.array([(r["ts"], r["value"]) for r in rs], dtype=float)
        return arr[:, 0], arr[:, 1]

    ta, va = series(a)
    tb, vb = series(b)
    if len(ta) < 10 or len(tb) < 10:
        return {"error": "not enough data"}
    grid = np.arange(max(ta[0], tb[0]), min(ta[-1], tb[-1]), 1.0)
    if len(grid) < 10:
        return {"error": "windows do not overlap"}
    ia = np.interp(grid, ta, va)
    ib = np.interp(grid, tb, vb)
    ia = (ia - ia.mean()) / (ia.std() or 1)
    ib = (ib - ib.mean()) / (ib.std() or 1)
    best_lag, best_r = 0, float(np.corrcoef(ia, ib)[0, 1])
    max_lag = min(300, len(grid) // 3)
    for lag in range(-max_lag, max_lag + 1, 5):
        if lag > 0:
            r = np.corrcoef(ia[:-lag], ib[lag:])[0, 1]
        elif lag < 0:
            r = np.corrcoef(ia[-lag:], ib[:lag])[0, 1]
        else:
            continue
        if np.isfinite(r) and abs(r) > abs(best_r):
            best_lag, best_r = lag, float(r)
    return {"a": a, "b": b, "r": round(best_r, 3), "lag_seconds": best_lag, "interpretation": f"{a} leads {b} by {best_lag}s" if best_lag > 0 else f"{b} leads {a} by {-best_lag}s" if best_lag < 0 else "no lead/lag"}


ALL_TOOLS = [get_readings, get_baseline, get_events, get_line_neighbours, get_manual_sections, get_past_incidents, compute_correlation]
