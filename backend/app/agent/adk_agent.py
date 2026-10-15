"""The investigation pipeline on Google ADK + Gemini.

Six stages, as in the PRD, as a SequentialAgent. Each stage writes its result to session
state (output_key) and the next stage reads it through instruction templating ({context},
{manual}, ...). Tools are plain functions from tools.py; none can change a machine.

    context_builder  → readings, baselines, events, neighbours, history   (tools)
    retriever        → troubleshooting / maintenance passages from the manual (tools)
    hypothesis_gen   → 3–5 candidate causes tied to observations
    evaluator        → evidence for / against / missing per cause, correlations (tools)
    recommender      → ordered, discriminating checks with safety notes
    reporter         → schema-validated IncidentReport + 20-second call script

Only built when Gemini is configured (GOOGLE_API_KEY or Vertex AI).
"""

import asyncio
import json
from typing import Any

from ..config import settings
from . import tools
from .schema import IncidentReport

RULES = (
    "Rules for every stage: use only numbers that came from a tool result; cite manual pages when used; "
    "support levels are labels (strong / plausible / weak / inconclusive), not probabilities; you cannot change any "
    "machine setting — recommendations are text for qualified personnel."
)


def _fast() -> str:
    return settings.gemini_model_fast


def _pro() -> str:
    return settings.gemini_model_pro


def build_pipeline():
    from google.adk.agents import LlmAgent, SequentialAgent

    context_builder = LlmAgent(
        name="context_builder",
        model=_fast(),
        description="Collects the incident window: readings, baselines, events, neighbours, past incidents.",
        instruction=(
            "An incident opened on machine '{machine_id}' with severity '{severity}'. Triggering signals:\n{signals}\n\n"
            "Gather context with the tools: get_readings for ALL of these parameters over 300 s: {parameters}; "
            "get_baseline for each triggering parameter; get_events (900 s); get_line_neighbours; get_past_incidents. "
            "Then write a compact factual summary (bullet points with numbers and units) of what moved, when, how fast, "
            "what stayed flat, what the neighbours show, and any confirmed past causes. No diagnosis yet. " + RULES
        ),
        tools=[tools.get_readings, tools.get_baseline, tools.get_events, tools.get_line_neighbours, tools.get_past_incidents],
        output_key="context",
    )

    retriever = LlmAgent(
        name="retriever",
        model=_fast(),
        description="Pulls the relevant troubleshooting and maintenance passages from the machine's own manual.",
        instruction=(
            "Context so far:\n{context}\n\nBuild 2–3 short queries from the symptoms (e.g. 'bearing vibration temperature', "
            "'belt slip current') and call get_manual_sections for machine '{machine_id}' with each. "
            "Return the relevant passages verbatim with their titles and page numbers, and one line on why each is relevant. " + RULES
        ),
        tools=[tools.get_manual_sections],
        output_key="manual",
    )

    hypothesis_generator = LlmAgent(
        name="hypothesis_generator",
        model=_pro(),
        description="Proposes 3–5 candidate causes, each tied to specific observations.",
        instruction=(
            "Context:\n{context}\n\nManual passages:\n{manual}\n\n"
            "Propose 3 to 5 candidate causes for this incident. For each: name, the specific observations it would explain, "
            "and the observations it would NOT explain. Consider: bearing wear, cooling fan failure, belt slip / low tension, "
            "overload / jam, upstream over-feed, sealer heater degradation, sensor failure — but only where the data fits. " + RULES
        ),
        output_key="hypotheses",
    )

    evaluator = LlmAgent(
        name="evaluator",
        model=_pro(),
        description="Weighs each hypothesis: supporting evidence, contradicting evidence, missing data, support level.",
        instruction=(
            "Context:\n{context}\n\nHypotheses:\n{hypotheses}\n\n"
            "For each hypothesis list evidence FOR, evidence AGAINST and MISSING data, then assign a support level "
            "(strong / plausible / weak / inconclusive). Use compute_correlation on machine '{machine_id}' for pairs that "
            "discriminate between causes (vibration_rms vs motor_temp, load vs motor_current, belt_speed vs motor_current) and "
            "get_baseline / get_readings if you need a number you do not have. Rank the hypotheses. " + RULES
        ),
        tools=[tools.compute_correlation, tools.get_baseline, tools.get_readings],
        output_key="evaluation",
    )

    recommender = LlmAgent(
        name="recommender",
        model=_fast(),
        description="Orders the checks an engineer can do, most discriminating first.",
        instruction=(
            "Evaluation:\n{evaluation}\n\nManual passages:\n{manual}\n\n"
            "Write an ordered list of checks an engineer can do on site, most discriminating first: each check says what to do, "
            "which causes it separates, and a one-line safety note (isolate / lock out before touching rotating parts). "
            "Prefer checks the manual describes and cite the page. " + RULES
        ),
        output_key="checks",
    )

    reporter = LlmAgent(
        name="reporter",
        model=_fast(),
        description="Writes the schema-validated incident report and the phone script.",
        instruction=(
            "Severity: {severity}. Context:\n{context}\n\nEvaluation:\n{evaluation}\n\nChecks:\n{checks}\n\n"
            "Produce the IncidentReport: a 2-sentence summary, a short timeline, the ranked causes with their evidence lists and "
            "missing data, the checks in order, overall missing data, cross_machine note if an upstream/downstream machine is "
            "involved, and a call_script of at most 20 seconds of speech: machine, problem, first check, 'press 1 to acknowledge'. " + RULES
        ),
        output_schema=IncidentReport,
        output_key="report",
    )

    return SequentialAgent(
        name="batchguard_investigation",
        description="Evidence-backed fault investigation over factory telemetry",
        sub_agents=[context_builder, retriever, hypothesis_generator, evaluator, recommender, reporter],
    )


async def _run_pipeline(state: dict[str, Any]) -> tuple[Any, list[dict[str, Any]]]:
    from google.adk.runners import InMemoryRunner
    from google.genai import types

    runner = InMemoryRunner(agent=build_pipeline(), app_name="batchguard")
    session = await runner.session_service.create_session(app_name="batchguard", user_id="system", state=state)
    msg = types.Content(role="user", parts=[types.Part(text="Investigate this incident.")])
    trace: list[dict[str, Any]] = []
    async for event in runner.run_async(user_id="system", session_id=session.id, new_message=msg):
        for fc in event.get_function_calls() or []:
            trace.append({"stage": event.author, "tool": fc.name, "args": dict(fc.args or {})})
    session = await runner.session_service.get_session(app_name="batchguard", user_id="system", session_id=session.id)
    return (session.state or {}).get("report"), trace


def _coerce(report: Any) -> dict[str, Any]:
    if isinstance(report, str):
        text = report.strip().strip("`")
        if text.startswith("json"):
            text = text[4:]
        start, end = text.find("{"), text.rfind("}")
        report = json.loads(text[start : end + 1])
    return IncidentReport.model_validate(report).model_dump()


def investigate(machine_id: str, signals: list[dict[str, Any]], severity: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Returns (validated report dict, tool trace with stage names). Raises after one retry."""
    params = [r["name"] for r in tools.conn().execute("SELECT name FROM parameters WHERE machine_id=?", (machine_id,)).fetchall()]
    state = {
        "machine_id": machine_id,
        "severity": severity,
        "signals": "\n".join(f"- {s.get('layer')}: {s.get('message')}" for s in signals),
        "parameters": ", ".join(params),
    }
    last_err: Exception | None = None
    trace: list[dict[str, Any]] = []
    for _ in range(2):
        try:
            report, trace = asyncio.run(_run_pipeline(state))
            return _coerce(report), trace
        except Exception as e:  # noqa: BLE001
            last_err = e
    raise RuntimeError(f"agent pipeline failed: {last_err}")


# ---------- "ask the agent": grounded Q&A with the same tools ----------
def build_ask_agent(incident_context: str):
    from google.adk.agents import LlmAgent

    return LlmAgent(
        name="batchguard_ask",
        model=_fast(),
        description="Answers an engineer's follow-up question about an incident, grounded in the evidence and tools.",
        instruction=(
            "You are BatchGuard's maintenance agent answering a follow-up question about an incident. "
            "Incident context (report, signals):\n" + incident_context + "\n\n"
            "Answer in plain language in under 120 words. If the report does not contain what you need, use the tools "
            "(get_readings, get_baseline, get_events, get_line_neighbours, get_manual_sections, get_past_incidents, "
            "compute_correlation) on the incident's machine; never invent numbers. " + RULES
        ),
        tools=list(tools.ALL_TOOLS),
    )


async def _run_ask(incident_context: str, question: str) -> str:
    from google.adk.runners import InMemoryRunner
    from google.genai import types

    runner = InMemoryRunner(agent=build_ask_agent(incident_context), app_name="batchguard")
    session = await runner.session_service.create_session(app_name="batchguard", user_id="system")
    msg = types.Content(role="user", parts=[types.Part(text=question)])
    answer = ""
    async for event in runner.run_async(user_id="system", session_id=session.id, new_message=msg):
        if event.is_final_response() and event.content and event.content.parts:
            answer = "".join(p.text or "" for p in event.content.parts)
    return answer.strip()


def ask(incident_context: str, question: str) -> str:
    return asyncio.run(_run_ask(incident_context, question))
