# BatchGuard AI

Factory monitoring with an investigating AI agent — our entry to the Google Cloud AI Builder Cup 2026 (Manufacturing).
Onboard a machine from its PDF manual, stream telemetry through a per-machine API, and let **Muse** (the agent, on
Google ADK + Gemini) detect problems, explain the likely cause with evidence, and escalate.

Two parts in this repo:

- **Frontend** (this folder) — Next.js 16: landing page, auth, Muse-guided onboarding, dashboard (machines, PDF/manual
  onboarding with verification, workflow node builder, live 3D factory, telemetry, incidents, observability, contacts, settings).
- **Backend** (`backend/`) — FastAPI + Google ADK: auth, orgs, machine specs + device keys, `/v1/telemetry` ingestion,
  deterministic detection (limits · trend · anomaly · staleness), incident lifecycle + escalation, the investigation agent
  (Gemini via ADK, rule-based fallback), email notifications, SSE live stream. See `backend/README.md`.

## Run

```bash
# 1 · backend (Python 3.12)
cd backend && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env            # set AUTH_SECRET; GOOGLE_API_KEY etc. are optional
cd .. && npm run backend        # http://localhost:8000

# 2 · frontend
npm install && cp .env.example .env.local
npm run dev                     # http://localhost:3000  (proxies /api/* and /v1/* to the backend)

# 3 · a device (after onboarding a machine and copying its key)
npm run device -- --device <device_id> --key <api_key> --type conveyor --fault bearing_wear
```

Without any Google Cloud credentials everything still works: Gemini falls back to a rule-based investigator and template
extraction, Google sign-in is replaced by email/password, and emails are recorded as "simulated". Add keys to the two
`.env` files to switch each integration on. Voice escalation (TeleCMI + Gemini Live) is planned and not wired.

## Live

- App: https://batchguard-frontend-6our3ivvha-as.a.run.app (demo login `demo@batchguard.ai` / `demo1234`)
- API: https://batchguard-backend-6our3ivvha-as.a.run.app (`/api/health`, device API at `/v1/telemetry`)

## Google Cloud

Project `batchguard-ai-33e4` (asia-southeast1). What runs where:

| Service | Used for | Where in code |
|---|---|---|
| Vertex AI — Gemini 2.5 Flash/Pro (`global`) | ADK investigation pipeline, "ask the agent", manual extraction | `backend/app/agent/` |
| Agent Development Kit | `SequentialAgent`(gather ‖ → hypotheses → evaluator → recommender → reporter) | `backend/app/agent/adk_agent.py` |
| Firestore | live operational mirror: machines + latest values, incidents, notifications, orgs, contacts | `backend/app/cloud.py` |
| Pub/Sub → BigQuery | every reading is published to `telemetry`; a BigQuery subscription writes `batchguard.telemetry` (partitioned, no code) | `cloud.publish_readings` |
| BigQuery | history beyond local retention for charts and the agent's `get_readings` | `cloud.query_history` |
| Cloud Storage | uploaded manuals / datasheets (`gs://<project>-manuals`) | `cloud.upload_manual` |
| Cloud Logging | structured backend + ADK logs | `cloud.setup_logging` |
| Cloud Run | backend (always-on, 1 instance) + frontend (scale-to-zero) | `deploy.sh`, `Dockerfile`s |
| Secret Manager | `AUTH_SECRET` | `deploy.sh` |

Local dev talks to the same project through `backend/secrets/sa.json` (git-ignored). Everything degrades to local-only
when `GCP_PROJECT` is empty.

## Deploy

```bash
./deploy.sh            # builds both images with Cloud Build and deploys to Cloud Run
```

## Flow

sign up → onboarding modals (organisation, use cases, escalation contacts; Muse guides each step) → dashboard →
onboard a machine (PDF → Gemini extraction, or manual; every value ticked as verified) → device ID + key + endpoint →
device posts to `/v1/telemetry` → detection opens an incident → Muse investigates → in-app + email escalation → engineer
acknowledges / resolves with feedback.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- three.js via `@react-three/fiber` + `@react-three/drei` (3D factory, animated agent character, procedural textures and environment lighting, HUD labels)
- `framer-motion` for scroll-driven stages and reveals
- `lucide-react` icons
- Fonts: Barlow Condensed (display), Barlow (body), IBM Plex Mono (data) via `next/font`

## Structure

```
src/
  app/
    page.tsx                 # landing page composition
    login/ signup/ onboarding/   # auth + Muse-guided onboarding wizard
    app/                     # dashboard: layout (Shell), overview, machines/[id], onboard, workflow, factory,
                             #   telemetry, incidents/[id], observability, contacts, settings
    globals.css              # light / blue theme tokens
  components/
    three/
      FactoryScene.tsx       # the 3D line: feeder, conveyor+motor, inspection, sealer, boxes, surroundings, camera rig
      AgentBot.tsx           # Muse as a 3D robot (hard hat + gear, glossy face screen, ear pods, coveralls, tablet); walks around the line, inspects, calls, waves
      story.ts               # the 8-stage incident script (running → drift → … → resolved) + fake readings
      HUD.tsx                # overlay readouts, stage tag, call bubble
      HeroScene.tsx          # client-only dynamic wrapper
      ParticleField.tsx      # CTA background
      LiveFactory.tsx        # dashboard 3D view of onboarded machines, coloured by live status
    app/                     # Shell (sidebar, topbar, live notifications), charts, KeyReveal
    auth/AuthCard.tsx        # email/password + Google (Firebase) sign-in
    ui/                      # Primitives (Button, Input, Modal, Badge…), Toast
    muse/
      MuseGuide.tsx          # in-app Muse that waves on each step/page
      MuseCompanion.tsx      # fixed full-body companion from the render: floats, leans to the cursor, waves on every section
      MuseLogo.tsx           # head crop of the render for header/footer
      MuseFace.tsx           # SVG face (kept for small inline uses)
    landing/
      Pipeline.tsx           # builder-canvas node graph with animated edges/packets
      Hero.tsx               # autoplaying 3D incident loop
      Story.tsx              # scroll-driven 3D incident (sticky viewport, steps set the stage)
      Journey.tsx            # three stations on a conveyor (Onboard → Watch → Respond)
      Problem / Agent / Architecture / Evaluation / Scale / CTA / Footer / Navbar / Marquee
    ui/                      # Section, Reveal, GlowCard
  lib/content.ts             # all landing copy, mirrors the PRD
  lib/api.ts                 # typed fetch client + useLive() SSE hook
  lib/firebase.ts            # optional Google sign-in
backend/                     # FastAPI + ADK (see backend/README.md)
```

## Assets & credits

- `public/muse.webp` / `muse.png` — Muse character render (background removed with `@imgly/background-removal-node`), used by the
  header logo, the scrolling companion and the Journey notes.
- `public/models/factory/` — [Kenney Factory Kit 3.0](https://kenney.nl/assets/factory-kit), CC0. Conveyors, hopper, scanner,
  robot arm, machines, structures, pipes, crane, cones. Loaded with `useGLTF` + drei `Clone` in `FactoryScene.tsx`.
- `public/logos/` — brand marks from [Simple Icons](https://simpleicons.org) (CC0), rendered by `src/components/ui/TechLogo.tsx`.

## Blender models

`public/models/` is the drop zone for glTF/GLB exports. `muse.glb` (feet at origin, facing +Z, ~2.2 units tall) replaces the
procedural robot when `NEXT_PUBLIC_MUSE_GLB=1` is set. See `public/models/README.md`.

## Editing the incident story

Everything the 3D scene does is driven by `Stage` in `src/components/three/story.ts`. Add or reorder stages there;
`FactoryScene.tsx` maps each stage to belt speed, lamp colour, vibration, sparks, camera focus and the agent drone.
