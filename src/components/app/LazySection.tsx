"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/Primitives";

/**
 * Renders a shimmer placeholder until the section scrolls near the viewport, then mounts its children
 * (which fetch their own data). Pages show what is on screen first and fill the rest as you scroll.
 */
export function LazySection({ children, height = 240, rootMargin = "240px", className = "", placeholder }: { children: ReactNode; height?: number; rootMargin?: string; className?: string; placeholder?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); } }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rootMargin]);
  return <div ref={ref} className={className}>{shown ? children : placeholder ?? <Skeleton className="w-full rounded-2xl" style={{ height }} />}</div>;
}

/** Numbered pagination: Prev · 1 … n · Next */
export function Pagination({ page, pages, onChange, total, pageSize }: { page: number; pages: number; onChange: (p: number) => void; total?: number; pageSize?: number }) {
  if (pages <= 1) return null;
  const win: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) win.push(p);
  const btn = (p: number, label: ReactNode, active = false, disabled = false) => (
    <button key={`${p}-${String(label)}`} disabled={disabled} onClick={() => onChange(p)} className={`min-w-8 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${active ? "bg-blue text-white" : "border border-line bg-white text-ink hover:border-blue/50 disabled:opacity-40"}`}>{label}</button>
  );
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
      <p className="text-xs text-muted">{total != null && pageSize ? `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}` : `page ${page} of ${pages}`}</p>
      <div className="flex items-center gap-1">
        {btn(page - 1, "‹ Prev", false, page <= 1)}
        {win[0] > 1 && <>{btn(1, 1)}{win[0] > 2 && <span className="px-1 text-xs text-muted">…</span>}</>}
        {win.map((p) => btn(p, p, p === page))}
        {win[win.length - 1] < pages && <>{win[win.length - 1] < pages - 1 && <span className="px-1 text-xs text-muted">…</span>}{btn(pages, pages)}</>}
        {btn(page + 1, "Next ›", false, page >= pages)}
      </div>
    </div>
  );
}
