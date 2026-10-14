"use client";

import { motion } from "framer-motion";
import { Section } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";
import { METRICS } from "@/lib/content";
import { EyeOff, Lock, Trophy } from "lucide-react";

export function Evaluation() {
  return (
    <Section
      id="evaluation"
      eyebrow="Proof, not promises"
      title="Blind runs. The diagnosis is locked before the label is revealed."
      lead="A hidden fault is injected into the line; the agent's answer is saved before the ground truth is shown; the scoreboard shows real accuracy. Targets below are goals to measure against — the submission reports whatever the runs produce, with the number of runs."
    >
      <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
        <Reveal>
          <div className="glass glow-amber rounded-2xl p-6">
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.25em] text-blue">
              <Trophy size={14} /> Blind test protocol
            </p>
            <ol className="mt-5 space-y-4">
              {[
                { i: EyeOff, t: "Inject hidden fault", b: "Random fault + random start time. Label written to a restricted eval_runs store the agent's tools cannot read." },
                { i: Lock, t: "Lock the diagnosis", b: "Agent investigates and its ranked causes are saved with a timestamp." },
                { i: Trophy, t: "Reveal and score", b: "Top-1 / Top-3 accuracy, detection delay and false alarms go to the scoreboard shown in the demo." },
              ].map(({ i: Icon, t, b }, k) => (
                <li key={t} className="flex gap-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-amber/40 bg-amber/10 text-amber">
                    <Icon size={16} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {k + 1}. {t}
                    </p>
                    <p className="text-sm text-muted">{b}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-6 rounded-lg bg-sky-soft p-3 font-mono text-[11px] text-muted">
              Minimum test set: 7 fault types × 3 runs = 21 blind runs + 1 hour of normal running for false alarms.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="overflow-hidden rounded-2xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-sky-soft font-mono text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3">Area</th>
                  <th className="px-4 py-3">Metric</th>
                  <th className="px-4 py-3 text-right">Target</th>
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m, i) => (
                  <motion.tr
                    key={m.metric}
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.05 }}
                    className="border-t border-line hover:bg-sky-soft/60"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-blue">{m.area}</td>
                    <td className="px-4 py-3 text-fg">{m.metric}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-amber">{m.target}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
