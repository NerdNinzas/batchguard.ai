"use client";
/* eslint-disable @next/next/no-img-element */

import { BookOpen, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Modal } from "@/components/ui/Primitives";
import { MACHINE_TYPES, type MachineTypeInfo } from "@/lib/machineTypes";

type Credit = { title: string; author: string; license: string; source: string };

/** Photo cards for each machine type with a "Learn more" sheet. */
export function MachineTypePicker({ value, onChange, compact = false }: { value: string; onChange: (id: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState<MachineTypeInfo | null>(null);
  const [credits, setCredits] = useState<Record<string, Credit>>({});
  useEffect(() => {
    fetch("/machines/credits.json").then((r) => r.json()).then(setCredits).catch(() => {});
  }, []);

  return (
    <>
      <div className={`grid gap-3 ${compact ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        {MACHINE_TYPES.map((t) => {
          const on = value === t.id;
          return (
            <div key={t.id} className={`group relative overflow-hidden rounded-2xl border bg-white text-left transition ${on ? "border-blue ring-4 ring-blue/15" : "border-line hover:border-blue/50"}`}>
              <button type="button" onClick={() => onChange(t.id)} className="block w-full text-left">
                <div className={`relative overflow-hidden ${compact ? "h-20" : "h-32"}`}>
                  <img src={t.image} alt={t.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/60 via-transparent to-transparent" />
                  {on && (
                    <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-blue text-white">
                      <Check size={14} />
                    </span>
                  )}
                  <p className={`absolute bottom-2 left-3 font-display font-semibold text-white ${compact ? "text-sm" : "text-lg"}`}>{t.name}</p>
                </div>
                {!compact && <p className="px-3 pt-2 text-xs leading-relaxed text-muted">{t.tagline}</p>}
              </button>
              <div className={`flex items-center justify-between px-3 ${compact ? "py-1.5" : "py-2"}`}>
                <span className="font-mono text-[10px] text-muted">{t.monitors.length} params</span>
                <button type="button" onClick={() => setOpen(t)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue hover:underline">
                  <BookOpen size={12} /> Learn more
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open?.name} width="max-w-3xl">
        {open && (
          <div className="space-y-5">
            <div className="relative h-56 overflow-hidden rounded-2xl">
              <img src={open.image} alt={open.name} className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/70 to-transparent" />
              <p className="absolute bottom-3 left-4 right-4 text-sm text-white">{open.tagline}</p>
              {credits[open.id] && (
                <a href={credits[open.id].source} target="_blank" rel="noreferrer" className="absolute right-2 top-2 rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-white/90 hover:bg-black/60">
                  {credits[open.id].license} · {credits[open.id].author}
                </a>
              )}
            </div>
            <p className="text-sm leading-relaxed text-ink">{open.description}</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-blue">What Muse monitors</p>
                <ul className="space-y-1.5">
                  {open.monitors.map((m) => (
                    <li key={m.param} className="rounded-xl border border-line bg-white p-2.5 text-xs">
                      <code className="font-mono font-semibold text-ink">{m.param}</code>
                      <p className="mt-0.5 text-muted">{m.why}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-red">Faults it recognises</p>
                <ul className="space-y-1.5">
                  {open.faults.map((f) => (
                    <li key={f.name} className="rounded-xl border border-line bg-white p-2.5 text-xs">
                      <p className="font-semibold text-ink">{f.name}</p>
                      <p className="mt-0.5 text-muted">{f.signature}</p>
                    </li>
                  ))}
                </ul>
                <p className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-amber">First checks</p>
                <ol className="list-decimal space-y-1 pl-5 text-xs text-ink">
                  {open.firstChecks.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ol>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Badge tone="muted">Typical use · {open.typicalUse}</Badge>
              <Button onClick={() => { onChange(open.id); setOpen(null); }}>Use this template</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
