"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, addEdge, useEdgesState, useNodesState, type Connection, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { Activity, Bot, ClipboardList, Cpu, PhoneCall, Plus, Radio, Save, Siren, Sparkles, Trash2, TrendingDown, TrendingUp, Wand2, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { VoiceBars } from "@/components/muse/MuseConsole";
import { Badge, Button, Card, Empty, StatusDot, statusTone } from "@/components/ui/Primitives";
import { PageSkeleton } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { fmtAgo, fmtEta, fmtTime, get, put, worstForecast, type Incident, type Latest, type LiveEvent, type Machine } from "@/lib/api";

/* ---------- node types ---------- */
type MachineNodeData = { machine: Machine; latest: Latest; incident?: { id: string; severity: string; title: string } | null; pulse?: number; pulseFresh?: boolean; lastSeen?: number; onRemove: (id: string) => void; [k: string]: unknown };
type MNode = Node<MachineNodeData, "machine">;
type MuseNodeData = { machines: number; rpm: number; open: number; investigating: number; lastEvent: string; [k: string]: unknown };
type MuseNode = Node<MuseNodeData, "muse">;
type AnyNode = MNode | MuseNode;
const MUSE_ID = "muse";

function MachineNode({ data }: NodeProps<MNode>) {
  const m = data.machine;
  const entries = Object.entries(data.latest ?? {}).slice(0, 4);
  const tone = statusTone(m.status);
  const ring = { green: "border-green/50", amber: "border-amber/60", red: "border-red/60", muted: "border-line", blue: "border-blue/40" }[tone] ?? "border-line";
  const wf = worstForecast(data.latest);
  const fresh = Boolean(data.pulse) && (data.pulseFresh ?? false);
  return (
    <div className={`relative w-[236px] rounded-2xl border-2 bg-white p-3 shadow-[0_10px_30px_-14px_rgba(11,26,51,.35)] transition ${ring} ${fresh ? "ring-4 ring-blue/30" : ""}`}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-blue" />
      <Handle type="target" id="muse" position={Position.Top} className="!h-2 !w-2 !border-2 !border-white !bg-violet" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5"><StatusDot status={m.status} /><p className="truncate text-sm font-semibold text-ink">{m.name}</p></div>
          <p className="font-mono text-[10px] text-muted">{m.device_id} · {m.type}</p>
        </div>
        <button onClick={() => data.onRemove(m.id)} className="rounded p-1 text-muted hover:text-red" aria-label="Remove from canvas"><Trash2 size={12} /></button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1">
        {entries.length === 0 && <p className="col-span-2 text-[11px] text-muted">no telemetry yet</p>}
        {entries.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-sky-soft/70 px-2 py-1">
            <p className="truncate font-mono text-[9px] text-muted">{k}</p>
            <p className={`font-mono text-xs font-semibold ${v.state === "critical" ? "text-red" : v.state === "warning" ? "text-amber" : "text-ink"}`}>{v.value.toFixed(1)}{v.unit ? ` ${v.unit}` : ""}</p>
          </div>
        ))}
      </div>
      {wf && <p className={`mt-1.5 flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] ${wf.level === "critical" ? "bg-red/10 text-red" : "bg-amber/10 text-amber"}`}>{wf.f.direction === "rising" ? <TrendingUp size={11} /> : <TrendingDown size={11} />}<span className="font-mono">{wf.parameter}</span> → {wf.level} in {fmtEta(wf.seconds)}</p>}
      {data.incident && <Link href={`/app/incidents/${data.incident.id}`} className="mt-1.5 flex items-center gap-1 rounded-lg bg-red/10 px-2 py-1 text-[10px] text-red hover:underline"><Siren size={11} /> {data.incident.severity}: {data.incident.title.replace(`${m.name}: `, "")}</Link>}
      <div className="mt-2 flex items-center justify-between">
        <Badge tone={tone}>{m.status}</Badge>
        <span className="font-mono text-[10px] text-muted">{data.lastSeen ? fmtAgo(data.lastSeen) : `health ${m.health}`}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-blue" />
    </div>
  );
}

function MuseMonitorNode({ data }: NodeProps<MuseNode>) {
  return (
    <div className="w-[300px] rounded-2xl border-2 border-violet/50 bg-[#0b1a33] p-3 text-white shadow-[0_18px_40px_-18px_rgba(124,108,255,.8)]">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue"><VoiceBars level={0.6} active speaking size={0.6} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Muse · monitoring the line</p>
          <p className="truncate text-[11px] text-white/70">{data.lastEvent || "watching every reading…"}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1 text-center">
        {[["machines", data.machines], ["rd/min", data.rpm], ["open", data.open], ["investigating", data.investigating]].map(([l, v]) => (
          <div key={String(l)} className="rounded-lg bg-white/10 px-1 py-1.5"><p className="font-display text-lg font-semibold leading-none">{v}</p><p className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-white/60">{l}</p></div>
        ))}
      </div>
      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-violet">ingest → detect → investigate → escalate → act</p>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-2 !border-white !bg-violet" />
    </div>
  );
}

const nodeTypes = { machine: MachineNode, muse: MuseMonitorNode };
const EDGE_COLOR: Record<string, string> = { green: "#16c784", amber: "#f59e0b", red: "#ef4444", muted: "#9fb0c8", blue: "#1e6fff" };

type LogLine = { id: number; ts: number; kind: string; text: string; tone: string };

export default function WorkflowPage() {
  const { subscribe } = useApp();
  const { toast } = useToast();
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<AnyNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [counts, setCounts] = useState({ rpm: 0, open: 0, investigating: 0, signals5m: 0, calls: 0, workOrders: 0 });
  const seq = useRef(0);
  const ticks = useRef<number[]>([]);
  const lastLine = useRef<Record<string, number>>({});

  const push = useCallback((kind: string, text: string, tone = "muted") => {
    setLog((l) => [{ id: ++seq.current, ts: Date.now() / 1000, kind, text, tone }, ...l].slice(0, 60));
  }, []);

  const remove = useCallback((id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setDirty(true);
  }, [setNodes, setEdges]);

  const refreshIncidents = useCallback(() => get<Incident[]>("/api/incidents?limit=50").then((incs) => {
    const open = incs.filter((i) => i.status !== "resolved");
    setCounts((c) => ({ ...c, open: open.length, investigating: open.filter((i) => !i.report).length }));
    setNodes((ns) => ns.map((n) => (n.type === "machine" ? { ...n, data: { ...n.data, incident: open.find((i) => i.machine_id === n.id) ? { id: open.find((i) => i.machine_id === n.id)!.id, severity: open.find((i) => i.machine_id === n.id)!.severity, title: open.find((i) => i.machine_id === n.id)!.title } : null } } : n)));
  }).catch(() => {}), [setNodes]);

  useEffect(() => {
    Promise.all([get<Machine[]>("/api/machines"), get<{ nodes: { id: string; position: { x: number; y: number } }[]; edges: Edge[] }>("/api/workflow")]).then(([ms, wf]) => {
      setMachines(ms);
      const byId = new Map(ms.map((m) => [m.id, m]));
      const saved = wf.nodes.filter((n) => byId.has(n.id) && n.id !== MUSE_ID);
      const mnodes: MNode[] = (saved.length ? saved : ms.map((m, i) => ({ id: m.id, position: { x: 60 + i * 290, y: 260 } }))).map((n) => ({
        id: n.id, type: "machine", position: n.position, data: { machine: byId.get(n.id)!, latest: byId.get(n.id)!.latest, lastSeen: byId.get(n.id)!.last_seen ?? undefined, onRemove: remove },
      }));
      const cx = mnodes.length ? mnodes.reduce((a, n) => a + n.position.x, 0) / mnodes.length : 200;
      const museNode: MuseNode = { id: MUSE_ID, type: "muse", position: { x: cx - 30, y: 20 }, draggable: true, deletable: false, data: { machines: ms.length, rpm: 0, open: 0, investigating: 0, lastEvent: "" } };
      setNodes([museNode, ...mnodes]);
      const ids = new Set(mnodes.map((n) => n.id));
      const lineEdges: Edge[] = saved.length
        ? wf.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e, animated: true }))
        : mnodes.slice(1).map((n, i) => ({ id: `e${i}`, source: mnodes[i].id, target: n.id, animated: true }));
      setEdges(lineEdges);
      refreshIncidents();
      push("muse", `Muse is monitoring ${ms.length} machine${ms.length === 1 ? "" : "s"} on this line`, "violet");
    });
  }, [remove, setNodes, setEdges, refreshIncidents, push]);

  // monitoring edges Muse → every machine (never saved), coloured by status
  const museEdges = useMemo<Edge[]>(() => nodes.filter((n) => n.type === "machine").map((n) => {
    const m = (n as MNode).data.machine;
    const tone = statusTone(m.status);
    return { id: `muse-${n.id}`, source: MUSE_ID, target: n.id, targetHandle: "muse", animated: true, deletable: false, selectable: false, style: { stroke: EDGE_COLOR[tone] ?? "#9fb0c8", strokeWidth: 1.5, strokeDasharray: "6 4", opacity: 0.8 } };
  }), [nodes]);

  // snapshot counters every 30 s (calls, work orders, readings/min from the backend)
  useEffect(() => {
    const load = () => get<{ counts: { readings_per_minute: number; open_incidents: number; work_orders_open: number; work_orders_in_progress: number }; recent_voice_calls: unknown[] }>("/api/muse/snapshot")
      .then((s) => setCounts((c) => ({ ...c, calls: s.recent_voice_calls.length, workOrders: s.counts.work_orders_open + s.counts.work_orders_in_progress })))
      .catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  // live events → node pulses, log lines, counters
  useEffect(() => subscribe((e: LiveEvent) => {
    const now = Date.now();
    if (e.type === "telemetry") {
      ticks.current = [...ticks.current.filter((t) => now - t < 60000), now];
      const mid = String(e.data.machine_id);
      setNodes((ns) => ns.map((n) => (n.id === mid && n.type === "machine" ? { ...n, data: { ...n.data, latest: { ...(n as MNode).data.latest, ...(e.data.latest as Latest) }, pulse: now, pulseFresh: true, lastSeen: Number(e.data.ts), machine: { ...(n as MNode).data.machine, status: (n as MNode).data.machine.status === "offline" ? "normal" : (n as MNode).data.machine.status } } } : n)));
      setTimeout(() => setNodes((ns) => ns.map((n) => (n.id === mid && n.type === "machine" && (n as MNode).data.pulse === now ? { ...n, data: { ...n.data, pulseFresh: false } } : n))), 900);
      const last = lastLine.current[mid] ?? 0;
      if (now - last > 12000) {
        lastLine.current[mid] = now;
        const latest = e.data.latest as Latest;
        const [k, v] = Object.entries(latest)[0] ?? [];
        const name = (nodes.find((n) => n.id === mid) as MNode | undefined)?.data.machine.name ?? String(e.data.device_id);
        push("telemetry", `${name} · ${k ?? "reading"} ${v ? v.value.toFixed(1) : ""}${v?.unit ? ` ${v.unit}` : ""} · ${v?.state ?? "normal"}`, v?.state === "critical" ? "red" : v?.state === "warning" ? "amber" : "muted");
      }
      setCounts((c) => ({ ...c, rpm: ticks.current.length }));
    } else if (e.type === "machine") {
      setNodes((ns) => ns.map((n) => (n.id === e.data.id && n.type === "machine" ? { ...n, data: { ...n.data, machine: { ...(n as MNode).data.machine, status: String(e.data.status ?? (n as MNode).data.machine.status), health: Number(e.data.health ?? (n as MNode).data.machine.health), name: String(e.data.name ?? (n as MNode).data.machine.name) } } } : n)));
      if (e.data.status) push("status", `${(nodes.find((n) => n.id === e.data.id) as MNode | undefined)?.data.machine.name ?? "machine"} → ${String(e.data.status)}`, statusTone(String(e.data.status)));
    } else if (e.type === "event") {
      push("detect", String(e.data.message), String(e.data.severity) === "info" ? "blue" : "amber");
    } else if (e.type === "incident") {
      const d = e.data as { id: string; title: string; severity: string; status: string; report?: unknown };
      push("incident", `${d.status === "resolved" ? "Resolved" : d.report ? "Report ready" : "Investigating"} · ${d.title}`, d.status === "resolved" ? "green" : d.severity === "critical" || d.severity === "emergency" ? "red" : "amber");
      refreshIncidents();
    } else if (e.type === "notification") {
      push("escalate", `${String(e.data.channel)} · ${String(e.data.status)} · ${String(e.data.subject).replace("[BatchGuard] ", "")}`, String(e.data.channel) === "voice" ? "violet" : "blue");
    } else if (e.type === "work_order") {
      push("act", `Work order ${String(e.data.status).replace("_", " ")} · ${String(e.data.title)}`, "green");
    } else if (e.type === "voice_call") {
      push("call", `Call ${String(e.data.status)} · ${String(e.data.title)} → ${String(e.data.to_number)}`, "violet");
    } else if (e.type === "contact" || e.type === "org" || e.type === "parameter") {
      push("edit", `${e.type} ${String(e.data.action ?? "updated")}${e.data.name ? ` · ${String(e.data.name)}` : e.data.parameter ? ` · ${String(e.data.parameter)}` : ""}`, "blue");
    }
  }), [subscribe, setNodes, push, nodes, refreshIncidents]);

  // keep the Muse node's counters fresh
  useEffect(() => {
    setNodes((ns) => ns.map((n) => (n.id === MUSE_ID ? ({ ...n, data: { ...(n as MuseNode).data, machines: ns.length - 1, rpm: counts.rpm, open: counts.open, investigating: counts.investigating, lastEvent: log[0]?.text ?? "" } } as MuseNode) : n)));
  }, [counts, log, setNodes]);

  const onConnect = useCallback((c: Connection) => { if (c.source === MUSE_ID || c.target === MUSE_ID) return; setEdges((es) => addEdge({ ...c, animated: true }, es)); setDirty(true); }, [setEdges]);
  const offCanvas = useMemo(() => (machines ?? []).filter((m) => !nodes.some((n) => n.id === m.id)), [machines, nodes]);

  function add(m: Machine) {
    setNodes((ns) => [...ns, { id: m.id, type: "machine", position: { x: 60 + (ns.length - 1) * 290, y: 260 + ((ns.length - 1) % 2) * 40 }, data: { machine: m, latest: m.latest, onRemove: remove } } as MNode]);
    setDirty(true);
  }
  function autoChain() {
    const ms = nodes.filter((n) => n.type === "machine");
    setEdges(ms.slice(1).map((n, i) => ({ id: `auto${i}`, source: ms[i].id, target: n.id, animated: true })));
    setNodes((ns) => { let i = 0; return ns.map((n) => (n.type === "machine" ? { ...n, position: { x: 60 + i++ * 290, y: 280 } } : n)); });
    setDirty(true);
  }
  async function save() {
    setSaving(true);
    try {
      const ms = nodes.filter((n) => n.type === "machine");
      const r = await put<{ order: string[] }>("/api/workflow", { nodes: ms.map((n) => ({ id: n.id, type: "machine", position: n.position })), edges: edges.map(({ id, source, target }) => ({ id, source, target })) });
      setDirty(false);
      toast("success", "Workflow saved", `Line order: ${r.order.length} machine(s). Muse uses this for upstream/downstream reasoning.`);
    } catch (e) { toast("error", "Save failed", e instanceof Error ? e.message : ""); } finally { setSaving(false); }
  }

  if (!machines) return <PageSkeleton variant="canvas" />;
  if (machines.length === 0) return <Empty title="Nothing to wire yet" body="Onboard at least one machine, then connect them upstream → downstream here." action={<Link href="/app/onboard"><Button>Onboard a machine</Button></Link>} />;

  const STAGES = [
    { k: "Ingest", v: `${counts.rpm}/min`, i: Radio, d: "readings validated against the verified spec" },
    { k: "Detect", v: `${log.filter((l) => l.kind === "detect").length} signals`, i: Zap, d: "limits · trend · anomaly on every reading" },
    { k: "Investigate", v: `${counts.investigating} running`, i: Bot, d: "ADK pipeline: evidence → causes → checks" },
    { k: "Escalate", v: `${counts.open} open`, i: PhoneCall, d: "dashboard → email → Gemini Live call" },
    { k: "Act", v: `${counts.workOrders} work orders`, i: ClipboardList, d: "checks become work orders; photos become evidence" },
  ];

  return (
    <div className="space-y-4">
      <div data-hl="canvas" className="grid gap-2 sm:grid-cols-5">
        {STAGES.map(({ k, v, i: Icon, d }, idx) => (
          <div key={k} className="relative rounded-2xl border border-line bg-white p-3">
            <div className="flex items-center justify-between"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{idx + 1} · {k}</p><Icon size={14} className="text-blue" /></div>
            <p className="font-display mt-1 text-xl font-semibold text-ink">{v}</p>
            <p className="text-[11px] text-muted">{d}</p>
            {idx < STAGES.length - 1 && <span className="absolute -right-2 top-1/2 hidden h-3 w-3 -translate-y-1/2 rotate-45 border-r border-t border-line bg-white sm:block" />}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card className="!p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <p className="text-sm text-muted"><Sparkles size={14} className="mr-1 inline text-blue" />Muse sits above the line and watches every machine (dashed links). Drag a node&apos;s right handle to the next machine to define upstream → downstream.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={autoChain}><Wand2 size={14} /> Auto-chain</Button>
              <Button size="sm" onClick={save} loading={saving} disabled={!dirty}><Save size={14} /> Save</Button>
            </div>
          </div>
          <div className="h-[640px]">
            <ReactFlow nodes={nodes} edges={[...museEdges, ...edges]} onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type === "position" && !x.dragging)) setDirty(true); }} onEdgesChange={(c) => { onEdgesChange(c.filter((x) => !(x.type === "remove" && String(x.id).startsWith("muse-")))); setDirty(true); }} onConnect={onConnect} nodeTypes={nodeTypes} fitView defaultEdgeOptions={{ animated: true, style: { stroke: "#1e6fff", strokeWidth: 2 } }}>
              <Background gap={22} color="#c9d8f2" />
              <MiniMap pannable zoomable className="!bg-white" nodeColor={(n) => (n.type === "muse" ? "#7c6cff" : { green: "#16c784", amber: "#f59e0b", red: "#ef4444" }[statusTone((n as MNode).data.machine.status)] ?? "#9fb0c8")} />
              <Controls />
            </ReactFlow>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-2"><Activity size={16} className="text-blue" /> Muse live log</span>} action={<span className="font-mono text-[10px] text-muted">{counts.rpm} rd/min</span>}>
            <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
              {log.length === 0 && <p className="text-xs text-muted">Waiting for the first reading…</p>}
              {log.map((l) => (
                <div key={l.id} className="flex gap-2 text-[11px]">
                  <span className="shrink-0 font-mono text-[10px] text-muted">{fmtTime(l.ts).slice(0, 5)}</span>
                  <Badge tone={l.tone === "muted" ? "muted" : l.tone}>{l.kind}</Badge>
                  <span className="min-w-0 flex-1 truncate text-ink" title={l.text}>{l.text}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Machines" className="h-fit">
            <p className="mb-3 text-xs text-muted">Not on the canvas yet:</p>
            {offCanvas.length === 0 && <p className="text-xs text-muted">All machines are placed.</p>}
            <div className="space-y-2">
              {offCanvas.map((m) => (
                <button key={m.id} onClick={() => add(m)} className="flex w-full items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-left text-sm hover:border-blue/50">
                  <Cpu size={14} className="text-blue" /><span className="flex-1 truncate">{m.name}</span><Plus size={14} className="text-muted" />
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-xl bg-sky-soft/60 p-3 text-xs text-muted">
              <p className="font-semibold text-ink">Why the order matters</p>
              <p className="mt-1">Edges define upstream → downstream. When the conveyor overloads, Muse checks the feeder first because you told it the order here.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
