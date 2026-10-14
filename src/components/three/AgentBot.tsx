"use client";

import { useFrame } from "@react-three/fiber";
import { Html, RoundedBox, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Stage } from "./story";

/**
 * Muse, the BatchGuard agent, as a 3D character matched to the render used in
 * the page corner: wide rounded white head, big glossy black screen with ^ ^
 * eyes and a smile, blue ear pods, white hard hat with a gear, navy coveralls
 * with pockets, reflective stripes, orange tab and gear badge, tablet in the
 * left hand, thumbs-up right hand, and a Gemini sparkle on its back.
 *
 * Idles at its station, walks around the line to the failing motor when an
 * incident opens, inspects it, calls the owner, and waves on every stage change.
 *
 * Drop a Blender export at /public/models/muse.glb (feet at origin, facing +Z,
 * ~2.2 units tall) and set NEXT_PUBLIC_MUSE_GLB=1 to use it instead.
 */

const STATION = new THREE.Vector3(1.2, 0, 2.3);
const AT_MOTOR = new THREE.Vector3(-3.8, 0, -1.2); // behind the belt, beside the drive motor, facing the viewer
const CORNER_FRONT = new THREE.Vector3(-7.4, 0, 2.3);
const CORNER_BACK = new THREE.Vector3(-7.4, 0, -1.2);
const TO_SITE = [CORNER_FRONT, CORNER_BACK, AT_MOTOR];
const TO_STATION = [CORNER_BACK, CORNER_FRONT, STATION];
const WALK_SPEED = 4.6;

const NAVY = "#243457";
const NAVY_DARK = "#1a2742";
const WHITE = "#f6f8fc";
const SCREEN = "#05070d";
const GLOW = "#6fd6ff";
const ORANGE = "#ff8a1f";
const REFLECT = "#d9e0ea";
const BOOT = "#0d1117";

const SPEECH: Record<Stage, string> = {
  running: "All four machines nominal.",
  drift: "Hmm — conveyor vibration creeping up.",
  warning: "Trend says limit in ~4 min. Opening a warning.",
  critical: "Temp crossed 90 °C. Escalating to critical.",
  investigating: "Checking readings, neighbours and the manual…",
  calling: "Calling the owner. Bearing wear, check drive-end.",
  acknowledged: "Ack received. Engineer is on it.",
  resolved: "Bearing replaced. Back to green!",
};

/* ---------- emblems ---------- */
function useGearGeometry() {
  return useMemo(() => {
    const s = new THREE.Shape();
    const teeth = 8;
    const R = 1;
    const r = 0.78;
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2;
      const a1 = a0 + Math.PI / teeth / 2;
      const a2 = a0 + Math.PI / teeth;
      const a3 = a0 + (Math.PI / teeth) * 1.5;
      const pts: [number, number][] = [
        [Math.cos(a0) * r, Math.sin(a0) * r],
        [Math.cos(a1) * R, Math.sin(a1) * R],
        [Math.cos(a2) * R, Math.sin(a2) * R],
        [Math.cos(a3) * r, Math.sin(a3) * r],
      ];
      pts.forEach(([x, y], k) => (i === 0 && k === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
    }
    s.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.32, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: false, curveSegments: 8 });
    g.center();
    return g;
  }, []);
}

function Gear({ scale = 0.08, color = "#2b3447", emissive = "#000000", emissiveIntensity = 0 }: { scale?: number; color?: string; emissive?: string; emissiveIntensity?: number }) {
  const geo = useGearGeometry();
  return (
    <mesh geometry={geo} scale={scale}>
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} metalness={0.4} roughness={0.5} />
    </mesh>
  );
}

/** Four-point Gemini-style sparkle. */
function useSparkleGeometry() {
  return useMemo(() => {
    const s = new THREE.Shape();
    const r = 1;
    const k = 0.2;
    s.moveTo(0, r);
    s.quadraticCurveTo(k, k, r, 0);
    s.quadraticCurveTo(k, -k, 0, -r);
    s.quadraticCurveTo(-k, -k, -r, 0);
    s.quadraticCurveTo(-k, k, 0, r);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.03, bevelSegments: 3, curveSegments: 24 });
    g.center();
    return g;
  }, []);
}

export function GeminiSparkle({ scale = 0.2 }: { scale?: number }) {
  const geo = useSparkleGeometry();
  return (
    <group scale={scale}>
      <mesh geometry={geo}>
        <meshStandardMaterial color="#4f8cff" emissive="#3b7bff" emissiveIntensity={1.1} metalness={0.3} roughness={0.25} />
      </mesh>
      <mesh geometry={geo} scale={[0.55, 0.55, 1.3]} position={[0, 0, 0.02]}>
        <meshStandardMaterial color="#9b8cff" emissive="#8b7cff" emissiveIntensity={1.5} metalness={0.2} roughness={0.2} />
      </mesh>
    </group>
  );
}

/* ---------- face on the screen ---------- */
function Face({ mood }: { mood: "happy" | "think" | "big" }) {
  const arc = mood === "big" ? Math.PI * 1.05 : Math.PI;
  return (
    <group position={[0, 0.0, 0.46]}>
      {[-0.19, 0.19].map((x) => (
        <group key={x} position={[x, 0.06, 0]}>
          <mesh rotation={[0, 0, mood === "think" && x > 0 ? 0.35 : 0]}>
            <torusGeometry args={[0.085, 0.022, 10, 28, arc]} />
            <meshStandardMaterial color={GLOW} emissive={GLOW} emissiveIntensity={3.2} />
          </mesh>
        </group>
      ))}
      {/* blush dashes */}
      {[-1, 1].map((s) =>
        [0, 1, 2].map((i) => (
          <mesh key={`${s}${i}`} position={[s * (0.3 + i * 0.03), -0.08 + (i % 2) * 0.012, 0]}>
            <boxGeometry args={[0.012, 0.035, 0.004]} />
            <meshStandardMaterial color={GLOW} emissive={GLOW} emissiveIntensity={1.6} />
          </mesh>
        )),
      )}
      {/* smile */}
      <mesh position={[0, -0.1, 0]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[mood === "big" ? 0.075 : 0.06, 0.016, 10, 28, Math.PI * 0.9]} />
        <meshStandardMaterial color={GLOW} emissive={GLOW} emissiveIntensity={3.2} />
      </mesh>
    </group>
  );
}

function Stripe({ y, radius, height = 0.045 }: { y: number; radius: number; height?: number }) {
  return (
    <mesh position={[0, y, 0]}>
      <cylinderGeometry args={[radius, radius, height, 24, 1, true]} />
      <meshStandardMaterial color={REFLECT} emissive={REFLECT} emissiveIntensity={0.2} metalness={0.3} roughness={0.5} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Limb({ length, radius, color }: { length: number; radius: number; color: string }) {
  return (
    <mesh position={[0, -length / 2, 0]} castShadow>
      <capsuleGeometry args={[radius, Math.max(0.01, length - radius * 2), 4, 14]} />
      <meshStandardMaterial color={color} roughness={0.75} />
    </mesh>
  );
}

/* ---------- procedural Muse ---------- */
function ProceduralMuse({ stage, refs }: { stage: Stage; refs: BotRefs }) {
  const busy = stage === "investigating" || stage === "calling";
  const mood = stage === "resolved" || stage === "running" || stage === "acknowledged" ? "big" : stage === "investigating" || stage === "drift" ? "think" : "happy";
  return (
    <group position={[0, -1.05, 0]}>
      {/* legs */}
      {[-0.14, 0.14].map((x, i) => (
        <group key={x} ref={i === 0 ? refs.legL : refs.legR} position={[x, 0.58, 0]}>
          <Limb length={0.5} radius={0.11} color={NAVY} />
          <Stripe y={-0.3} radius={0.115} />
          {/* side cargo pocket */}
          <RoundedBox args={[0.06, 0.12, 0.12]} radius={0.015} position={[x > 0 ? 0.1 : -0.1, -0.12, 0.02]}>
            <meshStandardMaterial color={NAVY_DARK} roughness={0.8} />
          </RoundedBox>
          {/* boot */}
          <RoundedBox args={[0.24, 0.14, 0.34]} radius={0.05} position={[0, -0.55, 0.05]} castShadow>
            <meshStandardMaterial color={BOOT} roughness={0.45} metalness={0.3} />
          </RoundedBox>
          <mesh position={[0, -0.56, 0.22]}>
            <boxGeometry args={[0.16, 0.025, 0.01]} />
            <meshStandardMaterial color={GLOW} emissive={GLOW} emissiveIntensity={2.5} />
          </mesh>
          <mesh position={[0, -0.615, 0.05]}>
            <boxGeometry args={[0.25, 0.02, 0.35]} />
            <meshStandardMaterial color="#1b2230" roughness={0.6} />
          </mesh>
        </group>
      ))}

      <group ref={refs.body} position={[0, 0.58, 0]}>
        {/* torso coveralls */}
        <RoundedBox args={[0.64, 0.64, 0.44] as [number, number, number]} radius={0.16} position={[0, 0.3, 0]} castShadow>
          <meshStandardMaterial color={NAVY} roughness={0.78} />
        </RoundedBox>
        {/* belt + buckle + pouch */}
        <mesh position={[0, 0.02, 0]}>
          <boxGeometry args={[0.66, 0.07, 0.46]} />
          <meshStandardMaterial color={NAVY_DARK} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.02, 0.235]}>
          <boxGeometry args={[0.1, 0.06, 0.012]} />
          <meshStandardMaterial color="#9fb0c8" metalness={0.8} roughness={0.3} />
        </mesh>
        <RoundedBox args={[0.1, 0.1, 0.08]} radius={0.02} position={[0.3, -0.02, 0.1]}>
          <meshStandardMaterial color={BOOT} roughness={0.6} />
        </RoundedBox>
        {/* reflective chest stripes */}
        {[0.16, 0.26].map((y) => (
          <mesh key={y} position={[0, y, 0.222]}>
            <boxGeometry args={[0.6, 0.038, 0.005]} />
            <meshStandardMaterial color={REFLECT} emissive={REFLECT} emissiveIntensity={0.2} metalness={0.3} roughness={0.5} />
          </mesh>
        ))}
        {/* chest pockets */}
        {[-0.17, 0.17].map((x) => (
          <RoundedBox key={x} args={[0.2, 0.16, 0.02]} radius={0.02} position={[x, 0.42, 0.225]}>
            <meshStandardMaterial color={NAVY_DARK} roughness={0.8} />
          </RoundedBox>
        ))}
        {/* orange tab + gear badge */}
        <mesh position={[-0.17, 0.5, 0.238]}>
          <boxGeometry args={[0.16, 0.04, 0.005]} />
          <meshStandardMaterial color={ORANGE} emissive={ORANGE} emissiveIntensity={0.35} />
        </mesh>
        <group position={[0.17, 0.42, 0.24]}>
          <Gear scale={0.05} color="#e8edf5" />
        </group>
        {/* Gemini sparkle on the back */}
        <group position={[0, 0.34, -0.235]} rotation={[0, Math.PI, 0]}>
          <GeminiSparkle scale={0.19} />
          <pointLight color="#6d8cff" intensity={0.8} distance={1.2} position={[0, 0, 0.2]} />
        </group>
        {/* collar */}
        <mesh position={[0, 0.6, 0.03]} rotation={[0.2, 0, 0]}>
          <cylinderGeometry args={[0.19, 0.22, 0.09, 20, 1, true]} />
          <meshStandardMaterial color={NAVY_DARK} roughness={0.7} side={THREE.DoubleSide} />
        </mesh>

        {/* arms */}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? refs.armL : refs.armR} position={[side * 0.36, 0.5, 0]}>
            <Limb length={0.46} radius={0.085} color={NAVY} />
            <Stripe y={-0.3} radius={0.09} />
            {/* white glove */}
            <mesh position={[0, -0.47, 0]} castShadow>
              <sphereGeometry args={[0.1, 18, 18]} />
              <meshStandardMaterial color={WHITE} roughness={0.35} />
            </mesh>
            <mesh position={[0, -0.4, 0]}>
              <torusGeometry args={[0.09, 0.014, 8, 22]} />
              <meshStandardMaterial color={GLOW} emissive={GLOW} emissiveIntensity={1.6} />
            </mesh>
            {side > 0 && (
              /* thumb on the right glove */
              <mesh position={[0.02, -0.56, 0.03]} rotation={[0, 0, 0.2]}>
                <capsuleGeometry args={[0.035, 0.07, 4, 10]} />
                <meshStandardMaterial color={WHITE} roughness={0.35} />
              </mesh>
            )}
            {side < 0 && (
              /* tablet in the left hand */
              <group position={[0.12, -0.46, 0.14]} rotation={[-0.5, 0.45, 0.15]}>
                <RoundedBox args={[0.34, 0.25, 0.018]} radius={0.02}>
                  <meshStandardMaterial color="#0b1220" roughness={0.3} metalness={0.4} />
                </RoundedBox>
                <mesh ref={refs.tablet} position={[0, 0, 0.011]}>
                  <planeGeometry args={[0.3, 0.21]} />
                  <meshStandardMaterial color="#0b1220" emissive={GLOW} emissiveIntensity={busy ? 1 : 0.3} />
                </mesh>
                <group position={[0, 0, 0.014]}>
                  <Gear scale={0.04} color={GLOW} emissive={GLOW} emissiveIntensity={2} />
                </group>
              </group>
            )}
          </group>
        ))}

        {/* neck */}
        <mesh position={[0, 0.68, 0]}>
          <cylinderGeometry args={[0.1, 0.12, 0.1, 16]} />
          <meshStandardMaterial color={BOOT} roughness={0.5} />
        </mesh>

        {/* head */}
        <group ref={refs.head} position={[0, 1.12, 0]}>
          <RoundedBox args={[1.06, 0.84, 0.9]} radius={0.34} smoothness={6} castShadow>
            <meshStandardMaterial color={WHITE} roughness={0.28} metalness={0.05} />
          </RoundedBox>
          {/* black glossy screen */}
          <RoundedBox args={[0.84, 0.6, 0.14]} radius={0.22} smoothness={6} position={[0, -0.02, 0.4]}>
            <meshPhysicalMaterial color={SCREEN} roughness={0.1} metalness={0.2} clearcoat={1} clearcoatRoughness={0.08} />
          </RoundedBox>
          <Face mood={mood} />
          {/* ear pods */}
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.55, -0.02, 0]} rotation={[0, 0, (side * Math.PI) / 2]}>
              <mesh>
                <cylinderGeometry args={[0.17, 0.17, 0.1, 28]} />
                <meshStandardMaterial color={WHITE} roughness={0.3} />
              </mesh>
              <mesh position={[0, 0.052, 0]}>
                <cylinderGeometry args={[0.12, 0.12, 0.01, 28]} />
                <meshStandardMaterial color={SCREEN} roughness={0.2} metalness={0.3} />
              </mesh>
              <mesh position={[0, 0.058, 0]}>
                <torusGeometry args={[0.125, 0.016, 8, 32]} />
                <meshStandardMaterial color={GLOW} emissive={GLOW} emissiveIntensity={2.6} />
              </mesh>
            </group>
          ))}
          {/* hard hat */}
          <group position={[0, 0.28, -0.02]}>
            <mesh castShadow scale={[1, 0.8, 1]}>
              <sphereGeometry args={[0.64, 36, 24, 0, Math.PI * 2, 0, Math.PI / 2.05]} />
              <meshStandardMaterial color={WHITE} roughness={0.22} metalness={0.05} />
            </mesh>
            {/* ridge */}
            <mesh position={[0, 0.42, 0]} scale={[1, 0.55, 1]}>
              <boxGeometry args={[0.1, 0.3, 0.7]} />
              <meshStandardMaterial color={WHITE} roughness={0.22} />
            </mesh>
            {/* brim */}
            <mesh position={[0, 0.0, 0.08]} rotation={[0.1, 0, 0]}>
              <cylinderGeometry args={[0.72, 0.72, 0.045, 36]} />
              <meshStandardMaterial color={WHITE} roughness={0.22} />
            </mesh>
            {/* front gear */}
            <group position={[0, 0.3, 0.5]} rotation={[-0.55, 0, 0]}>
              <Gear scale={0.1} color="#2b3447" />
            </group>
          </group>
          {/* headset mic when calling */}
          <mesh position={[0.45, -0.18, 0.3]} rotation={[0, 0.4, -0.5]} visible={stage === "calling"}>
            <cylinderGeometry args={[0.012, 0.012, 0.3, 8]} />
            <meshStandardMaterial color={BOOT} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/* ---------- optional Blender model ---------- */
function GltfMuse({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} position={[0, -1.05, 0]} />;
}

type BotRefs = {
  body: React.RefObject<THREE.Group | null>;
  head: React.RefObject<THREE.Group | null>;
  legL: React.RefObject<THREE.Group | null>;
  legR: React.RefObject<THREE.Group | null>;
  armL: React.RefObject<THREE.Group | null>;
  armR: React.RefObject<THREE.Group | null>;
  tablet: React.RefObject<THREE.Mesh | null>;
};

export function AgentBot({ stage }: { stage: Stage }) {
  const root = useRef<THREE.Group>(null);
  const refs: BotRefs = {
    body: useRef<THREE.Group>(null),
    head: useRef<THREE.Group>(null),
    legL: useRef<THREE.Group>(null),
    legR: useRef<THREE.Group>(null),
    armL: useRef<THREE.Group>(null),
    armR: useRef<THREE.Group>(null),
    tablet: useRef<THREE.Mesh>(null),
  };
  const phase = useRef(0);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const route = useRef<THREE.Vector3[]>([]);
  const prevOnSite = useRef(false);
  const waveUntil = useRef(0);

  const onSite = stage === "warning" || stage === "critical" || stage === "investigating" || stage === "calling" || stage === "acknowledged";
  const busy = stage === "investigating" || stage === "calling";
  const calling = stage === "calling";

  // wave for a moment on every stage change, like the corner companion
  useEffect(() => {
    waveUntil.current = performance.now() / 1000 + 1.6;
  }, [stage]);

  useFrame(({ clock }, dt) => {
    const g = root.current;
    if (!g) return;
    if (onSite !== prevOnSite.current) {
      prevOnSite.current = onSite;
      route.current = [...(onSite ? TO_SITE : TO_STATION)];
    }
    let moving = false;
    const wp = route.current[0];
    if (wp) {
      const dist = Math.hypot(wp.x - g.position.x, wp.z - g.position.z);
      if (dist < 0.08) route.current.shift();
      else {
        moving = true;
        const step = Math.min(dist, dt * WALK_SPEED);
        tmp.set(wp.x - g.position.x, 0, wp.z - g.position.z).normalize().multiplyScalar(step);
        g.position.add(tmp);
        phase.current += dt * 11;
      }
    }
    const yaw = moving && wp ? Math.atan2(wp.x - g.position.x, wp.z - g.position.z) : onSite ? 0.2 : 0.1;
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, yaw, 1 - Math.pow(0.01, dt));

    const t = clock.elapsedTime;
    const now = performance.now() / 1000;
    const waving = now < waveUntil.current && !moving;
    const swing = moving ? Math.sin(phase.current) : 0;
    if (refs.legL.current) refs.legL.current.rotation.x = swing * 0.6;
    if (refs.legR.current) refs.legR.current.rotation.x = -swing * 0.6;

    // right arm: thumbs-up raised at rest (like the render), waves on stage change,
    // hand to ear when calling, points at the motor when busy
    let rX = -0.35;
    let rZ = 1.9;
    if (moving) {
      rX = -swing * 0.5;
      rZ = 0.15;
    } else if (calling) {
      rX = -2.2;
      rZ = 0.4;
    } else if (busy) {
      rX = -0.4;
      rZ = 1.25 + Math.sin(t * 3) * 0.05;
    } else if (waving) {
      rX = -0.2;
      rZ = 2.3 + Math.sin(t * 9) * 0.35;
    }
    if (refs.armR.current) {
      refs.armR.current.rotation.x = THREE.MathUtils.lerp(refs.armR.current.rotation.x, rX, 1 - Math.pow(0.02, dt));
      refs.armR.current.rotation.z = THREE.MathUtils.lerp(refs.armR.current.rotation.z, rZ, 1 - Math.pow(0.02, dt));
    }
    if (refs.armL.current) {
      refs.armL.current.rotation.x = THREE.MathUtils.lerp(refs.armL.current.rotation.x, moving ? swing * 0.5 : busy ? -1.25 : -1.0, 1 - Math.pow(0.02, dt));
      refs.armL.current.rotation.z = 0.25;
    }
    if (refs.body.current) refs.body.current.position.y = 0.58 + (moving ? Math.abs(Math.sin(phase.current)) * 0.05 : waving ? Math.abs(Math.sin(t * 9)) * 0.03 : Math.sin(t * 2) * 0.015);
    if (refs.head.current) {
      const want = onSite && !moving ? 0.38 : Math.sin(t * 0.6) * 0.3;
      refs.head.current.rotation.y = THREE.MathUtils.lerp(refs.head.current.rotation.y, want, 1 - Math.pow(0.02, dt));
      refs.head.current.rotation.x = THREE.MathUtils.lerp(refs.head.current.rotation.x, onSite && !moving ? 0.1 : Math.sin(t * 1.3) * 0.04, 1 - Math.pow(0.02, dt));
      refs.head.current.rotation.z = THREE.MathUtils.lerp(refs.head.current.rotation.z, waving ? 0.1 : 0, 1 - Math.pow(0.02, dt));
    }
    if (refs.tablet.current) {
      const m = refs.tablet.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = busy ? 1.2 + Math.sin(t * 6) * 0.3 : 0.35;
    }
  });

  const useGlb = process.env.NEXT_PUBLIC_MUSE_GLB === "1";

  return (
    <group ref={root} position={[STATION.x, -0.09, STATION.z]} scale={0.92}>
      {useGlb ? (
        <Suspense fallback={<ProceduralMuse stage={stage} refs={refs} />}>
          <GltfMuse url="/models/muse.glb" />
        </Suspense>
      ) : (
        <ProceduralMuse stage={stage} refs={refs} />
      )}

      <Html position={[0, 2.15, 0]} center style={{ pointerEvents: "none" }} zIndexRange={[3, 0]}>
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            fontWeight: 600,
            color: "#0b1a33",
            background: "rgba(255,255,255,.95)",
            border: "1px solid #c9d8f2",
            borderRadius: 14,
            padding: "6px 12px",
            whiteSpace: "nowrap",
            boxShadow: "0 10px 24px -10px rgba(30,111,255,.45)",
            position: "relative",
          }}
        >
          <span style={{ color: "#3b7bff", marginRight: 6 }}>⚙</span>
          {SPEECH[stage]}
          <span
            style={{
              position: "absolute",
              left: "50%",
              bottom: -6,
              width: 10,
              height: 10,
              background: "rgba(255,255,255,.95)",
              borderRight: "1px solid #c9d8f2",
              borderBottom: "1px solid #c9d8f2",
              transform: "translateX(-50%) rotate(45deg)",
            }}
          />
        </div>
      </Html>
      <pointLight position={[0, 1.3, 0.7]} color={GLOW} intensity={busy ? 2.5 : 0.8} distance={2.5} />
    </group>
  );
}
