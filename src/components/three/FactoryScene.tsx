"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Clone, ContactShadows, Environment, Html, Lightformer, RoundedBox, Sparkles, useGLTF } from "@react-three/drei";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Stage } from "./story";
import { STAGES } from "./story";
import { AgentBot } from "./AgentBot";

/**
 * Live 3D packaging line built from Kenney's CC0 Factory Kit (public/models/factory)
 * plus a detailed procedural drive motor — the unit that fails. `stage` drives
 * belt speed, health lamps, vibration, sparks, the agent character and the camera.
 */

export type Health = "normal" | "warning" | "critical";
export const HEALTH_HEX: Record<Health, string> = { normal: "#16c784", warning: "#f59e0b", critical: "#ef4444" };

const STEEL = "#cfd8e6";
const STEEL_DARK = "#7f8fa8";
const GUN = "#3b4556";
const SAFETY = "#f5b400";

const FLOOR = -1.06;
const K = 1.5; // kit scale: 1 kit unit = 1.5 scene units
const BELT_TOP = FLOOR + 0.4 * K; // kit conveyor is 0.4 high
const BELT_START = -5.2;
const BELT_END = 6.0;
const BELT_LEN = BELT_END - BELT_START;
const MOTOR_POS: [number, number, number] = [-2.0, FLOOR + 0.5, -1.45];

export function healthOf(stage: Stage): Health {
  switch (stage) {
    case "warning":
    case "acknowledged":
      return "warning";
    case "critical":
    case "investigating":
    case "calling":
      return "critical";
    default:
      return "normal";
  }
}
function beltSpeedOf(stage: Stage) {
  switch (stage) {
    case "critical":
      return 0.55;
    case "investigating":
    case "calling":
      return 0.35;
    case "acknowledged":
      return 0.2;
    default:
      return 1;
  }
}
function shakeOf(stage: Stage) {
  const i = STAGES.indexOf(stage);
  return [0, 0.004, 0.009, 0.016, 0.016, 0.016, 0.006, 0][i];
}

/* ---------- kit models ---------- */
const KIT = "/models/factory/";
function Kit({
  name,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = K,
}: {
  name: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}) {
  const { scene } = useGLTF(`${KIT}${name}.glb`);
  return <Clone object={scene} position={position} rotation={rotation} scale={scale} castShadow receiveShadow />;
}
["conveyor-long-sides", "hopper-high-round", "scanner-high", "robot-arm-a", "machine-window", "machine-fortified", "structure-window-wide", "structure-wall", "pipe-large-long", "pipe-large-bend", "screen-hanging-wide", "crane", "warning-orange", "box-small", "box-large", "cog-a", "catwalk-straight", "screen-panel-wide"].forEach((n) =>
  useGLTF.preload(`${KIT}${n}.glb`),
);

/* ---------- procedural textures (client only) ---------- */
function makeCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function useFloorTexture() {
  return useMemo(() => {
    const t = makeCanvas(512, 512, (g) => {
      g.fillStyle = "#e3e8f0";
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 6000; i++) {
        g.fillStyle = `rgba(80,100,130,${Math.random() * 0.08})`;
        g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
      }
      g.strokeStyle = "rgba(60,80,110,.16)";
      g.lineWidth = 2;
      for (let i = 0; i <= 512; i += 128) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, 512);
        g.moveTo(0, i);
        g.lineTo(512, i);
        g.stroke();
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(12, 12);
    return t;
  }, []);
}

/* ---------- label ---------- */
export function Label({
  text,
  color = "#0b1a33",
  y = 0,
  bg = "rgba(255,255,255,.92)",
  visible = true,
  size = 10,
}: {
  text: string;
  color?: string;
  y?: number;
  bg?: string;
  visible?: boolean;
  size?: number;
}) {
  return (
    <Html position={[0, y, 0]} center style={{ pointerEvents: "none" }} zIndexRange={[2, 0]}>
      <div
        style={{
          opacity: visible ? 1 : 0,
          transition: "opacity .3s",
          fontFamily: "var(--font-mono)",
          fontSize: size,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color,
          background: bg,
          border: `1px solid ${color}44`,
          borderRadius: 999,
          padding: "3px 10px",
          whiteSpace: "nowrap",
          boxShadow: "0 6px 20px -8px rgba(11,26,51,.3)",
        }}
      >
        {text}
      </div>
    </Html>
  );
}

function Lamp({ health, position = [0, 0, 0] as [number, number, number] }: { health: Health; position?: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const p = health === "normal" ? 1 : 1 + Math.sin(clock.elapsedTime * (health === "critical" ? 10 : 5)) * 0.5;
    if (ref.current) ref.current.scale.setScalar(0.9 + 0.15 * p);
    if (light.current) light.current.intensity = 3 * p;
  });
  const c = HEALTH_HEX[health];
  return (
    <group position={position}>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.2, 12]} />
        <meshStandardMaterial color={GUN} metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.26, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.05, 16]} />
        <meshStandardMaterial color={GUN} metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh ref={ref} position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.07, 0.08, 0.2, 16]} />
        <meshStandardMaterial color={c} emissive={c} emissiveIntensity={2.2} transparent opacity={0.95} />
      </mesh>
      <pointLight ref={light} color={c} position={[0, 0.5, 0]} distance={3} />
    </group>
  );
}

/* ---------- the line ---------- */
function Conveyors() {
  return (
    <group>
      {[-4.5, -1.5, 1.5, 4.5].map((x) => (
        <Kit key={x} name="conveyor-long-sides" position={[x, FLOOR, 0]} />
      ))}
    </group>
  );
}

function Feeder() {
  const drop = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (drop.current) drop.current.position.y = FLOOR + 1.9 - ((clock.elapsedTime * 1.2) % 1) * 1.3;
  });
  return (
    <group position={[-5.3, 0, 0]}>
      <Kit name="hopper-high-round" position={[0, FLOOR, 0]} />
      <group ref={drop} position={[0.1, FLOOR + 1.5, 0]}>
        <Kit name="box-small" position={[0, 0, 0]} scale={0.7} />
      </group>
      <Lamp health="normal" position={[0.55, FLOOR + 2.25, 0.55]} />
      <group position={[0, FLOOR + 3.1, 0]}>
        <Label text="Feeder · feed_rate · hopper_level" />
      </group>
    </group>
  );
}

/** The drive motor: the machine that fails. Detailed procedural model. */
function DriveMotor({ stage }: { stage: Stage }) {
  const health = healthOf(stage);
  const shake = shakeOf(stage);
  const motor = useRef<THREE.Group>(null);
  const fan = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, dt) => {
    if (fan.current) fan.current.rotation.x += dt * (stage === "running" || stage === "resolved" ? 14 : 5);
    if (motor.current) {
      const t = clock.elapsedTime * 60;
      motor.current.position.x = MOTOR_POS[0] + Math.sin(t) * shake;
      motor.current.position.y = MOTOR_POS[1] + Math.cos(t * 1.3) * shake;
    }
  });
  const hc = HEALTH_HEX[health];
  const hot = health !== "normal";
  return (
    <group ref={motor} position={MOTOR_POS} scale={0.95}>
      <mesh position={[0, -0.45, 0]} castShadow>
        <boxGeometry args={[1.7, 0.08, 0.9]} />
        <meshStandardMaterial color={GUN} metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.36, 0.36, 1.3, 32]} />
        <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.32} emissive={hc} emissiveIntensity={hot ? 0.18 : 0} />
      </mesh>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-0.5 + i * 0.125, 0, 0]} castShadow>
          <boxGeometry args={[0.03, 0.82, 0.82]} />
          <meshStandardMaterial color={STEEL_DARK} metalness={0.75} roughness={0.3} emissive={hc} emissiveIntensity={hot ? 0.25 : 0} />
        </mesh>
      ))}
      <RoundedBox args={[0.5, 0.28, 0.4]} radius={0.03} position={[0.05, 0.45, 0]} castShadow>
        <meshStandardMaterial color={GUN} metalness={0.6} roughness={0.4} />
      </RoundedBox>
      <mesh position={[0.78, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.34, 0.3, 0.22, 32, 1, true]} />
        <meshStandardMaterial color={GUN} metalness={0.7} roughness={0.35} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={fan} position={[0.8, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.2, 0.035, 6, 5]} />
        <meshStandardMaterial color={STEEL_DARK} metalness={0.8} roughness={0.3} />
      </mesh>
      {/* drive-end bearing + shaft into the conveyor */}
      <mesh position={[-0.74, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.2, 0.14, 24]} />
        <meshStandardMaterial color={hot ? hc : STEEL_DARK} emissive={hc} emissiveIntensity={hot ? 1.4 : 0} metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[-0.74, 0, 0.45]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.9, 12]} />
        <meshStandardMaterial color={STEEL_DARK} metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[0.1, 0.1, 0.37]}>
        <boxGeometry args={[0.3, 0.14, 0.01]} />
        <meshStandardMaterial color="#e8ecf2" metalness={0.6} roughness={0.3} />
      </mesh>
      <Lamp health={health} position={[0.35, 0.58, 0]} />
      <group position={[0, 1.25, 0]}>
        <Label text={`Conveyor drive · ${health}`} color={health === "normal" ? "#0b1a33" : hc} />
      </group>
      {hot && <Sparkles count={40} scale={[1.4, 0.9, 0.9]} size={4} speed={1.6} color={hc} />}
    </group>
  );
}

function Inspection({ stage }: { stage: Stage }) {
  const beam = useRef<THREE.Mesh>(null);
  const speed = beltSpeedOf(stage);
  useFrame(({ clock }) => {
    if (beam.current) beam.current.position.y = BELT_TOP + 0.35 + Math.sin(clock.elapsedTime * 3 * speed) * 0.3;
  });
  return (
    <group position={[1.6, 0, 0]}>
      <Kit name="scanner-high" position={[0, FLOOR, 0]} />
      <mesh ref={beam} position={[0, BELT_TOP + 0.4, 0]}>
        <boxGeometry args={[0.02, 0.01, 1.4]} />
        <meshStandardMaterial color="#38a8ff" emissive="#38a8ff" emissiveIntensity={3} transparent opacity={0.85} />
      </mesh>
      <Lamp health="normal" position={[0, FLOOR + 1.9, 1.2]} />
      <group position={[0, FLOOR + 2.7, 0]}>
        <Label text="Inspection · item_weight · reject_rate" />
      </group>
      {/* reject bin */}
      <Kit name="box-large" position={[0.4, FLOOR, 2.1]} scale={1.1} />
    </group>
  );
}

function Packer({ stage }: { stage: Stage }) {
  const arm = useRef<THREE.Group>(null);
  const speed = beltSpeedOf(stage);
  useFrame(({ clock }) => {
    if (arm.current) arm.current.rotation.y = Math.sin(clock.elapsedTime * 1.2 * speed) * 0.8 - 0.4;
  });
  return (
    <group>
      <group ref={arm} position={[4.3, FLOOR, -1.7]}>
        <Kit name="robot-arm-a" position={[0, 0, 0]} scale={1.15} />
      </group>
      <Kit name="machine-window" position={[6.95, FLOOR, 0]} rotation={[0, -Math.PI / 2, 0]} />
      <Lamp health="normal" position={[6.95, FLOOR + 1.95, 0.9]} />
      <group position={[6.95, FLOOR + 2.7, 0]}>
        <Label text="Sealer / packer · seal_temp · cycle_time" />
      </group>
      {/* palletised output */}
      <group position={[8.6, FLOOR, 1.2]}>
        <mesh position={[0, 0.05, 0]}>
          <boxGeometry args={[1.3, 0.1, 1.3]} />
          <meshStandardMaterial color="#b98f5c" roughness={0.95} />
        </mesh>
        {[
          [-0.3, 0.3],
          [0.3, 0.3],
          [-0.3, -0.3],
          [0.3, -0.3],
        ].map(([x, z], i) => (
          <Kit key={i} name="box-small" position={[x, 0.1, z]} scale={0.9} rotation={[0, (i % 2) * 0.2, 0]} />
        ))}
      </group>
    </group>
  );
}

function Boxes({ stage }: { stage: Stage }) {
  const count = 9;
  const refs = useRef<THREE.Group[]>([]);
  const offsets = useMemo(() => Array.from({ length: count }, (_, i) => i / count), []);
  const t = useRef(0);
  const speed = beltSpeedOf(stage) * 0.11;
  useFrame((_, dt) => {
    t.current += dt * speed;
    refs.current.forEach((m, i) => {
      if (!m) return;
      const p = (offsets[i] + t.current) % 1;
      m.position.x = BELT_START + p * BELT_LEN;
      const reject = i === 2 && p > 0.62 && p < 0.74;
      m.position.z = reject ? (p - 0.62) * 12 : 0;
      m.rotation.y = reject ? (p - 0.62) * 5 : 0;
      m.visible = p < 0.98;
    });
  });
  return (
    <>
      {offsets.map((_, i) => (
        <group key={i} ref={(el) => el && (refs.current[i] = el)} position={[0, BELT_TOP, 0]}>
          <Kit name="box-small" scale={0.8} />
        </group>
      ))}
    </>
  );
}

/* ---------- surroundings ---------- */
function Surroundings() {
  const floorTex = useFloorTexture();
  const cog = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (cog.current) cog.current.rotation.y += dt * 0.6;
  });
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial map={floorTex} roughness={0.55} metalness={0.05} />
      </mesh>
      {/* floor safety lines */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR + 0.005, 3.1]}>
        <planeGeometry args={[18, 0.08]} />
        <meshBasicMaterial color={SAFETY} />
      </mesh>
      {/* back wall with windows */}
      {[-12, -9, -6, -3, 0, 3, 6, 9, 12].map((x) => (
        <Kit key={x} name="structure-window-wide" position={[x, FLOOR, -9.5]} />
      ))}
      {/* pipes along the wall */}
      {[-9, -7, -5, -3, -1, 1, 3, 5, 7, 9].map((x) => (
        <Kit key={x} name="pipe-large-long" position={[x, FLOOR + 4.6, -8.3]} scale={1} />
      ))}
      <Kit name="pipe-large-bend" position={[10.5, FLOOR + 4.6, -8.3]} scale={1} />
      {/* hanging status screen */}
      <Kit name="screen-hanging-wide" position={[-2, FLOOR + 3.8, -6.5]} scale={2.2} />
      {/* overhead crane */}
      <Kit name="crane" position={[6.5, FLOOR, -4.6]} scale={1.4} />
      {/* control cabinet + catwalk */}
      <Kit name="machine-fortified" position={[-9.2, FLOOR, -3.4]} />
      <Kit name="screen-panel-wide" position={[-8.2, FLOOR, 0.4]} rotation={[0, Math.PI / 3, 0]} />
      <Kit name="catwalk-straight" position={[-10.5, FLOOR + 3.6, -7.0]} rotation={[0, Math.PI / 2, 0]} />
      {/* spinning cog on the wall */}
      <group ref={cog} position={[8.6, FLOOR + 2.4, -8.2]} rotation={[Math.PI / 2, 0, 0]}>
        <Kit name="cog-a" scale={1.2} />
      </group>
      {/* cones */}
      <Kit name="warning-orange" position={[-3.8, FLOOR, 2.7]} scale={1.1} />
      <Kit name="warning-orange" position={[3.2, FLOOR, 2.8]} scale={1.1} />
      {/* ceiling light panels */}
      {[-6, -2, 2, 6].map((x) => (
        <mesh key={x} position={[x, FLOOR + 5.4, -1]}>
          <boxGeometry args={[2, 0.05, 0.6]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1.2} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------- camera ---------- */
function CameraRig({ stage, interactive }: { stage: Stage; interactive: boolean }) {
  const { camera, pointer, size } = useThree();
  const pos = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const focus = stage === "investigating" || stage === "calling" || stage === "critical" || stage === "drift" || stage === "warning";
  useFrame((_, dt) => {
    const px = interactive ? pointer.x : 0;
    const py = interactive ? pointer.y : 0;
    const aspect = size.width / Math.max(1, size.height);
    const k = Math.min(1.5, Math.max(1, 1.9 / aspect));
    if (focus) {
      pos.set(-2.4 + px * 1.0, 2.9 - py * 0.3, 8.8 * k);
      look.set(-2.2, -0.2, -0.8);
    } else {
      pos.set(0.4 + px * 1.5, 4.8 - py * 0.5, 14.5 * k);
      look.set(0.2, -0.1, -0.8);
    }
    camera.position.lerp(pos, 1 - Math.pow(0.02, dt));
    camera.lookAt(look);
  });
  return null;
}

export default function FactoryScene({ stage, interactive = true }: { stage: Stage; interactive?: boolean }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [0.4, 4.8, 14.5], fov: 36 }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[6, 12, 6]}
        intensity={2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <directionalLight position={[-6, 4, -6]} intensity={0.5} color="#cfe3ff" />
      <Environment resolution={256}>
        <Lightformer intensity={2.5} position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 6, 1]} color="#ffffff" />
        <Lightformer intensity={1.2} position={[-8, 2, 2]} rotation={[0, Math.PI / 2, 0]} scale={[6, 3, 1]} color="#dbe9ff" />
        <Lightformer intensity={1.2} position={[8, 2, 2]} rotation={[0, -Math.PI / 2, 0]} scale={[6, 3, 1]} color="#ffffff" />
        <Lightformer intensity={0.6} position={[0, 1, -8]} scale={[10, 3, 1]} color="#cfdcf0" />
      </Environment>
      <CameraRig stage={stage} interactive={interactive} />
      <Suspense fallback={null}>
        <Surroundings />
        <Conveyors />
        <Feeder />
        <DriveMotor stage={stage} />
        <Boxes stage={stage} />
        <Inspection stage={stage} />
        <Packer stage={stage} />
        <AgentBot stage={stage} />
      </Suspense>
      <ContactShadows position={[0, FLOOR + 0.01, 0]} opacity={0.4} scale={30} blur={2.2} far={5} color="#0b1a33" />
    </Canvas>
  );
}
