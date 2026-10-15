"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { LimitChart } from "@/components/app/charts";
import { Badge, Card, Empty, Select, Spinner, statusTone } from "@/components/ui/Primitives";
import { fmtTime, get, type Machine } from "@/lib/api";

type Row = { id?: number; machine_id: string; machine_name: string; parameter: string; value: number; unit?: string | null; ts: number; received_at?: number };

export default function TelemetryPage() {
  const { subscribe, live } = useApp();
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<{ m: string; p: string }>({ m: "", p: "" });
  const [series, setSeries] = useState<{ t: number; v: number }[]>([]);

  useEffect(() => {
    get<Machine[]>("/api/machines").then((ms) => { setMachines(ms); if (ms[0]) setSel({ m: ms[0].id, p: ms[0].parameters[0]?.name ?? "" }); }).catch(() => setMachines([]));
    get<Row[]>("/api/telemetry/recent?limit=150").then(setRows);
  }, []);
  useEffect(() => {
    if (!sel.m || !sel.p) return;
    get<{ series: Record<string, { t: number; v: number }[]> }>(`/api/machines/${sel.m}/readings?parameter=${sel.p}&seconds=600`).then((r) => setSeries(r.series[sel.p] ?? []));
  }, [sel]);
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type !== "telemetry") return;
        const mid = String(e.data.machine_id);
        const name = machines?.find((m) => m.id === mid)?.name ?? mid;
        const latest = e.data.latest as Record<string, { value: number; unit?: string | null; ts: number }>;
        const add: Row[] = Object.entries(latest).map(([p, v]) => ({ machine_id: mid, machine_name: name, parameter: p, value: v.value, unit: v.unit, ts: v.ts, received_at: Number(e.data.ts) }));
        setRows((r) => [...add.reverse(), ...r].slice(0, 150));
        if (mid === sel.m && latest[sel.p]) setSeries((s) => [...s, { t: latest[sel.p].ts, v: latest[sel.p].value }].filter((x) => x.t > Date.now() / 1000 - 600));
      }),
    [subscribe, machines, sel],
  );

  if (!machines) return <Spinner />;
  if (machines.length === 0) return <Empty title="No telemetry yet" body="Onboard a machine and start posting to /v1/telemetry." />;
  const m = machines.find((x) => x.id === sel.m);
  const p = m?.parameters.find((x) => x.name === sel.p);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card title="Live chart" action={<Badge tone={live ? "green" : "amber"}>{live ? "streaming" : "reconnecting"}</Badge>}>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Select value={sel.m} onChange={(e) => { const mm = machines.find((x) => x.id === e.target.value); setSel({ m: e.target.value, p: mm?.parameters[0]?.name ?? "" }); }}>{machines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
          <Select value={sel.p} onChange={(e) => setSel({ ...sel, p: e.target.value })}>{m?.parameters.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}</Select>
        </div>
        {p ? <LimitChart data={series} param={p} height={300} /> : <p className="text-sm text-muted">Pick a parameter.</p>}
      </Card>
      <Card title="Recent readings" action={<span className="text-xs text-muted">{rows.length} shown</span>}>
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white font-mono text-[10px] uppercase tracking-wider text-muted"><tr><th className="py-1.5 pr-2">time</th><th className="py-1.5 pr-2">machine</th><th className="py-1.5 pr-2">parameter</th><th className="py-1.5 text-right">value</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const pm = machines.find((x) => x.id === r.machine_id)?.parameters.find((x) => x.name === r.parameter);
                const state = pm ? (pm.crit_high != null && r.value > pm.crit_high) || (pm.crit_low != null && r.value < pm.crit_low) ? "critical" : (pm.warn_high != null && r.value > pm.warn_high) || (pm.warn_low != null && r.value < pm.warn_low) ? "warning" : "normal" : "normal";
                return (
                  <tr key={r.id ?? `${r.machine_id}-${r.parameter}-${r.ts}-${i}`} className="border-t border-line">
                    <td className="py-1 pr-2 font-mono text-muted">{fmtTime(r.ts)}</td><td className="py-1 pr-2">{r.machine_name}</td><td className="py-1 pr-2 font-mono">{r.parameter}</td>
                    <td className={`py-1 text-right font-mono font-semibold ${state === "critical" ? "text-red" : state === "warning" ? "text-amber" : "text-ink"}`}>{r.value.toFixed(2)} {r.unit ?? ""} <Badge tone={statusTone(state)}>{state}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
