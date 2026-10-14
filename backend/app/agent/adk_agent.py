"""The investigation agent on Google ADK + Gemini. Only built when Gemini is configured."""

import asyncio
import json
from typing import Any

from ..config import settings
from . import tools
from .schema import IncidentReport

INSTRUCTION = """You are BatchGuard's maintenance investigation agent for a factory line.
An incident has opened on a machine. Diagnose it with evidence, never with guesses.

Procedure (use the tools; do not invent numbers):
1. get_readings for every parameter on the machine over the last 5 minutes.
2. get_baseline for the parameters that triggered the incident.
3. get_events, get_line_neighbours, get_past_incidents.
4. get_manual_sections with a query built from the symptoms (e.g. "bearing vibration temperature").
5. compute_correlation between pairs that could be causally linked (vibration vs temperature, load vs current, speed vs current).
6. Propose 3 candidate causes. For each, list supporting evidence, contradicting evidence and missing data.
   Support level: strong / plausible / weak / inconclusive. These are labels, not probabilities.
7. Recommend ordered checks an engineer can do, most discriminating first, each with the safety note.
8. Write a call script of at most 20 seconds of speech: machine, problem, first check, "press 1 to acknowledge".

Rules: every number you write must come from a tool result. Cite the manual page when you use it.
You cannot change any machine setting; recommendations are text only, for qualified personnel.
Return ONLY a JSON object matching the IncidentReport schema."""


def _model() -> str:
    return settings.gemini_model_pro


def build_agent():
    from google.adk.agents import LlmAgent

    return LlmAgent(
        name="batchguard_investigator",
        model=_model(),
        description="Evidence-backed fault investigation over factory telemetry",
        instruction=INSTRUCTION,
        tools=list(tools.ALL_TOOLS),
    )


async def _run(prompt: str) -> tuple[str, list[dict[str, Any]]]:
    from google.adk.runners import InMemoryRunner
    from google.genai import types

    runner = InMemoryRunner(agent=build_agent(), app_name="batchguard")
    session = await runner.session_service.create_session(app_name="batchguard", user_id="system")
    content = types.Content(role="user", parts=[types.Part(text=prompt)])
    final = ""
    calls: list[dict[str, Any]] = []
    async for event in runner.run_async(user_id="system", session_id=session.id, new_message=content):
        for part in (event.content.parts if event.content else []):
            if getattr(part, "function_call", None):
                calls.append({"tool": part.function_call.name, "args": dict(part.function_call.args or {})})
        if event.is_final_response() and event.content and event.content.parts:
            final = "".join(p.text or "" for p in event.content.parts)
    return final, calls


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start : end + 1])


def investigate(machine_id: str, signals: list[dict[str, Any]], severity: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Returns (validated report dict, tool calls). Raises on failure after one retry."""
    prompt = (
        f"Incident on machine id '{machine_id}', severity {severity}.\nTriggering signals:\n"
        + "\n".join(f"- {s.get('layer')}: {s.get('message')}" for s in signals)
        + "\n\nInvestigate now and return the IncidentReport JSON."
    )
    last_err: Exception | None = None
    calls: list[dict[str, Any]] = []
    for attempt in range(2):
        try:
            text, calls = asyncio.run(_run(prompt if attempt == 0 else prompt + "\n\nYour previous answer was not valid JSON for the schema. Return only the JSON object."))
            report = IncidentReport.model_validate(_extract_json(text))
            return report.model_dump(), calls
        except Exception as e:  # noqa: BLE001
            last_err = e
    raise RuntimeError(f"agent failed: {last_err}")


def ask(incident_context: str, question: str) -> str:
    """Grounded Q&A over the same evidence: single Gemini call with the report + tools summary in context."""
    from google import genai

    client = genai.Client()
    resp = client.models.generate_content(
        model=settings.gemini_model_fast,
        contents=f"{INSTRUCTION}\n\nYou are now answering a follow-up question from an engineer about an incident.\n"
        f"Incident context (report and evidence):\n{incident_context}\n\nQuestion: {question}\n"
        "Answer in plain language in under 120 words, citing only evidence present above.",
    )
    return resp.text or ""
