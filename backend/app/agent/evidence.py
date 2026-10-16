"""Photo as evidence: a technician's photo is read by Gemini (vision) against the incident's ranked causes and
becomes evidence lines on the report, so the diagnosis is grounded in what was actually seen at the machine."""

import json
from pathlib import Path
from typing import Any

from .. import bus, cloud
from ..config import settings
from ..db import conn, j, row, rows, tx, uj
from ..ids import new_id, now

EVIDENCE_DIR = "evidence"


def _analysis_prompt(inc: dict[str, Any], m: dict[str, Any], caption: str) -> str:
    report = uj(inc.get("report"), {}) or {}
    causes = [c.get("name") for c in report.get("causes") or []]
    checks = [c.get("action") for c in sorted(report.get("checks") or [], key=lambda c: c.get("order", 99))]
    return (
        f"You are Muse, a factory-maintenance investigator. A technician photographed machine '{m.get('name')}' "
        f"({m.get('type')}) during incident '{inc.get('title')}' (severity {inc.get('severity')}).\n"
        f"Technician caption: {caption or '(none)'}\n"
        f"Ranked causes under investigation: {json.dumps(causes)}\n"
        f"Recommended checks: {json.dumps(checks[:4])}\n\n"
        "Look at the photo and report ONLY what is visibly supported. Do not invent readings or numbers. Return JSON:\n"
        "{\n"
        '  "description": "one or two sentences of what the photo shows",\n'
        '  "observations": ["short visible facts: discoloration, leaks, wear, debris, misalignment, loose parts, gauge readings if legible"],\n'
        '  "findings": [{"cause": "<one of the ranked causes, exact text>", "supports": true|false, "rationale": "why the photo supports or contradicts it"}],\n'
        '  "safety_flags": ["hazards visible in the photo, e.g. missing guard, exposed wiring, hot surface"],\n'
        '  "confidence": "high|medium|low",\n'
        '  "relevant": true|false  // false if the photo does not show the machine or is unusable\n'
        "}\n"
    )


def analyze_photo(data: bytes, mime: str, inc: dict[str, Any], m: dict[str, Any], caption: str) -> dict[str, Any]:
    if not settings.gemini_enabled:
        return {"description": "Gemini not configured — photo stored without analysis.", "observations": [], "findings": [], "safety_flags": [], "confidence": "low", "relevant": True, "model": None}
    from google import genai
    from google.genai import types

    client = genai.Client()
    resp = client.models.generate_content(
        model=settings.gemini_model_fast,
        contents=[types.Part.from_bytes(data=data, mime_type=mime), _analysis_prompt(inc, m, caption)],
        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.2),
    )
    out = json.loads(resp.text or "{}")
    out["model"] = settings.gemini_model_fast
    return out


def _merge_into_report(inc: dict[str, Any], ev: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any] | None:
    """Append photo observations to the matching causes' evidence lists; keep a photo_evidence index on the report."""
    report = uj(inc.get("report"), None)
    if not report:
        return None
    tag = f"photo:{ev['id']}"
    for c in report.get("causes") or []:
        c["evidence_for"] = [e for e in c.get("evidence_for") or [] if e.get("source") != tag]
        c["evidence_against"] = [e for e in c.get("evidence_against") or [] if e.get("source") != tag]
    for f in analysis.get("findings") or []:
        name = str(f.get("cause") or "").strip().lower()
        for c in report.get("causes") or []:
            if name and (name == c.get("name", "").lower() or name in c.get("name", "").lower() or c.get("name", "").lower() in name):
                line = {"observation": f"Photo: {f.get('rationale') or analysis.get('description', '')}", "supports": bool(f.get("supports")), "parameter": None, "value": None, "source": tag}
                (c.setdefault("evidence_for", []) if f.get("supports") else c.setdefault("evidence_against", [])).append(line)
                break
    idx = [x for x in report.get("photo_evidence") or [] if x.get("id") != ev["id"]]
    idx.append({"id": ev["id"], "caption": ev.get("caption"), "description": analysis.get("description"), "confidence": analysis.get("confidence"), "safety_flags": analysis.get("safety_flags") or []})
    report["photo_evidence"] = idx
    return report


def add_photo(inc: dict[str, Any], data: bytes, filename: str, mime: str, caption: str, by: str) -> dict[str, Any]:
    m = row(conn().execute("SELECT * FROM machines WHERE id=?", (inc["machine_id"],)).fetchone()) or {}
    eid = new_id("evd")
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in (filename or "photo.jpg"))[:80]
    local_dir = settings.upload_path / EVIDENCE_DIR
    local_dir.mkdir(parents=True, exist_ok=True)
    path = local_dir / f"{eid}_{safe}"
    path.write_bytes(data)
    gcs_uri = cloud.upload_blob(f"evidence/{inc['org_id']}/{inc['id']}/{eid}_{safe}", data, mime)
    try:
        analysis = analyze_photo(data, mime, inc, m, caption)
    except Exception as e:  # noqa: BLE001
        analysis = {"description": f"Analysis failed: {e}", "observations": [], "findings": [], "safety_flags": [], "confidence": "low", "relevant": True, "error": str(e)[:300]}
    ev = {"id": eid, "org_id": inc["org_id"], "incident_id": inc["id"], "machine_id": inc["machine_id"], "kind": "photo", "filename": filename, "path": str(path),
          "gcs_uri": gcs_uri, "mime": mime, "caption": caption, "analysis": j(analysis), "uploaded_by": by, "ts": now()}
    with tx() as c:
        c.execute("INSERT INTO evidence (id, org_id, incident_id, machine_id, kind, filename, path, gcs_uri, mime, caption, analysis, uploaded_by, ts) "
                  "VALUES (:id,:org_id,:incident_id,:machine_id,:kind,:filename,:path,:gcs_uri,:mime,:caption,:analysis,:uploaded_by,:ts)", ev)
        report = _merge_into_report(inc, ev, analysis)
        if report is not None:
            c.execute("UPDATE incidents SET report=? WHERE id=?", (j(report), inc["id"]))
        c.execute("INSERT INTO events (id, machine_id, type, message, severity, ts) VALUES (?,?,?,?,?,?)",
                  (new_id("evt"), inc["machine_id"], "evidence", f"Photo evidence added by {by}: {analysis.get('description', '')[:140]}", "info", now()))
    inc2 = row(conn().execute("SELECT * FROM incidents WHERE id=?", (inc["id"],)).fetchone())
    bus.publish(inc["org_id"], "incident", {**inc2, "signals": uj(inc2["signals"], []), "report": uj(inc2["report"], None)})
    cloud.mirror("evidence", eid, {**ev, "analysis": analysis})
    return public(ev)


def public(ev: dict[str, Any]) -> dict[str, Any]:
    e = dict(ev)
    e["analysis"] = uj(e.get("analysis"), {}) if isinstance(e.get("analysis"), str) else e.get("analysis") or {}
    e["url"] = f"/api/evidence/{e['id']}/file"
    e.pop("path", None)
    return e


def list_for_incident(incident_id: str) -> list[dict[str, Any]]:
    return [public(e) for e in rows(conn().execute("SELECT * FROM evidence WHERE incident_id=? ORDER BY ts", (incident_id,)).fetchall())]


def file_bytes(ev: dict[str, Any]) -> bytes | None:
    p = Path(ev["path"]) if ev.get("path") else None
    if p and p.exists():
        return p.read_bytes()
    if ev.get("gcs_uri"):
        return cloud.download_blob(ev["gcs_uri"])
    return None


def context_lines(incident_id: str) -> list[str]:
    """Photo findings as text for the investigation / ask prompts."""
    out = []
    for e in list_for_incident(incident_id):
        a = e["analysis"]
        if not a or a.get("relevant") is False:
            continue
        obs = "; ".join(a.get("observations") or [])
        out.append(f"Technician photo ({e.get('caption') or 'no caption'}): {a.get('description', '')} Observations: {obs or 'none'}."
                   + (f" Safety: {', '.join(a['safety_flags'])}." if a.get("safety_flags") else ""))
    return out
