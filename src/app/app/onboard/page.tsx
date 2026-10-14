"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, FileUp, Keyboard, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { KeyReveal } from "@/components/app/KeyReveal";
import { Badge, Button, Card, Input, Modal, Select } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { api, get, post, type Knowledge, type Machine, type Parameter } from "@/lib/api";

type Row = Parameter & { verified: boolean };
const NUM = ["normal_min", "normal_max", "warn_low", "warn_high", "crit_low", "crit_high"] as const;
const blank = (): Row => ({ name: "", unit: "", normal_min: null, normal_max: null, warn_low: null, warn_high: null, crit_low: null, crit_high: null, sample_rate: 1, verified: false });

export default function OnboardPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"pdf" | "manual">("pdf");
  const [types, setTypes] = useState<{ types: string[]; templates: Record<string, Partial<Parameter>[]> } | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("conveyor");
  const [location, setLocation] = useState("");
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [extract, setExtract] = useState<{ source: string; notes?: string | null; manual_name: string; manual_path: string; gemini: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [result, setResult] = useState<Machine | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    get<typeof types>("/api/machines/types").then(setTypes).catch(() => {});
  }, []);

  function applyTemplate(t: string) {
    setType(t);
    if (types?.templates[t]) setRows(types.templates[t].map((p) => ({ ...blank(), ...p, verified: false })));
  }

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("hint_type", type);
      const r = await api<{ spec: { machine_name: string; machine_type: string; parameters: Parameter[]; knowledge: Knowledge[]; notes?: string | null }; source: string; manual_name: string; manual_path: string; gemini_enabled: boolean }>("/api/machines/extract", { method: "POST", body: fd });
      setName(r.spec.machine_name);
      setType(r.spec.machine_type);
      setRows(r.spec.parameters.map((p) => ({ ...blank(), ...p, verified: false })));
      setKnowledge(r.spec.knowledge ?? []);
      setExtract({ source: r.source, notes: r.spec.notes, manual_name: r.manual_name, manual_path: r.manual_path, gemini: r.gemini_enabled });
      toast(r.source === "gemini" ? "success" : "info", r.source === "gemini" ? "Gemini read the manual" : "Template defaults loaded", r.source === "gemini" ? `${r.spec.parameters.length} parameters extracted — verify each one.` : "Gemini is not configured; type defaults are shown and clearly marked. Verify every value.", 7000);
    } catch (e) {
      toast("error", "Extraction failed", e instanceof Error ? e.message : "");
    } finally {
      setBusy(false);
    }
  }

  const allVerified = rows.length > 0 && rows.every((r) => r.name && r.verified);

  async function submit() {
    if (!name.trim()) return toast("warning", "Give the machine a name");
    if (!allVerified || !confirmAll) return toast("warning", "Verify every parameter", "Tick each row and the confirmation box. Nothing goes live unverified.");
    setBusy(true);
    try {
      const payload = {
        name, type, location, parameters: rows.map((r) => ({ ...r, verified: true })), knowledge,
        source: extract ? extract.source === "gemini" ? "pdf" : "template" : "manual",
        manual_name: extract?.manual_name ?? null, manual_path: extract?.manual_path ?? null, verified: true,
      };
      const m = await post<Machine>("/api/machines", payload);
      setResult(m);
      toast("success", `${m.name} is live`, "Device key issued. Copy it now — it is shown once.", 8000);
    } catch (e) {
      toast("error", "Could not create machine", e instanceof Error ? e.message : "");
    } finally {
      setBusy(false);
    }
  }

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Button variant={tab === "pdf" ? "primary" : "secondary"} onClick={() => setTab("pdf")}><FileUp size={16} /> From PDF manual</Button>
        <Button variant={tab === "manual" ? "primary" : "secondary"} onClick={() => setTab("manual")}><Keyboard size={16} /> Enter manually</Button>
      </div>

      {tab === "pdf" && (
        <Card title="1 · Upload the datasheet or manual">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
            onClick={() => fileRef.current?.click()}
            className={`grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${dragging ? "border-blue bg-blue/5" : "border-line bg-white hover:border-blue/50"}`}
          >
            <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <Sparkles size={28} className="text-blue" />
            <p className="mt-3 font-semibold text-ink">{busy ? "Reading the manual…" : "Drop a PDF or image here, or click to choose"}</p>
            <p className="mt-1 text-xs text-muted">Gemini extracts parameters, units, normal ranges, warning/critical limits and the troubleshooting sections — with the page each value came from.</p>
            <div className="mt-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <span className="text-xs text-muted">Hint type</span>
              <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 text-xs">
                {(types?.types ?? ["conveyor"]).map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {extract && (
            <div className={`mt-3 rounded-xl border p-3 text-xs ${extract.source === "gemini" ? "border-green/40 bg-green/5 text-ink" : "border-amber/40 bg-amber/5 text-ink"}`}>
              <Badge tone={extract.source === "gemini" ? "green" : "amber"}>{extract.source === "gemini" ? "Gemini extraction" : "template defaults"}</Badge> <span className="ml-2">{extract.manual_name}</span>
              {extract.notes && <p className="mt-1 text-muted">{extract.notes}</p>}
            </div>
          )}
        </Card>
      )}

      {tab === "manual" && (
        <Card title="1 · Start from a template (optional)">
          <div className="flex flex-wrap gap-2">
            {(types?.types ?? []).filter((t) => types?.templates[t]).map((t) => (
              <Button key={t} size="sm" variant={type === t ? "primary" : "secondary"} onClick={() => applyTemplate(t)}>{t}</Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Templates are typical values for the machine type, marked as defaults. Replace them with the values from your machine's documentation.</p>
        </Card>
      )}

      <Card title={`${tab === "pdf" ? "2" : "2"} · Machine`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Machine name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Main conveyor" />
          <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}>{(types?.types ?? ["conveyor"]).map((t) => <option key={t}>{t}</option>)}</Select>
          <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Line A · bay 2" />
        </div>
      </Card>

      <Card title="3 · Verify every parameter" action={<Badge tone={allVerified ? "green" : "amber"}>{rows.filter((r) => r.verified).length}/{rows.length} verified</Badge>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-2 py-2">Parameter</th><th className="px-2 py-2">Unit</th>
                {NUM.map((k) => <th key={k} className="px-2 py-2">{k.replace("_", " ")}</th>)}
                <th className="px-2 py-2">Source</th><th className="px-2 py-2 text-center">Verified</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`border-t border-line ${r.verified ? "bg-green/[0.04]" : ""}`}>
                  <td className="px-2 py-1.5"><input value={r.name} onChange={(e) => setRow(i, { name: e.target.value.replace(/\s+/g, "_").toLowerCase(), verified: false })} placeholder="motor_temp" className="w-32 rounded-lg border border-line px-2 py-1 font-mono text-xs" /></td>
                  <td className="px-2 py-1.5"><input value={r.unit ?? ""} onChange={(e) => setRow(i, { unit: e.target.value, verified: false })} placeholder="C" className="w-16 rounded-lg border border-line px-2 py-1 font-mono text-xs" /></td>
                  {NUM.map((k) => (
                    <td key={k} className="px-2 py-1.5"><input type="number" step="any" value={r[k] ?? ""} onChange={(e) => setRow(i, { [k]: e.target.value === "" ? null : Number(e.target.value), verified: false })} className={`w-20 rounded-lg border px-2 py-1 font-mono text-xs ${k.startsWith("crit") ? "border-red/30" : k.startsWith("warn") ? "border-amber/40" : "border-line"}`} /></td>
                  ))}
                  <td className="px-2 py-1.5">
                    {r.source_page || r.source_snippet ? (
                      <div className="max-w-[180px]">
                        <Badge tone={typeof r.confidence === "number" ? (r.confidence >= 0.7 ? "green" : r.confidence >= 0.4 ? "amber" : "red") : "muted"}>{r.source_page ? `p.${r.source_page}` : "no page"}{typeof r.confidence === "number" ? ` · ${Math.round(r.confidence * 100)}%` : ""}</Badge>
                        {r.source_snippet && <p className="mt-0.5 line-clamp-2 text-[11px] italic text-muted" title={r.source_snippet}>“{r.source_snippet}”</p>}
                      </div>
                    ) : <span className="text-[11px] text-muted">typed by you</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <label className="inline-flex cursor-pointer items-center justify-center">
                      <input type="checkbox" checked={r.verified} onChange={(e) => setRow(i, { verified: e.target.checked })} className="h-5 w-5 accent-blue" />
                    </label>
                  </td>
                  <td className="px-1 py-1.5"><button onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} className="rounded p-1 text-muted hover:text-red" aria-label="Remove"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={() => setRows((rs) => [...rs, blank()])}><Plus size={14} /> Add parameter</Button>
          <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, verified: Boolean(r.name) })))}>Tick all</Button>
          <span className="text-xs text-muted">Edit any value; editing clears its tick so you re-confirm it.</span>
        </div>
      </Card>

      {knowledge.length > 0 && (
        <Card title="Knowledge base from the manual" action={<Badge tone="blue">{knowledge.length} sections</Badge>}>
          <div className="grid gap-2 md:grid-cols-2">
            {knowledge.map((k, i) => (
              <div key={i} className="rounded-xl border border-line bg-white p-3 text-xs"><span className="font-semibold text-ink">{k.title}</span> <Badge tone="muted">{k.kind}{k.page ? ` · p.${k.page}` : ""}</Badge><p className="mt-1 text-muted">{k.text}</p></div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={confirmAll} onChange={(e) => setConfirmAll(e.target.checked)} className="mt-0.5 h-5 w-5 accent-blue" />
          <span className="text-sm text-ink">I verified these limits against the machine's documentation and take responsibility for them. BatchGuard will alert and escalate based on these values; it never changes machine settings.</span>
        </label>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted">On confirm you get a device ID, API key and endpoint with the exact parameters it accepts.</p>
          <Button size="lg" onClick={submit} loading={busy} disabled={!allVerified || !confirmAll}><CheckCircle2 size={18} /> Confirm & issue device key</Button>
        </div>
      </Card>

      <Modal open={Boolean(result)} onClose={() => setResult(null)} title={<span className="flex items-center gap-2"><CheckCircle2 className="text-green" /> {result?.name} is onboarded</span>} width="max-w-3xl">
        {result && (
          <>
            <KeyReveal machine={result} apiKey={result.api_key} codes={result.code} />
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Link href="/app/workflow"><Button variant="secondary">Wire it into the workflow</Button></Link>
              <Link href={`/app/machines/${result.id}`}><Button>Open machine</Button></Link>
            </div>
          </>
        )}
      </Modal>

      <AnimatePresence>{busy && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg">Working…</motion.div>}</AnimatePresence>
    </div>
  );
}
