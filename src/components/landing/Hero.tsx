"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ArrowRight, PhoneCall, FileText, Activity, Pause, Play } from "lucide-react";
import HeroScene from "@/components/three/HeroScene";
import { HUD } from "@/components/three/HUD";
import { STAGES, type Stage } from "@/components/three/story";

const DURATION: Record<Stage, number> = {
  running: 3200,
  drift: 2800,
  warning: 3000,
  critical: 2800,
  investigating: 3400,
  calling: 3600,
  acknowledged: 2600,
  resolved: 3000,
};

const words = ["Your", "factory,", "watched", "by an", "agent", "that", "explains", "and", "calls."];

export function Hero() {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const stage = STAGES[i];

  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => setI((v) => (v + 1) % STAGES.length), DURATION[stage]);
    return () => clearTimeout(id);
  }, [i, playing, stage]);

  return (
    <section id="top" className="relative overflow-hidden pt-28 pb-10">
      <div className="grid-bg absolute inset-0" />
      <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-sky/20 blur-[140px]" />

      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-muted shadow-sm"
          >
            <span className="relative inline-block h-2 w-2 rounded-full bg-green text-green pulse-ring" />
            Google Cloud AI Builder Cup 2026 · Manufacturing
          </motion.div>

          <h1 className="font-display text-5xl font-semibold leading-[0.98] text-ink sm:text-6xl md:text-7xl lg:text-8xl">
            {words.map((w, k) => (
              <motion.span
                key={k}
                initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ delay: 0.1 + k * 0.07, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className={`mr-[0.28em] inline-block ${k >= 6 ? "text-gradient" : ""}`}
              >
                {w}
              </motion.span>
            ))}
          </h1>

          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8, duration: 0.6 }} className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            BatchGuard AI turns a PDF manual into a verified monitoring spec in two minutes. From then on, a Gemini agent
            on Google Cloud watches the machine 24/7, explains every abnormal reading with evidence, and{" "}
            <span className="font-medium text-ink">calls you when it is serious.</span>
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1, duration: 0.6 }} className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="#story" className="group inline-flex items-center gap-2 rounded-xl bg-blue px-5 py-3 font-semibold text-white shadow-lg shadow-blue/25 transition hover:brightness-110">
              Walk through an incident
              <ArrowRight size={18} className="transition group-hover:translate-x-0.5" />
            </a>
            <a href="#agent" className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-5 py-3 text-ink transition hover:border-blue/50 hover:text-blue">
              How the agent reasons
            </a>
          </motion.div>
        </div>

        {/* 3D viewport */}
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.5, duration: 1 }}
          className="card glow-blue relative mt-12 h-[420px] w-full overflow-hidden rounded-3xl sm:h-[520px] lg:h-[640px]"
          style={{ background: "linear-gradient(180deg,#ffffff 0%,#eaf3ff 100%)" }}
        >
          <HUD stage={stage} />
          <button
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause" : "Play"}
            className="glass absolute bottom-3 right-3 z-20 grid h-9 w-9 place-items-center rounded-full text-ink sm:bottom-4 sm:right-4"
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <HeroScene stage={stage} />
        </motion.div>

        <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3, duration: 0.8 }} className="mx-auto mt-8 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { icon: FileText, k: "< 3 min", v: "PDF manual → verified machine" },
            { icon: Activity, k: "< 10 s", v: "fault start → incident open" },
            { icon: PhoneCall, k: "< 60 s", v: "critical → phone ringing" },
          ].map(({ icon: Icon, k, v }) => (
            <li key={k} className="card rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 text-blue">
                <Icon size={16} />
                <span className="font-mono text-lg font-semibold text-ink">{k}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted">{v}</p>
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
