"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Button({ variant = "primary", size = "md", loading, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const v = {
    primary: "bg-blue text-white hover:brightness-110 shadow-sm shadow-blue/25",
    secondary: "border border-line bg-white text-ink hover:border-blue/50 hover:text-blue",
    ghost: "text-muted hover:bg-sky-soft hover:text-ink",
    danger: "bg-red text-white hover:brightness-110",
  }[variant];
  const s = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2.5 text-sm", lg: "px-5 py-3 text-base" }[size];
  return (
    <button {...rest} disabled={rest.disabled || loading} className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${v} ${s} ${className}`}>
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Input({ label, hint, error, className = "", ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>}
      <input {...rest} className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-blue focus:ring-4 focus:ring-blue/10 ${error ? "border-red" : "border-line"} ${rest.disabled ? "bg-sky-soft/50" : ""}`} />
      {(error || hint) && <span className={`mt-1 block text-xs ${error ? "text-red" : "text-muted"}`}>{error || hint}</span>}
    </label>
  );
}

export function Select({ label, className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>}
      <select {...rest} className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-blue focus:ring-4 focus:ring-blue/10">
        {children}
      </select>
    </label>
  );
}

export function Textarea({ label, className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>}
      <textarea {...rest} className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-blue focus:ring-4 focus:ring-blue/10" />
    </label>
  );
}

export function Card({ children, className = "", title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`card rounded-2xl p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES: Record<string, string> = {
  green: "bg-green/10 text-green border-green/30", amber: "bg-amber/10 text-amber border-amber/40", red: "bg-red/10 text-red border-red/40",
  blue: "bg-blue/10 text-blue border-blue/30", violet: "bg-violet/10 text-violet border-violet/30", muted: "bg-sky-soft text-muted border-line",
};
export function Badge({ tone = "muted", children, className = "" }: { tone?: string; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${TONES[tone] ?? TONES.muted} ${className}`}>{children}</span>;
}

export const statusTone = (s: string) => ({ normal: "green", warning: "amber", critical: "red", emergency: "red", stale: "amber", offline: "muted", open: "red", acknowledged: "amber", resolved: "green", info: "blue" })[s] ?? "muted";

export function StatusDot({ status, className = "" }: { status: string; className?: string }) {
  const c = { green: "bg-green", amber: "bg-amber", red: "bg-red", blue: "bg-blue", muted: "bg-muted/50" }[statusTone(status)] ?? "bg-muted/50";
  const pulse = status === "critical" || status === "emergency";
  return <span className={`relative inline-block h-2.5 w-2.5 rounded-full ${c} ${pulse ? "pulse-ring text-red" : ""} ${className}`} />;
}

export function Modal({ open, onClose, title, children, width = "max-w-xl", closable = true }: { open: boolean; onClose?: () => void; title?: ReactNode; children: ReactNode; width?: string; closable?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] grid place-items-center bg-ink/40 p-4 backdrop-blur-sm" onClick={closable ? onClose : undefined}>
          <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }} transition={{ type: "spring", stiffness: 300, damping: 26 }} onClick={(e) => e.stopPropagation()} className={`card w-full ${width} max-h-[90vh] overflow-y-auto rounded-2xl p-6`}>
            {(title || closable) && (
              <div className="mb-4 flex items-start justify-between gap-4">
                {title && <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>}
                {closable && (
                  <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-sky-soft hover:text-ink" aria-label="Close">
                    <X size={18} />
                  </button>
                )}
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-white/60 px-6 py-14 text-center">
      <p className="font-display text-xl font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone = "blue" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  const c = { blue: "text-blue", green: "text-green", amber: "text-amber", red: "text-red", muted: "text-muted", violet: "text-violet" }[tone] ?? "text-blue";
  return (
    <div className="card rounded-2xl p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{label}</p>
      <p className={`font-display mt-1 text-3xl font-semibold ${c}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted">
      <Loader2 size={18} className="animate-spin text-blue" /> {label ?? "Loading…"}
    </div>
  );
}


/* ---------- skeleton loading ---------- */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

function SkCard({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`card rounded-2xl p-5 ${className}`}>
      <Skeleton className="h-4 w-40" />
      <div className="mt-4 space-y-2.5">{Array.from({ length: lines }).map((_, i) => <Skeleton key={i} className={`h-3 ${["w-full", "w-5/6", "w-2/3", "w-3/4"][i % 4]}`} />)}</div>
    </div>
  );
}

/** Page-shaped placeholders so every dashboard view loads with its layout already in place. */
export function PageSkeleton({ variant = "cards" }: { variant?: "overview" | "cards" | "detail" | "rows" | "canvas" | "voice" }) {
  if (variant === "overview") {
    return (
      <div className="space-y-6" aria-busy>
        <div className="card relative overflow-hidden rounded-3xl p-7 lg:p-9">
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div><Skeleton className="h-3 w-56" /><Skeleton className="mt-4 h-12 w-3/4" /><Skeleton className="mt-4 h-3 w-full" /><Skeleton className="mt-2 h-3 w-5/6" /><div className="mt-5 flex gap-2"><Skeleton className="h-9 w-36 rounded-full" /><Skeleton className="h-9 w-28 rounded-full" /><Skeleton className="h-9 w-40 rounded-full" /></div></div>
            <div className="grid grid-cols-2 gap-3 self-center">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]"><Skeleton className="aspect-square rounded-3xl" /><Skeleton className="min-h-[420px] rounded-3xl" /></div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="card overflow-hidden rounded-2xl"><Skeleton className="h-36 rounded-none" /><div className="p-4"><Skeleton className="h-4 w-1/2" /><div className="mt-3 grid grid-cols-2 gap-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div></div></div>)}</div>
      </div>
    );
  }
  if (variant === "detail") {
    return (
      <div className="space-y-5" aria-busy>
        <div className="card rounded-3xl p-6"><Skeleton className="h-3 w-40" /><Skeleton className="mt-3 h-9 w-2/3" /><Skeleton className="mt-3 h-3 w-1/2" /></div>
        <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="card rounded-2xl p-5"><Skeleton className="h-4 w-32" /><Skeleton className="mt-4 h-52" /></div>)}</div>
        <div className="grid gap-4 lg:grid-cols-2"><SkCard lines={4} /><SkCard lines={4} /></div>
      </div>
    );
  }
  if (variant === "rows") {
    return <div className="space-y-3" aria-busy>{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="card flex items-center gap-4 rounded-2xl p-4"><Skeleton className="h-10 w-10 rounded-xl" /><div className="flex-1"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-2 h-3 w-1/3" /></div><Skeleton className="h-5 w-16 rounded-full" /><Skeleton className="h-5 w-16 rounded-full" /></div>)}</div>;
  }
  if (variant === "canvas") {
    return (
      <div className="space-y-4" aria-busy>
        <div className="card relative h-[640px] overflow-hidden rounded-3xl"><Skeleton className="h-full rounded-none" /><div className="absolute left-4 top-4 flex gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-28 rounded-full" />)}</div><div className="absolute inset-x-0 bottom-10 flex justify-center gap-8">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-28 rounded-2xl" />)}</div></div>
        <div className="grid gap-4 md:grid-cols-3"><SkCard /><SkCard /><SkCard /></div>
      </div>
    );
  }
  if (variant === "voice") {
    return (
      <div className="space-y-5" aria-busy>
        <div className="card rounded-3xl p-8"><Skeleton className="h-3 w-48" /><Skeleton className="mt-3 h-10 w-1/2" /><Skeleton className="mt-3 h-3 w-2/3" /><div className="mt-4 flex gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-32 rounded-full" />)}</div></div>
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]"><SkCard lines={5} /><div className="space-y-5"><SkCard lines={2} /><SkCard lines={4} /></div></div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="card rounded-3xl p-5"><Skeleton className="h-11 w-11 rounded-2xl" /><Skeleton className="mt-4 h-5 w-2/3" /><Skeleton className="mt-2 h-3 w-full" /><Skeleton className="mt-2 h-3 w-5/6" /></div>)}</div>
      </div>
    );
  }
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy>{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="card overflow-hidden rounded-2xl"><Skeleton className="h-36 rounded-none" /><div className="p-4"><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-2 h-3 w-1/3" /><div className="mt-4 grid grid-cols-2 gap-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div></div></div>)}</div>;
}
