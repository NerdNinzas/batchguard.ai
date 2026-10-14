"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Kind = "success" | "error" | "info" | "warning";
type Toast = { id: number; kind: Kind; title: string; body?: string; ttl: number };
type Ctx = { toast: (kind: Kind, title: string, body?: string, ttl?: number) => void };

const ToastCtx = createContext<Ctx>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

const ICON: Record<Kind, typeof Info> = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const TONE: Record<Kind, string> = { success: "text-green border-green/40", error: "text-red border-red/40", info: "text-blue border-blue/40", warning: "text-amber border-amber/40" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((kind: Kind, title: string, body?: string, ttl = 5000) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-4), { id, kind, title, body, ttl }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), ttl);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        <AnimatePresence>
          {items.map((t) => {
            const Icon = ICON[t.kind];
            return (
              <motion.div key={t.id} initial={{ opacity: 0, x: 40, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }} className={`card pointer-events-auto flex gap-3 rounded-xl border-l-4 p-3.5 ${TONE[t.kind]}`}>
                <Icon size={20} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{t.title}</p>
                  {t.body && <p className="mt-0.5 text-xs leading-relaxed text-muted">{t.body}</p>}
                </div>
                <button onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="text-muted hover:text-ink" aria-label="Dismiss">
                  <X size={16} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
