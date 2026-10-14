# Virtual Factory simulator (reserved)

Lives here as a self-contained module; `src/app/simulator/page.tsx` mounts it.

Planned layout:

```
src/simulator/
  engine/        # behaviour model (500 ms tick), fault library, blind-test mode
  scene/         # React Three Fiber line: feeder, conveyor, inspection, sealer
  controls/      # sliders, start/stop/e-stop, fault injection, network toggle
  client/        # telemetry client → POST /v1/telemetry with per-machine device key
  index.tsx      # <VirtualFactory />
```

Nothing is built yet — the landing page ships first.
