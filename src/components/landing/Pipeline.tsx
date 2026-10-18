"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Factory,
  KeyRound,
  Server,
  Radio,
  Database,
  FileText,
  Activity,
  AlertTriangle,
  Sparkles,
  Mail,
  PhoneCall,
  UserCheck,
  LayoutDashboard,
  Network,
  type LucideIcon,
} from "lucide-react";
import { Section } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";

/**
 * Builder-canvas view of the platform: how a machine gets connected and
 * how an incident flows through to a phone call. Nodes are HTML, edges
 * are SVG beziers with packets riding them (SMIL animateMotion).
 */

type Tone = "blue" | "green" | "amber" | "red" | "violet";
type Node = { id: string; x: number; y: number; w?: number; h?: number; title: string; sub: string; icon: LucideIcon; tone: Tone; chips?: string[] };
type Edge = { from: string; to: string; a?: "r" | "b"; b?: "l" | "t"; label?: string; dashed?: boolean; tone?: Tone };

const W = 1280;
const H = 500;
const NW = 180;
const NH = 74;
const C = [20, 230, 440, 650, 860, 1070];

const NODES: Node[] = [
  { id: "machine", x: C[0], y: 30, title: "Machine / PLC", sub: "OPC UA · Modbus · HTTPS", icon: Factory, tone: "blue" },
  { id: "key", x: C[1], y: 30, title: "Device key", sub: "X-Device-Key header", icon: KeyRound, tone: "blue" },
  { id: "api", x: C[2], y: 30, title: "Telemetry API", sub: "Cloud Run · FastAPI", icon: Server, tone: "blue" },
  { id: "pubsub", x: C[3], y: 30, title: "Pub/Sub", sub: "topic: telemetry", icon: Radio, tone: "blue" },
  { id: "detect", x: C[4], y: 30, title: "Detection worker", sub: "limits · trend · anomaly", icon: Activity, tone: "amber" },
  { id: "incident", x: C[5], y: 30, title: "Incident", sub: "INC-0419 · critical", icon: AlertTriangle, tone: "red" },

  { id: "bq", x: C[3], y: 160, title: "BigQuery", sub: "history · baselines", icon: Database, tone: "green" },
  { id: "manual", x: C[3], y: 250, title: "Machine manual", sub: "Cloud Storage · §7.3", icon: FileText, tone: "green" },
  { id: "neigh", x: C[3], y: 340, title: "Line neighbours", sub: "feeder · inspection", icon: Network, tone: "green" },

  { id: "agent", x: C[4], y: 196, h: 142, title: "ADK agent · Gemini", sub: "causes · evidence · checks", icon: Sparkles, tone: "violet", chips: ["get_readings", "get_manual_sections", "get_line_neighbours", "compute_correlation"] },

  { id: "email", x: C[5], y: 190, title: "Email", sub: "warning + critical", icon: Mail, tone: "red" },
  { id: "call", x: C[5], y: 290, title: "Voice call", sub: "Twilio · Cloud TTS", icon: PhoneCall, tone: "red" },
  { id: "ack", x: C[5], y: 396, title: "Engineer ack", sub: "press 1 · feedback", icon: UserCheck, tone: "green" },
  { id: "fs", x: C[4], y: 396, title: "Firestore", sub: "report → dashboard", icon: LayoutDashboard, tone: "green" },
];

const EDGES: Edge[] = [
  { from: "machine", to: "key" },
  { from: "key", to: "api" },
  { from: "api", to: "pubsub" },
  { from: "pubsub", to: "detect" },
  { from: "detect", to: "incident", tone: "amber" },
  { from: "pubsub", to: "bq", a: "b", b: "t", label: "BQ subscription", tone: "green" },
  { from: "incident", to: "agent", a: "b", b: "t", label: "wakes agent", tone: "violet" },
  { from: "bq", to: "agent", tone: "green" },
  { from: "manual", to: "agent", tone: "green" },
  { from: "neigh", to: "agent", tone: "green" },
  { from: "agent", to: "email", tone: "red" },
  { from: "agent", to: "call", tone: "red" },
  { from: "agent", to: "fs", a: "b", b: "t", label: "report", tone: "green" },
  { from: "call", to: "ack", a: "b", b: "t", label: "no ack 2 min → next", tone: "green" },
];

const TONE: Record<Tone, { ring: string; bg: string; text: string; hex: string }> = {
  blue: { ring: "border-blue/40", bg: "bg-blue", text: "text-blue", hex: "#1e6fff" },
  green: { ring: "border-green/50", bg: "bg-green", text: "text-green", hex: "#16c784" },
  amber: { ring: "border-amber/50", bg: "bg-amber", text: "text-amber", hex: "#f59e0b" },
  red: { ring: "border-red/50", bg: "bg-red", text: "text-red", hex: "#ef4444" },
  violet: { ring: "border-violet/50", bg: "bg-violet", text: "text-violet", hex: "#7c6cff" },
};

function anchor(n: Node, side: "r" | "l" | "t" | "b") {
  const w = n.w ?? NW;
  const h = n.h ?? NH;
  switch (side) {
    case "r":
      return [n.x + w, n.y + h / 2];
    case "l":
      return [n.x, n.y + h / 2];
    case "t":
      return [n.x + w / 2, n.y];
    case "b":
      return [n.x + w / 2, n.y + h];
  }
}

function pathFor(e: Edge) {
  const from = NODES.find((n) => n.id === e.from)!;
  const to = NODES.find((n) => n.id === e.to)!;
  const a = e.a ?? "r";
  const b = e.b ?? "l";
  const [x1, y1] = anchor(from, a);
  const [x2, y2] = anchor(to, b);
  if (a === "b") {
    const k = Math.max(30, Math.abs(y2 - y1) * 0.5);
    return { d: `M${x1} ${y1} C${x1} ${y1 + k}, ${x2} ${y2 - k}, ${x2} ${y2}`, mid: [(x1 + x2) / 2, (y1 + y2) / 2] };
  }
  const k = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return { d: `M${x1} ${y1} C${x1 + k} ${y1}, ${x2 - k} ${y2}, ${x2} ${y2}`, mid: [(x1 + x2) / 2, (y1 + y2) / 2] };
}

export function Pipeline() {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const s = Math.max(0.62, scale);

  return (
    <Section
      id="pipeline"
      eyebrow="Builder canvas"
      title="How a machine gets connected — and how an incident becomes a phone call."
      lead="Read it like a workflow: readings enter on the left, deterministic detection opens an incident, and only then does the Gemini agent wake up, pull evidence from four sources, and fan out to email, voice and the dashboard."
    >
      <Reveal>
        <div ref={wrap} className="card relative overflow-x-auto rounded-3xl bg-[radial-gradient(circle,rgba(30,111,255,0.12)_1px,transparent_1px)] [background-size:22px_22px]" style={{ height: H * s + 32 }}>
          <div className="absolute left-4 top-4" style={{ width: W, height: H, transform: `scale(${s})`, transformOrigin: "top left" }}>
            {/* lanes */}
            {[
              { x: C[0], y: 4, t: "① Connect", c: "text-blue" },
              { x: C[4], y: 4, t: "② Detect", c: "text-amber" },
              { x: C[3], y: 134, t: "③ Evidence", c: "text-green" },
              { x: C[4], y: 174, t: "④ Investigate", c: "text-violet" },
              { x: C[5], y: 164, t: "⑤ Respond", c: "text-red" },
            ].map((l) => (
              <span key={l.t} className={`absolute font-mono text-[11px] uppercase tracking-[0.2em] ${l.c}`} style={{ left: l.x, top: l.y }}>
                {l.t}
              </span>
            ))}

            {/* edges */}
            <svg className="absolute inset-0" width={W} height={H} fill="none">
              <defs>
                <style>{`@keyframes dashflow { to { stroke-dashoffset: -24; } }`}</style>
              </defs>
              {EDGES.map((e, i) => {
                const { d, mid } = pathFor(e);
                const hex = TONE[e.tone ?? "blue"].hex;
                return (
                  <g key={i}>
                    <path id={`edge-${i}`} d={d} stroke={hex} strokeOpacity="0.35" strokeWidth="2" strokeDasharray="6 6" style={{ animation: "dashflow 1.2s linear infinite" }} />
                    <circle r="4" fill={hex}>
                      <animateMotion dur={`${2.2 + (i % 4) * 0.4}s`} repeatCount="indefinite" begin={`${(i * 0.37) % 2}s`}>
                        <mpath href={`#edge-${i}`} />
                      </animateMotion>
                    </circle>
                    {e.label && (
                      <g>
                        <rect x={mid[0] - e.label.length * 3.6 - 6} y={mid[1] - 18} width={e.label.length * 7.2 + 12} height="16" rx="8" fill="#ffffff" stroke="#dbe6f7" />
                        <text x={mid[0]} y={mid[1] - 7} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="#5b6b85" letterSpacing="0.08em">
                          {e.label.toUpperCase()}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* nodes */}
            {NODES.map((n, i) => {
              const Icon = n.icon;
              const t = TONE[n.tone];
              return (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.04 }}
                  whileHover={{ y: -3 }}
                  className={`absolute rounded-xl border bg-white p-3 shadow-[0_10px_30px_-14px_rgba(11,26,51,.35)] ${t.ring}`}
                  style={{ left: n.x, top: n.y, width: n.w ?? NW, height: n.h ?? NH }}
                >
                  <div className="flex items-start gap-2.5">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white ${t.bg}`}>
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold leading-tight text-ink">{n.title}</p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted">{n.sub}</p>
                    </div>
                  </div>
                  {n.chips && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {n.chips.map((c) => (
                        <span key={c} className="rounded bg-violet/10 px-1.5 py-0.5 font-mono text-[9px] text-violet">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* handles */}
                  <span className={`absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white ${t.bg}`} />
                  <span className={`absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white ${t.bg}`} />
                </motion.div>
              );
            })}
          </div>
        </div>
      </Reveal>

      <Reveal className="mt-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["No LLM on the hot path", "Detection is deterministic and runs on every reading. Gemini is invoked only when an incident opens."],
            ["One fault, one incident", "Cooldown and grouping attach new symptoms to the open incident instead of spawning alerts."],
            ["Evidence from four sources", "History, the machine's own manual, its neighbours, and signal correlations — all cited in the report."],
            ["Escalation that climbs", "Unacknowledged critical → one call to each contact in order, then the auto-shutdown countdown."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl border border-line bg-white p-4">
              <p className="font-display text-lg font-semibold text-ink">{t}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{b}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
