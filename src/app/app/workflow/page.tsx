"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, addEdge, useEdgesState, useNodesState, type Connection, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { Cpu, Plus, Save, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { Badge, Button, Card, Empty, Spinner, StatusDot, statusTone } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { get, put, type Latest, type Machine } from "@/lib/api";
import Link from "next/link";

type MachineNodeData = { machine: Machine; latest: Latest; onRemove: (id: string) => void; [k: string]: unknown };
type MNode = Node<MachineNodeData, "machine">;

function MachineNode({ data }: NodeProps<MNode>) {
  const m = data.machine;
  const entries = Object.entries(data.latest ?? {}).slice(0, 4);
  const tone = statusTone(m.status);
  const ring = { green: "border-green/50", amber: "border-amber/60", red: "border-red/60", muted: "border-line", blue: "border-blue/40" }[tone] ?? "border-line";
  return (
    <div className={`w-[230px] rounded-2xl border-2 bg-white p-3 shadow-[0_10px_30px_-14px_rgba(11,26,51,.35)] ${ring}`}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-blue" />
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
      <div className="mt-2 flex items-center justify-between">
        <Badge tone={tone}>{m.status}</Badge>
        <span className="font-mono text-[10px] text-muted">health {m.health}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-blue" />
    </div>
  );
}

const nodeTypes = { machine: MachineNode };

export default function WorkflowPage() {
  const { subscribe } = useApp();
  const { toast } = useToast();
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<MNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const remove = useCallback((id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setDirty(true);
  }, [setNodes, setEdges]);

  useEffect(() => {
    Promise.all([get<Machine[]>("/api/machines"), get<{ nodes: { id: string; position: { x: number; y: number } }[]; edges: Edge[] }>("/api/workflow")]).then(([ms, wf]) => {
      setMachines(ms);
      const byId = new Map(ms.map((m) => [m.id, m]));
      const saved = wf.nodes.filter((n) => byId.has(n.id));
      const ns: MNode[] = (saved.length ? saved : ms.map((m, i) => ({ id: m.id, position: { x: 60 + i * 290, y: 120 } }))).map((n) => ({
        id: n.id, type: "machine", position: n.position, data: { machine: byId.get(n.id)!, latest: byId.get(n.id)!.latest, onRemove: remove },
      }));
      setNodes(ns);
      const ids = new Set(ns.map((n) => n.id));
      setEdges(saved.length ? wf.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e, animated: true })) : ns.slice(1).map((n, i) => ({ id: `e${i}`, source: ns[i].id, target: n.id, animated: true })));
    });
  }, [remove, setNodes, setEdges]);

  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "telemetry") setNodes((ns) => ns.map((n) => (n.id === e.data.machine_id ? { ...n, data: { ...n.data, latest: { ...n.data.latest, ...(e.data.latest as Latest) }, machine: { ...n.data.machine, status: n.data.machine.status === "offline" ? "normal" : n.data.machine.status } } } : n)));
        if (e.type === "machine") setNodes((ns) => ns.map((n) => (n.id === e.data.id ? { ...n, data: { ...n.data, machine: { ...n.data.machine, status: String(e.data.status ?? n.data.machine.status), health: Number(e.data.health ?? n.data.machine.health) } } } : n)));
      }),
    [subscribe, setNodes],
  );

  const onConnect = useCallback((c: Connection) => { setEdges((es) => addEdge({ ...c, animated: true }, es)); setDirty(true); }, [setEdges]);
  const offCanvas = useMemo(() => (machines ?? []).filter((m) => !nodes.some((n) => n.id === m.id)), [machines, nodes]);

  function add(m: Machine) {
    setNodes((ns) => [...ns, { id: m.id, type: "machine", position: { x: 60 + ns.length * 290, y: 120 + (ns.length % 2) * 40 }, data: { machine: m, latest: m.latest, onRemove: remove } }]);
    setDirty(true);
  }
  function autoChain() {
    setEdges(nodes.slice(1).map((n, i) => ({ id: `auto${i}`, source: nodes[i].id, target: n.id, animated: true })));
    setNodes((ns) => ns.map((n, i) => ({ ...n, position: { x: 60 + i * 290, y: 140 } })));
    setDirty(true);
  }
  async function save() {
    setSaving(true);
    try {
      const r = await put<{ order: string[] }>("/api/workflow", { nodes: nodes.map((n) => ({ id: n.id, type: "machine", position: n.position })), edges: edges.map(({ id, source, target }) => ({ id, source, target })) });
      setDirty(false);
      toast("success", "Workflow saved", `Line order: ${r.order.length} machine(s). Muse uses this for upstream/downstream reasoning.`);
    } catch (e) { toast("error", "Save failed", e instanceof Error ? e.message : ""); } finally { setSaving(false); }
  }

  if (!machines) return <Spinner />;
  if (machines.length === 0) return <Empty title="Nothing to wire yet" body="Onboard at least one machine, then connect them upstream → downstream here." action={<Link href="/app/onboard"><Button>Onboard a machine</Button></Link>} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <Card className="!p-0 overflow-hidden" >
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <p className="text-sm text-muted"><Sparkles size={14} className="mr-1 inline text-blue" />Drag from a node's right handle to the next machine's left handle. Live values update on the nodes.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={autoChain}><Wand2 size={14} /> Auto-chain</Button>
            <Button size="sm" onClick={save} loading={saving} disabled={!dirty}><Save size={14} /> Save</Button>
          </div>
        </div>
        <div className="h-[620px]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type === "position" && !x.dragging)) setDirty(true); }} onEdgesChange={(c) => { onEdgesChange(c); setDirty(true); }} onConnect={onConnect} nodeTypes={nodeTypes} fitView defaultEdgeOptions={{ animated: true, style: { stroke: "#1e6fff", strokeWidth: 2 } }}>
            <Background gap={22} color="#c9d8f2" />
            <MiniMap pannable zoomable className="!bg-white" nodeColor={(n) => ({ green: "#16c784", amber: "#f59e0b", red: "#ef4444" }[statusTone((n as MNode).data.machine.status)] ?? "#9fb0c8")} />
            <Controls />
          </ReactFlow>
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
        <div className="mt-5 rounded-xl bg-sky-soft/60 p-3 text-xs text-muted">
          <p className="font-semibold text-ink">Why this matters</p>
          <p className="mt-1">Edges define upstream → downstream. When the conveyor overloads, Muse checks the feeder first because you told it the order here.</p>
        </div>
      </Card>
    </div>
  );
}
