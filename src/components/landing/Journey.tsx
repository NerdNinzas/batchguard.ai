"use client";

import { motion } from "framer-motion";
import { Upload, Radar, PhoneCall, Package, type LucideIcon } from "lucide-react";
import { Section } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";
import { MuseLogo } from "@/components/muse/MuseLogo";
import { JOURNEY, PRINCIPLES } from "@/lib/content";

type Phase = {
  name: string;
  caption: string;
  icon: LucideIcon;
  tone: string;
  bg: string;
  steps: typeof JOURNEY;
  muse: string;
};

const PHASES: Phase[] = [
  {
    name: "Onboard",
    caption: "Manual in, verified spec and device key out. Under three minutes.",
    icon: Upload,
    tone: "text-blue",
    bg: "bg-blue",
    steps: JOURNEY.slice(0, 4),
    muse: "I read the PDF. You verify every number before it goes live.",
  },
  {
    name: "Watch",
    caption: "Telemetry streams in every second. I watch the trend, not just the limit.",
    icon: Radar,
    tone: "text-amber",
    bg: "bg-amber",
    steps: JOURNEY.slice(4, 6),
    muse: "Vibration creeping up? I'll tell you four minutes before it matters.",
  },
  {
    name: "Respond",
    caption: "Evidence-backed diagnosis, a phone call, and a human closing the loop.",
    icon: PhoneCall,
    tone: "text-red",
    bg: "bg-red",
    steps: JOURNEY.slice(6, 9),
    muse: "I rank causes with evidence for and against, then I call you.",
  },
];

/** A box riding the belt between the stations. */
function Rider({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      className="absolute -top-3 left-0 grid h-6 w-6 place-items-center rounded-md bg-[#d8ad73] text-[#7a5428] shadow-md"
      animate={{ left: ["0%", "100%"] }}
      transition={{ repeat: Infinity, duration: 9, ease: "linear", delay }}
    >
      <Package size={14} />
    </motion.div>
  );
}

export function Journey() {
  return (
    <Section
      id="journey"
      eyebrow="End-to-end journey"
      title="Three stations. One loop. From PDF manual to a ringing phone."
      lead="Every incident on BatchGuard travels the same line: a machine is onboarded, it is watched, and when something drifts the right person is reached with evidence in hand."
    >
      {/* the belt */}
      <div className="relative mb-10 hidden h-3 rounded-full border border-line bg-white md:block">
        <div className="belt absolute inset-0 rounded-full" />
        <Rider />
        <Rider delay={3} />
        <Rider delay={6} />
        {PHASES.map((p, i) => (
          <div key={p.name} className="absolute top-1/2 -translate-y-1/2" style={{ left: `${(i / 3) * 100 + 100 / 6}%` }}>
            <span className={`block h-5 w-5 -translate-x-1/2 rounded-full border-4 border-white ${p.bg} shadow`} />
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {PHASES.map((p, pi) => {
          const Icon = p.icon;
          return (
            <Reveal key={p.name} delay={pi * 0.1}>
              <div className="flex h-full flex-col">
                <div className="card relative overflow-hidden rounded-2xl p-5">
                  <span className="font-display absolute -right-2 -top-6 text-[110px] font-bold leading-none text-ink/[0.04]">0{pi + 1}</span>
                  <div className="flex items-center gap-3">
                    <span className={`grid h-11 w-11 place-items-center rounded-xl text-white ${p.bg}`}>
                      <Icon size={20} />
                    </span>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">Station {pi + 1}</p>
                      <h3 className="font-display text-3xl font-semibold leading-none text-ink">{p.name}</h3>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{p.caption}</p>
                </div>

                <ol className="relative mt-4 flex-1 space-y-3 border-l-2 border-dashed border-line pl-5">
                  {p.steps.map((s) => (
                    <li key={s.step} className="relative">
                      <span className={`absolute -left-[29px] top-3 h-3 w-3 rounded-full border-2 border-white ${p.bg}`} />
                      <motion.div whileHover={{ x: 4 }} className="card rounded-xl p-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-mono text-sm font-semibold ${p.tone}`}>{s.step}</span>
                          <span className="rounded-full border border-blue/30 bg-blue/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-blue">{s.tag}</span>
                        </div>
                        <p className="mt-1.5 text-base font-semibold text-ink">{s.title}</p>
                        <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
                      </motion.div>
                    </li>
                  ))}
                </ol>

                <div className="mt-4 flex items-start gap-3 rounded-xl border border-line bg-sky-soft/70 p-3">
                  <MuseLogo size={34} />
                  <p className="text-[13px] leading-snug text-ink">{p.muse}</p>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>

      <Reveal className="mt-16">
        <div className="grid gap-4 md:grid-cols-3">
          {PRINCIPLES.map((p, i) => (
            <div key={p.title} className="relative overflow-hidden rounded-2xl border border-line bg-white p-6">
              <span className="font-display absolute -right-3 -top-4 text-7xl font-bold text-ink/[0.05]">0{i + 1}</span>
              <p className="font-display text-xl font-semibold text-ink">{p.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
