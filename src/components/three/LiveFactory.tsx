"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Clone, ContactShadows, Environment, Lightformer, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { Latest, Machine } from "@/lib/api";

/** 3D view of the onboarded machines, placed in workflow order, coloured by live status. */

const KIT = "/models/factory/";
const K = 1.5;
const FLOOR = 0;
const HEALTH_HEX: Record<string, string> = { normal: "#16c784", warning: "#f59e0b", critical: "#ef4444", emergency: "#ef4444", stale: "#f59e0b", offline: "#9fb0c8" };
const MODEL_BY_TYPE: Record<string, { name: string; scale?: number; y?: number; rot?: number }> = {
  conveyor: { name: "conveyor-long-sides" }, motor: { name: "machine-fortified", scale: 1.2 }, pump: { name: "piston-round", scale: 1.6 }, compressor: { name: "machine-window", scale: 1.1 },
  hopper: { name: "hopper-high-round" }, sealer: { name: "machine", scale: 1.1 }, inspection: { name: "scanner-high" }, other: { name: "machine-bed", scale: 1.3 },
};

function Kit({ name, position = [0, 0, 0], scale = K, rotation = [0, 0, 0] }: { name: string; position?: [number, number, number]; scale?: number; rotation?: [number, number, number] }) {
  const { scene } = useGLTF(`${KIT}${name}.glb`);
  return <Clone object={scene} position={position} scale={scale} rotation={rotation} castShadow receiveShadow />;
}
Object.values(MODEL_BY_TYPE).forEach((m) => useGLTF.preload(`${KIT}${m.name}.glb`));
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
          <Kit name="conveyor-long-sides" position={[-1.5, 0, 0]} />
          <Kit name="conveyor-long-sides" position={[1.5, 0, 0]} />
          <Kit name="machine-connection-pipe" position={[0, 0, -1.6]} scale={K * 0.9} />
        </>
      ) : (
        <Kit name={spec.name} scale={K * (spec.scale ?? 1)} position={[0, spec.y ?? 0, 0]} rotation={[0, spec.rot ?? 0, 0]} />
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}><ringGeometry args={[m.type === "conveyor" ? 3.2 : 1.5, m.type === "conveyor" ? 3.32 : 1.62, 64]} /><meshBasicMaterial color={c} transparent opacity={0.6} /></mesh>
      <Lamp status={m.status} position={[m.type === "conveyor" ? 2.6 : 1.1, m.type === "conveyor" ? 0.6 : 1.4, 0.9]} />
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
  return <>{offsets.map((_, i) => <group key={i} ref={(el) => el && (refs.current[i] = el)} position={[0, 0.62, 0]}><Kit name="box-small" scale={0.8} /></group>)}</>;
}

function Scene({ machines, labels }: { machines: Machine[]; labels: MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const gap = 7.5;
  const total = Math.max(1, machines.length);
  const width = total * gap;
  const floorTex = useMemo(() => {
    const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d")!;
    g.fillStyle = "#e3e8f0"; g.fillRect(0, 0, 256, 256); g.strokeStyle = "rgba(60,80,110,.16)"; g.lineWidth = 2;
    for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(20, 20); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  }, []);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow><planeGeometry args={[80, 80]} /><meshStandardMaterial map={floorTex} roughness={0.6} /></mesh>
      {/* connecting belt between machines */}
      {machines.length > 1 && Array.from({ length: Math.ceil(width / 3) }, (_, i) => <Kit key={i} name="conveyor-long" position={[-width / 2 + 1.5 + i * 3, 0, 2.4]} />)}
      {machines.length > 1 && <group position={[0, 0, 2.4]}><Boxes count={Math.min(12, total * 2)} length={width} /></group>}
      {machines.map((m, i) => <MachineBlock key={m.id} m={m} x={-width / 2 + gap / 2 + i * gap} />)}
      <LabelProjector anchors={machines.map((m, i) => ({ id: m.id, x: -width / 2 + gap / 2 + i * gap, y: m.type === "conveyor" ? 1.6 : 2.9 }))} labels={labels} />
      {/* backdrop */}
      {Array.from({ length: Math.ceil(width / 3) + 2 }, (_, i) => <Kit key={i} name="structure-window-wide" position={[-width / 2 - 3 + i * 3, 0, -5]} />)}
      {Array.from({ length: Math.ceil(width / 2) + 2 }, (_, i) => <Kit key={i} name="pipe-large-long" position={[-width / 2 - 2 + i * 2, 4.4, -4]} scale={1} />)}
      <Kit name="warning-orange" position={[-width / 2 - 1.5, 0, 3.6]} />
      <Kit name="warning-orange" position={[width / 2 + 1.5, 0, 3.6]} />
    </>
  );
}

export default function LiveFactory({ machines, latest }: { machines: Machine[]; latest: Record<string, Latest> }) {
  const width = Math.max(1, machines.length) * 7.5;
  const labels = useRef<Record<string, HTMLDivElement | null>>({});
  return (
    <div className="relative h-full w-full">
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 6, width * 0.7 + 9], fov: 36 }} gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }} style={{ background: "linear-gradient(180deg,#ffffff,#eaf3ff)" }}>
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 12, 6]} intensity={2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20} />
      <Environment resolution={256}>
        <Lightformer intensity={2.5} position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 6, 1]} />
        <Lightformer intensity={1.2} position={[-8, 2, 2]} rotation={[0, Math.PI / 2, 0]} scale={[6, 3, 1]} color="#dbe9ff" />
        <Lightformer intensity={1.2} position={[8, 2, 2]} rotation={[0, -Math.PI / 2, 0]} scale={[6, 3, 1]} />
      </Environment>
      <Suspense fallback={null}><Scene machines={machines} labels={labels} /></Suspense>
      <ContactShadows position={[0, 0.005, 0]} opacity={0.4} scale={40} blur={2.2} far={5} color="#0b1a33" />
      <OrbitControls makeDefault target={[0, 1, 0]} maxPolarAngle={Math.PI / 2.1} minDistance={6} maxDistance={80} />
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
