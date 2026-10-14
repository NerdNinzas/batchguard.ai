"use client";

import { ArrowRight, Siren } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { Bars, HealthRing, Sparkline } from "@/components/app/charts";
import { Badge, Button, Card, Empty, Spinner, Stat, StatusDot, statusTone } from "@/components/ui/Primitives";
import { fmtAgo, get, type Incident } from "@/lib/api";

type Overview = {
  machines: { id: string; name: string; type: string; status: string; health: number; device_id: string; last_seen?: number | null; verified: number }[];
  counts: { machines: number; online: number; open_incidents: number; critical: number; readings_per_min: number; mean_ack_seconds: number | null };
  open_incidents: Incident[];
  incidents_per_hour: number[];
  gemini_enabled: boolean;
  smtp_enabled: boolean;
};

export default function OverviewPage() {
  const { subscribe } = useApp();
  const [data, setData] = useState<Overview | null>(null);
  const [spark, setSpark] = useState<Record<string, { v: number }[]>>({});

  const load = () => get<Overview>("/api/overview").then(setData).catch(() => {});
  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "machine" || e.type === "incident") load();
        if (e.type === "telemetry") {
          const mid = String(e.data.machine_id);
          const latest = e.data.latest as Record<string, { value: number }>;
          const first = Object.values(latest)[0];
          if (first) setSpark((s) => ({ ...s, [mid]: [...(s[mid] ?? []), { v: first.value }].slice(-40) }));
        }
      }),
    [subscribe],
  );

  if (!data) return <Spinner label="Loading overview…" />;
  const c = data.counts;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Machines" value={c.machines} sub={`${c.online} online`} tone="blue" />
        <Stat label="Open incidents" value={c.open_incidents} sub={c.critical ? `${c.critical} critical` : "none critical"} tone={c.critical ? "red" : c.open_incidents ? "amber" : "green"} />
        <Stat label="Readings / min" value={c.readings_per_min} sub="last 60 s across the line" tone="violet" />
        <Stat label="Mean time to ack" value={c.mean_ack_seconds != null ? `${c.mean_ack_seconds}s` : "—"} sub="last 24 h" tone="green" />
        <Stat label="Agent" value={data.gemini_enabled ? "Gemini" : "Rule-based"} sub={data.gemini_enabled ? "ADK + Gemini on duty" : "set GOOGLE_API_KEY for Gemini"} tone={data.gemini_enabled ? "green" : "muted"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Line health" action={<Link href="/app/machines" className="text-sm font-semibold text-blue hover:underline">All machines →</Link>}>
          {data.machines.length === 0 ? (
            <Empty title="No machines yet" body="Onboard your first machine from its PDF manual or by hand." action={<Link href="/app/onboard"><Button>Onboard a machine <ArrowRight size={16} /></Button></Link>} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.machines.map((m) => (
                <Link key={m.id} href={`/app/machines/${m.id}`} className="flex items-center gap-4 rounded-xl border border-line bg-white p-3 transition hover:border-blue/50">
                  <HealthRing value={m.health} size={56} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StatusDot status={m.status} />
                      <p className="truncate font-semibold text-ink">{m.name}</p>
                    </div>
                    <p className="font-mono text-[11px] text-muted">{m.device_id} · {m.type} · {m.verified ? fmtAgo(m.last_seen) : "unverified"}</p>
                    <div className="mt-1 h-8">{spark[m.id]?.length ? <Sparkline data={spark[m.id]} height={32} /> : null}</div>
                  </div>
                  <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Incidents · last 24 h">
          <Bars data={data.incidents_per_hour} color="#ef4444" label={(i) => `${23 - i}h`} />
          <div className="mt-4 space-y-2">
            {data.open_incidents.length === 0 && <p className="text-sm text-muted">No open incidents. Muse is watching.</p>}
            {data.open_incidents.map((i) => (
              <Link key={i.id} href={`/app/incidents/${i.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2 hover:border-blue/50">
                <Siren size={16} className={i.severity === "critical" || i.severity === "emergency" ? "text-red" : "text-amber"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{i.title}</p>
                  <p className="text-xs text-muted">{fmtAgo(i.opened_at)} · {i.status}</p>
                </div>
                <Badge tone={statusTone(i.severity)}>{i.severity}</Badge>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
