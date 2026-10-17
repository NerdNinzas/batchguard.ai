"use client";

import { Activity, ExternalLink, Factory, Flame, Gauge, Plus, Power, RotateCcw, Trash2, Wifi, WifiOff, Zap } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SimMachine } from "@/lib/status";
type UiMachine = SimMachine & { has_key: boolean };
import { statusOf } from "@/lib/status";

const Scene = dynamic(() => import("@/components/Scene").then((m) => m.Scene), { ssr: false, loading: () => <div className="grid h-full place-items-center text-sm text-muted">Loading the factory…</div> });

type Snapshot = {
  connected: boolean; backend: string; dashboard: string; posts: number; posts_per_min: number; uptime_s: number; error: string | null;
  presets: { key: string; label: string; types: string[]; description: string }[]; machines: UiMachine[]; log: { ts: number; text: string; tone: string }[];
};
const TYPES = [["conveyor", "Conveyor"], ["motor", "Motor / drive"], ["pump", "Pump"], ["compressor", "Compressor"], ["hopper", "Hopper / feeder"], ["sealer", "Sealer / packer"], ["inspection", "Inspection station"], ["other", "Generic machine"]];
const TONE: Record<string, string> = { normal: "text-green", warning: "text-amber", critical: "text-red", stopped: "text-muted", shutdown: "text-violet" };
const fmt = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

async function post(path: string, body: unknown, method = "POST") {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body == null ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json();
}

export default function Home() {
  const [s, setS] = useState<Snapshot | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [ramp, setRamp] = useState(30);
  const [addType, setAddType] = useState("motor");
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, number>>({});

  const refresh = useCallback(() => fetch("/api/state").then((r) => r.json()).then(setS).catch(() => {}), []);
  useEffect(() => { refresh(); const id = setInterval(refresh, 1000); return () => clearInterval(id); }, [refresh]);

  const m = useMemo(() => s?.machines.find((x) => x.id === sel) ?? null, [s, sel]);
  useEffect(() => { if (s && !sel && s.machines[0]) setSel(s.machines[0].id); }, [s, sel]);

  async function act(id: string, body: unknown, label: string) {
    setBusy(label);
    try { await post(`/api/machines/${id}`, body); await refresh(); } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }
  async function add() { setBusy("add"); try { const r = await post("/api/machines", { type: addType }); await refresh(); setSel(r.id); } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); } }
  async function remove(id: string) { if (!confirm("Remove this machine from BatchGuard too?")) return; setBusy("remove"); try { await post(`/api/machines/${id}`, null, "DELETE"); setSel(null); await refresh(); } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); } }

  if (!s) return <div className="grid min-h-screen place-items-center text-muted">Connecting to the virtual factory…</div>;
  const counts = s.machines.reduce((a, x) => { a[statusOf(x)]++; return a; }, { normal: 0, warning: 0, critical: 0, stopped: 0, shutdown: 0 } as Record<string, number>);

  return (
    <div className="flex h-screen flex-col">
      {/* header */}
      <header className="flex items-center justify-between border-b border-line bg-panel/80 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue text-white"><Factory size={18} /></span>
          <div><p className="text-sm font-semibold leading-tight">BatchGuard · Virtual Factory</p><p className="text-[11px] text-muted">Streams real telemetry into the demo account · turn the dials, inject faults, watch Muse react</p></div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${s.connected ? "border-green/40 text-green" : "border-red/40 text-red"}`}>{s.connected ? <Wifi size={12} /> : <WifiOff size={12} />} {s.connected ? "connected" : "disconnected"} <span className="mono text-[10px] text-muted">{s.backend.replace(/^https?:\/\//, "")}</span></span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-muted"><Activity size={12} /> {s.posts_per_min} posts/min</span>
          <span className="hidden items-center gap-2 sm:inline-flex"><span className="text-green">{counts.normal} ok</span><span className="text-amber">{counts.warning} warn</span><span className="text-red">{counts.critical} crit</span><span className="text-muted">{counts.stopped} off</span>{counts.shutdown ? <span className="text-violet">{counts.shutdown} shut down</span> : null}</span>
          <a href={`${s.dashboard}/app`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-blue px-3 py-1.5 font-semibold text-white hover:bg-blue/90">Open BatchGuard <ExternalLink size={12} /></a>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_380px]">
        {/* 3D */}
        <div className="relative min-h-[360px]">
          <Scene machines={s.machines} selected={sel} onSelect={setSel} />
          <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
            {s.machines.map((x) => { const st = statusOf(x); return <button key={x.id} onClick={() => setSel(x.id)} className={`pointer-events-auto rounded-full border px-2.5 py-1 text-[11px] ${sel === x.id ? "border-white bg-white/10" : "border-line bg-panel/80"} ${TONE[st]}`}>{x.name}</button>; })}
          </div>
          {s.error && !s.connected && <div className="absolute inset-x-3 bottom-3 rounded-xl border border-red/40 bg-red/10 p-3 text-xs text-red">{s.error}</div>}
          <div className="absolute bottom-3 left-3 flex gap-2">
            <button onClick={() => post("/api/line", { action: "reset" }).then(refresh)} className="inline-flex items-center gap-1 rounded-full border border-line bg-panel/90 px-3 py-1.5 text-xs hover:border-green/60"><RotateCcw size={12} /> Whole line normal</button>
            <div className="inline-flex items-center gap-1 rounded-full border border-line bg-panel/90 pl-2 pr-1 text-xs">
              <Plus size={12} /><select value={addType} onChange={(e) => setAddType(e.target.value)} className="bg-transparent py-1.5 text-xs outline-none">{TYPES.map(([v, l]) => <option key={v} value={v} className="bg-panel">{l}</option>)}</select>
              <button onClick={add} disabled={busy === "add"} className="rounded-full bg-blue px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">{busy === "add" ? "adding…" : "Add machine"}</button>
            </div>
          </div>
        </div>

        {/* control panel */}
        <aside className="flex min-h-0 flex-col border-l border-line bg-panel">
          {!m ? <div className="p-5 text-sm text-muted">Select a machine in the 3D view.</div> : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-base font-semibold">{m.name}</p><p className="mono text-[11px] text-muted">{m.device_id} · {m.type} · {m.has_key ? "key ok" : "no key"}{m.last_post ? ` · last post ${m.last_post.ok ? m.last_post.ms + " ms" : "failed " + (m.last_post.error ?? "")}` : ""}</p></div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${TONE[statusOf(m)]} border-current`}>{statusOf(m)}</span>
              </div>

              {m.shutdown && (
                <div className="mt-3 rounded-xl border border-violet/50 bg-violet/10 p-3 text-xs">
                  <p className="font-semibold text-violet">⏻ Shut down by {m.shutdown.by} · {fmt(m.shutdown.at)}</p>
                  <p className="mt-1 text-muted">{m.shutdown.reason}</p>
                  <p className="mt-1 text-muted">Telemetry is paused. Restart here (operator) or from the machine page in BatchGuard after a check.</p>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => act(m.id, { action: "running", running: !m.running }, "run")} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${m.running ? "bg-red/15 text-red" : "bg-green/15 text-green"}`}><Power size={12} /> {m.running ? "Stop machine (telemetry drops)" : m.shutdown ? "Restart machine (operator)" : "Start machine"}</button>
                <button onClick={() => act(m.id, { action: "release" }, "release")} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs hover:border-green/60"><RotateCcw size={12} /> Back to normal</button>
                <button onClick={() => remove(m.id)} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:border-red/60 hover:text-red"><Trash2 size={12} /></button>
              </div>

              <div className="mt-4">
                <p className="mono text-[10px] uppercase tracking-[0.2em] text-muted">Production speed</p>
                <div className="mt-1 flex items-center gap-2"><Gauge size={14} className="text-muted" /><input type="range" min={0.2} max={1.5} step={0.05} value={m.speed} onChange={(e) => act(m.id, { action: "speed", speed: Number(e.target.value) }, "speed")} className="flex-1" /><span className="mono w-10 text-right text-xs">{m.speed.toFixed(2)}×</span></div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between"><p className="mono text-[10px] uppercase tracking-[0.2em] text-muted">Parameters</p><label className="flex items-center gap-1 text-[11px] text-muted">ramp <input type="number" min={1} max={900} value={ramp} onChange={(e) => setRamp(Number(e.target.value))} className="w-14 rounded border border-line bg-bg px-1 py-0.5 text-right" /> s</label></div>
                <div className="mt-2 space-y-3">
                  {m.params.map((p) => {
                    const v = m.values[p.name] ?? 0;
                    const lo = Math.min(p.crit_low ?? p.warn_low ?? p.normal_min ?? v * 0.5, p.normal_min ?? v) * 0.85;
                    const hi = Math.max(p.crit_high ?? p.warn_high ?? p.normal_max ?? v * 1.5, p.normal_max ?? v) * 1.15;
                    const c = m.controls[p.name];
                    const state = (p.crit_high != null && v > p.crit_high) || (p.crit_low != null && v < p.crit_low) ? "critical" : (p.warn_high != null && v > p.warn_high) || (p.warn_low != null && v < p.warn_low) ? "warning" : "normal";
                    const draft = drafts[p.name];
                    return (
                      <div key={p.name} className="rounded-xl border border-line bg-bg/60 p-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="mono">{p.name}</span>
                          <span className={`mono font-semibold ${TONE[state]}`}>{v.toFixed(2)}{p.unit ? ` ${p.unit}` : ""}{c ? <span className="ml-1 text-[10px] text-muted">→ {c.target.toFixed(1)}</span> : null}</span>
                        </div>
                        <input type="range" min={lo} max={hi} step={(hi - lo) / 200} value={draft ?? c?.target ?? v} onChange={(e) => setDrafts((d) => ({ ...d, [p.name]: Number(e.target.value) }))} onMouseUp={() => { if (draft != null) { act(m.id, { action: "target", parameter: p.name, target: draft, ramp_s: ramp }, p.name); setDrafts((d) => { const n = { ...d }; delete n[p.name]; return n; }); } }} onTouchEnd={() => { if (draft != null) { act(m.id, { action: "target", parameter: p.name, target: draft, ramp_s: ramp }, p.name); setDrafts((d) => { const n = { ...d }; delete n[p.name]; return n; }); } }} className="mt-1 w-full" />
                        <div className="mono flex justify-between text-[9px] text-muted"><span>{p.crit_low != null ? `crit ${p.crit_low}` : ""}{p.warn_low != null ? ` · warn ${p.warn_low}` : ""}</span><span>normal {p.normal_min ?? "–"}–{p.normal_max ?? "–"}</span><span>{p.warn_high != null ? `warn ${p.warn_high}` : ""}{p.crit_high != null ? ` · crit ${p.crit_high}` : ""}</span></div>
                        {c && <button onClick={() => act(m.id, { action: "release", parameter: p.name }, p.name)} className="mt-1 text-[10px] text-muted hover:text-green">release → drifts back to normal</button>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4">
                <p className="mono text-[10px] uppercase tracking-[0.2em] text-muted">Inject a fault</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {s.presets.filter((f) => f.types.includes(m.type) || f.types.includes("other")).map((f) => (
                    <button key={f.key} onClick={() => act(m.id, { action: "preset", preset: f.key }, f.key)} title={f.description} className={`rounded-xl border p-2 text-left text-xs transition hover:border-red/60 ${m.fault === f.key ? "border-red bg-red/10" : "border-line"}`}>
                      <span className="flex items-center gap-1 font-semibold"><Flame size={11} className="text-red" /> {f.label}</span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-muted">{f.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="border-t border-line p-3">
            <p className="mono mb-1 flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-muted"><Zap size={11} /> Live log · what BatchGuard said back</p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {s.log.map((l, i) => <p key={i} className="text-[11px] leading-snug"><span className="mono text-[10px] text-muted">{fmt(l.ts)}</span> <span className={l.tone === "red" ? "text-red" : l.tone === "amber" ? "text-amber" : l.tone === "green" ? "text-green" : l.tone === "blue" ? "text-sky" : "text-muted"}>{l.text}</span></p>)}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
