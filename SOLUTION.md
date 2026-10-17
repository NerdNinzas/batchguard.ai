# BatchGuard AI — how the solution is built

This document explains the architecture, every technology in use, and the complete flow from a PDF manual to a phone call and back.

---

## 1. Architecture at a glance

```
                    ┌──────────────────────────────── Google Cloud (asia-southeast1 / us-central1) ───────────────────────────────┐
                    │                                                                                                            │
  Browser ──HTTPS──▶│  Cloud Run: batchguard-frontend (Next.js 16)                                                               │
   │                │      /api/* and /v1/* rewritten to ─────▶  Cloud Run: batchguard-backend (FastAPI, always-on, 1 instance)   │
   │  wss (voice)   │                                                │   ├── SQLite (hot path) ── mirrored ──▶ Firestore          │
   └───────────────▶│                                                │   ├── Pub/Sub topic `telemetry` ──▶ BigQuery batchguard.telemetry
                    │                                                │   ├── Cloud Storage (manuals, photo evidence)             │
                    │                                                │   ├── Secret Manager (auth secret, Dograh key, Resend key)│
                    │                                                │   ├── Cloud Logging                                        │
                    │                                                │   ├── Vertex AI · Gemini 2.5 Flash / Pro  (ADK agent,       │
                    │                                                │   │        PDF extraction, vision, call outcomes, chat)     │
                    │                                                │   └── Vertex AI · Gemini Live native audio (Muse voice)    │
                    └────────────────────────────────────────────────┼───────────────────────────────────────────────────────────┘
                                                                     │
   Machines / devices ──POST /v1/telemetry (X-Device-Key)────────────┘
   Dograh (self-hosted voice platform) ──TeleCMI SIP trunk──▶ contact's phone      Resend ──▶ email
```

Two deployable units, one repository:

- **Frontend** — Next.js 16 App Router, Tailwind v4, framer-motion, React Three Fiber (3D factory), React Flow (node builder), recharts. Proxies the API to the backend at build time; connects directly to the backend for the voice websocket.
- **Backend** — Python 3.12, FastAPI, Google ADK, google-genai (Vertex AI), SQLite, SSE event bus. Runs the detection engine, the agent pipeline, escalation, voice relay and all Google Cloud adapters.

---

## 2. Technology map

| Layer | What | Why |
|---|---|---|
| UI | Next.js 16, React 19, Tailwind v4, framer-motion, lucide | Fast to build, server-rendered shell, animation for Muse |
| 3D | three.js 0.182, @react-three/fiber, drei, Kenney Factory Kit + Poly Haven HDRI/PBR (CC0) | Live 3D hall that reflects machine status |
| Graphs | @xyflow/react (workflow builder, Dograh call-flow viewer), recharts | Node builder for the line; charts with limit bands |
| API | FastAPI + uvicorn, pydantic v2, sse-starlette | Typed, async, streaming |
| Data | SQLite primary (WAL, serialised writes), persisted by snapshots to Cloud Storage (every minute when dirty + on shutdown, hourly backups, restore on a fresh container); Firestore mirrors live state and audit collections via SQLite triggers; BigQuery keeps every reading | Relational/time-series queries stay fast; durable on Cloud Run; Firestore ready for realtime listeners, mobile and integrations |
| Cloud data | Firestore (mirror of orgs, machines, incidents, contacts, notifications, evidence, work orders), Pub/Sub → BigQuery (every reading), Cloud Storage (manuals, photos) | Durable Google data layer and analytics |
| AI | Vertex AI Gemini 2.5 Flash (fast paths) and Pro (reasoning), via `google-genai` | Extraction, vision, chat, outcomes |
| Agent | Google ADK 2.x: `SequentialAgent` of a `ParallelAgent` (evidence gathering) → hypothesis generator → evaluator → recommender → reporter, 7 function tools | Evidence-first diagnosis with traceable tool calls |
| Voice out | Dograh (self-hosted) running Gemini Live over a TeleCMI SIP trunk; workflows defined as JSON | Phone escalation with transcript, recording, extraction |
| Voice in | Gemini Live native audio (`gemini-live-2.5-flash-native-audio`, us-central1), Kore voice, `en-IN` | Realtime Indian-English copilot with tool calling |
| Email | Resend HTTPS API, Muse-branded HTML templates | Alerts, reports, call summaries, digest, welcome |
| Auth | scrypt passwords + JWT cookie; Firebase ID-token verification for Google sign-in | Simple and stateless |
| Deploy | Cloud Build → Artifact Registry → Cloud Run (`deploy.sh`), Secret Manager, budget alert | One command, no servers |

---

## 3. Data model (SQLite tables; selected ones mirrored to Firestore)

Tables: `users`, `orgs`, `contacts` (escalation ladder with quiet hours), `lines`, `machines` (device id, key hash, manual text, knowledge sections, status, health), `parameters` (limits + source page + verified flag), `readings` (time series), `latest` (per-parameter current value, state, **forecast**), `events`, `incidents` (signals, report JSON, feedback), `notifications`, `workflows` (node builder), `api_logs`, `agent_runs` (tool calls, source, error), `chat`, `voice_settings`, `voice_calls`, `evidence` (photos + Gemini analysis), `work_orders`. Readings older than 24 h are pruned locally (BigQuery holds the full history).

**Persistence on Cloud Run:** `cloud.snapshot_db()` uses the SQLite backup API for a consistent copy, trims it to the last hour of readings, and uploads it to `gs://<bucket>/db/batchguard.db` (plus an hourly backup) every minute when something changed and on shutdown; `restore_db_if_missing()` pulls it back on a fresh container.

**Firestore mirror (selected collections):** SQLite triggers record inserts/updates/deletes of `machines`, `incidents`, `notifications`, `work_orders`, `evidence` and `voice_calls` in a `_changes` table; after each transaction they are queued and written to Firestore within ~5 s (machine heartbeats at most every 15 s), and each machine document carries its live `latest` readings map. That is the surface for realtime listeners, a future mobile app and external integrations, and an audit trail independent of the SQLite file.

---

## 4. The complete flow

### 4.1 Sign-in and onboarding
1. Email/password (`/api/auth/signup`, `/login`) or Google via Firebase (`/api/auth/google`, token verified with the project id only).
2. Muse-guided modals collect organisation, owner, phone, industry and use cases; `complete-onboarding` sends the **welcome email**.
3. Demo mode seeds `Demo Packaging Co` with six machines, three contacts, a line workflow and a built-in telemetry producer that runs a bearing-wear cycle on the conveyor every 30 minutes.

### 4.2 Onboarding a machine from its manual
1. `/app/onboard` → upload PDF → `POST /api/machines/extract`.
2. Gemini 2.5 Flash reads the PDF (multimodal) with a response schema: parameters, units, normal/warn/crit limits, sample rate, source page and snippet, confidence, plus knowledge sections (fault tables, maintenance intervals). Template fallback per machine type when Gemini is off.
3. The user reviews every row and ticks **verified**. Only verified parameters accept telemetry.
4. `POST /api/machines` stores the spec, uploads the PDF to Cloud Storage, and returns a per-machine **device key** plus code samples (curl, Python, Node) for `POST /v1/telemetry`.

### 4.3 Telemetry and detection (every reading, no LLM)
1. `POST /v1/telemetry` with `X-Device-Key` → `ingest_readings()`: validates parameter and unit against the verified spec, de-duplicates by `reading_id`, stores the reading, updates `latest`.
2. Detection layers in `detection.py`:
   - **limits** — warn/crit crossings;
   - **trend** — linear fit over the window, R² ≥ 0.6, projected to the critical limit within 10 min;
   - **anomaly** — |z| ≥ 3.5 against the machine's own baseline (2 min before the last minute);
   - **staleness** — sweeper opens an incident when a machine stops posting (30 s grace after restarts) and auto-resolves it when telemetry resumes.
3. **Forecast** — every 5 s per parameter a looser fit (R² ≥ 0.5, 24 h horizon) projects time-to-warning and time-to-critical; stored on `latest` and shown on machine cards ("reaches the critical limit in 12 min").
4. The reading is published on the SSE bus (`/api/stream`), mirrored to Firestore, and sent to Pub/Sub → BigQuery.

### 4.4 Incidents and the escalation ladder
1. `handle_signals()` groups signals into one open incident per machine with a 5-minute cooldown per parameter+layer; two warning parameters together → critical.
2. Severity ladder: info (dashboard event only) → warning (dashboard + email) → critical (dashboard + email + voice) → emergency (next contact, repeated every 2 min until acknowledged).
3. `notify.py` records every channel attempt as a notification: in-app, email (Resend template), voice (Dograh call when the org has auto-dial on; otherwise a one-click call from the incident page).

### 4.5 The investigation (Google ADK)
1. Opening or escalating an incident kicks `investigate_async()` (debounced per incident).
2. ADK pipeline (`adk_agent.py`), Gemini 2.5 Pro for reasoning, Flash for gathering:
   - **ParallelAgent gather** — tools `get_readings_window`, `get_baseline`, `get_events`, `get_neighbour_machines`, `search_manual`, `compute_correlation`, `get_incident_history`;
   - **hypothesis_generator** → 3–5 candidate causes from the signature;
   - **evaluator** → evidence for/against each, support level (strong/plausible/weak/inconclusive), missing data;
   - **recommender** → checks ordered by how well they discriminate, each with a safety note;
   - **reporter** → `IncidentReport` schema: summary, timeline, ranked causes, checks, missing data, call script (≤ 20 s), cross-machine note.
3. **Guardrail** — every number in the report must match stored readings, limits, manual pages or neighbour values (±0.5 %); otherwise it is replaced by `[unverified]` and listed.
4. Rule-based fallback investigator runs when Gemini is unavailable.
5. The report is stored, broadcast over SSE, mirrored to Firestore, and emailed (**report ready** template). "Ask Muse" on the incident page answers follow-up questions grounded in the same tools.

### 4.6 Voice escalation (Dograh → Gemini Live → TeleCMI)
1. Five call types live as Dograh workflow JSON in `backend/app/voice/workflows/`: critical alert, emergency escalation, warning advisory, resolution follow-up, test call. Each has a persona node, greeting, agent steps, an end node with **extraction variables** (acknowledged, ETA, hand-off, verdict…) and a QC rubric.
2. `POST /api/voice/sync` publishes them to the Dograh account; the org picks a **TeleCMI caller number** on `/app/voice`.
3. A call fills the template variables from the incident report (machine, problem, likely cause, first check) and triggers `POST /public/agent/workflow/{uuid}`.
4. The backend polls the run every 15 s; when it completes it reads the transcript, takes Dograh's extraction, and if that is missing runs its own Gemini extraction over the transcript (heuristic fallback). `acknowledged = true` acknowledges the incident; a follow-up `verdict` resolves it with feedback. A **call summary email** goes to the primary contact.

### 4.7 Acting: photos, work orders, feedback
- **Photo evidence** — a technician uploads a photo on the incident; Gemini vision describes it against the ranked causes and the findings become evidence lines on the report; "Re-investigate with the photos" feeds them back into the pipeline.
- **Work orders** — Kanban per machine (open / in progress / done, drag and drop, assignee, due time). "From Muse's checks" creates one per recommended check with priority by severity.
- **Feedback** — resolving an incident records verdict / actual cause / fix (from the UI or from the follow-up call) and emails the **resolved** template.

### 4.8 Muse copilot (chat + realtime voice + navigation)
1. The overview opens with **Ask Muse**: a greeting generated from a live factory snapshot (machines, latest values, forecasts, open incidents with likely cause, work orders, recent calls).
2. **Chat** streams over SSE (`POST /api/muse/chat`) with a tool loop: `get_factory_status`, `get_incident`, `get_machine`, `navigate`.
3. **Voice** — the browser captures 16 kHz PCM, streams it over a websocket (`/api/muse/live`, short-lived JWT) to the backend, which relays it to Gemini Live (native audio, Kore voice, `en-IN`); audio comes back at 24 kHz with live transcription, interruption handling and the same tools.
4. **Navigation** — the `navigate` tool takes a page, a target id and a *section*; the frontend routes there and puts a yellow spotlight on the exact element (a parameter chart, the device key, work orders, a contact, the email card…) while Muse keeps talking. Muse's persona: an upbeat plant manager who calls you boss.

### 4.9 Observability and evaluation
- Streaming endpoints (live SSE stream, chat, voice websocket) are called on the backend origin directly with a short-lived bearer token (`/api/auth/token`), so they work behind Firebase Hosting, which buffers proxied responses.
- `/app/observability`: request latency and status by route, ingest rate, agent runs with every tool call.
- `/app/settings` blind evaluation: record an injected fault, score the first report that follows (detected, delay, top-1/top-3).
- Cloud Logging receives structured logs; BigQuery holds every reading for analytics.

---

## 5. Security and safety

- Device keys are hashed; only a prefix is shown after creation. Keys can be rotated.
- All third-party keys (Dograh, Resend) stay server-side; Cloud Run reads them from Secret Manager.
- The voice websocket uses a 30-minute scoped token, never the session cookie.
- The agent is advisory; every recommendation carries a safety note and the number guardrail prevents invented values.
- Auto-dial is off by default so demo faults never ring real phones.

---

## 6. Running it

See [README.md](README.md) for setup, environment variables, demo credentials and deployment.
