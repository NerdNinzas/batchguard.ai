"use client";

import { Power, ShieldAlert, TimerReset } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Primitives";
import { fmtCountdown, post, type Incident } from "@/lib/api";
import { useNow } from "@/lib/useNow";

/** Live countdown to Muse's auto-shutdown on an incident, with the two ways to stop it. */
export function ShutdownBanner({ inc, onChanged, compact = false }: { inc: Incident; onChanged: () => void; compact?: boolean }) {
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const st = inc.shutdown_state;
  if (!st || st === "cancelled") return null;
  async function act(path: string, label: string) { setBusy(label); try { await post(path); onChanged(); } finally { setBusy(null); } }
  if (st === "done") {
    return (
      <div className={`rounded-2xl border border-violet/50 bg-violet/10 ${compact ? "p-3" : "p-4"}`}>
        <p className="flex items-center gap-2 font-semibold text-violet"><Power size={16} /> Muse shut this machine down{inc.shutdown_at ? ` at ${new Date(inc.shutdown_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
        <p className="mt-1 text-sm text-ink">No one acknowledged the incident and no one answered the call within the window, so the machine was stopped to protect it.</p>
        {!compact && <div className="mt-2 flex flex-wrap items-center gap-2"><Link href={`/app/machines/${inc.machine_id}`}><Button size="sm" variant="secondary"><Power size={14} /> Go to the machine to restart it</Button></Link><span className="text-[11px] text-muted">Restart only after a qualified person has checked it.</span></div>}
      </div>
    );
  }
  const left = now ? fmtCountdown(inc.shutdown_at, now) : "–:––";
  const urgent = st === "warned" || (inc.shutdown_at ?? 0) - now / 1000 < 60;
  return (
    <div className={`rounded-2xl border ${urgent ? "border-red/60 bg-red/10" : "border-amber/60 bg-amber/10"} ${compact ? "p-3" : "p-4"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`grid h-11 w-11 place-items-center rounded-xl ${urgent ? "bg-red text-white animate-pulse" : "bg-amber/20 text-amber"}`}><ShieldAlert size={20} /></span>
          <div>
            <p className={`font-display text-2xl font-semibold tabular-nums ${urgent ? "text-red" : "text-ink"}`}>{left}</p>
            <p className="text-xs text-muted">until Muse shuts the machine down — nobody has acknowledged or answered the call yet</p>
          </div>
        </div>
        {!compact && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => act(`/api/incidents/${inc.id}/ack`, "ack")} loading={busy === "ack"}>Acknowledge · keep it running</Button>
            <Button size="sm" variant="secondary" onClick={() => act(`/api/incidents/${inc.id}/cancel-shutdown`, "cancel")} loading={busy === "cancel"}><TimerReset size={14} /> Cancel countdown</Button>
          </div>
        )}
      </div>
    </div>
  );
}
