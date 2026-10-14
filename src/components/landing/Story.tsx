"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import HeroScene from "@/components/three/HeroScene";
import { HUD } from "@/components/three/HUD";
import { STAGES, STAGE_INFO, readingsFor, type Stage } from "@/components/three/story";

const TONE: Record<string, string> = {
  blue: "bg-blue",
  amber: "bg-amber",
  red: "bg-red",
  green: "bg-green",
  violet: "bg-violet",
};

/**
 * Scroll-driven incident. The 3D viewport is sticky; each step that enters
 * the viewport sets the stage, so scrolling *is* the timeline.
 */
export function Story() {
  const [stage, setStage] = useState<Stage>("running");
  const idx = STAGES.indexOf(stage);

  return (
    <section id="story" className="relative py-24 md:py-32">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-14 max-w-3xl">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-blue">One incident, start to finish</p>
          <h2 className="font-display text-4xl font-semibold leading-[1.02] text-ink sm:text-5xl md:text-6xl">
            Scroll to break a bearing. Watch the agent catch it.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            This is the exact round trip: machine → telemetry API → detection → agent → phone call → engineer. The 3D line
            reacts to each step as you scroll.
          </p>
        </div>

        <div className="grid gap-10 lg:grid-cols-[1.25fr_1fr]">
          {/* sticky 3D */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div
              className="card glow-blue relative h-[360px] overflow-hidden rounded-3xl sm:h-[460px] lg:h-[calc(100vh-8rem)] lg:max-h-[720px]"
              style={{ background: "linear-gradient(180deg,#ffffff 0%,#eaf3ff 100%)" }}
            >
              <HUD stage={stage} compact />
              <HeroScene stage={stage} interactive={false} />
              {/* readings strip */}
              <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 grid grid-cols-4 gap-2">
                {(() => {
                  const r = readingsFor(stage);
                  const rows: [string, string, string][] = [
                    ["vibration_rms", `${r.vib.toFixed(1)} mm/s`, r.vib >= 6.5 ? "text-red" : r.vib >= 5 ? "text-amber" : "text-ink"],
                    ["motor_temp", `${r.temp} °C`, r.temp >= 90 ? "text-red" : r.temp >= 80 ? "text-amber" : "text-ink"],
                    ["motor_current", `${r.amps.toFixed(1)} A`, "text-ink"],
                    ["belt_speed", `${r.speed.toFixed(1)} m/s`, r.speed < 1 ? "text-amber" : "text-ink"],
                  ];
                  return rows.map(([k, v, c]) => (
                    <div key={k} className="glass rounded-lg px-2.5 py-1.5 font-mono">
                      <p className="text-[10px] text-muted">{k}</p>
                      <p className={`text-sm font-semibold ${c}`}>{v}</p>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>

          {/* steps */}
          <ol className="relative space-y-6 lg:space-y-[40vh] lg:py-[20vh]">
            {STAGES.map((s, i) => {
              const info = STAGE_INFO[s];
              const active = i === idx;
              return (
                <motion.li
                  key={s}
                  onViewportEnter={() => setStage(s)}
                  viewport={{ amount: 0.6, margin: "-10% 0px -30% 0px" }}
                  animate={{ opacity: active ? 1 : 0.45, scale: active ? 1 : 0.98 }}
                  transition={{ duration: 0.35 }}
                  className={`card relative rounded-2xl p-6 transition-shadow ${active ? "glow-blue" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`grid h-8 w-8 place-items-center rounded-full font-mono text-xs font-semibold text-white ${TONE[info.tone]}`}>{i + 1}</span>
                    <span className="font-mono text-[11px] uppercase tracking-wider text-muted">{info.tag}</span>
                  </div>
                  <h3 className="mt-3 text-xl font-semibold text-ink">{info.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{info.body}</p>
                  {s === "investigating" && (
                    <div className="mt-4 rounded-xl border border-violet/30 bg-violet/5 p-3 font-mono text-[11px] leading-relaxed">
                      <p className="text-violet">#1 Bearing wear · STRONG · vibration leads temperature by 9 min (r = 0.91)</p>
                      <p className="text-amber">#2 Cooling fan failure · WEAK · contradicted: vibration moved first</p>
                      <p className="text-muted">#3 Overload · WEAK · load flat at 38 kg, no jam event</p>
                      <p className="mt-2 text-ink">Check first → IR-gun drive-end bearing · manual p.42 §7.3</p>
                    </div>
                  )}
                </motion.li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
