"use client";
/* eslint-disable @next/next/no-img-element */

import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { useHighlight } from "@/components/muse/MuseLive";
import { HealthRing } from "@/components/app/charts";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Badge, Button, Empty, StatusDot, statusTone } from "@/components/ui/Primitives";
import { PageSkeleton } from "@/components/ui/Primitives";
import { fmtAgo, get, type Machine, fmtEta, worstForecast } from "@/lib/api";
import { machineType } from "@/lib/machineTypes";

export default function MachinesPage() {
  const { subscribe } = useApp();
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const load = () => get<Machine[]>("/api/machines").then(setMachines).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "machine") load();
        if (e.type === "telemetry")
          setMachines((ms) => ms?.map((m) => (m.id === e.data.machine_id ? { ...m, latest: { ...m.latest, ...(e.data.latest as Machine["latest"]) }, last_seen: Number(e.data.ts) } : m)) ?? ms);
      }),
    [subscribe],
  );

  if (!machines) return <PageSkeleton variant="cards" />;
  if (machines.length === 0) return <Empty title="No machines yet" body="Upload a manual or fill in a spec by hand." action={<Link href="/app/onboard"><Button>Onboard a machine <ArrowRight size={16} /></Button></Link>} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{machines.length} machine{machines.length === 1 ? "" : "s"} · {machines.filter((m) => m.verified).length} verified</p>
        <Link href="/app/onboard"><Button size="sm"><Plus size={14} /> Onboard machine</Button></Link>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {machines.map((m) => (
          <MachineCard key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}


function MachineCard({ m }: { m: Machine }) {
  const hl = useHighlight(m.id);
  return (
    <Link data-hl={m.id} href={`/app/machines/${m.id}`} className={`card group overflow-hidden rounded-2xl transition hover:-translate-y-0.5 hover:border-blue/50 ${hl.className}`}>
            <div className="relative h-36 overflow-hidden">
              <img src={machineType(m.type)?.image ?? "/machines/conveyor.jpg"} alt="" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/25 to-transparent" />
              <div className="absolute right-3 top-3"><HealthRing value={m.health} size={48} /></div>
              <div className="absolute bottom-2 left-4 right-4">
                <div className="flex items-center gap-2">
                  <StatusDot status={m.status} />
                  <p className="truncate font-display text-2xl font-semibold text-white">{m.name}</p>
                </div>
                <p className="font-mono text-[11px] text-white/75">{m.device_id} · {machineType(m.type)?.name ?? m.type}{m.location ? ` · ${m.location}` : ""}</p>
              </div>
            </div>
            <div className="p-4">
            {(() => { const wf = worstForecast(m.latest); return wf ? (
              <div className={`-mt-1 mb-2 flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] ${wf.level === "critical" ? "bg-red/10 text-red" : "bg-amber/10 text-amber"}`}>
                {wf.f.direction === "rising" ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                <span><span className="font-mono">{wf.parameter}</span> reaches the {wf.level} limit in <strong>{fmtEta(wf.seconds)}</strong> at {Math.abs(wf.f.slope_per_min).toFixed(2)}/min</span>
              </div>
            ) : null; })()}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone={statusTone(m.status)}>{m.status}</Badge>
              <Badge tone={m.verified ? "green" : "amber"}>{m.verified ? "verified" : "unverified"}</Badge>
              <Badge tone="muted">{m.source}</Badge>
              <Badge tone="muted">{fmtAgo(m.last_seen)}</Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {m.parameters.slice(0, 4).map((p) => {
                const l = m.latest[p.name];
                return (
                  <div key={p.name} className="rounded-lg bg-sky-soft/60 px-2.5 py-1.5">
                    <p className="truncate font-mono text-[10px] text-muted">{p.name}</p>
                    <p className={`font-mono text-sm font-semibold ${l?.state === "critical" ? "text-red" : l?.state === "warning" ? "text-amber" : "text-ink"}`}>{l ? `${l.value.toFixed(1)} ${p.unit ?? ""}` : "—"}</p>
                  </div>
                );
              })}
            </div>
            </div>
    </Link>
  );
}
