"use client";

import { CalendarClock, ClipboardList, GripVertical, Plus, Sparkles, Trash2, User } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { Badge, Button, Input, Select, Spinner } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { del, fmtAgo, get, post, put, type WorkOrder } from "@/lib/api";

const COLS: { key: WorkOrder["status"]; label: string; tone: string }[] = [
  { key: "open", label: "Open", tone: "border-amber/50" },
  { key: "in_progress", label: "In progress", tone: "border-blue/50" },
  { key: "done", label: "Done", tone: "border-green/50" },
];
const PRIO_TONE: Record<string, string> = { low: "muted", medium: "blue", high: "amber", urgent: "red" };

/** Kanban of maintenance work orders for one machine (or one incident). Drag cards between columns. */
export function WorkOrdersBoard({ machineId, incidentId, contacts, compact = false }: { machineId: string; incidentId?: string; contacts?: { name: string }[]; compact?: boolean }) {
  const { subscribe } = useApp();
  const { toast } = useToast();
  const [items, setItems] = useState<WorkOrder[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", priority: "medium", assignee: "", due_hours: "24" });
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const load = useCallback(() => get<WorkOrder[]>(`/api/work-orders?${incidentId ? `incident_id=${incidentId}` : `machine_id=${machineId}`}`).then(setItems), [machineId, incidentId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribe((e) => {
    if (e.type !== "work_order") return;
    const w = e.data as unknown as WorkOrder & { deleted?: boolean };
    if (w.machine_id !== machineId) return;
    if (incidentId && w.incident_id !== incidentId) return;
    setItems((cur) => {
      if (!cur) return cur;
      if (w.deleted) return cur.filter((x) => x.id !== w.id);
      return cur.some((x) => x.id === w.id) ? cur.map((x) => (x.id === w.id ? w : x)) : [...cur, w];
    });
  }), [subscribe, machineId, incidentId]);

  async function move(id: string, status: WorkOrder["status"]) {
    const cur = items?.find((x) => x.id === id);
    if (!cur || cur.status === status) return;
    setItems((s) => s!.map((x) => (x.id === id ? { ...x, status } : x)));
    try { await put(`/api/work-orders/${id}`, { status }); } catch { toast("error", "Could not move work order"); load(); }
  }
  async function add() {
    if (!draft.title.trim()) return toast("warning", "Give the work order a title");
    await post("/api/work-orders", { machine_id: machineId, incident_id: incidentId ?? null, title: draft.title.trim(), priority: draft.priority, assignee: draft.assignee || null, due_at: Date.now() / 1000 + Number(draft.due_hours) * 3600 });
    setDraft({ title: "", priority: "medium", assignee: "", due_hours: "24" }); setAdding(false); toast("success", "Work order created");
  }
  async function remove(id: string) { await del(`/api/work-orders/${id}`); setItems((s) => s!.filter((x) => x.id !== id)); }
  async function assign(id: string, assignee: string) { setItems((s) => s!.map((x) => (x.id === id ? { ...x, assignee } : x))); await put(`/api/work-orders/${id}`, { assignee }); }

  if (!items) return <Spinner />;
  const open = items.filter((w) => w.status !== "done").length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted"><ClipboardList size={12} className="inline" /> {open} open · {items.length - open} done{incidentId ? "" : " · drag cards between columns"}</p>
        <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}><Plus size={14} /> New work order</Button>
      </div>
      {adding && (
        <div className="mb-3 grid gap-2 rounded-2xl border border-line bg-white p-3 sm:grid-cols-[1fr_120px_150px_110px_auto] sm:items-end">
          <Input label="What needs doing" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} autoFocus />
          <Select label="Priority" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>{["low", "medium", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</Select>
          <Select label="Assignee" value={draft.assignee} onChange={(e) => setDraft({ ...draft, assignee: e.target.value })}><option value="">— unassigned —</option>{(contacts ?? []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</Select>
          <Select label="Due in" value={draft.due_hours} onChange={(e) => setDraft({ ...draft, due_hours: e.target.value })}>{[["1", "1 h"], ["4", "4 h"], ["24", "1 day"], ["72", "3 days"], ["168", "1 week"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          <Button onClick={add}>Add</Button>
        </div>
      )}
      <div className={`grid gap-3 ${compact ? "md:grid-cols-3" : "lg:grid-cols-3"}`}>
        {COLS.map((col) => {
          const list = items.filter((w) => w.status === col.key);
          return (
            <div key={col.key} onDragOver={(e) => { e.preventDefault(); setOver(col.key); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); if (dragging) move(dragging, col.key); setDragging(null); setOver(null); }}
              className={`min-h-[140px] rounded-2xl border-2 border-dashed bg-sky-soft/30 p-2 transition ${over === col.key ? "border-blue bg-sky-soft/70" : col.tone}`}>
              <p className="mb-2 flex items-center justify-between px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted"><span>{col.label}</span><span>{list.length}</span></p>
              <div className="space-y-2">
                {list.map((w) => {
                  const overdue = w.status !== "done" && w.due_at != null && w.due_at < Date.now() / 1000;
                  return (
                    <div key={w.id} draggable onDragStart={() => setDragging(w.id)} onDragEnd={() => setDragging(null)}
                      className={`group cursor-grab rounded-xl border border-line bg-white p-3 shadow-[0_6px_18px_-12px_rgba(11,26,51,.35)] active:cursor-grabbing ${dragging === w.id ? "opacity-50" : ""}`}>
                      <div className="flex items-start gap-2">
                        <GripVertical size={14} className="mt-0.5 shrink-0 text-muted/60" />
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm leading-snug text-ink ${w.status === "done" ? "line-through opacity-60" : ""}`}>{w.title}</p>
                          {w.description && !compact && <p className="mt-1 line-clamp-2 whitespace-pre-line text-[11px] text-muted">{w.description}</p>}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge tone={PRIO_TONE[w.priority]}>{w.priority}</Badge>
                            {w.source === "muse" && <Badge tone="violet"><Sparkles size={9} /> muse</Badge>}
                            {w.due_at != null && <span className={`inline-flex items-center gap-1 font-mono text-[10px] ${overdue ? "text-red" : "text-muted"}`}><CalendarClock size={10} /> {overdue ? "overdue" : "due"} {fmtAgo(w.due_at)}</span>}
                          </div>
                          <div className="mt-2 flex items-center gap-1">
                            <User size={11} className="text-muted" />
                            <select value={w.assignee ?? ""} onChange={(e) => assign(w.id, e.target.value)} className="w-full bg-transparent text-[11px] text-ink outline-none">
                              <option value="">unassigned</option>
                              {(contacts ?? []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                              {w.assignee && !(contacts ?? []).some((c) => c.name === w.assignee) && <option value={w.assignee}>{w.assignee}</option>}
                            </select>
                          </div>
                        </div>
                        <button onClick={() => remove(w.id)} className="rounded p-1 text-muted opacity-0 transition hover:text-red group-hover:opacity-100" aria-label="Delete"><Trash2 size={12} /></button>
                      </div>
                      {col.key !== "done" && (
                        <div className="mt-2 flex gap-1 sm:hidden">
                          {COLS.filter((c) => c.key !== w.status).map((c) => <button key={c.key} onClick={() => move(w.id, c.key)} className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted">→ {c.label}</button>)}
                        </div>
                      )}
                    </div>
                  );
                })}
                {list.length === 0 && <p className="px-1 py-3 text-center text-[11px] text-muted">{col.key === "open" ? "Nothing open" : col.key === "in_progress" ? "Drop a card here to start it" : "Drop here when finished"}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
