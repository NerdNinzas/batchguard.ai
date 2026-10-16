"""BatchGuard AI backend — FastAPI. Run: uvicorn app.main:app --reload --port 8000"""

import asyncio
import contextlib
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import bus, cloud, demo, incidents
from .config import settings
from .db import conn, init_db, tx
from .routers import auth, device, incidents as incidents_router, machines, misc, orgs, voice
from .voice import calls as voice_calls


async def _sweeper() -> None:
    tick = 0
    while True:
        try:
            await asyncio.to_thread(incidents.staleness_sweep)
            await asyncio.to_thread(incidents.escalation_sweep)
            if tick % 3 == 0:  # every 15 s: pull outcomes of voice calls still in flight
                await asyncio.to_thread(voice_calls.poll_pending)
        except Exception as e:  # noqa: BLE001
            print("sweeper error:", e)
        tick += 1
        await asyncio.sleep(5)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    bus.bind_loop(asyncio.get_running_loop())
    cloud.setup_logging()
    # investigations that were in flight when the previous process stopped can never finish
    with tx() as c:
        c.execute("UPDATE agent_runs SET finished_at=?, ok=0, error='interrupted by restart' WHERE finished_at IS NULL", (time.time(),))
    task = asyncio.create_task(_sweeper())
    if settings.demo_mode:
        await asyncio.to_thread(demo.ensure_seeded)
        demo.start_producer()
    print(f"BatchGuard backend ready · gemini={('vertex:' + settings.google_cloud_location) if settings.google_genai_use_vertexai and settings.gemini_enabled else 'on' if settings.gemini_enabled else 'off (fallback)'} · gcp={settings.gcp_project or 'off'} · email={'resend' if settings.email_enabled else 'simulated'} · voice={'dograh' if settings.voice_enabled else 'off'} · db={settings.db_file}")
    yield
    task.cancel()


app = FastAPI(title="BatchGuard AI", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[settings.app_url, "http://localhost:3000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def api_log(request: Request, call_next):
    t0 = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as e:  # noqa: BLE001
        response = JSONResponse({"detail": str(e)}, status_code=500)
    ms = (time.perf_counter() - t0) * 1000
    path = request.url.path
    if path.startswith(("/v1/", "/api/")) and path != "/api/stream":
        try:
            with tx() as c:
                c.execute("INSERT INTO api_logs (ts, route, method, status, ms) VALUES (?,?,?,?,?)", (time.time(), path, request.method, response.status_code, round(ms, 2)))
        except Exception:  # noqa: BLE001
            pass
    return response


for r in (auth.router, orgs.router, machines.router, device.router, incidents_router.router, misc.router, voice.router):
    app.include_router(r)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "gemini": settings.gemini_enabled, "email": settings.email_enabled, "smtp": False, "demo": settings.demo_mode, "vertex": settings.google_genai_use_vertexai, "voice": settings.voice_enabled, "cloud": cloud.status(), "machines": conn().execute("SELECT COUNT(*) n FROM machines").fetchone()["n"]}
