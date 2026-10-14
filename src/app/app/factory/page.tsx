"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { Badge, Button, Empty, Spinner, StatusDot, statusTone } from "@/components/ui/Primitives";
import { get, type Latest, type Machine } from "@/lib/api";

const LiveFactory = dynamic(() => import("@/components/three/LiveFactory"), { ssr: false, loading: () => <div className="grid h-full place-items-center text-sm text-muted">Loading 3D factory…</div> });

export default function FactoryPage() {
  const { subscribe } = useApp();
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [latest, setLatest] = useState<Record<string, Latest>>({});

  useEffect(() => {
    get<Machine[]>("/api/machines").then((ms) => { setMachines(ms); setLatest(Object.fromEntries(ms.map((m) => [m.id, m.latest]))); });
  }, []);
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "telemetry") setLatest((s) => ({ ...s, [String(e.data.machine_id)]: { ...(s[String(e.data.machine_id)] ?? {}), ...(e.data.latest as Latest) } }));
        if (e.type === "machine") setMachines((ms) => ms?.map((m) => (m.id === e.data.id ? { ...m, status: String(e.data.status ?? m.status), health: Number(e.data.health ?? m.health) } : m)) ?? ms);
      }),
    [subscribe],
  );

  if (!machines) return <Spinner />;
  if (machines.length === 0) return <Empty title="No machines to show" body="Onboard a machine and it appears here as a 3D model, coloured by its live status." action={<Link href="/app/onboard"><Button>Onboard a machine</Button></Link>} />;

  return (
    <div className="space-y-4">
      <div className="card relative h-[640px] overflow-hidden rounded-3xl">
        <LiveFactory machines={machines} latest={latest} />
        <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-2">
          {machines.map((m) => (
            <span key={m.id} className="glass flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-ink"><StatusDot status={m.status} />{m.name}<Badge tone={statusTone(m.status)}>{m.status}</Badge></span>
          ))}
        </div>
        <p className="pointer-events-none absolute bottom-3 left-4 font-mono text-[10px] uppercase tracking-widest text-muted">drag to orbit · scroll to zoom · order follows the workflow</p>
      </div>
    </div>
  );
}
