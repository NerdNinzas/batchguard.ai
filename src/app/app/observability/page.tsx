"use client";

import { useEffect, useState } from "react";
import { Bars } from "@/components/app/charts";
import { Badge, Card, Stat } from "@/components/ui/Primitives";
import { PageSkeleton } from "@/components/ui/Primitives";
import { fmtTime, get } from "@/lib/api";

type Obs = {
  ingest_per_minute: number[];
  routes: { route: string; n: number; errors: number; p50_ms: number; p95_ms: number }[];
  agent_runs: { id: string; title: string; source: string; ok: number; duration_s: number; tool_calls: { tool: string; stage?: string }[]; error?: string | null; started_at: number }[];
  stale_machines: { name: string; status: string }[];
  db_rows: Record<string, number>;
  config: { gemini: boolean; smtp: boolean; stale_after_s: number; cooldown_s: number; escalation_timeout_s: number };
  recent_logs: { route: string; method: string; status: number; ms: number; ts: number }[];
};

export default function ObservabilityPage() {
  const [d, setD] = useState<Obs | null>(null);
  useEffect(() => {
    const load = () => get<Obs>("/api/observability").then(setD);
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);
  if (!d) return <PageSkeleton variant="cards" />;
  const total = d.ingest_per_minute.reduce((a, b) => a + b, 0);
  const errors = d.routes.reduce((a, r) => a + r.errors, 0);
  const calls = d.routes.reduce((a, r) => a + r.n, 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Readings · 30 min" value={total} sub={`${d.ingest_per_minute.at(-1) ?? 0} in the last minute`} />
        <Stat label="API calls · 1 h" value={calls} sub={`${errors} error(s)`} tone={errors ? "amber" : "green"} />
        <Stat label="Agent runs" value={d.agent_runs.length} sub={`${d.agent_runs.filter((r) => r.ok).length} ok · mean ${(d.agent_runs.reduce((a, r) => a + r.duration_s, 0) / Math.max(1, d.agent_runs.length)).toFixed(1)}s`} tone="violet" />
        <Stat label="Stale / offline" value={d.stale_machines.length} tone={d.stale_machines.length ? "amber" : "green"} sub={d.stale_machines.map((m) => m.name).join(", ") || "all posting"} />
        <Stat label="Rows stored" value={d.db_rows.readings.toLocaleString()} sub={`${d.db_rows.incidents} incidents · ${d.db_rows.notifications} notifications`} tone="muted" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Ingestion per minute"><Bars data={d.ingest_per_minute} label={(i) => `${29 - i}m`} /></Card>
        <Card title="Pipeline configuration">
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[["Gemini / ADK", d.config.gemini ? "enabled" : "fallback (rule-based)", d.config.gemini], ["Email (SMTP)", d.config.smtp ? "enabled" : "simulated", d.config.smtp], ["Voice (TeleCMI + Gemini Live)", "planned", false], ["Stale after", `${d.config.stale_after_s}s`, true], ["Incident cooldown", `${d.config.cooldown_s}s`, true], ["Escalation timeout", `${d.config.escalation_timeout_s}s`, true]].map(([k, v, ok]) => (
              <div key={String(k)} className="rounded-xl border border-line bg-white p-3"><p className="text-xs text-muted">{k}</p><p className="mt-0.5 flex items-center gap-2 font-semibold text-ink">{v} <Badge tone={ok ? "green" : "amber"}>{ok ? "ok" : "off"}</Badge></p></div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="API routes · last hour">
          <table className="w-full text-left text-xs"><thead className="font-mono text-[10px] uppercase tracking-wider text-muted"><tr><th className="py-1">route</th><th className="py-1 text-right">calls</th><th className="py-1 text-right">errors</th><th className="py-1 text-right">p50</th><th className="py-1 text-right">p95</th></tr></thead>
            <tbody>{d.routes.map((r) => <tr key={r.route} className="border-t border-line"><td className="py-1.5 font-mono">{r.route}</td><td className="py-1.5 text-right">{r.n}</td><td className={`py-1.5 text-right ${r.errors ? "text-red" : ""}`}>{r.errors}</td><td className="py-1.5 text-right font-mono">{r.p50_ms} ms</td><td className="py-1.5 text-right font-mono">{r.p95_ms} ms</td></tr>)}</tbody></table>
        </Card>
        <Card title="Agent runs">
          <div className="space-y-2">{d.agent_runs.map((r) => <div key={r.id} className="rounded-xl border border-line bg-white p-3 text-xs"><div className="flex items-center justify-between gap-2"><p className="truncate font-semibold text-ink">{r.title}</p><Badge tone={r.ok ? "green" : "red"}>{r.source}</Badge></div><p className="mt-1 font-mono text-[10px] text-muted">{fmtTime(r.started_at)} · {r.duration_s}s · {r.tool_calls.length ? r.tool_calls.map((t) => (t.stage ? `${t.stage}·${t.tool}` : t.tool)).join(" → ") : "no tool trace (rule-based)"}</p>{r.error && <p className="mt-1 text-red">{r.error.slice(0, 160)}</p>}</div>)}{d.agent_runs.length === 0 && <p className="text-sm text-muted">No runs yet.</p>}</div>
        </Card>
      </div>
      <Card title="Recent API log">
        <div className="max-h-72 overflow-y-auto font-mono text-[11px]">{d.recent_logs.map((l, i) => <div key={i} className="flex gap-3 border-t border-line py-1"><span className="text-muted">{fmtTime(l.ts)}</span><span className={l.status >= 400 ? "text-red" : "text-green"}>{l.status}</span><span className="w-12">{l.method}</span><span className="flex-1 truncate">{l.route}</span><span className="text-muted">{l.ms} ms</span></div>)}</div>
      </Card>
    </div>
  );
}
