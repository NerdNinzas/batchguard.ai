"use client";
/* eslint-disable @next/next/no-img-element */

import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { useEffect, useRef } from "react";

/* Same cut-outs as the landing companion. */
const ARM = "polygon(64.5% 45%, 70.5% 36%, 81.3% 30.3%, 100% 30%, 100% 50%, 85.8% 57.2%, 70% 54.9%)";
const BODY = "polygon(0 0, 100% 0, 100% 30%, 81.3% 30.3%, 70.5% 36%, 64.5% 45%, 70% 54.9%, 85.8% 57.2%, 100% 50%, 100% 100%, 0 100%)";
const SHOULDER = "66.3% 48.1%";

/**
 * Muse as an in-app guide: stands in a corner with its tablet, says `line`, and waves
 * whenever the line changes (each onboarding step, each dashboard page).
 */
export function MuseGuide({ line, size = 150, className = "", side = "right" }: { line: string; size?: number; className?: string; side?: "left" | "right" }) {
  const arm = useAnimationControls();
  const body = useAnimationControls();
  const last = useRef("");
  useEffect(() => {
    if (last.current === line) return;
    last.current = line;
    arm.start({ rotate: [0, -16, 6, -16, 6, 0], transition: { duration: 1.3, ease: "easeInOut" } });
    body.start({ y: [0, -12, 0, -5, 0], transition: { duration: 0.9, ease: "easeOut" } });
  }, [line, arm, body]);

  return (
    <div className={`flex items-end gap-3 ${side === "left" ? "flex-row" : "flex-row-reverse"} ${className}`}>
      <motion.div animate={body} className="relative shrink-0" style={{ width: size, aspectRatio: "664 / 887", transformOrigin: "50% 100%" }}>
        <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }} className="absolute inset-0">
          <img src="/muse.webp" alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" style={{ clipPath: BODY }} />
          <motion.img src="/muse.webp" alt="" draggable={false} animate={arm} initial={{ rotate: 0 }} className="absolute inset-0 h-full w-full select-none" style={{ clipPath: ARM, transformOrigin: SHOULDER }} />
        </motion.div>
      </motion.div>
      <AnimatePresence mode="wait">
        <motion.div key={line} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="card relative mb-10 max-w-[280px] rounded-2xl px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-blue">Muse</span>
          <p className="mt-1 text-[13px] leading-snug text-ink">{line}</p>
          <span className={`absolute top-8 h-3 w-3 rotate-45 border-line bg-white ${side === "left" ? "-left-1.5 border-b border-l" : "-right-1.5 border-r border-t"}`} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
