"use client";

import "@xyflow/react/dist/style.css";
import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import {
  AlarmClock, AudioLines, CheckCircle2, ChevronRight, CloudUpload, ExternalLink, FileText, Mic, Phone, PhoneCall, PhoneOutgoing, Play, RefreshCw, ShieldCheck, Siren, Sparkles, TriangleAlert, Waypoints, Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "@/components/app/Shell";
import { Badge, Button, Card, Empty, Input, Modal, Select, Spinner, Textarea } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { fmtAgo, fmtTime, get, post, put, type CallType, type Incident, type VoiceCall, type VoiceStatus, type WfEdge, type WfNode } from "@/lib/api";

/* ---------- node styling (mirrors Dograh's node palette) ---------- */
const NODE_META: Record<string, { label: string; ring: string; chip: string; text: string }> = {
  globalNode: { label: "Global persona", ring: "border-amber/60", chip: "bg-amber/15 text-amber", text: "Applies to every step" },
  startCall: { label: "Start · greeting", ring: "border-green/60", chip: "bg-green/15 text-green", text: "First thing Muse says" },
  agentNode: { label: "Agent step", ring: "border-violet/60", chip: "bg-violet/15 text-violet", text: "Mid-call conversation step" },
  endCall: { label: "End · extraction", ring: "border-red/60", chip: "bg-red/15 text-red", text: "Hang up, then extract variables" },
  qa: { label: "QC scorer", ring: "border-sky/60", chip: "bg-sky/15 text-sky", text: "Scores the transcript after the call" },
};
const ICONS: Record<string, ReactNode> = { siren: <Siren size={20} />, alarm: <AlarmClock size={20} />, triangle: <TriangleAlert size={20} />, check: <CheckCircle2 size={20} />, phone: <PhoneOutgoing size={20} /> };
const TONE_BG: Record<string, string> = { red: "from-red/15 to-white text-red", amber: "from-amber/20 to-white text-amber", green: "from-green/15 to-white text-green", blue: "from-blue/15 to-white text-blue" };
const STATUS_TONE: Record<string, string> = { dialing: "amber", ringing: "amber", in_progress: "blue", completed: "green", no_answer: "muted", failed: "red" };

type FlowNodeData = { node: WfNode; [k: string]: unknown };
type FlowNode = Node<FlowNodeData, "voice">;

function VoiceNode({ data }: NodeProps<FlowNode>) {
  const n = data.node;
  const meta = NODE_META[n.type] ?? NODE_META.agentNode;
  const d = n.data as { name?: string; greeting?: string; prompt?: string; extraction_variables?: { name: string }[] };
  const body = n.type === "startCall" ? d.greeting : d.prompt;
  return (
    <div className={`w-[250px] rounded-2xl border-2 bg-white p-3 shadow-[0_10px_30px_-14px_rgba(11,26,51,.35)] ${meta.ring}`}>
      {n.type !== "globalNode" && n.type !== "qa" && n.type !== "startCall" && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-blue" />}
      <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${meta.chip}`}>{meta.label}</span>
      <p className="mt-1.5 truncate text-sm font-semibold text-ink">{d.name}</p>
      {body && <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted">{n.type === "startCall" ? "“" + body + "”" : body}</p>}
      {n.type === "endCall" && d.extraction_variables && <p className="mt-1 font-mono text-[9px] text-red">extracts: {d.extraction_variables.map((v) => v.name).join(", ")}</p>}
      {n.type !== "globalNode" && n.type !== "qa" && n.type !== "endCall" && <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-blue" />}
    </div>
  );
}
const nodeTypes = { voice: VoiceNode };

function WorkflowGraph({ nodes, edges }: { nodes: WfNode[]; edges: WfEdge[] }) {
  const rfNodes = useMemo<FlowNode[]>(() => nodes.map((n) => ({ id: n.id, type: "voice", position: n.position, data: { node: n }, draggable: false, selectable: false })), [nodes]);
  const rfEdges = useMemo<Edge[]>(() => edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.data?.label, animated: true, style: { stroke: "#1e6fff", strokeWidth: 1.5 }, labelStyle: { fontSize: 9, fill: "#5b6b85", fontFamily: "var(--font-plex-mono)" }, labelBgStyle: { fill: "#f6f9ff" } })), [edges]);
  return (
    <div className="h-[380px] overflow-hidden rounded-2xl border border-line bg-[radial-gradient(circle_at_30%_20%,#e6f2ff,transparent_60%),#f6f9ff]">
      <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} panOnScroll proOptions={{ hideAttribution: true }} minZoom={0.2}>
        <Background gap={18} size={1} color="#c9dcf7" />
      </ReactFlow>
    </div>
  );
}

/* ---------- script reader: every node's prompt, greeting, edges, extraction + QC ---------- */
function Scripts({ ct }: { ct: CallType }) {
  const { nodes, edges } = ct.workflow_definition;
  const out = (id: string) => edges.filter((e) => e.source === id);
  return (
    <div className="space-y-3">
      {nodes.map((n) => {
        const meta = NODE_META[n.type] ?? NODE_META.agentNode;
        const d = n.data as Record<string, unknown>;
        return (
          <div key={n.id} className={`rounded-2xl border bg-white p-4 ${meta.ring.replace("/60", "/40")}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${meta.chip}`}>{meta.label}</span>
                <p className="text-sm font-semibold text-ink">{String(d.name ?? n.id)}</p>
              </div>
              <p className="text-[11px] text-muted">{meta.text}{typeof d.wait_for_user_response_timeout === "number" ? ` · waits ${d.wait_for_user_response_timeout}s` : ""}{d.detect_voicemail ? " · voicemail detection" : ""}</p>
            </div>
            {typeof d.greeting === "string" && (
              <div className="mt-3 rounded-xl bg-green/10 p-3"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-green">Greeting (spoken first)</p><p className="mt-1 text-sm text-ink">“{d.greeting}”</p></div>
            )}
            {typeof d.prompt === "string" && (
              <div className="mt-3"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Prompt</p><pre className="mt-1 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink">{d.prompt}</pre></div>
            )}
            {Array.isArray(d.extraction_variables) && d.extraction_variables.length > 0 && (
              <div className="mt-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-red">Extracted after the call</p>
                {typeof d.extraction_prompt === "string" && <p className="mt-1 text-xs text-muted">{d.extraction_prompt}</p>}
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {(d.extraction_variables as { name: string; type: string; prompt: string }[]).map((v) => (
                    <div key={v.name} className="rounded-lg bg-sky-soft/60 px-2.5 py-1.5"><p className="font-mono text-[11px] text-ink">{v.name} <span className="text-muted">· {v.type}</span></p><p className="text-[11px] text-muted">{v.prompt}</p></div>
                  ))}
                </div>
              </div>
            )}
            {typeof d.qa_system_prompt === "string" && (
              <div className="mt-3"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky">QC rubric · sample {String(d.qa_sample_rate)}% · min {String(d.qa_min_call_duration)}s</p><pre className="mt-1 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink">{d.qa_system_prompt}</pre></div>
            )}
            {out(n.id).length > 0 && (
              <div className="mt-3 space-y-1.5">
                {out(n.id).map((e) => (
                  <div key={e.id} className="flex gap-2 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-[12px]">
                    <ChevronRight size={14} className="mt-0.5 shrink-0 text-blue" />
                    <p className="text-ink"><span className="font-mono text-[10px] uppercase text-blue">{e.data?.label}</span> → <span className="font-semibold">{String((nodes.find((x) => x.id === e.target)?.data as { name?: string } | undefined)?.name ?? e.target)}</span><span className="text-muted"> — {e.data?.condition}</span></p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- place-call form ---------- */
function PlaceCall({ ct, status, incidents, onPlaced }: { ct: CallType; status: VoiceStatus; incidents: Incident[]; onPlaced: (c: VoiceCall) => void }) {
  const { toast } = useToast();
  const contacts = status.contacts.filter((c) => c.phone);
  const [contactId, setContactId] = useState<string>(contacts[0]?.id ?? "");
  const [phone, setPhone] = useState("");
  const [incidentId, setIncidentId] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const needsIncident = ct.key !== "test_call";
  const vars = ct.template_variables.filter((v) => !["org_name", "contact_name", "contact_role", "dashboard_url", "from_number"].includes(v.name));

  async function go() {
    const to = phone.trim() || contacts.find((c) => c.id === contactId)?.phone || "";
    if (!to) return toast("warning", "Pick a contact with a phone number or type one");
    setBusy(true);
    try {
      const c = await post<VoiceCall>("/api/voice/calls", { call_type: ct.key, phone: phone.trim() || undefined, contact_id: phone.trim() ? undefined : contactId || undefined, incident_id: incidentId || undefined, context: overrides });
      if (c.status === "failed") toast("error", "Dograh rejected the call", c.error ?? "");
      else toast("success", `Calling ${c.to_number}`, `${c.title} · from ${c.from_number ?? "default TeleCMI number"} · run ${c.run_name ?? c.run_id}`);
      onPlaced(c);
    } catch (e) { toast("error", "Could not place call", e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-white p-4">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted"><PhoneOutgoing size={12} /> Who to call</p>
        <Select label="Escalation contact" value={contactId} onChange={(e) => setContactId(e.target.value)} className="mt-2">
          <option value="">— custom number —</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>#{c.escalation_order} {c.name} · {c.role} · {c.phone}</option>)}
        </Select>
        <Input label="Or a number (international format)" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-2" hint="Overrides the contact when filled. TeleCMI trial numbers dial Indian (+91) numbers best." />
        <p className="mt-2 text-[11px] text-muted">Caller id: <span className="font-mono text-ink">{status.settings.from_number ?? "Dograh default"}</span> · via {status.telephony.configs.find((c) => c.id === status.settings.telephony_configuration_id)?.name ?? "default trunk"}</p>
      </div>
      {needsIncident && (
        <div className="rounded-2xl border border-line bg-white p-4">
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted"><Siren size={12} /> Incident to brief</p>
          <Select label="Fill the script from" value={incidentId} onChange={(e) => setIncidentId(e.target.value)} className="mt-2">
            <option value="">— none (use the values below) —</option>
            {incidents.map((i) => <option key={i.id} value={i.id}>[{i.severity}] {i.title} · {i.status}</option>)}
          </Select>
          <p className="mt-1.5 text-[11px] text-muted">With an incident selected, machine, problem, likely cause and first check come straight from Muse&apos;s investigation report. Values below override.</p>
        </div>
      )}
      <div className="rounded-2xl border border-line bg-white p-4">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted"><Sparkles size={12} /> Template variables</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {vars.map((v) => {
            const doc = ct.variables.find((x) => x.name === v.name);
            const long = ["problem", "first_check", "likely_cause"].includes(v.name);
            const common = { label: v.name, value: overrides[v.name] ?? "", placeholder: doc?.example || v.default || "", onChange: (e: { target: { value: string } }) => setOverrides((o) => ({ ...o, [v.name]: e.target.value })), className: long ? "sm:col-span-2" : "" };
            return long ? <Textarea key={v.name} rows={2} {...common} /> : <Input key={v.name} {...common} />;
          })}
        </div>
      </div>
      <Button onClick={go} loading={busy} className="w-full" size="lg"><PhoneCall size={18} /> Place call with Gemini Live</Button>
      {!ct.synced && <p className="text-center text-[11px] text-amber">This workflow is not on Dograh yet — it will be published automatically on the first call.</p>}
    </div>
  );
}

/* ---------- call detail (transcript, context, outcome) ---------- */
function CallDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [c, setC] = useState<VoiceCall | null>(null);
  useEffect(() => { get<VoiceCall>(`/api/voice/calls/${id}`).then(setC).catch(() => setC(null)); }, [id]);
  return (
    <Modal open onClose={onClose} width="max-w-4xl" title={c ? <span className="flex items-center gap-2"><AudioLines size={22} className="text-blue" /> {c.title}</span> : "Call"}>
      {!c ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={STATUS_TONE[c.status] ?? "muted"}>{c.status.replace("_", " ")}</Badge>
              <span>{fmtTime(c.created_at)}</span><span>· to <span className="font-mono text-ink">{c.to_number}</span></span>{c.from_number && <span>· from <span className="font-mono text-ink">{c.from_number}</span></span>}
              {c.duration_seconds != null && <span>· {Math.round(c.duration_seconds)} s</span>}{c.disposition && <span>· {c.disposition}</span>}
            </div>
            {c.error && <p className="mt-2 rounded-xl border border-red/30 bg-red/5 p-2 text-xs text-red">{c.error}</p>}
            {c.incident && <p className="mt-2 text-xs text-muted">Incident: <Link href={`/app/incidents/${c.incident.id}`} className="text-blue hover:underline">{c.incident.title}</Link> · {c.incident.status}</p>}
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Transcript</p>
            <pre className="mt-1 max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-sky-soft/50 p-3 font-sans text-[13px] leading-relaxed text-ink">{c.transcript || (c.status === "completed" ? "Transcript not available yet." : "The transcript appears once the call completes.")}</pre>
            <div className="mt-2 flex gap-3 text-xs">
              {c.transcript_url && <a href={c.transcript_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue hover:underline"><FileText size={12} /> transcript file</a>}
              {c.recording_url && <a href={c.recording_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue hover:underline"><Play size={12} /> recording</a>}
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-line bg-white p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-red">Gathered after the call</p>
              {!c.gathered_context || Object.keys(c.gathered_context).length === 0 ? <p className="mt-1 text-xs text-muted">Nothing extracted yet.</p> : (
                <dl className="mt-1 space-y-1">{Object.entries(c.gathered_context).map(([k, v]) => <div key={k} className="flex gap-2 text-xs"><dt className="w-32 shrink-0 font-mono text-muted">{k}</dt><dd className="text-ink">{String(v)}</dd></div>)}</dl>
              )}
            </div>
            <div className="rounded-2xl border border-line bg-white p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Brief sent to Gemini Live</p>
              <dl className="mt-1 space-y-1">{Object.entries(c.initial_context).map(([k, v]) => <div key={k} className="flex gap-2 text-xs"><dt className="w-32 shrink-0 font-mono text-muted">{k}</dt><dd className="text-ink">{v}</dd></div>)}</dl>
            </div>
            <p className="text-[11px] text-muted">Placed by {c.placed_by} · Dograh run {c.run_name ?? c.run_id ?? "—"} · workflow #{c.workflow_id}</p>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- page ---------- */
export default function VoicePage() {
  const { subscribe } = useApp();
  const { toast } = useToast();
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [types, setTypes] = useState<CallType[] | null>(null);
  const [calls, setCalls] = useState<VoiceCall[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"graph" | "scripts" | "call">("graph");
  const [detail, setDetail] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, t, c, i] = await Promise.all([get<VoiceStatus>("/api/voice/status"), get<CallType[]>("/api/voice/call-types"), get<VoiceCall[]>("/api/voice/calls?limit=40"), get<Incident[]>("/api/incidents?limit=30")]);
    setStatus(s); setTypes(t); setCalls(c); setIncidents(i);
  }, []);
  useEffect(() => { load().catch((e) => toast("error", "Voice AI", e instanceof Error ? e.message : String(e))); }, [load, toast]);
  useEffect(() => subscribe((e) => {
    if (e.type === "voice_call") {
      const c = e.data as unknown as VoiceCall;
      setCalls((cs) => (cs.some((x) => x.id === c.id) ? cs.map((x) => (x.id === c.id ? c : x)) : [c, ...cs]));
    }
  }), [subscribe]);

  async function pickNumber(id: number) {
    const st = await put<VoiceStatus["settings"]>("/api/voice/settings", { from_phone_number_id: id });
    setStatus((s) => (s ? { ...s, settings: st } : s));
    toast("success", `Caller id set to ${st.from_number}`, "Every Muse call now shows this TeleCMI number.");
  }
  async function toggleAuto() {
    if (!status) return;
    const st = await put<VoiceStatus["settings"]>("/api/voice/settings", { auto_dial: !status.settings.auto_dial });
    setStatus((s) => (s ? { ...s, settings: st } : s));
    toast(st.auto_dial ? "warning" : "info", st.auto_dial ? "Auto-dial ON" : "Auto-dial off", st.auto_dial ? "Critical and emergency incidents now ring the escalation ladder automatically." : "Calls are placed manually from incidents or this page.");
  }
  async function sync(key?: string) {
    setSyncing(key ?? "all");
    try {
      if (key) await post(`/api/voice/call-types/${key}/sync`); else await post("/api/voice/sync");
      toast("success", key ? "Workflow published to Dograh" : "All 5 workflows published to Dograh");
      await load();
    } catch (e) { toast("error", "Sync failed", e instanceof Error ? e.message : String(e)); }
    finally { setSyncing(null); }
  }

  if (!status || !types) return <Spinner label="Connecting to Dograh…" />;
  const sel = types.find((t) => t.key === open) ?? null;
  const telecmi = status.telephony.numbers.filter((n) => n.telecmi);
  const others = status.telephony.numbers.filter((n) => !n.telecmi);
  const published = types.filter((t) => t.synced?.uuid).length;
  const live = calls.filter((c) => ["dialing", "ringing", "in_progress"].includes(c.status));

  return (
    <div className="space-y-5">
      {/* hero */}
      <div className="relative overflow-hidden rounded-3xl border border-line bg-[radial-gradient(circle_at_85%_20%,#e6f2ff,transparent_45%),linear-gradient(135deg,#ffffff,#f6f9ff)] p-6 lg:p-8">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-blue"><Mic size={14} /> Gemini Voice AI · realtime</p>
            <h1 className="mt-2 font-display text-4xl font-semibold leading-tight text-ink lg:text-5xl">Muse picks up the phone.</h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">When a machine turns critical, Muse calls the on-call contact over a TeleCMI line, speaks the 20-second brief from its investigation report with Gemini Live, asks for an acknowledgement and writes the answer back onto the incident. Every call type below is a Dograh workflow you can read line by line.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone={status.enabled ? "green" : "red"}><Zap size={10} /> {status.enabled ? `Dograh · ${status.host}` : "Dograh not configured"}</Badge>
              <Badge tone={status.settings.from_number ? "blue" : "amber"}><Phone size={10} /> {status.settings.from_number ? `TeleCMI ${status.settings.from_number}` : "No caller id selected"}</Badge>
              <Badge tone={published === types.length ? "green" : "amber"}><CloudUpload size={10} /> {published}/{types.length} workflows published</Badge>
              <Badge tone={status.settings.auto_dial ? "red" : "muted"}><Siren size={10} /> auto-dial {status.settings.auto_dial ? "on" : "off"}</Badge>
              {live.length > 0 && <Badge tone="amber"><AudioLines size={10} /> {live.length} call{live.length > 1 ? "s" : ""} in progress</Badge>}
            </div>
          </div>
          <div className="flex items-center justify-end gap-4">
            <div className="hidden text-right sm:block">
              <p className="font-display text-lg font-semibold text-ink">Try the line</p>
              <p className="text-xs text-muted">A 30-second test call to any number.</p>
              <Button className="mt-2" onClick={() => { setOpen("test_call"); setTab("call"); }}><PhoneCall size={16} /> Place test call</Button>
            </div>
            <div className="relative h-36 w-28 shrink-0 lg:h-44 lg:w-36">
              <Image src="/muse.webp" alt="Muse" fill className="object-contain drop-shadow-[0_18px_30px_rgba(30,111,255,.25)]" sizes="150px" />
            </div>
          </div>
        </div>
      </div>

      {status.telephony.error && <p className="rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm text-ink"><strong>Dograh telephony:</strong> {status.telephony.error}</p>}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        {/* number picker */}
        <Card title={<span className="flex items-center gap-2"><Phone size={18} className="text-blue" /> TeleCMI caller number</span>} action={<span className="text-xs text-muted">{status.telephony.configs.find((c) => c.provider === "ari")?.name ?? "TeleCMI"} · SIP trunk on Dograh</span>}>
          <p className="mb-3 text-sm text-muted">Pick the number Muse calls from. Contacts see it on their phone, so choose one they can call back.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {telecmi.map((n) => {
              const on = status.settings.from_phone_number_id === n.id;
              return (
                <button key={n.id} onClick={() => pickNumber(n.id)} disabled={!n.active} className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition ${on ? "border-blue bg-sky-soft/70 shadow-[0_10px_30px_-16px_rgba(30,111,255,.6)]" : "border-line bg-white hover:border-blue/50"} ${!n.active ? "opacity-50" : ""}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${on ? "bg-blue text-white" : "bg-sky-soft text-blue"}`}><Phone size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm font-semibold text-ink">{n.number}</span>
                    <span className="block truncate text-[11px] text-muted">{n.label} · {n.country}{n.default_caller ? " · Dograh default" : ""}{!n.active ? " · inactive" : ""}</span>
                  </span>
                  {on && <CheckCircle2 size={18} className="shrink-0 text-blue" />}
                </button>
              );
            })}
            {telecmi.length === 0 && <p className="text-sm text-muted sm:col-span-2">No TeleCMI numbers found on the Dograh account.</p>}
          </div>
          {others.length > 0 && <p className="mt-3 text-[11px] text-muted">Other trunks on the account: {others.map((n) => `${n.number} (${n.config_name})`).join(", ")} — not used.</p>}
        </Card>

        {/* escalation switch + sync */}
        <div className="space-y-5">
          <Card title={<span className="flex items-center gap-2"><Siren size={18} className="text-red" /> Automatic escalation calls</span>}>
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm text-muted">Critical → call contact #1 with the brief. No acknowledgement in {2} min → emergency, call the next contact, repeat. An acknowledgement spoken on the call acknowledges the incident.</p>
              <button onClick={toggleAuto} role="switch" aria-checked={!!status.settings.auto_dial} className={`relative h-7 w-12 shrink-0 rounded-full transition ${status.settings.auto_dial ? "bg-red" : "bg-line"}`}>
                <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${status.settings.auto_dial ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted">{status.settings.auto_dial ? "ON — real calls go out on every critical incident. Keep it off while the demo producer is injecting faults unless the contacts are yours." : "Off — calls are placed manually from an incident page or from a call type below."}</p>
          </Card>
          <Card title={<span className="flex items-center gap-2"><CloudUpload size={18} className="text-blue" /> Dograh workflows</span>} action={<Button size="sm" variant="secondary" onClick={() => sync()} loading={syncing === "all"}><RefreshCw size={14} /> Publish all</Button>}>
            <ul className="space-y-1.5">
              {types.map((t) => (
                <li key={t.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-ink">{t.title}</span>
                  {t.synced?.uuid ? <span className="shrink-0 font-mono text-[10px] text-green">#{t.synced.id} · v{t.synced.version} · {fmtAgo(t.synced.synced_at)}</span> : <span className="shrink-0 font-mono text-[10px] text-amber">not published</span>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted">Each JSON file in <span className="font-mono">backend/app/voice/workflows</span> is pushed as a Dograh workflow and published; the call hits the published version.</p>
          </Card>
        </div>
      </div>

      {/* call types */}
      <div>
        <div className="mb-3 flex items-end justify-between">
          <div><h2 className="font-display text-2xl font-semibold text-ink">Call types</h2><p className="text-sm text-muted">Click one to read the workflow, every prompt, the extraction variables and the QC rubric — then place it.</p></div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {types.map((t) => (
            <button key={t.key} onClick={() => { setOpen(t.key); setTab("graph"); }} className="group relative overflow-hidden rounded-3xl border border-line bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-blue/50 hover:shadow-[0_18px_40px_-24px_rgba(30,111,255,.5)]">
              <div className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${TONE_BG[t.tone] ?? TONE_BG.blue} opacity-60`} />
              <div className="relative">
                <div className="flex items-start justify-between">
                  <span className={`grid h-11 w-11 place-items-center rounded-2xl bg-white shadow ${TONE_BG[t.tone]?.split(" ").pop() ?? "text-blue"}`}>{ICONS[t.icon] ?? <Phone size={20} />}</span>
                  {t.synced?.uuid ? <Badge tone="green"><ShieldCheck size={10} /> published</Badge> : <Badge tone="amber">draft</Badge>}
                </div>
                <p className="mt-4 font-display text-xl font-semibold text-ink">{t.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{t.description}</p>
                <p className="mt-3 text-[11px] text-muted"><strong className="text-ink">Trigger:</strong> {t.trigger}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted">{t.workflow_definition.nodes.length} nodes · {t.workflow_definition.edges.length} edges · {t.template_variables.length} vars</span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue">Open <ChevronRight size={14} className="transition group-hover:translate-x-0.5" /></span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* history */}
      <Card title={<span className="flex items-center gap-2"><AudioLines size={18} className="text-blue" /> Call history</span>} action={<Button size="sm" variant="ghost" onClick={() => load()}><RefreshCw size={14} /> Refresh</Button>}>
        {calls.length === 0 ? <Empty title="No calls yet" body="Place a test call above, or open an incident and press “Call the on-call contact now”." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted"><th className="py-2 pr-3">When</th><th className="pr-3">Call</th><th className="pr-3">To</th><th className="pr-3">Status</th><th className="pr-3">Outcome</th><th className="pr-3">Length</th><th /></tr></thead>
              <tbody>
                {calls.map((c) => {
                  const g = c.gathered_context ?? {};
                  const ack = g.acknowledged === true || String(g.acknowledged).toLowerCase() === "true";
                  return (
                    <tr key={c.id} className="border-t border-line/70 hover:bg-sky-soft/40">
                      <td className="py-2 pr-3 font-mono text-[11px] text-muted">{fmtTime(c.created_at)}</td>
                      <td className="pr-3"><p className="text-ink">{c.title}</p>{c.incident_id && <Link href={`/app/incidents/${c.incident_id}`} className="text-[11px] text-blue hover:underline">incident →</Link>}</td>
                      <td className="pr-3"><p className="font-mono text-xs text-ink">{c.to_number}</p><p className="text-[11px] text-muted">{c.contact_name ?? "custom"}</p></td>
                      <td className="pr-3"><Badge tone={STATUS_TONE[c.status] ?? "muted"}>{c.status.replace("_", " ")}</Badge>{c.error && <p className="mt-0.5 max-w-[220px] truncate text-[10px] text-red" title={c.error}>{c.error}</p>}</td>
                      <td className="pr-3 text-xs">{ack ? <span className="inline-flex items-center gap-1 text-green"><CheckCircle2 size={12} /> acknowledged{g.eta_minutes != null && g.eta_minutes !== "" ? ` · ETA ${String(g.eta_minutes)} min` : ""}</span> : g.verdict ? <span className="text-ink">verdict: {String(g.verdict)}</span> : g.confirmed === true ? <span className="text-green">line confirmed</span> : <span className="text-muted">{c.disposition ?? "—"}</span>}</td>
                      <td className="pr-3 font-mono text-xs text-muted">{c.duration_seconds != null ? `${Math.round(c.duration_seconds)} s` : "—"}</td>
                      <td className="text-right"><button onClick={() => setDetail(c.id)} className="inline-flex items-center gap-1 text-xs text-blue hover:underline"><FileText size={12} /> transcript</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* call-type detail */}
      <Modal open={!!sel} onClose={() => setOpen(null)} width="max-w-6xl" title={sel ? <span className="flex items-center gap-3"><span className={`grid h-10 w-10 place-items-center rounded-2xl bg-sky-soft ${TONE_BG[sel.tone]?.split(" ").pop() ?? "text-blue"}`}>{ICONS[sel.icon]}</span>{sel.title}</span> : null}>
        {sel && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-2xl text-sm text-muted">{sel.description}</p>
              <div className="flex items-center gap-2">
                {sel.synced?.uuid ? <Badge tone="green"><ShieldCheck size={10} /> Dograh #{sel.synced.id} · v{sel.synced.version}</Badge> : <Badge tone="amber">not on Dograh yet</Badge>}
                <Button size="sm" variant="secondary" onClick={() => sync(sel.key)} loading={syncing === sel.key}><CloudUpload size={14} /> {sel.synced ? "Re-publish" : "Publish"}</Button>
                {status.host && sel.synced?.id && <a href={`https://${status.host}/workflow/${sel.synced.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue hover:underline">open in Dograh <ExternalLink size={12} /></a>}
              </div>
            </div>
            <div className="mt-4 flex gap-1 rounded-xl bg-sky-soft/60 p-1">
              {([["graph", "Workflow", <Waypoints key="g" size={14} />], ["scripts", "Prompt scripts", <FileText key="s" size={14} />], ["call", "Place call", <PhoneCall key="c" size={14} />]] as const).map(([k, label, icon]) => (
                <button key={k} onClick={() => setTab(k)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === k ? "bg-white text-ink shadow" : "text-muted hover:text-ink"}`}>{icon} {label}</button>
              ))}
            </div>
            <div className="mt-4">
              {tab === "graph" && (
                <div className="space-y-3">
                  <WorkflowGraph nodes={sel.workflow_definition.nodes} edges={sel.workflow_definition.edges} />
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {sel.variables.map((v) => <div key={v.name} className="rounded-xl border border-line bg-white px-3 py-2"><p className="font-mono text-[11px] text-ink">{"{{"}{v.name}{"}}"}</p><p className="text-[11px] text-muted">{v.description}</p><p className="truncate text-[11px] text-blue">e.g. {v.example}</p></div>)}
                  </div>
                  <p className="text-[11px] text-muted"><strong className="text-ink">Trigger:</strong> {sel.trigger}</p>
                </div>
              )}
              {tab === "scripts" && <Scripts ct={sel} />}
              {tab === "call" && <div className="mx-auto max-w-2xl"><PlaceCall ct={sel} status={status} incidents={incidents.filter((i) => i.status !== "resolved")} onPlaced={(c) => { setCalls((cs) => [c, ...cs.filter((x) => x.id !== c.id)]); setOpen(null); }} /></div>}
            </div>
          </div>
        )}
      </Modal>

      {detail && <CallDetail id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
