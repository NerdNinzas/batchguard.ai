"use client";

import { AnimatePresence, motion } from "framer-motion";
import { PhoneCall, Cpu, CheckCircle2, Activity } from "lucide-react";
import { STAGES, STAGE_INFO, readingsFor, type Stage } from "./story";

const TONE: Record<string, string> = {
  blue: "text-blue border-blue/30 bg-blue/5",
  amber: "text-amber border-amber/40 bg-amber/10",
  red: "text-red border-red/40 bg-red/10",
  green: "text-green border-green/40 bg-green/10",
  violet: "text-violet border-violet/40 bg-violet/10",
};

/** Overlay readouts rendered on top of the 3D viewport. */
export function HUD({ stage, compact = false }: { stage: Stage; compact?: boolean }) {
  const info = STAGE_INFO[stage];
  const r = readingsFor(stage);
  const idx = STAGES.indexOf(stage);
  const tempCls = r.temp >= 90 ? "text-red" : r.temp >= 80 ? "text-amber" : "text-ink";
  const vibCls = r.vib >= 6.5 ? "text-red" : r.vib >= 5 ? "text-amber" : "text-ink";

  return (
    <>
      {/* top-left: readings */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-2 sm:left-4 sm:top-4">
        <div className="glass flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-muted">
          <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-green text-green pulse-ring" /> live · line A · conv-01
        </div>
        {!compact && (
          <div className="glass grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl px-3 py-2 font-mono text-[11px]">
            {[
              ["vibration_rms", `${r.vib.toFixed(1)} mm/s`, vibCls],
              ["motor_temp", `${r.temp} °C`, tempCls],
              ["motor_current", `${r.amps.toFixed(1)} A`, "text-ink"],
              ["belt_speed", `${r.speed.toFixed(1)} m/s`, "text-ink"],
            ].map(([k, v, c]) => (
              <div key={k} className="contents">
                <span className="text-muted">{k}</span>
                <span className={`text-right font-semibold ${c}`}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* top-right: stage tag */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 sm:right-4 sm:top-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={stage}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wider backdrop-blur ${TONE[info.tone]}`}
          >
            {stage === "calling" ? <PhoneCall size={12} /> : stage === "investigating" ? <Cpu size={12} /> : stage === "resolved" || stage === "acknowledged" ? <CheckCircle2 size={12} /> : <Activity size={12} />}
            {info.tag}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* bottom: caption + progress */}
      {!compact && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 sm:inset-x-4 sm:bottom-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35 }}
              className="glass max-w-xl rounded-xl px-4 py-3"
            >
              <p className="text-sm font-semibold text-ink">{info.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{info.body}</p>
            </motion.div>
          </AnimatePresence>
          <div className="mt-2 flex gap-1">
            {STAGES.map((s, i) => (
              <span key={s} className={`h-1 flex-1 rounded-full transition-colors ${i <= idx ? "bg-blue" : "bg-ink/10"}`} />
            ))}
          </div>
        </div>
      )}

      {/* call bubble */}
      <AnimatePresence>
        {stage === "calling" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, x: 30 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="card absolute right-3 top-14 z-10 w-64 rounded-2xl p-4 sm:right-4"
          >
            <div className="flex items-center gap-3">
              <span className="relative grid h-10 w-10 place-items-center rounded-full bg-red text-white">
                <PhoneCall size={18} />
                <span className="pulse-ring absolute inset-0 rounded-full text-red" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">BatchGuard calling</p>
                <p className="text-[11px] text-muted">Owner · +65 •••• 4421</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink">
              “Conveyor conv-01 critical. Bearing wear likely. Check the drive-end bearing. Press 1 to acknowledge.”
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
