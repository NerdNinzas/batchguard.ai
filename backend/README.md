# BatchGuard backend (FastAPI + Google ADK)

```bash
cd backend
uv venv --python 3.12 .venv            # or: python3.12 -m venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env                   # set AUTH_SECRET; everything else is optional
.venv/bin/uvicorn app.main:app --reload --port 8000
```

The Next.js dev server proxies `/api/*` and `/v1/*` here (see `next.config.ts`), so the browser only ever talks to `localhost:3000`.

## Layout

```
app/
  main.py            FastAPI app, CORS, API log middleware, staleness + escalation sweeper
  config.py          settings from .env (Gemini, SMTP, Firebase, tuning)
  db.py              SQLite schema + helpers (Firestore/BigQuery adapters replace these later)
  auth.py            scrypt passwords, JWT session cookie, device-key hashing, Firebase ID-token verify
  detection.py       limits · trend (linear fit → time-to-limit) · anomaly (z-score) · health score
  incidents.py       open/attach with cooldown & grouping, severity ladder, ack/resolve, escalation + staleness sweeps
  notify.py          in-app + email (SMTP or simulated) + voice (Dograh → Gemini Live realtime → TeleCMI; auto-dial per org)
  voice/             dograh.py client · calls.py (call types, context from the report, outcomes → incident) · workflows/*.json (5 Dograh call flows)
  bus.py             in-process pub/sub → SSE (/api/stream)
  cloud.py           Firestore mirror · Pub/Sub→BigQuery · BigQuery history · Cloud Storage · Cloud Logging (all fail-soft)
  demo.py            seeded demo factory + built-in telemetry producer (DEMO_MODE)
  ingest.py          shared ingestion path (device API + demo producer)
  agent/
    tools.py         7 ADK function tools (readings, baseline, events, neighbours, manual, history, correlation)
    adk_agent.py     6-stage SequentialAgent (context_builder → retriever → hypothesis_generator → evaluator →
                     recommender → reporter) sharing session state; schema-validated IncidentReport; tool-grounded "ask"
    fallback.py      rule-based investigator on the same tools (used when Gemini is off / fails twice)
    schema.py        IncidentReport pydantic schema + number guardrail
    runner.py        orchestration: pick agent, guardrail, store, broadcast
    extract.py       manual/datasheet → spec (Gemini multimodal w/ response schema, or type templates)
  routers/
    auth.py          /api/auth/{signup,login,google,logout,me}
    orgs.py          /api/org, /api/org/use-cases, /api/org/complete-onboarding, /api/contacts
    machines.py      /api/machines (+ /extract, /{id}/verify, /rotate-key, /readings, /events)
    device.py        /v1/telemetry, /v1/events, /v1/ping  (X-Device-Key)
    incidents.py     /api/incidents (+ ack, resolve, investigate, ask)
    misc.py          notifications, workflow, overview, observability, telemetry snapshots, eval, SSE
scripts/device_sample.py   reference device client with fault injection
scripts/trigger_fault.py   quick bearing-wear trigger for testing the agent pipeline
```

Without `GOOGLE_API_KEY` the rule-based investigator and template extraction run, so the whole loop works offline.
