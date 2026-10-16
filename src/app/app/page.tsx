"use client";
/* eslint-disable @next/next/no-img-element */

import { motion } from "framer-motion";
import { Activity, ArrowRight, Bot, CheckCircle2, Clock, Cpu, PhoneCall, ShieldCheck, Siren, Users, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { MuseConsole } from "@/components/muse/MuseConsole";
import { Bars, HealthRing, Sparkline } from "@/components/app/charts";
import { Badge, Button, Empty, Spinner, StatusDot, statusTone } from "@/components/ui/Primitives";
import { fmtAgo, fmtTime, get } from "@/lib/api";
import { machineType } from "@/lib/machineTypes";

type Spark = { parameter: string; unit?: string | null; points: number[]; latest: Record<string, { value: number; unit?: string | null; state: string }> };
type Overview = {
  machines: { id: string; name: string; type: string; status: string; health: number; device_id: string; last_seen?: number | null; verified: number }[];
  sparks: Record<string, Spark>;
  ingest_per_minute: number[];
  recent_incidents: { id: string; severity: string; status: string; title: string; opened_at: number; report_source?: string | null; machine_name: string }[];
  agent_runs: { source: string; ok: number; started_at: number; finished_at?: number | null; title: string }[];
  contacts: number;
  org: { name: string; industry?: string | null; timezone?: string | null };
  counts: { machines: number; online: number; open_incidents: number; critical: number; readings_per_min: number; mean_ack_seconds: number | null; resolved_24h: number };
  incidents_per_hour: number[];
  gemini_enabled: boolean;
};

const SEV_BG: Record<string, string> = { critical: "bg-red", emergency: "bg-red", warning: "bg-amber", info: "bg-blue" };

export default function OverviewPage() {
  const { subscribe, user } = useApp();
  const [d, setD] = useState<Overview | null>(null);
  const [sparks, setSparks] = useState<Record<string, number[]>>({});

  const load = () =>
    get<Overview>("/api/overview")
      .then((o) => {
        setD(o);
        setSparks(Object.fromEntries(Object.entries(o.sparks).map(([k, v]) => [k, v.points])));
      })
      .catch(() => {});
  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "machine" || e.type === "incident") load();
        if (e.type === "telemetry" && d) {
          const mid = String(e.data.machine_id);
          const sp = d.sparks[mid];
          const latest = e.data.latest as Record<string, { value: number; unit?: string | null; state: string }>;
          if (!sp) return;
          const v = latest[sp.parameter]?.value;
          setSparks((s) => (v == null ? s : { ...s, [mid]: [...(s[mid] ?? []), v].slice(-40) }));
          setD((cur) => (cur ? { ...cur, sparks: { ...cur.sparks, [mid]: { ...sp, latest: { ...sp.latest, ...latest } } } } : cur));
        }
      }),
    [subscribe, d],
  );

  if (!d) return <Spinner label="Loading your line…" />;
  const c = d.counts;
  const healthy = c.critical === 0 && c.open_incidents === 0;
  const headline = c.critical ? `${c.critical} machine${c.critical > 1 ? "s" : ""} need${c.critical > 1 ? "" : "s"} attention` : c.open_incidents ? `${c.open_incidents} open warning${c.open_incidents > 1 ? "s" : ""}` : "All machines running normally";
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user.name.split(" ")[0];

  return (
    <div className="space-y-6">
      <MuseConsole />

      {/* hero */}
      <section className="relative overflow-hidden rounded-3xl text-white shadow-[0_24px_60px_-24px_rgba(11,26,51,.6)]">
        <img src="/machines/conveyor.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0b1a33]/95 via-[#0b1a33]/80 to-[#1e6fff]/40" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_50%,rgba(30,111,255,.25),transparent_60%)]" />
        <div className="relative grid gap-6 p-7 lg:grid-cols-[1.4fr_1fr] lg:p-9">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-sky">{greet}, {firstName} · {d.org.name}</p>
            <h1 className="font-display mt-2 text-4xl font-semibold leading-[1] sm:text-5xl">
              {headline}
              {healthy && <CheckCircle2 className="ml-3 inline text-green" size={36} />}
            </h1>
            <p className="mt-3 max-w-xl text-sm text-white/75">
              Muse is watching {c.machines} machine{c.machines === 1 ? "" : "s"} across {d.org.industry ?? "your"} line — {c.readings_per_min.toLocaleString()} readings in the last minute, {d.contacts} contact{d.contacts === 1 ? "" : "s"} on the escalation ladder, {d.gemini_enabled ? "Gemini investigations on" : "rule-based investigations on"}.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/app/incidents"><Button variant={c.open_incidents ? "danger" : "secondary"} size="sm" className={c.open_incidents ? "" : "!border-white/20 !bg-white/10 !text-white hover:!bg-white/20"}><Siren size={14} /> {c.open_incidents ? `Open incidents (${c.open_incidents})` : "Incident history"}</Button></Link>
              <Link href="/app/factory"><Button size="sm" className="!bg-white !text-ink hover:!bg-white/90">3D factory <ArrowRight size={14} /></Button></Link>
              <Link href="/app/onboard"><Button variant="secondary" size="sm" className="!border-white/20 !bg-white/10 !text-white hover:!bg-white/20"><Cpu size={14} /> Onboard a machine</Button></Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 self-center">
            {[
              { l: "Online", v: `${c.online}/${c.machines}`, i: Activity, t: c.online === c.machines ? "text-green" : "text-amber" },
              { l: "Readings / min", v: c.readings_per_min.toLocaleString(), i: Zap, t: "text-sky" },
              { l: "Critical", v: c.critical, i: Siren, t: c.critical ? "text-red" : "text-green" },
              { l: "Mean time to ack", v: c.mean_ack_seconds != null ? `${c.mean_ack_seconds}s` : "—", i: Clock, t: "text-white" },
            ].map(({ l, v, i: Icon, t }) => (
              <div key={l} className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                <div className="flex items-center justify-between"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">{l}</p><Icon size={14} className="text-white/50" /></div>
                <p className={`font-display mt-1 text-3xl font-semibold ${t}`}>{v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* machines */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.25em] text-blue">Line health</p><h2 className="font-display text-2xl font-semibold text-ink">Your machines, live</h2></div>
          <Link href="/app/machines" className="text-sm font-semibold text-blue hover:underline">All machines →</Link>
        </div>
        {d.machines.length === 0 ? (
          <Empty title="No machines yet" body="Onboard your first machine from its PDF manual or by hand." action={<Link href="/app/onboard"><Button>Onboard a machine <ArrowRight size={16} /></Button></Link>} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {d.machines.map((m, i) => {
              const t = machineType(m.type);
              const sp = d.sparks[m.id];
              const key = sp?.latest[sp.parameter];
              const tone = statusTone(m.status);
              const ring = { green: "ring-green/30", amber: "ring-amber/40", red: "ring-red/40", muted: "ring-line", blue: "ring-blue/30" }[tone] ?? "ring-line";
              return (
                <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Link href={`/app/machines/${m.id}`} className={`card group block overflow-hidden rounded-2xl ring-1 ${ring} transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-18px_rgba(30,111,255,.45)]`}>
                    <div className="relative h-32 overflow-hidden">
                      <img src={t?.image ?? "/machines/conveyor.jpg"} alt="" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
                      <div className="absolute left-3 top-3"><Badge tone={tone} className="!bg-white/90 backdrop-blur">{m.status}</Badge></div>
                      <div className="absolute right-3 top-3"><HealthRing value={m.health} size={44} /></div>
                      <div className="absolute bottom-2 left-3 right-3">
                        <p className="font-display text-xl font-semibold text-white">{m.name}</p>
                        <p className="font-mono text-[10px] text-white/70">{m.device_id} · {t?.name ?? m.type} · {fmtAgo(m.last_seen)}</p>
                      </div>
                    </div>
                    <div className="p-3">
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="font-mono text-[10px] text-muted">{sp?.parameter ?? "—"}</p>
                          <p className={`font-mono text-xl font-semibold ${key?.state === "critical" ? "text-red" : key?.state === "warning" ? "text-amber" : "text-ink"}`}>{key ? `${key.value.toFixed(1)} ${key.unit ?? ""}` : "no data"}</p>
                        </div>
                        <div className="h-10 w-32">{sparks[m.id]?.length ? <Sparkline data={sparks[m.id].map((v) => ({ v }))} height={40} color={tone === "red" ? "#ef4444" : tone === "amber" ? "#f59e0b" : "#1e6fff"} /> : null}</div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {Object.entries(sp?.latest ?? {}).filter(([k]) => k !== sp?.parameter).slice(0, 3).map(([k, v]) => (
                          <span key={k} className={`rounded-md bg-sky-soft/70 px-1.5 py-0.5 font-mono text-[10px] ${v.state === "critical" ? "text-red" : v.state === "warning" ? "text-amber" : "text-muted"}`}>{k} {v.value.toFixed(1)}</span>
                        ))}
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* pulse + incidents + agent */}
      <div className="grid gap-5 xl:grid-cols-3">
        <section className="card rounded-2xl p-5 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div><p className="font-mono text-[10px] uppercase tracking-[0.25em] text-blue">Line pulse</p><h3 className="font-display text-xl font-semibold text-ink">Readings ingested · last 30 min</h3></div>
            <Badge tone="green"><Activity size={10} /> streaming</Badge>
          </div>
          <Bars data={d.ingest_per_minute} label={(i) => `${29 - i}m`} height={170} />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat icon={ShieldCheck} tone="green" label="Resolved · 24 h" value={c.resolved_24h} />
            <Stat icon={Bot} tone="violet" label="Agent runs" value={d.agent_runs.length} sub={d.agent_runs[0] ? `${d.agent_runs[0].source} · ${d.agent_runs[0].finished_at ? `${Math.round(d.agent_runs[0].finished_at - d.agent_runs[0].started_at)}s` : "running"}` : "none yet"} />
            <Stat icon={Users} tone="blue" label="Escalation ladder" value={d.contacts} sub="contacts in order" />
          </div>
        </section>

        <section className="card rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <div><p className="font-mono text-[10px] uppercase tracking-[0.25em] text-red">Incidents</p><h3 className="font-display text-xl font-semibold text-ink">Recent</h3></div>
            <Link href="/app/incidents" className="text-xs font-semibold text-blue hover:underline">All →</Link>
          </div>
          <Bars data={d.incidents_per_hour} color="#ef4444" height={70} label={(i) => `${23 - i}h`} />
          <ol className="mt-3 space-y-2">
            {d.recent_incidents.length === 0 && <li className="text-sm text-muted">No incidents yet. Muse is watching.</li>}
            {d.recent_incidents.map((i) => (
              <li key={i.id}>
                <Link href={`/app/incidents/${i.id}`} className="flex items-start gap-3 rounded-xl border border-line bg-white p-2.5 transition hover:border-blue/50">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${SEV_BG[i.severity] ?? "bg-blue"} ${i.status === "open" && (i.severity === "critical" || i.severity === "emergency") ? "pulse-ring relative text-red" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{i.title}</p>
                    <p className="text-[11px] text-muted">{fmtAgo(i.opened_at)} · {i.status}{i.report_source ? ` · ${i.report_source}` : " · investigating"}</p>
                  </div>
                  <Badge tone={statusTone(i.severity)}>{i.severity}</Badge>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* agent strip */}
      <section className="card flex flex-wrap items-center gap-4 rounded-2xl p-4">
        <img src="/muse.webp" alt="" className="h-16 w-auto" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold text-ink">Muse · {d.gemini_enabled ? "ADK pipeline on Gemini" : "rule-based investigator"}</p>
          <p className="text-sm text-muted">{d.agent_runs.length ? `Last investigation: ${d.agent_runs[0].title} — ${fmtTime(d.agent_runs[0].started_at)}` : "No investigations yet; the first incident will wake the agent."} · Voice escalation <PhoneCall size={12} className="inline" /> planned.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">{d.agent_runs.slice(0, 5).map((r, i) => <Badge key={i} tone={r.ok ? (r.source.includes("gemini") ? "violet" : "blue") : "red"}>{r.source}</Badge>)}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted"><StatusDot status="normal" /> live</div>
      </section>
    </div>
  );
}

function Stat({ icon: Icon, tone, label, value, sub }: { icon: typeof Activity; tone: string; label: string; value: React.ReactNode; sub?: string }) {
  const c = { green: "bg-green/10 text-green", violet: "bg-violet/10 text-violet", blue: "bg-blue/10 text-blue" }[tone] ?? "bg-sky-soft text-blue";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${c}`}><Icon size={18} /></span>
      <div className="min-w-0"><p className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</p><p className="font-display text-2xl font-semibold leading-none text-ink">{value}</p>{sub && <p className="truncate text-[11px] text-muted">{sub}</p>}</div>
    </div>
  );
}
