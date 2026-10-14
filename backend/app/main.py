"""BatchGuard AI backend — FastAPI. Run: uvicorn app.main:app --reload --port 8000"""

import asyncio
import contextlib
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import bus, incidents
from .config import settings
from .db import conn, init_db, tx
from .routers import auth, device, incidents as incidents_router, machines, misc, orgs


async def _sweeper() -> None:
    while True:
        try:
            await asyncio.to_thread(incidents.staleness_sweep)
            await asyncio.to_thread(incidents.escalation_sweep)
        except Exception as e:  # noqa: BLE001
            print("sweeper error:", e)
        await asyncio.sleep(5)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    bus.bind_loop(asyncio.get_running_loop())
    task = asyncio.create_task(_sweeper())
    print(f"BatchGuard backend ready · gemini={'on' if settings.gemini_enabled else 'off (fallback)'} · smtp={'on' if settings.smtp_enabled else 'simulated'} · db={settings.db_file}")
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


for r in (auth.router, orgs.router, machines.router, device.router, incidents_router.router, misc.router):
    app.include_router(r)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "gemini": settings.gemini_enabled, "smtp": settings.smtp_enabled, "machines": conn().execute("SELECT COUNT(*) n FROM machines").fetchone()["n"]}
