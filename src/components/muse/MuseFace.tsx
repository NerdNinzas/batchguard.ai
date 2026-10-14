"use client";

import { motion, useMotionValue, useSpring } from "framer-motion";
import { useEffect, useRef, useState } from "react";

export type Mood = "idle" | "happy" | "grin" | "concerned" | "thinking" | "wink" | "talk";

/*
 * Eyes are drawn as glowing strokes on a black screen. Each path keeps the
 * same command structure (M … Q … ) so framer-motion can morph between them.
 * "open" eyes are a near-circle arc; "happy" eyes are the ^ ^ arcs.
 */
const EYE_L: Record<Mood, string> = {
  idle: "M60 102 Q72 88 84 102 Q72 116 60 102",
  happy: "M58 108 Q72 86 86 108 Q72 96 58 108",
  grin: "M56 110 Q72 82 88 110 Q72 96 56 110",
  concerned: "M60 100 Q72 92 84 106 Q72 112 60 100",
  thinking: "M60 102 Q72 90 84 102 Q72 114 60 102",
  wink: "M58 108 Q72 86 86 108 Q72 96 58 108",
  talk: "M60 102 Q72 88 84 102 Q72 116 60 102",
};
const EYE_R: Record<Mood, string> = {
  idle: "M116 102 Q128 88 140 102 Q128 116 116 102",
  happy: "M114 108 Q128 86 142 108 Q128 96 114 108",
  grin: "M112 110 Q128 82 144 110 Q128 96 112 110",
  concerned: "M116 106 Q128 92 140 100 Q128 112 116 106",
  thinking: "M118 104 Q128 100 138 104 Q128 106 118 104",
  wink: "M118 104 Q128 100 138 104 Q128 106 118 104",
  talk: "M116 102 Q128 88 140 102 Q128 116 116 102",
};
const MOUTH: Record<Mood, string> = {
  idle: "M90 128 Q100 136 110 128",
  happy: "M88 126 Q100 142 112 126",
  grin: "M84 124 Q100 150 116 124",
  concerned: "M92 134 Q100 128 108 134",
  thinking: "M94 131 Q100 133 106 129",
  wink: "M88 126 Q100 142 112 126",
  talk: "M92 126 Q100 140 108 126",
};

/**
 * Muse: BatchGuard's agent as a face. A white robot head with a glossy black
 * screen, glowing blue eyes that follow the cursor, blue ear pods and a white
 * hard hat with a gear. `mood` morphs the eyes and mouth.
 */
export function MuseFace({
  size = 80,
  mood = "idle",
  track = true,
  hat = true,
  className = "",
  float = false,
}: {
  size?: number;
  mood?: Mood;
  track?: boolean;
  hat?: boolean;
  className?: string;
  float?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 220, damping: 22 });
  const sy = useSpring(py, { stiffness: 220, damping: 22 });
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    if (mood === "thinking") {
      px.set(6);
      py.set(-5);
      return;
    }
    if (!track) return;
    const onMove = (e: MouseEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const m = Math.min(1, d / 260);
      px.set((dx / d) * 7 * m);
      py.set((dy / d) * 5 * m);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [track, mood, px, py]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true);
        t2 = setTimeout(() => setBlink(false), 110);
        loop();
      }, 2400 + Math.random() * 3200);
    };
    loop();
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, []);

  const glowFilter = `drop-shadow(0 0 2px #5fd1ff) drop-shadow(0 0 5px rgba(95,209,255,.7))`;

  return (
    <motion.div
      className={`inline-block ${className}`}
      style={{ width: size, height: size }}
      animate={float ? { y: [0, -5, 0] } : undefined}
      transition={float ? { repeat: Infinity, duration: 3.2, ease: "easeInOut" } : undefined}
    >
      <svg ref={ref} viewBox="0 0 200 200" width={size} height={size} aria-label="Muse, the BatchGuard agent" role="img">
        <defs>
          <radialGradient id="muse-head" cx="0.35" cy="0.25" r="0.8">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="70%" stopColor="#eef2f8" />
            <stop offset="100%" stopColor="#cfd8e6" />
          </radialGradient>
          <radialGradient id="muse-screen" cx="0.35" cy="0.25" r="0.9">
            <stop offset="0%" stopColor="#1a2130" />
            <stop offset="60%" stopColor="#0a0e18" />
            <stop offset="100%" stopColor="#05070c" />
          </radialGradient>
          <linearGradient id="muse-shine" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="muse-hat" cx="0.4" cy="0.2" r="0.8">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#d9e0ea" />
          </radialGradient>
        </defs>

        {/* ear pods */}
        {[26, 174].map((cx) => (
          <g key={cx}>
            <ellipse cx={cx} cy="106" rx="14" ry="18" fill="url(#muse-head)" stroke="#c3cedd" strokeWidth="1.5" />
            <ellipse cx={cx} cy="106" rx="8" ry="11" fill="none" stroke="#5fd1ff" strokeWidth="3" style={{ filter: glowFilter }} />
          </g>
        ))}

        {/* head */}
        <circle cx="100" cy="108" r="66" fill="url(#muse-head)" stroke="#c3cedd" strokeWidth="1.5" />
        {/* screen */}
        <path d="M46 104 Q46 56 100 56 Q154 56 154 104 Q154 150 100 152 Q46 150 46 104 Z" fill="url(#muse-screen)" />
        <path d="M52 100 Q56 66 100 62 Q128 64 140 76 Q120 70 100 72 Q66 76 52 100 Z" fill="url(#muse-shine)" />

        {/* eyes: glowing arcs that track the cursor */}
        <motion.g style={{ x: sx, y: sy }}>
          <motion.g animate={{ scaleY: blink ? 0.12 : 1 }} style={{ originY: "104px", originX: "100px" }} transition={{ duration: 0.08 }}>
            <motion.path animate={{ d: EYE_L[mood] }} transition={{ type: "spring", stiffness: 200, damping: 20 }} fill="none" stroke="#5fd1ff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" style={{ filter: glowFilter }} />
            <motion.path animate={{ d: EYE_R[mood] }} transition={{ type: "spring", stiffness: 200, damping: 20 }} fill="none" stroke="#5fd1ff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" style={{ filter: glowFilter }} />
          </motion.g>
          {/* blush dashes */}
          {[[62, 118], [68, 120], [74, 118], [126, 118], [132, 120], [138, 118]].map(([x, y]) => (
            <rect key={`${x}${y}`} x={x} y={y} width="2.5" height="7" rx="1.2" fill="#5fd1ff" opacity="0.8" />
          ))}
          {/* mouth */}
          <motion.path animate={{ d: MOUTH[mood] }} transition={{ type: "spring", stiffness: 220, damping: 20 }} fill="none" stroke="#5fd1ff" strokeWidth="5" strokeLinecap="round" style={{ filter: glowFilter }} />
          {mood === "grin" && <path d="M92 134 Q100 142 108 134 Z" fill="#5fd1ff" opacity="0.35" />}
        </motion.g>

        {/* hard hat */}
        {hat && (
          <g>
            <path d="M34 72 Q36 20 100 18 Q164 20 166 72 Z" fill="url(#muse-hat)" stroke="#c3cedd" strokeWidth="1.5" />
            <path d="M92 20 Q100 16 108 20 L110 60 L90 60 Z" fill="#ffffff" opacity="0.9" />
            <rect x="24" y="66" width="152" height="12" rx="6" fill="#e7ecf3" stroke="#c3cedd" strokeWidth="1.5" />
            {/* gear */}
            <g transform="translate(100 44)">
              <path
                d="M0 -13 L3 -12 L5 -16 L10 -13 L9 -9 L13 -7 L13 0 L9 2 L10 6 L7 9 L4 7 L2 11 L-2 11 L-4 7 L-7 9 L-10 6 L-9 2 L-13 0 L-13 -7 L-9 -9 L-10 -13 L-5 -16 L-3 -12 Z"
                fill="#2b3447"
              />
              <circle r="4.5" fill="#eef2f8" />
            </g>
          </g>
        )}
      </svg>
    </motion.div>
  );
}
