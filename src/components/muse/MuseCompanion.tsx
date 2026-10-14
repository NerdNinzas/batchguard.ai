"use client";
/* eslint-disable @next/next/no-img-element */

import { AnimatePresence, motion, useMotionValue, useSpring, useAnimationControls } from "framer-motion";
import { useEffect, useRef, useState } from "react";

/** Section id → what Muse says there. Order = scroll order. */
const SCRIPT: { id: string; line: string }[] = [
  { id: "top", line: "Hi, I'm Muse — BatchGuard's agent. Scroll and I'll show you how I keep a line safe." },
  { id: "story", line: "Watch me catch a bearing fault. Keep scrolling — you're driving the timeline." },
  { id: "problem", line: "This is the gap I'm built for: alarms that never explain themselves." },
  { id: "journey", line: "Nine steps, three stations. Onboard, watch, respond." },
  { id: "pipeline", line: "Here's how I'm wired. Every node is a Google Cloud service doing one job." },
  { id: "agent", line: "Detection is plain code. The thinking part is me, on Gemini." },
  { id: "architecture", line: "I only wake up when an incident opens — that's why I'm cheap to run." },
  { id: "evaluation", line: "Blind runs. I don't get to peek at the label before I answer." },
  { id: "scale", line: "Same API for real PLCs. I scale with Cloud Run." },
  { id: "cta", line: "That's the whole loop. Come break a bearing with me on Oct 18." },
];

/* Regions of /muse.webp (664×887), measured on the cutout. */
const ARM = "polygon(64.5% 45%, 70.5% 36%, 81.3% 30.3%, 100% 30%, 100% 50%, 85.8% 57.2%, 70% 54.9%)";
const BODY = "polygon(0 0, 100% 0, 100% 30%, 81.3% 30.3%, 70.5% 36%, 64.5% 45%, 70% 54.9%, 85.8% 57.2%, 100% 50%, 100% 100%, 0 100%)";
const SHOULDER = "66.3% 48.1%";

/**
 * Muse as the full character render: stands in the page corner with the
 * tablet, breathes and floats, leans toward the cursor, and raises/waves
 * the thumbs-up arm every time you reach a new section.
 */
export function MuseCompanion() {
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(true);
  const arm = useAnimationControls();
  const body = useAnimationControls();
  const scrollT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWave = useRef(0);

  // lean toward the pointer
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const rz = useSpring(tx, { stiffness: 120, damping: 18 });
  const ry = useSpring(ty, { stiffness: 120, damping: 18 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const nx = e.clientX / window.innerWidth - 0.85;
      const ny = e.clientY / window.innerHeight - 0.8;
      tx.set(nx * -6);
      ty.set(nx * 14 + ny * 0);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [tx, ty]);

  const wave = () => {
    const now = Date.now();
    if (now - lastWave.current < 900) return;
    lastWave.current = now;
    arm.start({ rotate: [0, -16, 6, -16, 6, 0], transition: { duration: 1.3, ease: "easeInOut" } });
    body.start({ y: [0, -14, 0, -6, 0], scaleY: [1, 1.03, 1, 1.01, 1], transition: { duration: 0.9, ease: "easeOut" } });
  };

  // which section is in view
  useEffect(() => {
    const els = SCRIPT.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const ratios = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => ratios.set((e.target as HTMLElement).id, e.intersectionRatio));
        let best = -1;
        let bestId = "";
        ratios.forEach((r, id) => {
          if (r > best) {
            best = r;
            bestId = id;
          }
        });
        const i = SCRIPT.findIndex((s) => s.id === bestId);
        if (i >= 0) setIdx(i);
      },
      { threshold: [0, 0.15, 0.3, 0.5, 0.7, 1] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // wave + reopen the bubble whenever the section changes
  useEffect(() => {
    setOpen(true);
    wave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // small bounce while scrolling so it feels alive
  useEffect(() => {
    const onScroll = () => {
      if (scrollT.current) return;
      body.start({ y: [0, -4, 0], transition: { duration: 0.35 } });
      scrollT.current = setTimeout(() => (scrollT.current = null), 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [body]);

  const cur = SCRIPT[idx];
  function next() {
    const n = SCRIPT[Math.min(idx + 1, SCRIPT.length - 1)];
    document.getElementById(n.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="pointer-events-none fixed bottom-0 right-2 z-40 flex items-end gap-2 sm:right-5">
      <AnimatePresence mode="wait">
        {open && (
          <motion.div
            key={cur.id}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.25 }}
            className="card pointer-events-auto relative mb-24 hidden max-w-[250px] rounded-2xl px-4 py-3 sm:block"
          >
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-blue">Muse · agent</span>
              <button onClick={() => setOpen(false)} aria-label="Hide" className="text-muted hover:text-ink">
                ×
              </button>
            </div>
            <p className="text-[13px] leading-snug text-ink">{cur.line}</p>
            {idx < SCRIPT.length - 1 && (
              <button onClick={next} className="mt-2 text-[12px] font-semibold text-blue hover:underline">
                Take me to the next part →
              </button>
            )}
            <span className="absolute -right-1.5 top-8 h-3 w-3 rotate-45 border-r border-t border-line bg-white" />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => (open ? next() : setOpen(true))}
        onMouseEnter={wave}
        aria-label="Muse, the BatchGuard agent"
        className="pointer-events-auto relative w-[110px] sm:w-[150px]"
        style={{ rotate: rz, x: ry, transformOrigin: "50% 100%" }}
      >
        {/* floor shadow */}
        <motion.span
          className="absolute bottom-1 left-1/2 h-3 w-[70%] -translate-x-1/2 rounded-full bg-ink/20 blur-[3px]"
          animate={{ scaleX: [1, 0.92, 1], opacity: [0.35, 0.25, 0.35] }}
          transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }}
        />
        <motion.div
          animate={body}
          className="relative"
          style={{ aspectRatio: "664 / 887", transformOrigin: "50% 100%" }}
          initial={false}
        >
          {/* idle float */}
          <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }} className="absolute inset-0">
            <img src="/muse.webp" alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" style={{ clipPath: BODY }} />
            <motion.img
              src="/muse.webp"
              alt=""
              draggable={false}
              animate={arm}
              initial={{ rotate: 0 }}
              className="absolute inset-0 h-full w-full select-none"
              style={{ clipPath: ARM, transformOrigin: SHOULDER }}
            />
          </motion.div>
        </motion.div>
      </motion.button>
    </div>
  );
}
