# Blender models

Drop glTF/GLB exports here. Currently supported:

- `muse.glb` — the agent character. Feet at origin, facing +Z, ~2.2 units tall.
  Enable with `NEXT_PUBLIC_MUSE_GLB=1` in `.env.local`. Until then the procedural
  R3F character in `src/components/three/AgentBot.tsx` is used.

Export from Blender: File → Export → glTF 2.0, format "glTF Binary (.glb)",
apply transforms, include materials; compress with `npx gltf-transform optimize`.
