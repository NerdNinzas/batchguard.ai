"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "@/components/ui/Primitives";
import type { Machine } from "@/lib/api";

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }} className="rounded-lg border border-line bg-white px-2 py-1 text-xs text-muted hover:text-ink" aria-label="Copy">
      {ok ? <Check size={14} className="text-green" /> : <Copy size={14} />}
    </button>
  );
}

/** Shown once after verification / rotation: device id, key, endpoint, accepted parameters, code samples. */
export function KeyReveal({ machine, apiKey, codes }: { machine: Machine; apiKey?: string; codes?: Record<string, string> }) {
  const [lang, setLang] = useState<"curl" | "python" | "node">("curl");
  const code = codes ?? machine.code ?? {};
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Device ID" value={machine.device_id} />
        <Field label="Endpoint" value={machine.endpoint ?? "/v1/telemetry"} />
        <div className="sm:col-span-2">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Device key · header <code>X-Device-Key</code></p>
          {apiKey ? (
            <div className="flex items-center gap-2 rounded-xl border border-amber/50 bg-amber/10 px-3 py-2">
              <KeyRound size={16} className="text-amber" />
              <code className="flex-1 break-all font-mono text-sm text-ink">{apiKey}</code>
              <CopyBtn text={apiKey} />
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-sky-soft/50 px-3 py-2 font-mono text-sm text-muted">{machine.api_key_prefix ?? "bg_live_"}… (shown once at verification; rotate to get a new one)</div>
          )}
          {apiKey && <p className="mt-1 text-xs text-amber">Copy it now — it is stored hashed and cannot be shown again.</p>}
        </div>
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Parameters this endpoint accepts</p>
        <div className="flex flex-wrap gap-1.5">
          {machine.parameters.map((p) => (
            <Badge key={p.name} tone="blue">{p.name}{p.unit ? ` · ${p.unit}` : ""}</Badge>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">Other fields: <code>ts</code> (unix seconds, optional), <code>reading_id</code> (idempotency, optional), <code>unit</code> (must match the spec). Events go to <code>/v1/events</code> with <code>type</code>, <code>message</code>, <code>severity</code>.</p>
      </div>
      <div>
        <div className="mb-2 flex items-center gap-1">
          {(["curl", "python", "node"] as const).map((l) => (
            <Button key={l} size="sm" variant={lang === l ? "primary" : "ghost"} onClick={() => setLang(l)}>{l}</Button>
          ))}
          <span className="flex-1" />
          <CopyBtn text={code[lang] ?? ""} />
        </div>
        <pre className="overflow-x-auto rounded-xl bg-ink p-4 font-mono text-xs leading-relaxed text-[#cfe3ff]">{code[lang]}</pre>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{label}</p>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
        <code className="flex-1 truncate font-mono text-sm text-ink">{value}</code>
        <CopyBtn text={value} />
      </div>
    </div>
  );
}
