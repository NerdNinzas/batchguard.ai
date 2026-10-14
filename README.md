# BatchGuard AI — landing page

Marketing / explainer site for **BatchGuard AI**, our entry to the Google Cloud AI Builder Cup 2026 (Manufacturing theme).
A live 3D packaging line runs, develops a bearing fault, the agent investigates, the owner gets a phone call, and the
engineer closes the loop — all rendered in the browser with React Three Fiber.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

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
    simulator/page.tsx       # placeholder route for the Virtual Factory
    globals.css              # light / blue theme tokens
  components/
    three/
      FactoryScene.tsx       # the 3D line: feeder, conveyor+motor, inspection, sealer, boxes, surroundings, camera rig
      AgentBot.tsx           # Muse as a 3D robot (hard hat + gear, glossy face screen, ear pods, coveralls, tablet); walks around the line, inspects, calls, waves
      story.ts               # the 8-stage incident script (running → drift → … → resolved) + fake readings
      HUD.tsx                # overlay readouts, stage tag, call bubble
      HeroScene.tsx          # client-only dynamic wrapper
      ParticleField.tsx      # CTA background
    muse/
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
  lib/content.ts             # all copy, mirrors the PRD
  simulator/                 # reserved for the real Virtual Factory module (see README inside)
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
