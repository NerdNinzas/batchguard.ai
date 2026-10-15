"""Investigation orchestration: pick ADK/Gemini or fallback, apply guardrails, store, broadcast."""

import json
import traceback
from typing import Any

from .. import bus, cloud
from ..config import settings
from ..db import conn, j, row, tx, uj
from ..ids import new_id, now
from . import fallback
from .schema import IncidentReport, number_guardrail


def _allowed_numbers(machine_id: str) -> set[float]:
    allowed: set[float] = set()
    for r in conn().execute("SELECT value FROM readings WHERE machine_id=? AND ts>=? ", (machine_id, now() - 1200)).fetchall():
        allowed.add(round(float(r["value"]), 3))
        allowed.add(round(float(r["value"]), 1))
        allowed.add(round(float(r["value"])))
    for p in conn().execute("SELECT * FROM parameters WHERE machine_id=?", (machine_id,)).fetchall():
        for k in ("normal_min", "normal_max", "warn_low", "warn_high", "crit_low", "crit_high", "sample_rate", "source_page"):
            if p[k] is not None:
                allowed.add(float(p[k]))
    # manual page numbers and the tool windows the agent is told to use are legitimate numbers too
    m = conn().execute("SELECT knowledge FROM machines WHERE id=?", (machine_id,)).fetchone()
    for sec in uj(m["knowledge"], []) if m else []:
        if sec.get("page") is not None:
            allowed.add(float(sec["page"]))
    allowed.update({60.0, 120.0, 300.0, 600.0, 900.0, 1800.0, 3600.0})
    return allowed


def investigate_async(incident_id: str) -> None:
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone())
    if not inc:
        return
    # one investigation at a time per incident: a run that started < 10 min ago and has not finished is still going
    if conn().execute("SELECT 1 FROM agent_runs WHERE incident_id=? AND finished_at IS NULL AND started_at > ?", (incident_id, now() - 600)).fetchone():
        return
    run_id = new_id("run")
    with tx() as c:
        c.execute("INSERT INTO agent_runs (id, incident_id, started_at, source) VALUES (?,?,?,?)", (run_id, incident_id, now(), "pending"))
    signals = uj(inc["signals"], [])
    source, calls, report, err = "fallback", [], None, None
    stale_only = bool(signals) and all(s.get("layer") == "stale" for s in signals)
    if settings.gemini_enabled and not stale_only:
        try:
            from . import adk_agent

            report, calls = adk_agent.investigate(inc["machine_id"], signals, inc["severity"])
            source = "gemini-adk"
        except Exception as e:  # noqa: BLE001
            err = f"{e}\n{traceback.format_exc()[-800:]}"
    if report is None:
        try:
            report = fallback.investigate(inc["machine_id"], signals, inc["severity"])
            report = IncidentReport.model_validate(report).model_dump()
            source = "rule-based" if not err else "rule-based (gemini failed)"
        except Exception as e:  # noqa: BLE001
            err = (err or "") + f"\nfallback: {e}"
    if report is not None:
        report, flagged = number_guardrail(report, _allowed_numbers(inc["machine_id"]))
        report["guardrail"] = {"unverified_numbers_removed": flagged, "schema": "IncidentReport v1"}
    with tx() as c:
        c.execute("UPDATE agent_runs SET finished_at=?, source=?, tool_calls=?, ok=?, error=? WHERE id=?",
                  (now(), source, j(calls), 1 if report else 0, err, run_id))
        if report is not None:
            c.execute("UPDATE incidents SET report=?, report_source=? WHERE id=?", (j(report), source, incident_id))
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone())
    bus.publish(inc["org_id"], "incident", {**inc, "signals": signals, "report": report})
    cloud.mirror("incidents", incident_id, inc)


def ask(incident_id: str, question: str) -> str:
    inc = row(conn().execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone())
    if not inc:
        return "Unknown incident."
    report = uj(inc["report"], {})
    context = json.dumps({"title": inc["title"], "severity": inc["severity"], "signals": uj(inc["signals"], []), "report": report}, default=str)[:12000]
    if settings.gemini_enabled:
        try:
            from . import adk_agent

            answer = adk_agent.ask(context, question)
        except Exception as e:  # noqa: BLE001
            answer = f"Gemini unavailable ({e}). " + _rule_answer(report, question)
    else:
        answer = _rule_answer(report, question)
    with tx() as c:
        c.execute("INSERT INTO chat (id, incident_id, role, text, ts) VALUES (?,?,?,?,?)", (new_id("msg"), incident_id, "user", question, now()))
        c.execute("INSERT INTO chat (id, incident_id, role, text, ts) VALUES (?,?,?,?,?)", (new_id("msg"), incident_id, "agent", answer, now()))
    return answer


def _rule_answer(report: dict[str, Any], question: str) -> str:
    if not report:
        return "The investigation has not finished yet."
    q = question.lower()
    causes = report.get("causes", [])
    for c in causes:
        if any(w in q for w in c["name"].lower().split()):
            against = "; ".join(e["observation"] for e in c.get("evidence_against", [])) or "nothing specific"
            for_ = "; ".join(e["observation"] for e in c.get("evidence_for", [])) or "nothing specific"
            return f"{c['name']} is rated {c['support']}. For: {for_}. Against: {against}."
    if "check" in q or "do" in q:
        return "Checks in order: " + " → ".join(ch["action"] for ch in report.get("checks", []))
    return report.get("summary", "No summary available.") + " (Configure GOOGLE_API_KEY for free-form answers.)"
