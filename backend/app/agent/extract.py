"""Manual / datasheet → structured machine spec. Gemini multimodal with a response schema when
configured; otherwise a template extraction so the verify screen still works end to end."""

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..config import settings


class ExtractedParameter(BaseModel):
    name: str = Field(description="snake_case parameter name, e.g. motor_temp")
    unit: str | None = None
    normal_min: float | None = None
    normal_max: float | None = None
    warn_low: float | None = None
    warn_high: float | None = None
    crit_low: float | None = None
    crit_high: float | None = None
    sample_rate: float | None = Field(default=None, description="samples per second recommended")
    source_page: int | None = None
    source_snippet: str | None = Field(default=None, description="the exact text the value came from")
    confidence: float = Field(ge=0, le=1)


class KnowledgeSection(BaseModel):
    title: str
    page: int | None = None
    kind: Literal["troubleshooting", "maintenance", "safety", "spec", "other"] = "other"
    text: str


class ExtractedSpec(BaseModel):
    machine_name: str
    machine_type: str = Field(description="conveyor | motor | pump | compressor | hopper | sealer | inspection | other")
    manufacturer: str | None = None
    model: str | None = None
    parameters: list[ExtractedParameter]
    knowledge: list[KnowledgeSection] = Field(default_factory=list)
    notes: str | None = None


TEMPLATES: dict[str, list[dict[str, Any]]] = {
    "conveyor": [
        {"name": "belt_speed", "unit": "m/s", "normal_min": 0.8, "normal_max": 1.5, "warn_low": 0.6, "warn_high": 1.7, "crit_low": 0.3, "crit_high": 2.0, "sample_rate": 1},
        {"name": "motor_temp", "unit": "C", "normal_min": 40, "normal_max": 75, "warn_high": 80, "crit_high": 90, "sample_rate": 1},
        {"name": "motor_current", "unit": "A", "normal_min": 6, "normal_max": 10, "warn_high": 12, "crit_high": 14, "sample_rate": 1},
        {"name": "vibration_rms", "unit": "mm/s", "normal_min": 1.5, "normal_max": 4.5, "warn_high": 5.0, "crit_high": 7.1, "sample_rate": 1},
        {"name": "load", "unit": "kg", "normal_min": 0, "normal_max": 80, "warn_high": 95, "crit_high": 110, "sample_rate": 1},
    ],
    "motor": [
        {"name": "temperature", "unit": "C", "normal_min": 35, "normal_max": 75, "warn_high": 85, "crit_high": 95, "sample_rate": 1},
        {"name": "current", "unit": "A", "normal_min": 4, "normal_max": 12, "warn_high": 14, "crit_high": 16, "sample_rate": 1},
        {"name": "vibration_rms", "unit": "mm/s", "normal_min": 1, "normal_max": 4.5, "warn_high": 5, "crit_high": 7.1, "sample_rate": 1},
        {"name": "rpm", "unit": "rpm", "normal_min": 1400, "normal_max": 1500, "warn_low": 1300, "crit_low": 1200, "sample_rate": 1},
    ],
    "pump": [
        {"name": "discharge_pressure", "unit": "bar", "normal_min": 3, "normal_max": 6, "warn_low": 2.5, "warn_high": 6.5, "crit_low": 2, "crit_high": 7.5, "sample_rate": 1},
        {"name": "flow_rate", "unit": "m3/h", "normal_min": 20, "normal_max": 40, "warn_low": 15, "crit_low": 10, "sample_rate": 1},
        {"name": "bearing_temp", "unit": "C", "normal_min": 30, "normal_max": 65, "warn_high": 75, "crit_high": 85, "sample_rate": 1},
        {"name": "vibration_rms", "unit": "mm/s", "normal_min": 1, "normal_max": 4, "warn_high": 4.5, "crit_high": 7.1, "sample_rate": 1},
    ],
    "compressor": [
        {"name": "outlet_pressure", "unit": "bar", "normal_min": 6, "normal_max": 8, "warn_low": 5.5, "warn_high": 8.5, "crit_low": 5, "crit_high": 9.5, "sample_rate": 1},
        {"name": "oil_temp", "unit": "C", "normal_min": 60, "normal_max": 85, "warn_high": 95, "crit_high": 105, "sample_rate": 1},
        {"name": "motor_current", "unit": "A", "normal_min": 20, "normal_max": 45, "warn_high": 50, "crit_high": 58, "sample_rate": 1},
        {"name": "vibration_rms", "unit": "mm/s", "normal_min": 1, "normal_max": 4.5, "warn_high": 5, "crit_high": 7.1, "sample_rate": 1},
    ],
    "hopper": [
        {"name": "feed_rate", "unit": "items/min", "normal_min": 30, "normal_max": 60, "warn_high": 70, "crit_high": 80, "sample_rate": 1},
        {"name": "hopper_level", "unit": "%", "normal_min": 20, "normal_max": 95, "warn_low": 15, "crit_low": 5, "sample_rate": 1},
        {"name": "vibration_rms", "unit": "mm/s", "normal_min": 1, "normal_max": 4, "warn_high": 5, "crit_high": 7, "sample_rate": 1},
    ],
    "sealer": [
        {"name": "seal_temp", "unit": "C", "normal_min": 150, "normal_max": 180, "warn_low": 140, "warn_high": 190, "crit_low": 130, "crit_high": 200, "sample_rate": 1},
        {"name": "cycle_time", "unit": "s", "normal_min": 1.5, "normal_max": 2.5, "warn_high": 3, "crit_high": 4, "sample_rate": 1},
        {"name": "items_packed", "unit": "count", "normal_min": 0, "normal_max": 100000, "sample_rate": 1},
    ],
    "inspection": [
        {"name": "item_weight", "unit": "g", "normal_min": 480, "normal_max": 520, "warn_low": 470, "warn_high": 530, "crit_low": 450, "crit_high": 550, "sample_rate": 1},
        {"name": "reject_rate", "unit": "%", "normal_min": 0, "normal_max": 2, "warn_high": 4, "crit_high": 8, "sample_rate": 1},
    ],
}

GENERIC_KNOWLEDGE = [
    {"title": "7.3 Bearing inspection", "page": 42, "kind": "maintenance", "text": "Rising vibration followed by bearing temperature indicates wear. Check housing temperature with an IR thermometer; above 90 °C stop and replace. Re-grease every 2000 h."},
    {"title": "8.1 Troubleshooting: motor overheating", "page": 51, "kind": "troubleshooting", "text": "If temperature rises while current and vibration stay normal, check the cooling fan and shroud for blockage. If current also rises, check load and belt tension."},
    {"title": "8.2 Troubleshooting: belt slip", "page": 52, "kind": "troubleshooting", "text": "Belt speed drops while motor current falls: low tension or glazed drum. Re-tension to spec and inspect the drum surface."},
    {"title": "3.2 Safety", "page": 9, "kind": "safety", "text": "Isolate and lock out the drive before touching rotating parts. Only qualified personnel may open the motor housing."},
]


def _template_spec(filename: str, hint_type: str | None) -> ExtractedSpec:
    name = Path(filename).stem.replace("_", " ").replace("-", " ").title()
    mtype = hint_type or next((k for k in TEMPLATES if k in filename.lower()), "conveyor")
    params = [ExtractedParameter(**p, source_page=None, source_snippet="template default — verify against the manual", confidence=0.35) for p in TEMPLATES.get(mtype, TEMPLATES["conveyor"])]
    return ExtractedSpec(
        machine_name=name or "New machine", machine_type=mtype, parameters=params,
        knowledge=[KnowledgeSection(**k) for k in GENERIC_KNOWLEDGE],
        notes="Gemini is not configured (GOOGLE_API_KEY). These are type defaults, clearly marked; verify every value before going live.",
    )


def extract(file_bytes: bytes, filename: str, mime: str, hint_type: str | None = None) -> tuple[dict[str, Any], str]:
    """Returns (spec dict, source) where source is 'gemini' or 'template'."""
    if settings.gemini_enabled:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client()
            prompt = (
                "You are reading a machine manual or datasheet for a factory monitoring platform. Extract every monitorable "
                "parameter with its unit, normal operating range, warning and critical limits (low and/or high) exactly as the "
                "document states them. For each value give the page number and the exact snippet it came from, and a confidence 0–1. "
                "Do not invent limits: if the document has no limit for a parameter, leave it null with low confidence. Also extract "
                "the troubleshooting, maintenance and safety sections as short knowledge passages with page numbers."
            )
            resp = client.models.generate_content(
                model=settings.gemini_model_fast,
                contents=[types.Part.from_bytes(data=file_bytes, mime_type=mime), prompt],
                config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=ExtractedSpec),
            )
            spec = ExtractedSpec.model_validate(json.loads(resp.text or "{}"))
            return spec.model_dump(), "gemini"
        except Exception as e:  # noqa: BLE001
            spec = _template_spec(filename, hint_type)
            spec.notes = f"Gemini extraction failed ({e}); showing type defaults. Verify every value."
            return spec.model_dump(), "template"
    return _template_spec(filename, hint_type).model_dump(), "template"
