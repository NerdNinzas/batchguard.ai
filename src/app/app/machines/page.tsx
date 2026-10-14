"use client";

import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { HealthRing } from "@/components/app/charts";
import { Badge, Button, Empty, Spinner, StatusDot, statusTone } from "@/components/ui/Primitives";
import { fmtAgo, get, type Machine } from "@/lib/api";

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

  if (!machines) return <Spinner />;
  if (machines.length === 0) return <Empty title="No machines yet" body="Upload a manual or fill in a spec by hand." action={<Link href="/app/onboard"><Button>Onboard a machine <ArrowRight size={16} /></Button></Link>} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{machines.length} machine{machines.length === 1 ? "" : "s"} · {machines.filter((m) => m.verified).length} verified</p>
        <Link href="/app/onboard"><Button size="sm"><Plus size={14} /> Onboard machine</Button></Link>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {machines.map((m) => (
          <Link key={m.id} href={`/app/machines/${m.id}`} className="card rounded-2xl p-5 transition hover:border-blue/50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusDot status={m.status} />
                  <p className="truncate font-display text-xl font-semibold text-ink">{m.name}</p>
                </div>
                <p className="font-mono text-[11px] text-muted">{m.device_id} · {m.type}{m.location ? ` · ${m.location}` : ""}</p>
              </div>
              <HealthRing value={m.health} size={52} />
            </div>
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
          </Link>
        ))}
      </div>
    </div>
  );
}
