"use client";

import dynamic from "next/dynamic";
import type { Stage } from "./story";

const FactoryScene = dynamic(() => import("./FactoryScene"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-sm text-muted">
      <span className="animate-pulse">Loading 3D factory…</span>
    </div>
  ),
});

/** Client-only wrapper so server components can mount the scene. */
export default function HeroScene({ stage, interactive }: { stage: Stage; interactive?: boolean }) {
  return <FactoryScene stage={stage} interactive={interactive} />;
}
