"use client";

import { Siren } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Pagination } from "@/components/app/LazySection";
import { useApp } from "@/components/app/Shell";
import { useHighlight } from "@/components/muse/MuseLive";
import { Badge, Button, Empty, Skeleton, statusTone } from "@/components/ui/Primitives";
import { cached, fmtAgo, fmtCountdown, get, type Incident } from "@/lib/api";
import { useNow } from "@/lib/useNow";

type Page = { items: Incident[]; total: number; page: number; page_size: number; pages: number; counts: { all: number; open: number; acknowledged: number; resolved: number } };
const PAGE_SIZE = 30;
const key = (filter: string, page: number) => `/api/incidents?page=${page}&page_size=${PAGE_SIZE}${filter === "all" ? "" : `&status=${filter}`}`;

export default function IncidentsPage() {
  const { subscribe } = useApp();
  const [filter, setFilter] = useState<"all" | "open" | "acknowledged" | "resolved">("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(() => cached<Page>(key("all", 1)));
  const [loading, setLoading] = useState(false);

  const load = useCallback((f = filter, p = page, silent = false) => {
    if (!silent) setLoading(true);
    return get<Page>(key(f, p)).then((d) => { setData(d); if (p > d.pages && d.pages >= 1) setPage(d.pages); }).catch(() => {}).finally(() => setLoading(false));
  }, [filter, page]);
  useEffect(() => { const c = cached<Page>(key(filter, page)); if (c) setData(c); load(filter, page, Boolean(c)); }, [filter, page, load]);
  useEffect(() => subscribe((e) => { if (e.type === "incident") load(filter, page, true); }), [subscribe, filter, page, load]);

  const counts = data?.counts;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "open", "acknowledged", "resolved"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "primary" : "ghost"} onClick={() => { setFilter(f); setPage(1); }}>{f} <span className="font-mono text-[10px] opacity-70">{counts ? counts[f] : "·"}</span></Button>
        ))}
        {loading && data && <span className="text-xs text-muted">refreshing…</span>}
      </div>
      {!data ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <RowSkeleton key={i} />)}</div>
      ) : data.items.length === 0 ? (
        <Empty title="No incidents" body="When detection fires, Muse opens one incident per machine, investigates it and posts the report here." />
      ) : (
        <div className={`space-y-2 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {data.items.map((i) => <IncidentRow key={i.id} i={i} />)}
          <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.page_size} onChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
        </div>
      )}
    </div>
  );
}

function RowSkeleton() {
  return <div className="card flex items-center gap-4 rounded-2xl p-4"><Skeleton className="h-10 w-10 rounded-xl" /><div className="flex-1"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-2 h-3 w-1/3" /></div><Skeleton className="h-5 w-16 rounded-full" /><Skeleton className="h-5 w-16 rounded-full" /></div>;
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
