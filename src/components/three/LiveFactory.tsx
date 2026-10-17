"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Clone, ContactShadows, Environment, OrbitControls, useGLTF, useTexture } from "@react-three/drei";
import { Suspense, useMemo, useRef, type MutableRefObject } from "react";
import { useProgress } from "@react-three/drei";
import * as THREE from "three";
import type { Latest, Machine } from "@/lib/api";

/** 3D view of the onboarded machines, placed in workflow order, coloured by live status. */

const KIT = "/models/factory/";
const K = 2.1;
const FLOOR = 0;
const HEALTH_HEX: Record<string, string> = { normal: "#16c784", warning: "#f59e0b", critical: "#ef4444", emergency: "#ef4444", stale: "#f59e0b", offline: "#9fb0c8" };
const MODEL_BY_TYPE: Record<string, { name: string; scale?: number; y?: number; rot?: number }> = {
  conveyor: { name: "conveyor-long-sides" }, motor: { name: "machine-fortified", scale: 1.4 }, pump: { name: "piston-round", scale: 1.9 }, compressor: { name: "machine-window", scale: 1.35 },
  hopper: { name: "hopper-high-round", scale: 1.25 }, sealer: { name: "machine", scale: 1.35 }, inspection: { name: "scanner-high", scale: 1.25 }, other: { name: "machine-bed", scale: 1.5 },
};

function Kit({ name, position = [0, 0, 0], scale = K, rotation = [0, 0, 0] }: { name: string; position?: [number, number, number]; scale?: number; rotation?: [number, number, number] }) {
  const { scene } = useGLTF(`${KIT}${name}.glb`);
  useMemo(() => {
    // the kit ships flat-shaded colours; make them painted metal so the HDRI lights them
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && "metalness" in m && !(m as unknown as { _bg?: boolean })._bg) {
        m.metalness = 0.35;
        m.roughness = 0.5;
        m.envMapIntensity = 1.1;
        (m as unknown as { _bg?: boolean })._bg = true;
      }
    });
  }, [scene]);
  return <Clone object={scene} position={position} scale={scale} rotation={rotation} castShadow receiveShadow />;
}
Object.values(MODEL_BY_TYPE).forEach((m) => useGLTF.preload(`${KIT}${m.name}.glb`));

/* Photoscanned CC0 props from Poly Haven (real-world metres). */
const PH = "/models/ph/";
const PROPS: { id: string; file: string; position: [number, number, number]; rotation?: number; scale?: number }[] = [
  { id: "industrial_storage_cart", file: "industrial_storage_cart_1k.gltf", position: [-9.5, 0, 3.2], rotation: 0.6 },
  { id: "metal_tool_chest", file: "metal_tool_chest_1k.gltf", position: [-11.5, 0, -2.2], rotation: 1.5 },
  { id: "barrel_03", file: "barrel_03_1k.gltf", position: [10.5, 0, -2.4] },
  { id: "barrel_03", file: "barrel_03_1k.gltf", position: [11.4, 0, -1.6], rotation: 1.1 },
  { id: "cardboard_box_01", file: "cardboard_box_01_1k.gltf", position: [9.8, 0, 3.4], rotation: 0.3 },
  { id: "cardboard_box_01", file: "cardboard_box_01_1k.gltf", position: [10.4, 0, 3.9], rotation: -0.4 },
  { id: "hand_truck", file: "hand_truck_1k.gltf", position: [12.2, 0, 3.2], rotation: -1.2 },
  { id: "industrial_pastic_container", file: "industrial_pastic_container_1k.gltf", position: [-8.3, 0, 4.4], rotation: 0.2 },
  { id: "korean_fire_extinguisher_01", file: "korean_fire_extinguisher_01_1k.gltf", position: [-12.6, 0, 0.6] },
  { id: "WetFloorSign_01", file: "WetFloorSign_01_1k.gltf", position: [-3.5, 0, 4.6], rotation: 0.4 },
  { id: "drill_press_01", file: "drill_press_01_1k.gltf", position: [-13.2, 0, -3.6], rotation: 0.9 },
  { id: "metal_trash_can", file: "metal_trash_can_1k.gltf", position: [13.6, 0, -0.4] },
  { id: "ladder_sectioned_01", file: "ladder_sectioned_01_1k.gltf", position: [13.2, 0, -3.8], rotation: 0.5 },
];
function Prop({ file, position, rotation = 0, scale = 1 }: { file: string; position: [number, number, number]; rotation?: number; scale?: number }) {
  const { scene } = useGLTF(`${PH}${file.replace("_1k.gltf", "")}/${file}`);
  return <Clone object={scene} position={position} rotation={[0, rotation, 0]} scale={scale} castShadow receiveShadow />;
}
PROPS.forEach((p) => useGLTF.preload(`${PH}${p.id}/${p.file}`));

/* Real concrete floor (Poly Haven CC0, 1k PBR maps). */
function ConcreteFloor() {
  const [map, rough, normal, ao] = useTexture(["/textures/floor/diffuse.jpg", "/textures/floor/rough.jpg", "/textures/floor/nor_gl.jpg", "/textures/floor/ao.jpg"]);
  useMemo(() => {
    for (const t of [map, rough, normal, ao]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(16, 16);
      t.anisotropy = 8;
    }
    map.colorSpace = THREE.SRGBColorSpace;
  }, [map, rough, normal, ao]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[80, 80]} />
      <meshStandardMaterial map={map} roughnessMap={rough} normalMap={normal} aoMap={ao} color="#c9ced6" roughness={0.6} metalness={0.1} normalScale={new THREE.Vector2(0.45, 0.45)} envMapIntensity={1.0} />
    </mesh>
  );
}
["conveyor-long", "conveyor-long-sides", "machine-connection-pipe", "box-small", "structure-window-wide", "pipe-large-long", "warning-orange"].forEach((n) => useGLTF.preload(`${KIT}${n}.glb`));

function Lamp({ status, position }: { status: string; position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  const bad = status === "critical" || status === "emergency";
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.setScalar(bad ? 1 + Math.sin(clock.elapsedTime * 10) * 0.25 : 1);
  });
  const c = HEALTH_HEX[status] ?? HEALTH_HEX.offline;
  return (
    <group position={position}>
      <mesh position={[0, 0.15, 0]}><cylinderGeometry args={[0.04, 0.04, 0.3, 10]} /><meshStandardMaterial color="#3b4556" metalness={0.8} roughness={0.3} /></mesh>
      <mesh ref={ref} position={[0, 0.42, 0]}><cylinderGeometry args={[0.09, 0.1, 0.24, 16]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={2.2} /></mesh>
      <pointLight color={c} intensity={bad ? 4 : 1.5} distance={4} position={[0, 0.6, 0]} />
    </group>
  );
}

function MachineBlock({ m, x }: { m: Machine; x: number }) {
  const spec = MODEL_BY_TYPE[m.type] ?? MODEL_BY_TYPE.other;
  const c = HEALTH_HEX[m.status] ?? HEALTH_HEX.offline;
  return (
    <group position={[x, FLOOR, 0]}>
      {m.type === "conveyor" ? (
        <>
          <Kit name="conveyor-long-sides" position={[-2.1, 0, 0]} />
          <Kit name="conveyor-long-sides" position={[2.1, 0, 0]} />
          <Kit name="machine-connection-pipe" position={[0, 0, -2.2]} scale={K * 0.9} />
        </>
      ) : (
        <Kit name={spec.name} scale={K * (spec.scale ?? 1)} position={[0, spec.y ?? 0, 0]} rotation={[0, spec.rot ?? 0, 0]} />
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}><ringGeometry args={[m.type === "conveyor" ? 4.4 : 2.1, m.type === "conveyor" ? 4.52 : 2.22, 64]} /><meshBasicMaterial color={c} transparent opacity={0.6} /></mesh>
      <Lamp status={m.status} position={[m.type === "conveyor" ? 3.4 : 1.5, m.type === "conveyor" ? 0.9 : 2.0, 1.2]} />
    </group>
  );
}

/** Projects each machine's label anchor to screen space every frame and positions the DOM labels. */
function LabelProjector({ anchors, labels }: { anchors: { id: string; x: number; y: number }[]; labels: MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (const a of anchors) {
      const el = labels.current[a.id];
      if (!el) continue;
      v.set(a.x, a.y, 0).project(camera);
      const px = (v.x * 0.5 + 0.5) * size.width;
      const py = (-v.y * 0.5 + 0.5) * size.height;
      const visible = v.z < 1 && px > -200 && px < size.width + 200;
      el.style.transform = `translate(-50%, -100%) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      el.style.opacity = visible ? "1" : "0";
    }
  });
  return null;
}

function Boxes({ count, length }: { count: number; length: number }) {
  const refs = useRef<THREE.Group[]>([]);
  const offsets = useMemo(() => Array.from({ length: count }, (_, i) => i / count), [count]);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += dt * 0.08;
    refs.current.forEach((g, i) => { if (g) g.position.x = -length / 2 + ((offsets[i] + t.current) % 1) * length; });
  });
  return <>{offsets.map((_, i) => <group key={i} ref={(el) => el && (refs.current[i] = el)} position={[0, 0.4 * K + 0.02, 0]}><Kit name="box-small" scale={1.1} /></group>)}</>;
}

function Scene({ machines, labels }: { machines: Machine[]; labels: MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const gap = 7.4;
  const total = Math.max(1, machines.length);
  const width = total * gap;
  return (
    <>
      <ConcreteFloor />
      {/* painted walkway line in front of the line */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 5.4]}><planeGeometry args={[width + 10, 0.12]} /><meshStandardMaterial color="#f5b400" roughness={0.9} /></mesh>
      {/* connecting belt between machines */}
      {machines.length > 1 && Array.from({ length: Math.ceil(width / (2 * K)) }, (_, i) => <Kit key={i} name="conveyor-long" position={[-width / 2 + K + i * 2 * K, 0, 3.2]} />)}
      {machines.length > 1 && <group position={[0, 0, 3.2]}><Boxes count={Math.min(12, total * 2)} length={width} /></group>}
      {machines.map((m, i) => <MachineBlock key={m.id} m={m} x={-width / 2 + gap / 2 + i * gap} />)}
      <LabelProjector anchors={machines.map((m, i) => ({ id: m.id, x: -width / 2 + gap / 2 + i * gap, y: m.type === "conveyor" ? 2.0 : 4.4 }))} labels={labels} />
      {/* hall: windowed back wall, ceiling beams, caged lights over the line (Poly Haven CC0) */}
      {Array.from({ length: Math.ceil((width + 16) / (2 * K)) }, (_, i) => <Kit key={`w${i}`} name="structure-window-wide" position={[-(width + 16) / 2 + K + i * 2 * K, 0, -8.5]} />)}
      {Array.from({ length: Math.ceil((width + 16) / 5) }, (_, i) => (
        <mesh key={`b${i}`} position={[-(width + 16) / 2 + 2.5 + i * 5, 7.4, -1.5]} castShadow>
          <boxGeometry args={[0.35, 0.5, 14]} />
          <meshStandardMaterial color="#3b4556" metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
      {machines.map((m, i) => {
        const x = -width / 2 + gap / 2 + i * gap;
        return (
          <group key={`l${m.id}`} position={[x, 7.2, 1.2]}>
            <Prop file="caged_hanging_light_1k.gltf" position={[0, 0, 0]} scale={1.6} />
            <pointLight position={[0, -1.4, 0]} intensity={60} distance={16} decay={2} color="#fff1dc" castShadow={i % 2 === 0} shadow-bias={-0.002} />
          </group>
        );
      })}
      {/* photoscanned props around the line */}
      {PROPS.map((p, i) => <Prop key={i} file={p.file} position={[p.position[0] * (width / 37), p.position[1], p.position[2] * 1.25]} rotation={p.rotation} scale={p.scale} />)}
      <Kit name="warning-orange" position={[-width / 2 - 1.5, 0, 3.6]} />
    </>
  );
}

export default function LiveFactory({ machines, latest }: { machines: Machine[]; latest: Record<string, Latest> }) {
  const width = Math.max(1, machines.length) * 7.4;
  const labels = useRef<Record<string, HTMLDivElement | null>>({});
  return (
    <div className="relative h-full w-full">
    <LoadOverlay />
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 9.5, width * 0.5 + 12], fov: 40 }} gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }} style={{ background: "radial-gradient(ellipse at 50% 30%, #2a3140 0%, #171b23 70%)" }}>
      <ambientLight intensity={0.22} />
      <directionalLight position={[8, 14, 6]} intensity={0.9} color="#fff3e0" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-camera-left={-24} shadow-camera-right={24} shadow-camera-top={24} shadow-camera-bottom={-24} />
      {/* real foundry HDRI (Poly Haven, CC0): lighting, reflections and the backdrop */}
      <Suspense fallback={null}>
        <Environment files="/hdri/industrial_workshop_foundry_1k.hdr" environmentIntensity={0.7} />
      </Suspense>
      <Suspense fallback={null}><Scene machines={machines} labels={labels} /></Suspense>
      <ContactShadows position={[0, 0.005, 0]} opacity={0.55} scale={48} blur={2} far={6} color="#000000" />
      <OrbitControls makeDefault target={[0, 1.2, 0]} maxPolarAngle={Math.PI / 2.2} minDistance={6} maxDistance={80} />
    </Canvas>
    {/* DOM labels positioned by LabelProjector */}
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {machines.map((m) => {
        const c = HEALTH_HEX[m.status] ?? HEALTH_HEX.offline;
        const entries = Object.entries(latest[m.id] ?? m.latest).slice(0, 3);
        return (
          <div key={m.id} ref={(el) => { labels.current[m.id] = el; }} className="absolute left-0 top-0 rounded-xl border bg-white/95 px-2.5 py-1.5 shadow-[0_8px_24px_-10px_rgba(11,26,51,.35)]" style={{ borderColor: `${c}66`, minWidth: 150, opacity: 0, willChange: "transform" }}>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />
              <span className="text-xs font-bold text-ink">{m.name}</span>
              <span className="ml-auto font-mono text-[9px] uppercase text-muted">{m.status}</span>
            </div>
            {entries.map(([k, v]) => (
              <div key={k} className="mt-0.5 flex justify-between gap-3 font-mono text-[10px]">
                <span className="text-muted">{k}</span>
                <span className={`font-semibold ${v.state === "critical" ? "text-red" : v.state === "warning" ? "text-amber" : "text-ink"}`}>{v.value.toFixed(1)}{v.unit ? ` ${v.unit}` : ""}</span>
              </div>
            ))}
            {entries.length === 0 && <div className="mt-0.5 text-[10px] text-muted">no telemetry yet</div>}
          </div>
        );
      })}
    </div>
    </div>
  );
}


/** Shimmer + progress while the kit models, textures and HDRI download (served from the CDN, cached after first visit). */
function LoadOverlay() {
  const { active, progress, loaded, total } = useProgress();
  if (!active && (loaded > 0 || total === 0)) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#171b23]/70 backdrop-blur-[2px]">
      <div className="flex gap-6">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-24 w-24 rounded-2xl opacity-60" />)}</div>
      <div className="mt-6 h-1.5 w-56 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-sky transition-[width] duration-300" style={{ width: `${Math.max(4, progress)}%` }} /></div>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.25em] text-white/70">Loading 3D models · {Math.round(progress)}%{total ? ` · ${loaded}/${total}` : ""}</p>
    </div>
  );
}
