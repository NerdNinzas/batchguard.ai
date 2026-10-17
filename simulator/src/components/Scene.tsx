"use client";

import { Clone, ContactShadows, Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { SimMachine } from "@/lib/status";
import { statusOf, type Status } from "@/lib/status";

const KIT = "/models/factory/";
const MODEL: Record<string, { name: string; scale: number; y?: number }> = {
  conveyor: { name: "conveyor-long-sides", scale: 1.0 }, motor: { name: "machine-fortified", scale: 1.4 }, pump: { name: "piston-round", scale: 1.9 },
  compressor: { name: "machine-window", scale: 1.35 }, hopper: { name: "hopper-high-round", scale: 1.25 }, sealer: { name: "machine", scale: 1.35 },
  inspection: { name: "scanner-high", scale: 1.25 }, other: { name: "machine-bed", scale: 1.5 },
};
Object.values(MODEL).forEach((m) => useGLTF.preload(`${KIT}${m.name}.glb`));
useGLTF.preload(`${KIT}box-small.glb`);

const COLOR: Record<Status, string> = { normal: "#22c55e", warning: "#f59e0b", critical: "#ef4444", stopped: "#64748b", shutdown: "#a855f7" };

/** how hot / shaky a machine looks, 0..1, from its parameters relative to limits */
function stress(m: SimMachine) {
  let heat = 0, shake = 0;
  for (const p of m.params) {
    const v = m.values[p.name]; if (v == null) continue;
    const hi = p.crit_high ?? p.warn_high; const base = (p.normal_min != null && p.normal_max != null) ? (p.normal_min + p.normal_max) / 2 : null;
    if (hi != null && base != null && hi > base) {
      const f = Math.max(0, Math.min(1.3, (v - base) / (hi - base)));
      if (/temp|heat/.test(p.name)) heat = Math.max(heat, f);
      if (/vib|current|load/.test(p.name)) shake = Math.max(shake, f);
    }
  }
  return { heat, shake };
}

function Kit({ name, scale = 1, position = [0, 0, 0], rotation = [0, 0, 0] }: { name: string; scale?: number; position?: [number, number, number]; rotation?: [number, number, number] }) {
  const { scene } = useGLTF(`${KIT}${name}.glb`);
  return <Clone object={scene} scale={scale} position={position} rotation={rotation} />;
}

function Machine({ m, x, selected, onSelect }: { m: SimMachine; x: number; selected: boolean; onSelect: () => void }) {
  const g = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);
  const st = statusOf(m);
  const { heat, shake } = stress(m);
  const spec = MODEL[m.type] ?? MODEL.other;
  useFrame(({ clock }) => {
    if (!g.current) return;
    const t = clock.getElapsedTime();
    const amp = m.running ? 0.004 + shake * 0.05 : 0;
    g.current.position.x = x + Math.sin(t * 37) * amp;
    g.current.position.z = Math.cos(t * 41) * amp;
    if (glow.current) { const mat = glow.current.material as THREE.MeshBasicMaterial; mat.opacity = 0.15 + heat * 0.55 + (st === "critical" ? Math.sin(t * 6) * 0.15 : 0); }
  });
  const c = COLOR[st];
  return (
    <group ref={g} position={[x, 0, 0]} onClick={(e) => { e.stopPropagation(); onSelect(); }} onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "")}>
      {m.type === "conveyor" ? (
        <group><Kit name="conveyor-long-sides" position={[-2.4, 0, 0]} /><Kit name="conveyor-long-sides" position={[0, 0, 0]} /><Kit name="conveyor-long-sides" position={[2.4, 0, 0]} /><Boxes speed={m.running ? m.speed : 0} /></group>
      ) : <Kit name={spec.name} scale={spec.scale} />}
      {/* status ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}><ringGeometry args={[m.type === "conveyor" ? 4.3 : 2.0, m.type === "conveyor" ? 4.45 : 2.15, 64]} /><meshBasicMaterial color={selected ? "#ffffff" : c} transparent opacity={selected ? 0.9 : 0.6} /></mesh>
      {/* heat glow */}
      <mesh ref={glow} position={[0, m.type === "conveyor" ? 0.6 : 1.6, 0]}><sphereGeometry args={[m.type === "conveyor" ? 2.2 : 1.7, 24, 24]} /><meshBasicMaterial color={heat > 0.8 ? "#ff4d2e" : "#ff8a3d"} transparent opacity={0} depthWrite={false} /></mesh>
      {/* stack lamp */}
      <mesh position={[m.type === "conveyor" ? 3.6 : 1.5, m.type === "conveyor" ? 1.1 : 2.3, 1.1]}><cylinderGeometry args={[0.12, 0.12, 0.5, 12]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={st === "normal" ? 0.6 : 2.2} /></mesh>
      <Html position={[0, m.type === "conveyor" ? 1.9 : 3.9, 0]} center distanceFactor={14} style={{ pointerEvents: "none" }}>
        <div style={{ background: "rgba(7,17,31,.85)", border: `1px solid ${c}`, borderRadius: 12, padding: "6px 10px", color: "#e8f0ff", fontSize: 12, whiteSpace: "nowrap", fontFamily: "system-ui" }}>
          <div style={{ fontWeight: 700 }}>{m.name}</div>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: c }}>{st === "shutdown" ? "SHUT DOWN BY BATCHGUARD" : st.toUpperCase()}{m.fault ? ` · ${m.fault.replace(/_/g, " ")}` : ""}</div>
        </div>
      </Html>
    </group>
  );
}

function Boxes({ speed }: { speed: number }) {
  const refs = useRef<THREE.Group[]>([]);
  useFrame((_, dt) => {
    refs.current.forEach((b, i) => { if (!b) return; b.position.x += dt * 1.1 * speed; if (b.position.x > 3.6) b.position.x = -3.6 - (i % 2) * 0.4; });
  });
  return <>{[0, 1, 2, 3].map((i) => <group key={i} ref={(el) => { if (el) refs.current[i] = el; }} position={[-3.4 + i * 1.8, 0.78, 0]}><Kit name="box-small" scale={0.9} /></group>)}</>;
}

export function Scene({ machines, selected, onSelect }: { machines: SimMachine[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const gap = 6.4;
  const width = Math.max(1, machines.length) * gap;
  const positions = useMemo(() => machines.map((_, i) => -width / 2 + gap / 2 + i * gap), [machines, width]);
  return (
    <Canvas shadows camera={{ position: [0, 11, 21], fov: 42 }} dpr={[1, 1.75]} onPointerMissed={() => onSelect(null)}>
      <color attach="background" args={["#07111f"]} />
      <fog attach="fog" args={["#07111f", 30, 70]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[8, 14, 6]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} />
      <Environment preset="warehouse" environmentIntensity={0.35} />
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow><planeGeometry args={[Math.max(60, width + 20), 40]} /><meshStandardMaterial color="#111c30" roughness={0.9} metalness={0.1} /></mesh>
      <gridHelper args={[Math.max(60, width + 20), 30, "#1f2f4d", "#16233b"]} position={[0, 0.005, 0]} />
      {/* back wall */}
      <mesh position={[0, 5, -9]}><boxGeometry args={[Math.max(60, width + 20), 10, 0.4]} /><meshStandardMaterial color="#0d1830" roughness={1} /></mesh>
      {machines.map((m, i) => <Machine key={m.id} m={m} x={positions[i]} selected={selected === m.id} onSelect={() => onSelect(m.id)} />)}
      <ContactShadows position={[0, 0.01, 0]} opacity={0.5} scale={Math.max(60, width + 20)} blur={2.2} far={6} />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.15} minDistance={8} maxDistance={48} target={[0, 1, 0]} />
    </Canvas>
  );
}
