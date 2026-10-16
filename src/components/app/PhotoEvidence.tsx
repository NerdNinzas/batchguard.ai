"use client";

import { Camera, Eye, ImagePlus, ShieldAlert, ThumbsDown, ThumbsUp, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, Input, Modal } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { api, fmtAgo, type EvidenceItem } from "@/lib/api";

/** Technician photos for an incident: upload → Gemini vision reads it against Muse's ranked causes. */
export function PhotoEvidence({ incidentId, items, onChanged }: { incidentId: string; items: EvidenceItem[]; onChanged: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<EvidenceItem | null>(null);
  const preview = file ? URL.createObjectURL(file) : null;

  async function upload() {
    if (!file) return toast("warning", "Choose a photo first");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("caption", caption);
      const ev = await api<EvidenceItem>(`/api/incidents/${incidentId}/evidence`, { method: "POST", body: fd });
      const n = ev.analysis?.findings?.length ?? 0;
      toast("success", "Photo read by Gemini", ev.analysis?.description ? `${ev.analysis.description.slice(0, 120)}${n ? ` · ${n} cause${n > 1 ? "s" : ""} updated` : ""}` : undefined);
      setFile(null); setCaption(""); if (fileRef.current) fileRef.current.value = "";
      onChanged();
    } catch (e) { toast("error", "Upload failed", e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
        <button onClick={() => fileRef.current?.click()} className="relative grid h-[120px] place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-sky-soft/40 text-muted transition hover:border-blue/60 hover:text-blue">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <span className="flex flex-col items-center gap-1 text-xs"><ImagePlus size={22} /> Choose photo</span>}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </button>
        <div className="space-y-2">
          <Input label="What are we looking at? (optional)" placeholder="e.g. drive-end bearing housing, taken after stopping the line" value={caption} onChange={(e) => setCaption(e.target.value)} />
          <div className="flex items-center gap-2">
            <Button onClick={upload} loading={busy} disabled={!file}><Upload size={15} /> {busy ? "Gemini is looking…" : "Add as evidence"}</Button>
            <p className="text-[11px] text-muted">Gemini describes the photo and marks which ranked causes it supports or contradicts. Lines land on the report.</p>
          </div>
        </div>
      </div>

      {items.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {items.map((ev) => {
            const a = ev.analysis ?? {};
            return (
              <button key={ev.id} onClick={() => setOpen(ev)} className="group flex gap-3 rounded-2xl border border-line bg-white p-2 text-left transition hover:border-blue/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ev.url} alt="" className="h-20 w-24 shrink-0 rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] leading-snug text-ink">{a.description ?? "No analysis"}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {a.confidence && <Badge tone={a.confidence === "high" ? "green" : a.confidence === "medium" ? "blue" : "muted"}><Eye size={9} /> {a.confidence}</Badge>}
                    {(a.findings ?? []).slice(0, 2).map((f, i) => <Badge key={i} tone={f.supports ? "green" : "red"}>{f.supports ? <ThumbsUp size={9} /> : <ThumbsDown size={9} />} {f.cause.slice(0, 26)}</Badge>)}
                    {(a.safety_flags?.length ?? 0) > 0 && <Badge tone="red"><ShieldAlert size={9} /> {a.safety_flags!.length} safety</Badge>}
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-muted">{ev.uploaded_by} · {fmtAgo(ev.ts)}{ev.caption ? ` · ${ev.caption}` : ""}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} width="max-w-4xl" title={open ? <span className="flex items-center gap-2"><Camera size={20} className="text-blue" /> Photo evidence</span> : null}>
        {open && (
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={open.url} alt="" className="max-h-[60vh] w-full rounded-2xl object-contain bg-sky-soft/40" />
            <div className="space-y-3 text-sm">
              <p className="text-ink">{open.analysis?.description}</p>
              {open.caption && <p className="text-xs text-muted">Caption: {open.caption}</p>}
              {(open.analysis?.observations?.length ?? 0) > 0 && <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Observations</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-ink">{open.analysis!.observations!.map((o, i) => <li key={i}>{o}</li>)}</ul></div>}
              {(open.analysis?.findings?.length ?? 0) > 0 && <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Against the ranked causes</p><div className="mt-1 space-y-1.5">{open.analysis!.findings!.map((f, i) => <div key={i} className={`rounded-xl border p-2 text-[13px] ${f.supports ? "border-green/40 bg-green/5" : "border-red/40 bg-red/5"}`}><p className="font-semibold text-ink">{f.supports ? "Supports" : "Contradicts"}: {f.cause}</p><p className="text-muted">{f.rationale}</p></div>)}</div></div>}
              {(open.analysis?.safety_flags?.length ?? 0) > 0 && <div className="rounded-xl border border-red/40 bg-red/5 p-2 text-[13px] text-red"><ShieldAlert size={12} className="inline" /> {open.analysis!.safety_flags!.join(" · ")}</div>}
              {open.analysis?.error && <p className="text-xs text-red">{open.analysis.error}</p>}
              <p className="font-mono text-[10px] text-muted">{open.analysis?.model ?? "no model"} · {open.uploaded_by} · {fmtAgo(open.ts)}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
