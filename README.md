# BatchGuard AI

Factory monitoring with an investigating AI agent. Onboard a machine from its PDF manual, stream telemetry through a per-machine API, and let **Muse** detect problems, explain the likely cause with evidence, phone the right person, and talk to you about your factory in realtime.

Built for the **Google Cloud AI Builder Cup 2026 · Manufacturing** theme on Google ADK, Gemini 2.5, Gemini Live, Cloud Run, Firestore, Pub/Sub, BigQuery and Cloud Storage.

- **Live demo:** https://batchguard.web.app — sign in with `demo@batchguard.ai` / `demo1234`
- **The idea and the problem:** [IDEA.md](IDEA.md)
- **How it is built, end to end:** [SOLUTION.md](SOLUTION.md)

---

## What you get

| Area | Highlights |
|---|---|
| Onboarding | PDF manual → Gemini extracts parameters, limits and knowledge with page citations → you verify → device key + code samples |
| Detection | Limits, trend (time-to-limit), anomaly (z-score vs own baseline), staleness; runs on every reading without an LLM |
| Forecast | Predicted time to warning / critical per parameter, on machine cards and charts |
| Investigation | Google ADK pipeline (parallel evidence gathering → hypotheses → evaluation → checks → report) with a number guardrail |
| Escalation | Dashboard → email (Resend, Muse templates) → voice call (Gemini Live over TeleCMI via Dograh) → next contact until acknowledged |
| Auto-shutdown | If a critical incident is not acknowledged and no call is answered within the window (default 5 min), Muse sends the machine a `shutdown` command, with a live countdown on the incident and overview; restart from the machine page after a check |
| Action | Photo evidence read by Gemini vision, work-order Kanban per machine, feedback loop on resolution |
| Muse copilot | ChatGPT-style streaming chat, realtime Indian-English voice, and voice/chat navigation that spotlights any part of the dashboard |
| Visibility | Live 3D factory, workflow node builder, telemetry table, observability, blind evaluation scoreboard |
| Simulator | Separate virtual factory app that streams telemetry into the demo account: dial parameters, inject faults, add machines, watch Muse react |

---

## Repository layout

```
batchguard/
├── src/                      Next.js 16 frontend
│   ├── app/                  landing, login/signup, onboarding, /app/* dashboard pages
│   ├── components/app/       Shell (sidebar, notifications), charts, WorkOrders, PhotoEvidence, KeyReveal
│   ├── components/muse/      MuseLive (chat + voice runtime), MuseConsole (Ask Muse), MuseChip/Guide/Face
│   ├── components/three/     3D factory (R3F), Muse character, HUD
│   └── lib/                  api.ts (typed client, SSE hook), firebase.ts, machineTypes.ts
├── backend/                  FastAPI + Google ADK (Python 3.12)
│   ├── app/main.py           app, lifespan (sweepers, demo producer), routers
│   ├── app/detection.py      limits / trend / anomaly / forecast
│   ├── app/ingest.py         shared ingestion path (/v1/telemetry + demo producer)
│   ├── app/incidents.py      incident lifecycle, severity ladder, escalation sweep
│   ├── app/notify.py         in-app, email (Resend), voice channels
│   ├── app/mail.py           Resend client + Muse email templates
│   ├── app/cloud.py          Firestore / Pub/Sub / BigQuery / GCS / Logging adapters (fail-soft)
│   ├── app/agent/            adk_agent.py (pipeline), tools.py, schema.py, runner.py, fallback.py,
│   │                         extract.py (PDF), evidence.py (photos), muse_live.py (copilot + Gemini Live)
│   ├── app/voice/            dograh.py client, calls.py (call types, outcomes), scenarios.json, workflows/*.json
│   ├── app/routers/          auth, orgs, machines, device, incidents, misc, voice, work_orders, muse
│   ├── scripts/              device_sample.py (reference device), trigger_fault.py
│   └── Dockerfile
├── public/                   models (Kenney factory kit), HDRIs, machine photos (credits.json), logos, Muse renders
├── Dockerfile                frontend image (standalone Next.js)
├── cloudbuild.frontend.yaml  Cloud Build config for the frontend
└── deploy.sh                 ./deploy.sh [backend|frontend|all]
```

---

## Run locally

Prerequisites: Node 22+, Python 3.12, a Google Cloud project with Vertex AI enabled (or an AI Studio key), `gcloud` authenticated.

```bash
# 1. backend
cd backend
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # fill in the values below
.venv/bin/uvicorn app.main:app --reload --port 8000

# 2. frontend (new terminal, repo root)
npm install
cp .env.example .env.local      # BACKEND_URL=http://localhost:8000
npm run dev                     # http://localhost:3000
```

Sign in with `demo@batchguard.ai` / `demo1234`. Demo mode seeds a packaging line with six machines and runs a bearing-wear fault cycle on the conveyor every 30 minutes, so incidents, reports and escalations appear on their own.

### Backend environment (`backend/.env`)

| Variable | Purpose |
|---|---|
| `APP_URL`, `AUTH_SECRET`, `DATABASE_PATH`, `UPLOAD_DIR` | app basics |
| `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION=global` | Gemini on Vertex AI (or `GOOGLE_API_KEY` for AI Studio) |
| `GEMINI_MODEL_FAST`, `GEMINI_MODEL_PRO` | `gemini-2.5-flash`, `gemini-2.5-pro` |
| `GEMINI_LIVE_MODEL`, `GEMINI_LIVE_LOCATION`, `GEMINI_LIVE_VOICE`, `GEMINI_LIVE_LANGUAGE` | Muse realtime voice (`gemini-live-2.5-flash-native-audio`, `us-central1`, `Kore`, `en-IN`) |
| `GCP_PROJECT`, `GCP_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`, `FIRESTORE_DATABASE`, `BIGQUERY_DATASET`, `GCS_BUCKET`, `PUBSUB_TOPIC_TELEMETRY`, `CLOUD_LOGGING` | Google Cloud data services (all fail-soft when empty) |
| `FIREBASE_PROJECT_ID` | verify Google sign-in tokens |
| `RESEND_API_KEY`, `RESEND_FROM`, `EMAIL_ASSET_BASE` | email; empty key → emails recorded as "simulated" |
| `DOGRAH_BASE_URL`, `DOGRAH_API_KEY`, `DOGRAH_TELEPHONY_CONFIG_ID`, `DOGRAH_FROM_PHONE_NUMBER_ID`, `VOICE_AUTO_DIAL` | phone escalation through Dograh + TeleCMI |
| `DEMO_MODE`, `STALE_AFTER_SECONDS`, `INCIDENT_COOLDOWN_SECONDS`, `ESCALATION_TIMEOUT_SECONDS`, `TREND_WINDOW_SECONDS` | demo and detection tuning |

### Frontend environment (`.env.local`)

`BACKEND_URL` (proxy target for `/api/*` and `/v1/*`), `NEXT_PUBLIC_BACKEND_URL` (backend origin the browser uses for the live stream, chat and voice websocket), `NEXT_PUBLIC_FIREBASE_*` (Google sign-in button; optional).

---

## Connect a machine

After onboarding, each machine page shows its endpoint, key and code samples. The minimum:

```bash
curl -X POST http://localhost:8000/v1/telemetry \
  -H "X-Device-Key: bg_live_..." -H "Content-Type: application/json" \
  -d '{"device_id":"main-conveyor-41y","readings":[{"parameter":"motor_temp","value":71.2,"unit":"C"}]}'
```

Readings are validated against the verified spec (unknown parameters and mismatched units are rejected), de-duplicated by `reading_id`, and answered with the detection signals they produced. Devices also poll `GET /v1/commands?device_id=…` (same key) for `shutdown` / `start` commands and acknowledge them with `POST /v1/commands/{id}/ack`; the virtual simulator does this every 3 s. `backend/scripts/device_sample.py` is a reference device; `trigger_fault.py` injects a bearing-wear ramp.

---

## Muse copilot

On the overview, **Ask Muse** gives a live greeting and a chat that streams token by token. Press the round voice button to talk to Muse in realtime (Gemini Live, Indian English). Ask for anything on the dashboard and Muse navigates there and highlights it in yellow while it keeps talking:

- "How is production running right now?"
- "Take me to the most urgent incident"
- "Show me the compressor's pressure chart"
- "Where are the work orders for the main conveyor?"
- "Open the email settings"

The voice websocket connects straight to the backend origin, so the browser must be able to reach `NEXT_PUBLIC_BACKEND_URL` (defaults to `http://localhost:8000`).

---

## Voice escalation (phone)

`/app/voice` lists five call types as Dograh workflows (JSON in `backend/app/voice/workflows`), lets you pick a TeleCMI caller number, publish the workflows, place a test call with a condition preset, and review call history with transcripts, recordings and the extracted outcome. An acknowledgement spoken on the call acknowledges the incident; a follow-up call's verdict resolves it. Auto-dial is per organisation and off by default.

---

## Virtual factory simulator

A separate app (`simulator/`, its own Cloud Run service and Hosting site: **https://batchguard-sim.web.app**) that behaves like a real plant's PLC gateway for the demo account. It signs in as the demo owner, obtains a device key per machine, and streams telemetry to `POST /v1/telemetry` every second, exactly like a device would. The 3D factory on the page is the simulated plant; the control panel lets you:

- drag any parameter to a target value over a chosen ramp time (temperature, vibration, pressure, flow…),
- inject fault presets (bearing wear, overload, belt slip, pressure drop, cavitation, seal overheat, feed starvation, reject spike, slow drift),
- stop a machine (telemetry stops → BatchGuard marks it stale) and start it again,
- change production speed, add machines of any type (they are onboarded into BatchGuard with template limits) or remove them,
- watch what BatchGuard said back for each post (detected signals) in the live log.

Run it locally with the backend's built-in producer turned off (`DEMO_PRODUCER=false` in `backend/.env`):

```bash
cd simulator && npm install && cp .env.example .env.local && npm run dev   # http://localhost:3002
```

Deploy with `./deploy.sh simulator` (always-on single instance; `all` deploys backend, frontend and simulator).

---

## Deploy to Google Cloud

```bash
# one-time
gcloud auth login && gcloud config set project <PROJECT>
printf '%s' "$DOGRAH_API_KEY" | gcloud secrets create batchguard-dograh-key --data-file=-
printf '%s' "$RESEND_API_KEY" | gcloud secrets create batchguard-resend-key --data-file=-   # optional
echo <PROJECT> > backend/.gcp-project

# every release
./deploy.sh all          # backend (always-on, 1 instance, session affinity) then frontend (scale-to-zero)
```

`deploy.sh` builds both images with Cloud Build, pushes to Artifact Registry, deploys to Cloud Run, wires the frontend to the backend URL and the backend to the public app URL. A $100 budget alert is set on the project.

> **Data:** SQLite is the primary database and it persists on Cloud Run: a consistent snapshot (last hour of readings; BigQuery keeps the full history) is uploaded to Cloud Storage every minute when something changed and on shutdown, with hourly backups, and a fresh container restores the latest snapshot before serving. Firestore mirrors the collections other clients care about (machines with live state, incidents and reports, notifications, work orders, evidence, voice calls) within seconds via SQLite triggers.

---

## Testing and quality

```bash
npm run lint && npx tsc --noEmit && npm run build     # frontend
cd backend && .venv/bin/python -m compileall app        # backend
```

Blind evaluation: on Settings, record an injected fault, run `trigger_fault.py`, and the scoreboard reports detection, delay and top-1/top-3 cause accuracy for the first report that follows.

---

## Credits

Kenney Factory Kit (CC0) · Poly Haven HDRIs and textures (CC0) · machine photos from Wikimedia Commons (see `public/machines/credits.json`) · Simple Icons.

BatchGuard AI is advisory only. Recommendations are for qualified personnel following site safety and lockout procedures.

## Keeping the demo warm (no cold starts)

All three Cloud Run services (`batchguard-backend`, `batchguard-frontend`, `batchguard-simulator`) run with `--min-instances 1`, `--no-cpu-throttling` and `--cpu-boost`, so there is always a hot instance. On top of that:

- **Cloud Scheduler** jobs `keepalive-*` ping each service and both Hosting sites every minute (`./deploy.sh keepalive` creates or updates them).
- The always-on backend pings the dashboard and simulator every 30 s (`KEEPALIVE_URLS`, set in `deploy.sh`).

When the demo is over, tear it down in this order:

```bash
./deploy.sh keepalive-off                                   # remove the scheduler jobs
gcloud run services delete batchguard-simulator --region asia-southeast1
gcloud run services delete batchguard-frontend  --region asia-southeast1
gcloud run services delete batchguard-backend   --region asia-southeast1   # last: it snapshots SQLite to Cloud Storage on shutdown
```
