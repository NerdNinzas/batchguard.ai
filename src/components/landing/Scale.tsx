"use client";

import { Section } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";
import { GlowCard } from "@/components/ui/GlowCard";

const STAGES = [
  { s: "Prototype", now: true, b: "Machines post over HTTPS with per-device keys; one factory; Cloud Run autoscaling." },
  { s: "Pilot · 1–3 factories", b: "Edge gateway reads PLCs over OPC UA / Modbus and posts to the same API; per-device certificates." },
  { s: "Scale · hundreds", b: "Multi-tenant Firestore; Pub/Sub + BigQuery at millions of readings/hour; Dataflow for windowed detection; Vertex AI models per machine type." },
  { s: "Product", b: "Shared, anonymised incident knowledge base per machine model; CMMS work orders; mobile app." },
];

export function Scale() {
  return (
    <Section
      id="scale"
      eyebrow="Path to production"
      title="Real hardware uses the same endpoint."
      lead="The telemetry API is device-agnostic. Cost stays low because detection is plain code and the LLM runs only when an incident opens — not on every reading."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((st, i) => (
          <Reveal key={st.s} delay={i * 0.07}>
            <GlowCard accent={st.now ? "amber" : "blue"} className={`h-full ${st.now ? "border-amber/40" : ""}`}>
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted">stage {i + 1}</p>
              <p className="mt-1 text-lg font-semibold text-ink">
                {st.s} {st.now && <span className="ml-1 rounded-full bg-amber px-2 py-0.5 text-[10px] text-white">now</span>}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{st.b}</p>
            </GlowCard>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
