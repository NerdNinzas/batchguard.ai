"use client";
/* eslint-disable @next/next/no-img-element */

import { ClipboardList, KeyRound, RefreshCw, Siren, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { KeyReveal } from "@/components/app/KeyReveal";
import { WorkOrdersBoard } from "@/components/app/WorkOrders";
import { useApp } from "@/components/app/Shell";
import { HealthRing, LimitChart } from "@/components/app/charts";
import { Badge, Button, Card, Modal, Spinner, StatusDot, statusTone } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { del, fmtAgo, fmtEta, fmtTime, get, post, type Contact, type Incident, type Machine } from "@/lib/api";
import { machineType } from "@/lib/machineTypes";

type Series = Record<string, { t: number; v: number }[]>;

export default function MachinePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { subscribe } = useApp();
  const { toast } = useToast();
  const [m, setM] = useState<Machine | null>(null);
  const [series, setSeries] = useState<Series>({});
  const [events, setEvents] = useState<{ id: string; type: string; message: string; severity: string; ts: number }[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [window_, setWindow] = useState(600);
  const [rotated, setRotated] = useState<{ api_key: string; code: Record<string, string> } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  useEffect(() => { get<Contact[]>("/api/contacts").then(setContacts).catch(() => setContacts([])); }, []);

  const load = useCallback(async () => {
    const [mm, rr, ee, ii] = await Promise.all([
      get<Machine>(`/api/machines/${id}`),
      get<{ series: Series }>(`/api/machines/${id}/readings?seconds=${window_}`),
      get<typeof events>(`/api/machines/${id}/events?limit=30`),
      get<Incident[]>("/api/incidents?limit=200"),
    ]);
    setM(mm);
    setSeries(rr.series);
    setEvents(ee);
    setIncidents(ii.filter((i) => i.machine_id === id));
  }, [id, window_]);

  useEffect(() => {
    load().catch(() => router.replace("/app/machines"));
  }, [load, router]);

  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "telemetry" && e.data.machine_id === id) {
          const latest = e.data.latest as Machine["latest"];
          const ts = Number(e.data.ts);
          setM((cur) => (cur ? { ...cur, latest: { ...cur.latest, ...latest }, last_seen: ts, status: cur.status === "offline" || cur.status === "stale" ? "normal" : cur.status } : cur));
          setSeries((s) => {
            const n = { ...s };
            for (const [p, l] of Object.entries(latest)) n[p] = [...(n[p] ?? []), { t: l.ts, v: l.value }].filter((x) => x.t > ts - window_);
            return n;
          });
        }
        if (e.type === "machine" && e.data.id === id) setM((cur) => (cur ? { ...cur, status: String(e.data.status ?? cur.status), health: Number(e.data.health ?? cur.health) } : cur));
        if (e.type === "event" && e.data.machine_id === id) setEvents((ev) => [e.data as unknown as (typeof events)[number], ...ev].slice(0, 30));
        if (e.type === "incident" && e.data.machine_id === id) load();
      }),
    [subscribe, id, window_, load],
  );

  if (!m) return <Spinner />;

  async function rotate() {
    const r = await post<{ api_key: string; code: Record<string, string> }>(`/api/machines/${id}/rotate-key`);
    setRotated(r);
    toast("success", "Key rotated", "The old key stops working immediately.");
  }
  async function remove() {
    await del(`/api/machines/${id}`);
    toast("info", "Machine deleted");
    router.replace("/app/machines");
  }

  return (
    <div className="space-y-6">
      <div className="card relative overflow-hidden rounded-3xl">
        <img src={machineType(m.type)?.image ?? "/machines/conveyor.jpg"} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0b1a33]/95 via-[#0b1a33]/75 to-[#0b1a33]/30" />
        <div className="relative flex flex-wrap items-center gap-4 p-6">
          <HealthRing value={m.health} size={76} />
          <div className="min-w-0 flex-1 text-white">
            <div className="flex flex-wrap items-center gap-2">
              <StatusDot status={m.status} />
              <h2 className="font-display text-4xl font-semibold">{m.name}</h2>
              <Badge tone={statusTone(m.status)} className="!bg-white/90">{m.status}</Badge>
              <Badge tone={m.verified ? "green" : "amber"} className="!bg-white/90">{m.verified ? "verified" : "unverified"}</Badge>
            </div>
            <p className="mt-1 font-mono text-xs text-white/75">{m.device_id} · {machineType(m.type)?.name ?? m.type}{m.location ? ` · ${m.location}` : ""} · source: {m.source}{m.manual_name ? ` (${m.manual_name})` : ""} · last seen {fmtAgo(m.last_seen)}</p>
            {machineType(m.type) && <p className="mt-2 max-w-2xl text-sm text-white/80">{machineType(m.type)!.tagline}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={rotate} disabled={!m.verified}><RefreshCw size={14} /> Rotate key</Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirmDel(true)}><Trash2 size={14} /></Button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Window</span>
        {[120, 600, 1800, 3600].map((s) => (
          <Button key={s} size="sm" variant={window_ === s ? "primary" : "ghost"} onClick={() => setWindow(s)}>{s < 3600 ? `${s / 60} min` : "1 h"}</Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {m.parameters.map((p) => {
          const l = m.latest[p.name];
          return (
            <Card key={p.name} title={<span className="font-mono text-base">{p.name}</span>} action={<span className={`font-mono text-2xl font-semibold ${l?.state === "critical" ? "text-red" : l?.state === "warning" ? "text-amber" : "text-ink"}`}>{l ? `${l.value.toFixed(2)} ${p.unit ?? ""}` : "—"}</span>}>
              <LimitChart data={series[p.name] ?? []} param={p} />
              {l?.forecast && (l.forecast.eta_crit_seconds != null || l.forecast.eta_warn_seconds != null) && (
                <div className={`mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] ${l.forecast.eta_crit_seconds != null && l.forecast.eta_crit_seconds < 1800 ? "bg-red/10 text-red" : "bg-amber/10 text-amber"}`}>
                  {l.forecast.direction === "rising" ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  <span>
                    {l.forecast.direction} {Math.abs(l.forecast.slope_per_min).toFixed(3)} {p.unit ?? ""}/min
                    {l.forecast.eta_warn_seconds != null && l.state === "normal" && <> · warning in <strong>{l.forecast.eta_warn_seconds === 0 ? "now" : fmtEta(l.forecast.eta_warn_seconds)}</strong></>}
                    {l.forecast.eta_crit_seconds != null && <> · critical in <strong>{l.forecast.eta_crit_seconds === 0 ? "now" : fmtEta(l.forecast.eta_crit_seconds)}</strong></>}
                    <span className="opacity-70"> · fit R² {l.forecast.r2}</span>
                  </span>
                </div>
              )}
              <p className="mt-2 font-mono text-[10px] text-muted">normal {p.normal_min ?? "–"}–{p.normal_max ?? "–"} · warn {p.warn_low ?? "–"}/{p.warn_high ?? "–"} · crit {p.crit_low ?? "–"}/{p.crit_high ?? "–"}{p.source_page ? ` · manual p.${p.source_page}` : ""}</p>
            </Card>
          );
        })}
      </div>

      <Card title={<span className="flex items-center gap-2"><ClipboardList size={18} className="text-blue" /> Maintenance work orders</span>} action={<span className="text-xs text-muted">from Muse&apos;s checks or added by hand</span>}>
        <WorkOrdersBoard machineId={id} contacts={contacts} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="Incidents">
          {incidents.length === 0 && <p className="text-sm text-muted">None yet.</p>}
          <div className="space-y-2">
            {incidents.slice(0, 8).map((i) => (
              <Link key={i.id} href={`/app/incidents/${i.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2 hover:border-blue/50">
                <Siren size={16} className={i.severity === "critical" || i.severity === "emergency" ? "text-red" : "text-amber"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{i.title}</p>
                  <p className="text-xs text-muted">{fmtAgo(i.opened_at)} · {i.status}{i.report ? ` · ${i.report.causes[0]?.name}` : ""}</p>
                </div>
                <Badge tone={statusTone(i.severity)}>{i.severity}</Badge>
              </Link>
            ))}
          </div>
        </Card>
        <Card title="Events & logs">
          {events.length === 0 && <p className="text-sm text-muted">No events. Devices can post E-stop, jam sensor etc. to /v1/events.</p>}
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-[11px] text-muted">{fmtTime(e.ts)}</span>
                <Badge tone={statusTone(e.severity)}>{e.type}</Badge>
                <span className="truncate text-ink">{e.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {m.knowledge.length > 0 && (
        <Card title="Knowledge from the manual">
          <div className="grid gap-3 md:grid-cols-2">
            {m.knowledge.map((k, i) => (
              <div key={i} className="rounded-xl border border-line bg-white p-3">
                <div className="flex items-center justify-between"><p className="text-sm font-semibold text-ink">{k.title}</p><Badge tone="muted">{k.kind}{k.page ? ` · p.${k.page}` : ""}</Badge></div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{k.text}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title={<span className="flex items-center gap-2"><KeyRound size={18} className="text-blue" /> Device connection</span>}>
        <KeyReveal machine={m} apiKey={rotated?.api_key} codes={rotated?.code} />
      </Card>

      <Modal open={confirmDel} onClose={() => setConfirmDel(false)} title="Delete this machine?">
        <p className="text-sm text-muted">All readings, events and its device key are removed. Incidents are kept for history.</p>
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button><Button variant="danger" onClick={remove}>Delete</Button></div>
      </Modal>
    </div>
  );
}
