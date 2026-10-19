"""Thin client for the self-hosted Dograh voice-AI platform.

Everything goes through the backend so the X-API-Key never reaches the browser (the Vite reference app
`ecoforge-voice-dograh` proxied `/dograh-api` → `${DOGRAH_BASE_URL}`; here `DOGRAH_BASE_URL` is read directly).
"""

from typing import Any

import requests

from ..config import settings


class DographError(RuntimeError):
    pass


def enabled() -> bool:
    return settings.voice_enabled


def host() -> str:
    return settings.dograh_base_url.split("/api/")[0].replace("https://", "").replace("http://", "")


def _req(method: str, path: str, json: Any = None, params: dict[str, Any] | None = None, timeout: int = 30) -> Any:
    if not enabled():
        raise DographError("Voice AI is not configured: set DOGRAH_API_KEY in backend/.env")
    url = settings.dograh_base_url.rstrip("/") + path
    try:
        r = requests.request(method, url, headers={"X-API-Key": settings.dograh_api_key, "Content-Type": "application/json"}, json=json, params=params, timeout=timeout)
    except requests.RequestException as e:
        raise DographError(f"Dograh unreachable: {e}") from e
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail")
        except Exception:  # noqa: BLE001
            detail = r.text[:300]
        raise DographError(f"Dograh {r.status_code}: {detail}")
    if not r.content:
        return None
    return r.json()


# ---------- workflows ----------
def list_workflows() -> list[dict[str, Any]]:
    d = _req("GET", "/workflow/fetch")
    return d if isinstance(d, list) else (d or {}).get("workflows", [])


def get_workflow(workflow_id: int) -> dict[str, Any]:
    return _req("GET", f"/workflow/fetch/{workflow_id}")


def workflow_configurations() -> dict[str, Any]:
    """Per-call limits Dograh enforces on its side: hard hang-up at max_call_duration, and end after max_user_idle_timeout
    seconds of silence from the person. Keeps Gemini Live minutes (and TeleCMI minutes) bounded per call."""
    return {"max_call_duration": int(settings.voice_max_call_seconds), "max_user_idle_timeout": float(settings.voice_user_idle_seconds)}


def create_workflow(name: str, definition: dict[str, Any]) -> dict[str, Any]:
    wf = _req("POST", "/workflow/create/definition", {"name": name, "workflow_definition": definition})
    try:  # the create endpoint takes no configurations; set them right after
        _req("PUT", f"/workflow/{int(wf['id'])}", {"name": name, "workflow_definition": definition, "workflow_configurations": workflow_configurations()})
    except Exception as e:  # noqa: BLE001
        print("dograh: could not set workflow configurations on create:", e)
    return wf


def update_workflow(workflow_id: int, name: str, definition: dict[str, Any]) -> dict[str, Any]:
    return _req("PUT", f"/workflow/{workflow_id}", {"name": name, "workflow_definition": definition, "workflow_configurations": workflow_configurations()})


def publish_workflow(workflow_id: int) -> Any:
    return _req("POST", f"/workflow/{workflow_id}/publish")


# ---------- telephony (TeleCMI lives here as an `ari` SIP configuration) ----------
def telephony_configs() -> list[dict[str, Any]]:
    return (_req("GET", "/organizations/telephony-configs") or {}).get("configurations", [])


def phone_numbers(config_id: int) -> list[dict[str, Any]]:
    return (_req("GET", f"/organizations/telephony-configs/{config_id}/phone-numbers") or {}).get("phone_numbers", [])


# ---------- calls ----------
def trigger_call(workflow_uuid: str, phone: str, initial_context: dict[str, Any] | None, config_id: int | None, from_phone_number_id: int | None, draft: bool = False) -> dict[str, Any]:
    body: dict[str, Any] = {"phone_number": phone}
    if initial_context:
        body["initial_context"] = initial_context
    if config_id:
        body["telephony_configuration_id"] = config_id
    if from_phone_number_id:
        body["from_phone_number_id"] = from_phone_number_id
    path = f"/public/agent/{'test/' if draft else ''}workflow/{workflow_uuid}"
    return _req("POST", path, body, timeout=60)


def run_detail(workflow_id: int, run_id: int) -> dict[str, Any]:
    return _req("GET", f"/workflow/{workflow_id}/runs/{run_id}")


def list_runs(page: int = 1, limit: int = 20) -> dict[str, Any]:
    return _req("GET", "/organizations/usage/runs", params={"page": page, "limit": limit}) or {"runs": []}


def signed_url(key: str, inline: bool = False) -> str:
    return (_req("GET", "/s3/signed-url", params={"key": key, "inline": str(inline).lower()}) or {}).get("url", "")


def fetch_text(url: str, limit: int = 20000) -> str:
    """Download a transcript (public download URL or signed URL)."""
    try:
        r = requests.get(url, headers={"X-API-Key": settings.dograh_api_key}, timeout=30)
        if r.status_code >= 400:
            return ""
        return r.text[:limit]
    except requests.RequestException:
        return ""
