"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

function Cloud() {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const n = 1400;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 16;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 10;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 6;
    }
    return arr;
  }, []);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y += dt * 0.02;
    ref.current.rotation.x += dt * 0.005;
  });
  return (
    <Points ref={ref} positions={positions} stride={3}>
      <PointMaterial transparent color="#1e6fff" size={0.03} sizeAttenuation depthWrite={false} opacity={0.5} />
    </Points>
  );
}

export default function ParticleField({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`}>
      <Canvas camera={{ position: [0, 0, 6], fov: 60 }} dpr={[1, 1.5]} gl={{ alpha: true }}>
        <Cloud />
      </Canvas>
    </div>
  );
}
