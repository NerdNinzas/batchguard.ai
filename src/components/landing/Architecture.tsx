"use client";

import { motion } from "framer-motion";
import { Section } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";
import { TechLogo } from "@/components/ui/TechLogo";
import { GCP, GENAI_USES } from "@/lib/content";

const FLOW = [
  { n: "Machine / PLC gateway", s: "device key", c: "amber" },
  { n: "Ingestion API", s: "Cloud Run · FastAPI", c: "blue" },
  { n: "Pub/Sub", s: "telemetry topic", c: "blue" },
  { n: "Detection worker", s: "limits · trend · anomaly", c: "blue" },
  { n: "Incident", s: "Firestore", c: "red" },
  { n: "ADK agent", s: "Gemini on Vertex AI", c: "violet" },
  { n: "Escalation", s: "Twilio · TTS · email", c: "red" },
];

export function Architecture() {
  return (
    <Section
      id="architecture"
      eyebrow="Architecture"
      title={
        <>
          Everything on Google Cloud. <span className="text-blue">The LLM only wakes when an incident opens.</span>
        </>
      }
      lead="Readings flow into Pub/Sub; a BigQuery subscription keeps history with no code; Firestore drives the live dashboard. Only an opened incident wakes the agent, which reads history from BigQuery and the manual from Cloud Storage, then writes its report back to Firestore."
    >
      {/* animated flow */}
      <Reveal>
        <div className="glass relative overflow-x-auto rounded-2xl p-6">
          <div className="flex min-w-[900px] items-center gap-3">
            {FLOW.map((f, i) => (
              <div key={f.n} className="flex flex-1 items-center gap-3">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className={`flex-1 rounded-xl border p-3 ${
                    f.c === "amber" ? "border-amber/40 bg-amber/10" : f.c === "red" ? "border-red/40 bg-red/10" : f.c === "violet" ? "border-violet/40 bg-violet/10" : "border-blue/30 bg-blue/5"
                  }`}
                >
                  <p className="text-sm font-semibold text-ink">{f.n}</p>
                  <p className="font-mono text-[10px] text-muted">{f.s}</p>
                </motion.div>
                {i < FLOW.length - 1 && (
                  <div className="relative h-px w-6 shrink-0 bg-line">
                    <motion.span
                      className="absolute -top-[2px] h-[5px] w-[5px] rounded-full bg-blue"
                      animate={{ left: ["0%", "100%"] }}
                      transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.17, ease: "linear" }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-muted">
            <span>BigQuery ← Pub/Sub subscription (history)</span>
            <span>Cloud Storage ← manuals, photos, call audio</span>
            <span>Firestore → real-time listeners → live dashboard</span>
          </div>
        </div>
      </Reveal>

      {/* services grid */}
      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {GCP.map((g, i) => (
          <Reveal key={g.layer} delay={i * 0.07}>
            <div className="h-full rounded-2xl border border-line bg-white p-5">
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-blue">{g.layer}</p>
              <ul className="mt-4 space-y-2.5">
                {g.items.map((it, j) => (
                  <li key={it} className="flex items-center gap-3 text-base text-fg">
                    <TechLogo name={it} size={26} />
                    <span className="flex-1">{it}</span>
                    <span className={`h-1.5 w-1.5 rounded-full ${j < 3 ? "bg-green" : "bg-muted/50"}`} />
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] text-muted">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green" /> built for the demo (P0) · <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted/50" /> if time allows / roadmap
      </p>

      {/* GenAI uses */}
      <Reveal className="mt-16">
        <p className="mb-5 font-mono text-xs uppercase tracking-[0.25em] text-blue">Gemini is used at 10 points, not one chat call</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {GENAI_USES.map((g) => (
            <div key={g.n} className={`rounded-xl border p-4 ${g.p === "P0" ? "border-blue/30 bg-blue/[0.05]" : "border-line bg-white"}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-2xl font-semibold text-ink/70">{String(g.n).padStart(2, "0")}</span>
                <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${g.p === "P0" ? "bg-blue/20 text-blue" : "bg-white text-muted"}`}>{g.p}</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-ink">{g.feature}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{g.cap}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal className="mt-16">
        <p className="mb-5 font-mono text-xs uppercase tracking-[0.25em] text-blue">Built with</p>
        <div className="flex flex-wrap gap-3">
          {["Google Cloud", "Gemini", "Agent Development Kit", "Firebase Auth", "BigQuery", "Pub/Sub", "Cloud Storage", "Twilio Voice", "Next.js", "React", "Three.js", "TypeScript", "Tailwind", "FastAPI", "Python", "Blender"].map((t) => (
            <span key={t} className="card flex items-center gap-3 rounded-xl px-5 py-3.5 text-lg font-semibold text-ink">
              <TechLogo name={t} size={34} />
              {t}
            </span>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
