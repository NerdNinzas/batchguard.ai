"""Incident report schema (what the agent must produce) + guardrail checks."""

import re
from typing import Any, Literal

from pydantic import BaseModel, Field


class Evidence(BaseModel):
    observation: str
    supports: bool = True
    parameter: str | None = None
    value: float | None = None
    source: str = "readings"  # readings | events | manual | neighbours | correlation | history


class Cause(BaseModel):
    name: str
    support: Literal["strong", "plausible", "weak", "inconclusive"]
    rationale: str
    evidence_for: list[Evidence] = Field(default_factory=list)
    evidence_against: list[Evidence] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list)


class Check(BaseModel):
    order: int
    action: str
    discriminates: str  # which causes this check separates
    safety: str = "Qualified personnel only. Isolate before touching rotating parts."


class TimelineItem(BaseModel):
    t: str
    what: str


class IncidentReport(BaseModel):
    summary: str
    severity: Literal["info", "warning", "critical", "emergency"]
    timeline: list[TimelineItem] = Field(default_factory=list)
    causes: list[Cause] = Field(min_length=1, max_length=5)
    checks: list[Check] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list)
    call_script: str = Field(description="≤ 20 seconds spoken: machine, problem, first check, press 1 to acknowledge")
    cross_machine: str | None = None


_NUM = re.compile(r"(?<![\w.])(-?\d+(?:\.\d+)?)(?![\w.])")


def number_guardrail(report: dict[str, Any], allowed: set[float]) -> tuple[dict[str, Any], list[str]]:
    """Every number in the report must appear in stored readings/limits (±0.5% tolerance). Others are flagged."""
    flagged: list[str] = []

    def ok(n: float) -> bool:
        if n in allowed or abs(n) <= 10:  # small integers (counts, minutes, ordering) are fine
            return True
        return any(a != 0 and abs(n - a) / abs(a) < 0.005 for a in allowed)

    def scrub(text: str) -> str:
        def repl(m: re.Match) -> str:
            n = float(m.group(1))
            if ok(n):
                return m.group(0)
            flagged.append(m.group(0))
            return "[unverified]"

        return _NUM.sub(repl, text)

    def walk(v: Any) -> Any:
        if isinstance(v, str):
            return scrub(v)
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: (walk(x) if k not in ("value", "t", "order", "page") else x) for k, x in v.items()}
        return v

    return walk(report), flagged
