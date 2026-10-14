"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Section } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";
import { GlowCard } from "@/components/ui/GlowCard";
import { AGENT_PIPELINE, AGENT_TOOLS, DETECTION_LAYERS, GUARDRAILS, SEVERITY } from "@/lib/content";
import { ShieldAlert, Wrench, Cpu, Mail, PhoneCall, LayoutDashboard } from "lucide-react";

const COLOR: Record<string, string> = {
  red: "text-red border-red/30 bg-red/10",
  amber: "text-amber border-amber/40 bg-amber/10",
  blue: "text-blue border-blue/30 bg-blue/10",
  violet: "text-violet border-violet/30 bg-violet/10",
};

/** Animated incident report mock that types itself in. */
function IncidentMock() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStage((s) => (s + 1) % 7), 1400);
    return () => clearInterval(id);
  }, []);
  const rows = [
    { k: "incident", v: "INC-0419 · conv-01 · Critical" },
    { k: "signals", v: "vibration_rms 3.1→6.8 mm/s (14 min) · motor_temp 74→91 °C" },
    { k: "cause #1", v: "Bearing wear · STRONG · vib leads temp by 9 min (r=0.91)", c: "text-red" },
    { k: "cause #2", v: "Cooling fan failure · WEAK · contradicted: vibration moved first", c: "text-amber" },
    { k: "cause #3", v: "Overload · WEAK · load flat at 38 kg, no jam event", c: "text-muted" },
    { k: "check first", v: "IR-gun drive-end bearing; manual p.42 §7.3 (Bearing inspection)" },
    { k: "call script", v: "“Conveyor conv-01 critical. Bearing wear likely. Check bearing temp. Press 1 to acknowledge.”" },
  ];
  return (
    <div className="glass glow-blue relative overflow-hidden rounded-2xl p-5 font-mono text-[12px] leading-relaxed">
      <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted">
        <Cpu size={14} className="text-blue" /> agent · incident report · schema-validated
      </div>
      {rows.map((r, i) => (
        <motion.div
          key={r.k}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: i <= stage ? 1 : 0.15, x: 0 }}
          transition={{ duration: 0.4 }}
          className="grid grid-cols-[88px_1fr] gap-3 border-t border-line py-2"
        >
          <span className="text-muted">{r.k}</span>
          <span className={r.c ?? "text-ink"}>{r.v}</span>
        </motion.div>
      ))}
      <motion.div
        animate={{ opacity: [0.2, 1, 0.2] }}
        transition={{ repeat: Infinity, duration: 1.2 }}
        className="mt-2 h-3 w-2 bg-blue"
      />
    </div>
  );
}

export function Agent() {
  return (
    <Section
      id="agent"
      eyebrow="Detection + diagnosis"
      title={
        <>
          Detection is deterministic code. <span className="text-blue">Diagnosis is a Gemini agent.</span>
        </>
      }
      lead="Detection must be fast, cheap and testable, so it never waits on an LLM. The agent is only woken once an incident opens — which keeps cost low and reasoning focused."
    >
      {/* detection layers */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {DETECTION_LAYERS.map((l, i) => (
          <Reveal key={l.name} delay={i * 0.07}>
            <GlowCard accent={l.color as "red" | "amber" | "blue" | "violet"} className="h-full">
              <span className={`inline-block rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ${COLOR[l.color]}`}>
                Layer {i + 1} · {l.name}
              </span>
              <p className="mt-4 text-sm text-ink">{l.method}</p>
              <p className="mt-2 text-xs text-muted">
                Catches: <span className="text-fg">{l.catches}</span>
              </p>
              <p className="mt-3 rounded-lg bg-sky-soft p-2.5 font-mono text-[11px] text-blue">{l.example}</p>
            </GlowCard>
          </Reveal>
        ))}
      </div>

      {/* pipeline + mock */}
      <div className="mt-20 grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <Reveal>
          <p className="mb-5 font-mono text-xs uppercase tracking-[0.25em] text-blue">Agent pipeline · ADK + Gemini</p>
          <ol className="relative space-y-3 border-l border-line pl-6">
            {AGENT_PIPELINE.map((s, i) => (
              <motion.li
                key={s.name}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="relative"
              >
                <span className="absolute -left-[31px] top-1.5 grid h-5 w-5 place-items-center rounded-full border border-amber/50 bg-bg font-mono text-[10px] text-amber">
                  {i + 1}
                </span>
                <p className="text-sm font-semibold text-ink">{s.name}</p>
                <p className="text-sm text-muted">{s.body}</p>
              </motion.li>
            ))}
          </ol>

          <p className="mb-3 mt-10 font-mono text-xs uppercase tracking-[0.25em] text-muted">Function tools the agent can call</p>
          <div className="flex flex-wrap gap-2">
            {AGENT_TOOLS.map((t) => (
              <code key={t} className="rounded-md border border-line bg-sky-soft px-2 py-1 font-mono text-[11px] text-blue">
                {t}
              </code>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <IncidentMock />
          <div className="mt-6 rounded-2xl border border-line bg-white p-5">
            <p className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.25em] text-muted">
              <ShieldAlert size={14} className="text-amber" /> Guardrails
            </p>
            <ul className="space-y-2 text-sm text-muted">
              {GUARDRAILS.map((g) => (
                <li key={g} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber" />
                  {g}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>

      {/* severity ladder */}
      <Reveal className="mt-20">
        <p className="mb-5 font-mono text-xs uppercase tracking-[0.25em] text-blue">Severity & escalation ladder</p>
        <div className="grid gap-3 md:grid-cols-4">
          {SEVERITY.map((s, i) => {
            const icons = [LayoutDashboard, Mail, PhoneCall, PhoneCall];
            const Icon = icons[i];
            return (
              <div
                key={s.level}
                className={`relative overflow-hidden rounded-2xl border p-5 ${
                  s.color === "red" ? "border-red/30 bg-red/[0.06]" : s.color === "amber" ? "border-amber/30 bg-amber/[0.06]" : "border-blue/30 bg-blue/[0.06]"
                }`}
                style={{ marginTop: `${(3 - i) * 0}px` }}
              >
                <div className="flex items-center justify-between">
                  <p className={`text-lg font-semibold ${s.color === "red" ? "text-red" : s.color === "amber" ? "text-amber" : "text-blue"}`}>{s.level}</p>
                  <Icon size={18} className="text-muted" />
                </div>
                <p className="mt-3 text-xs text-muted">Trigger</p>
                <p className="text-sm text-ink">{s.trigger}</p>
                <p className="mt-3 text-xs text-muted">Action</p>
                <p className="text-sm text-ink">{s.action}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Wrench size={14} className="text-amber" />
          Cooldown: the same parameter on the same machine cannot open a new incident for 5 minutes — new symptoms attach to the open one. One fault = one incident, not 200 alerts.
        </p>
      </Reveal>
    </Section>
  );
}
