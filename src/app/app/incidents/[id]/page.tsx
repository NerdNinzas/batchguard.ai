"use client";

import { Camera, Check, ClipboardList, MessageSquare, Phone, RefreshCw, Send, ShieldAlert, ThumbsDown, ThumbsUp, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PhotoEvidence } from "@/components/app/PhotoEvidence";
import { ShutdownBanner } from "@/components/app/ShutdownCountdown";
import { useApp } from "@/components/app/Shell";
import { Spot, useHighlight } from "@/components/muse/MuseLive";
import { WorkOrdersBoard } from "@/components/app/WorkOrders";
import { Badge, Button, Card, Input, Modal, Select, statusTone } from "@/components/ui/Primitives";
import { PageSkeleton } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { fmtAgo, fmtTime, get, post, type Cause, type Contact, type Incident, type VoiceCall, type WorkOrder } from "@/lib/api";

const SUPPORT: Record<string, string> = { strong: "green", plausible: "blue", weak: "amber", inconclusive: "muted" };

export default function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const { subscribe, user } = useApp();
  const { toast } = useToast();
  const [inc, setInc] = useState<Incident | null>(null);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [fb, setFb] = useState({ verdict: "correct", actual_cause: "", fix: "" });
  const [calling, setCalling] = useState(false);
  const hl = useHighlight(id);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [makingWo, setMakingWo] = useState(false);
  useEffect(() => { get<Contact[]>("/api/contacts").then(setContacts).catch(() => setContacts([])); }, []);
  async function workOrdersFromChecks() {
    setMakingWo(true);
    try { const made = await post<WorkOrder[]>(`/api/work-orders/from-incident/${id}`); toast("success", made.length ? `${made.length} work order${made.length > 1 ? "s" : ""} created` : "All checks already have work orders"); load(); }
    catch (e) { toast("error", "Could not create work orders", e instanceof Error ? e.message : String(e)); }
    finally { setMakingWo(false); }
  }

  const load = useCallback(() => get<Incident>(`/api/incidents/${id}`).then(setInc), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribe((e) => { if (e.type === "incident" && e.data.id === id) load(); if (e.type === "notification" && e.data.incident_id === id) load(); }), [subscribe, id, load]);

  if (!inc) return <PageSkeleton variant="detail" />;
  const r = inc.report;

  async function ack() { await post(`/api/incidents/${id}/ack`); toast("success", "Acknowledged", "Escalation stops here."); load(); }
  async function reinvestigate() { await post(`/api/incidents/${id}/investigate`); toast("info", "Muse is re-investigating…"); }
  async function callContact() {
    if (!inc) return;
    const sev = inc.severity;
    const call_type = inc.status === "acknowledged" ? "resolution_followup" : sev === "emergency" ? "emergency_escalation" : sev === "warning" || sev === "info" ? "warning_notice" : "critical_alert";
    setCalling(true);
    try {
      const c = await post<VoiceCall>("/api/voice/calls", { call_type, incident_id: id });
      if (c.status === "failed") toast("error", "Call failed", c.error ?? "Dograh rejected the call");
      else toast("success", `Muse is calling ${c.contact_name ?? c.to_number}`, `${c.title} · Gemini Live via TeleCMI ${c.from_number ?? ""}`);
      load();
    } catch (e) { toast("error", "Could not place call", e instanceof Error ? e.message : String(e)); }
    finally { setCalling(false); }
  }
  async function ask() {
    if (!q.trim()) return;
    setAsking(true);
    try { await post(`/api/incidents/${id}/ask`, { question: q }); setQ(""); load(); } finally { setAsking(false); }
  }
  async function resolve() {
    await post(`/api/incidents/${id}/resolve`, fb);
    setResolveOpen(false);
    toast("success", "Resolved", "Feedback stored against the machine's history.");
    load();
  }

  return (
    <div className="space-y-5">
      <div data-hl={id} className={`card rounded-2xl p-5 ${hl.className}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(inc.severity)}>{inc.severity}</Badge><Badge tone={statusTone(inc.status)}>{inc.status === "resolved" && inc.resolved_reason === "back to normal" ? "resolved · back to normal" : inc.resolved_reason === "back online" ? "resolved · back online" : inc.status}</Badge>{inc.escalation_level > 0 && <Badge tone="red">escalation level {inc.escalation_level}</Badge>}<Badge tone="muted">{inc.id}</Badge></div>
            <h2 className="font-display mt-2 text-3xl font-semibold text-ink">{inc.title}</h2>
            <p className="text-sm text-muted">Opened {fmtAgo(inc.opened_at)} ({fmtTime(inc.opened_at)}) · <Link href={`/app/machines/${inc.machine_id}`} className="text-blue hover:underline">{inc.machine?.name}</Link> · {inc.machine?.device_id}{inc.acknowledged_by ? ` · acknowledged by ${inc.acknowledged_by}` : ""}</p>
          </div>
          <div className="flex gap-2">
            {inc.status === "open" && <Button onClick={ack}><Check size={16} /> Acknowledge</Button>}
            {inc.status !== "resolved" && <Button variant="secondary" onClick={() => setResolveOpen(true)}>Resolve with feedback</Button>}
            <Button variant="ghost" onClick={reinvestigate}><RefreshCw size={14} /></Button>
          </div>
        </div>
      </div>

      {inc.shutdown_state && inc.shutdown_state !== "cancelled" && <ShutdownBanner inc={inc} onChanged={load} />}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <Spot k="report"><Card title="Investigation report" action={r ? <Badge tone={inc.report_source?.includes("gemini") ? "violet" : "blue"}>{inc.report_source}</Badge> : <Badge tone="amber">investigating…</Badge>}>
            {!r ? <p className="text-sm text-muted">Muse is gathering evidence: readings, baseline, events, neighbours, the manual, correlations. This usually takes a few seconds.</p> : (
              <div className="space-y-5">
                <p className="text-base leading-relaxed text-ink">{r.summary}</p>
                {r.cross_machine && <p className="rounded-xl border border-violet/30 bg-violet/5 p-3 text-sm text-ink"><strong>Cross-machine:</strong> {r.cross_machine}</p>}
                <div>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Ranked causes</p>
                  <Spot k="causes"><div className="space-y-3">{r.causes.map((c, i) => <CauseCard key={c.name} c={c} i={i} />)}</div></Spot>
                </div>
                <div>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Recommended checks · most discriminating first</p>
                  <Spot k="checks"><ol className="space-y-2">{r.checks.map((c) => <li key={c.order} className="flex gap-3 rounded-xl border border-line bg-white p-3 text-sm"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue font-mono text-xs text-white">{c.order}</span><div><p className="text-ink">{c.action}</p><p className="mt-0.5 text-xs text-muted">Separates: {c.discriminates} · <ShieldAlert size={11} className="inline" /> {c.safety}</p></div></li>)}</ol></Spot>
                </div>
                {r.missing_data.length > 0 && <div className="rounded-xl bg-sky-soft/60 p-3 text-xs text-muted"><strong className="text-ink">Missing data:</strong> {r.missing_data.join(" · ")}</div>}
                <Spot k="call-script"><div className="rounded-xl border border-red/30 bg-red/5 p-3"><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-red"><Phone size={12} /> Call script (≤ 20 s)</p><p className="mt-1 text-sm text-ink">“{r.call_script}”</p><div className="mt-2 flex flex-wrap items-center gap-2"><Button size="sm" variant="danger" onClick={callContact} loading={calling}><Phone size={14} /> {inc.status === "acknowledged" ? "Call back: what did you find?" : "Call the on-call contact now"}</Button><Link href="/app/voice" className="text-[11px] text-blue hover:underline">Scripts, TeleCMI number & call history →</Link></div><p className="mt-1 text-[11px] text-muted">Gemini Live speaks this brief over TeleCMI; an acknowledgement on the call acknowledges the incident here.</p></div></Spot>
                {r.guardrail && <p className="text-[11px] text-muted">Guardrail: schema {r.guardrail.schema} · {r.guardrail.unverified_numbers_removed.length} unverified number(s) removed{r.guardrail.unverified_numbers_removed.length ? ` (${r.guardrail.unverified_numbers_removed.join(", ")})` : ""}.</p>}
              </div>
            )}
          </Card></Spot>

          <Spot k="evidence"><Card title={<span className="flex items-center gap-2"><Camera size={18} className="text-blue" /> Photo evidence</span>} action={<span className="text-xs text-muted">{(inc.evidence ?? []).length} photo{(inc.evidence ?? []).length === 1 ? "" : "s"} · Gemini vision</span>}>
            <PhotoEvidence incidentId={id} items={inc.evidence ?? []} onChanged={load} />
            {(inc.evidence ?? []).length > 0 && <div className="mt-3 flex items-center gap-2"><Button size="sm" variant="secondary" onClick={reinvestigate}><Wand2 size={14} /> Re-investigate with the photos</Button><span className="text-[11px] text-muted">Muse re-runs the pipeline with the photo findings as extra signals.</span></div>}
          </Card></Spot>

          <Spot k="work-orders"><Card title={<span className="flex items-center gap-2"><ClipboardList size={18} className="text-blue" /> Work orders</span>} action={r && r.checks.length > 0 ? <Button size="sm" variant="secondary" onClick={workOrdersFromChecks} loading={makingWo}><Wand2 size={14} /> From Muse&apos;s checks</Button> : undefined}>
            <WorkOrdersBoard machineId={inc.machine_id} incidentId={id} contacts={contacts} compact />
          </Card></Spot>

          <Spot k="chat"><Card title={<span className="flex items-center gap-2"><MessageSquare size={18} className="text-blue" /> Ask Muse about this incident</span>}>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {(inc.chat ?? []).length === 0 && <p className="text-sm text-muted">e.g. “Why not a fan failure?” · “What should I check first?”</p>}
              {inc.chat?.map((m) => <div key={m.id} className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${m.role === "user" ? "ml-auto bg-blue text-white" : "bg-sky-soft text-ink"}`}>{m.text}</div>)}
            </div>
            <div className="mt-3 flex gap-2"><Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Why not a motor fault?" className="flex-1" /><Button onClick={ask} loading={asking}><Send size={16} /></Button></div>
          </Card></Spot>
        </div>

        <div className="space-y-5">
          <Spot k="timeline"><Card title="Timeline & signals">
            <ul className="space-y-2">{inc.signals.map((s, i) => <li key={i} className="flex gap-2 text-sm"><span className="shrink-0 font-mono text-[11px] text-muted">{fmtTime(s.ts)}</span><Badge tone={statusTone(s.severity)}>{s.layer}</Badge><span className="text-ink">{s.message}</span></li>)}</ul>
          </Card></Spot>
          <Spot k="escalation"><Card title="Escalation">
            <ul className="space-y-1.5">{(inc.notifications ?? []).map((n) => <li key={n.id} className="flex items-center gap-2 text-xs"><span className="font-mono text-muted">{fmtTime(n.sent_at)}</span><Badge tone={n.channel === "voice" ? "violet" : n.channel === "email" ? "blue" : "green"}>{n.channel}</Badge><span className="text-ink">{n.status}</span>{n.to_addr && <span className="text-muted">→ {n.to_addr}</span>}</li>)}{(inc.notifications ?? []).length === 0 && <p className="text-sm text-muted">None.</p>}</ul>
          </Card></Spot>
          <Spot k="agent-runs"><Card title="Agent runs">
            {(inc.runs ?? []).map((run) => <div key={run.id} className="mb-2 rounded-xl border border-line bg-white p-3 text-xs"><div className="flex items-center justify-between"><Badge tone={run.ok ? "green" : "red"}>{run.source}</Badge><span className="font-mono text-muted">{run.finished_at ? `${(run.finished_at - run.started_at).toFixed(1)}s` : "running"}</span></div>{run.tool_calls.length > 0 && <p className="mt-1 font-mono text-[10px] text-muted">{run.tool_calls.map((t) => (t.stage ? `${t.stage}·${t.tool}` : t.tool)).join(" → ")}</p>}{run.error && <p className="mt-1 text-red">{run.error.slice(0, 200)}</p>}</div>)}
          </Card></Spot>
          {inc.status === "resolved" && inc.resolved_reason === "back to normal" && <Card title="Back to normal"><p className="text-sm text-ink"><ThumbsUp size={14} className="inline text-green" /> The machine&apos;s parameters returned to their normal band{inc.resolved_at ? ` at ${fmtTime(inc.resolved_at)}` : ""}, so Muse closed this incident automatically. The investigation report and timeline above stay as the record.</p></Card>}
          {inc.feedback && inc.feedback.verdict !== "auto" && <Card title="Engineer feedback"><p className="text-sm text-ink">{inc.feedback.verdict === "correct" ? <ThumbsUp size={14} className="inline text-green" /> : <ThumbsDown size={14} className="inline text-red" />} {inc.feedback.verdict}{inc.feedback.actual_cause ? ` · actual cause: ${inc.feedback.actual_cause}` : ""}{inc.feedback.fix ? ` · fix: ${inc.feedback.fix}` : ""}</p></Card>}
        </div>
      </div>

      <Modal open={resolveOpen} onClose={() => setResolveOpen(false)} title="Resolve incident">
        <div className="space-y-3">
          <Select label="Was the diagnosis right?" value={fb.verdict} onChange={(e) => setFb({ ...fb, verdict: e.target.value })}><option value="correct">Correct</option><option value="partly">Partly</option><option value="wrong">Wrong</option></Select>
          <Input label="Actual cause" value={fb.actual_cause} onChange={(e) => setFb({ ...fb, actual_cause: e.target.value })} placeholder="Bearing wear" />
          <Input label="What fixed it" value={fb.fix} onChange={(e) => setFb({ ...fb, fix: e.target.value })} placeholder="Replaced drive-end bearing" />
          <p className="text-xs text-muted">Resolving by {user.email}. Feedback feeds Muse&apos;s history for this machine.</p>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setResolveOpen(false)}><X size={14} /> Cancel</Button><Button onClick={resolve}><Check size={14} /> Resolve</Button></div>
      </Modal>
    </div>
  );
}

function CauseCard({ c, i }: { c: Cause; i: number }) {
  return (
    <div className={`rounded-2xl border p-4 ${i === 0 ? "border-blue/40 bg-blue/[0.03]" : "border-line bg-white"}`}>
      <div className="flex items-center gap-2"><span className="font-mono text-lg font-semibold text-blue">#{i + 1}</span><p className="font-semibold text-ink">{c.name}</p><Badge tone={SUPPORT[c.support] ?? "muted"}>{c.support}</Badge></div>
      <p className="mt-1 text-xs text-muted">{c.rationale}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div><p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-green">Evidence for</p><ul className="space-y-1 text-xs text-ink">{c.evidence_for.length === 0 && <li className="text-muted">—</li>}{c.evidence_for.map((e, k) => <li key={k} className="flex gap-1.5"><span className="text-green">+</span><span>{e.observation} <span className="text-muted">({e.source})</span></span></li>)}</ul></div>
        <div><p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-red">Evidence against</p><ul className="space-y-1 text-xs text-ink">{c.evidence_against.length === 0 && <li className="text-muted">—</li>}{c.evidence_against.map((e, k) => <li key={k} className="flex gap-1.5"><span className="text-red">−</span><span>{e.observation} <span className="text-muted">({e.source})</span></span></li>)}</ul></div>
      </div>
      {c.missing_data.length > 0 && <p className="mt-2 text-[11px] text-muted">Missing: {c.missing_data.join(" · ")}</p>}
    </div>
  );
}
