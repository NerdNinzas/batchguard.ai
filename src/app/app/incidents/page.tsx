"use client";

import { Siren } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { useHighlight } from "@/components/muse/MuseLive";
import { Badge, Button, Empty, statusTone } from "@/components/ui/Primitives";
import { PageSkeleton } from "@/components/ui/Primitives";
import { cached, fmtAgo, fmtCountdown, get, type Incident } from "@/lib/api";
import { useNow } from "@/lib/useNow";

export default function IncidentsPage() {
  const { subscribe } = useApp();
  const [items, setItems] = useState<Incident[] | null>(() => cached<Incident[]>("/api/incidents?limit=200"));
  const [filter, setFilter] = useState<"all" | "open" | "acknowledged" | "resolved">("all");
  const load = () => get<Incident[]>("/api/incidents?limit=200").then(setItems);
  useEffect(() => { load(); }, []);
  useEffect(() => subscribe((e) => { if (e.type === "incident") load(); }), [subscribe]);
  if (!items) return <PageSkeleton variant="rows" />;
  const list = items.filter((i) => filter === "all" || i.status === filter);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">{(["all", "open", "acknowledged", "resolved"] as const).map((f) => <Button key={f} size="sm" variant={filter === f ? "primary" : "ghost"} onClick={() => setFilter(f)}>{f} <span className="font-mono text-[10px] opacity-70">{items.filter((i) => f === "all" || i.status === f).length}</span></Button>)}</div>
      {list.length === 0 ? <Empty title="No incidents" body="When detection fires, Muse opens one incident per machine, investigates it and posts the report here." /> : (
        <div className="space-y-2">
          {list.map((i) => (
            <IncidentRow key={i.id} i={i} />
          ))}
        </div>
      )}
    </div>
  );
}


function IncidentRow({ i }: { i: Incident }) {
  const hl = useHighlight(i.id);
  return (
    <Link data-hl={i.id} href={`/app/incidents/${i.id}`} className={`card flex items-center gap-4 rounded-2xl p-4 transition hover:border-blue/50 ${hl.className}`}>
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${i.severity === "critical" || i.severity === "emergency" ? "bg-red/10 text-red" : i.severity === "warning" ? "bg-amber/10 text-amber" : "bg-blue/10 text-blue"}`}><Siren size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{i.title}</p>
                <p className="text-xs text-muted">{i.machine?.name} · {fmtAgo(i.opened_at)} · {i.signals.length} signal(s){i.report ? ` · top cause: ${i.report.causes[0]?.name} (${i.report.causes[0]?.support})` : " · investigating…"}</p>
              </div>
              {i.shutdown_state === "done" && <Badge tone="violet">shut down by Muse</Badge>}
              {(i.shutdown_state === "pending" || i.shutdown_state === "warned") && <Countdown ts={i.shutdown_at} />}
              <Badge tone={statusTone(i.severity)}>{i.severity}</Badge>
              <Badge tone={statusTone(i.status)}>{i.status === "resolved" && i.resolved_reason === "back to normal" ? "resolved · back to normal" : i.resolved_reason === "back online" ? "resolved · back online" : i.status}</Badge>
    </Link>
  );
}


function Countdown({ ts }: { ts?: number | null }) {
  const now = useNow();
  return <Badge tone="red">shutdown in {now ? fmtCountdown(ts, now) : "–:––"}</Badge>;
}
