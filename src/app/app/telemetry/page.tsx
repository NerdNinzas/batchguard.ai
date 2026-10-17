"use client";

import { useCallback, useEffect, useState } from "react";
import { LazySection, Pagination } from "@/components/app/LazySection";
import { useApp } from "@/components/app/Shell";
import { LimitChart } from "@/components/app/charts";
import { Badge, Button, Card, Empty, PageSkeleton, Select, Skeleton, statusTone } from "@/components/ui/Primitives";
import { cached, fmtTime, get, type Machine } from "@/lib/api";

type Row = { id?: number; machine_id: string; machine_name: string; parameter: string; value: number; unit?: string | null; ts: number; received_at?: number };
type RowPage = { rows: Row[]; total: number; limit: number; offset: number };
const PAGE_SIZE = 50;

export default function TelemetryPage() {
  const { subscribe, live } = useApp();
  const [machines, setMachines] = useState<Machine[] | null>(() => cached<Machine[]>("/api/machines"));
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<{ m: string; p: string }>({ m: "", p: "" });
  const [series, setSeries] = useState<{ t: number; v: number }[]>([]);

  const loadMachines = useCallback(() => get<Machine[]>("/api/machines").then((ms) => { setMachines(ms); setError(null); setSel((s) => (s.m ? s : { m: ms[0]?.id ?? "", p: ms[0]?.parameters[0]?.name ?? "" })); }).catch((e) => setError(e instanceof Error ? e.message : "Could not load machines")), []);
  useEffect(() => { loadMachines(); }, [loadMachines]);
  useEffect(() => {
    if (!sel.m || !sel.p) return;
    get<{ series: Record<string, { t: number; v: number }[]> }>(`/api/machines/${sel.m}/readings?parameter=${sel.p}&seconds=600`).then((r) => setSeries(r.series[sel.p] ?? [])).catch(() => {});
  }, [sel]);
  useEffect(() => subscribe((e) => {
    if (e.type !== "telemetry") return;
    const mid = String(e.data.machine_id);
    const latest = e.data.latest as Record<string, { value: number; unit?: string | null; ts: number }>;
    if (mid === sel.m && latest[sel.p]) setSeries((s) => [...s, { t: latest[sel.p].ts, v: latest[sel.p].value }].filter((x) => x.t > Date.now() / 1000 - 600));
  }), [subscribe, sel]);

  if (!machines) {
    if (error) return <Empty title="Backend not reachable" body={error} action={<Button onClick={loadMachines}>Retry</Button>} />;
    return <PageSkeleton variant="rows" />;
  }
  if (machines.length === 0) return <Empty title="No telemetry yet" body="Onboard a machine and start posting to /v1/telemetry." />;
  const m = machines.find((x) => x.id === sel.m);
  const p = m?.parameters.find((x) => x.name === sel.p);

  return (
    <div className="space-y-4">
      <Card title="Live chart" action={<Badge tone={live ? "green" : "amber"}>{live ? "streaming" : "reconnecting"}</Badge>}>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Select value={sel.m} onChange={(e) => { const mm = machines.find((x) => x.id === e.target.value); setSel({ m: e.target.value, p: mm?.parameters[0]?.name ?? "" }); }}>{machines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
          <Select value={sel.p} onChange={(e) => setSel({ ...sel, p: e.target.value })}>{m?.parameters.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}</Select>
        </div>
        {p ? <LimitChart data={series} param={p} height={300} /> : <p className="text-sm text-muted">Pick a parameter.</p>}
      </Card>
      {/* the readings table loads only when it scrolls into view, 50 rows a page */}
      <LazySection height={420}>
        <ReadingsTable machines={machines} />
      </LazySection>
    </div>
  );
}

function ReadingsTable({ machines }: { machines: Machine[] }) {
  const { subscribe } = useApp();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RowPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveRows, setLiveRows] = useState<Row[]>([]);
  const load = useCallback((p: number, silent = false) => {
    if (!silent) setLoading(true);
    return get<RowPage>(`/api/telemetry/recent?limit=${PAGE_SIZE}&offset=${(p - 1) * PAGE_SIZE}`).then((d) => { setData(d); setLiveRows([]); }).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(page); }, [page, load]);
  useEffect(() => subscribe((e) => {
    if (e.type !== "telemetry" || page !== 1) return;
    const mid = String(e.data.machine_id);
    const name = machines.find((m) => m.id === mid)?.name ?? mid;
    const latest = e.data.latest as Record<string, { value: number; unit?: string | null; ts: number }>;
    const add: Row[] = Object.entries(latest).map(([p, v]) => ({ machine_id: mid, machine_name: name, parameter: p, value: v.value, unit: v.unit, ts: v.ts, received_at: Number(e.data.ts) }));
    setLiveRows((r) => [...add.reverse(), ...r].slice(0, PAGE_SIZE));
  }), [subscribe, machines, page]);

  const rows = data ? [...liveRows, ...data.rows].slice(0, PAGE_SIZE) : [];
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return (
    <Card title="Recent readings" action={<span className="text-xs text-muted">{data ? `${data.total.toLocaleString()} readings kept (last 3 h)` : ""}</span>}>
      {!data ? (
        <div className="space-y-2">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-7" />)}</div>
      ) : (
        <>
          <div className={`max-h-[560px] overflow-y-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
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
          <Pagination page={page} pages={pages} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}
    </Card>
  );
}
