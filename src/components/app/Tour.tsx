"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Compass, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** One stop on the guided tour: a page, the element to spotlight, and what Muse says about it. */
type Step = { path: string; target: string; title: string; body: string; place?: "bottom" | "top" | "right" | "left" };

const STEPS: Step[] = [
  { path: "/app", target: '[data-hl="hero"]', title: "Overview · your factory at a glance", body: "Who's online, readings per minute, open incidents and mean time to acknowledge. The headline names the exact machines that need you, or says all is normal." },
  { path: "/app", target: '[data-hl="muse"]', title: "Ask Muse", body: "Chat with your factory. Answers stream live, every number comes from live data, and Muse can take you anywhere — try “show me the compressor's pressure chart”." },
  { path: "/app", target: '[data-tour="voice-fab"]', title: "Talk to Muse", body: "The round button follows you on every page. Tap it for a realtime voice conversation (Gemini Live) in English, Hindi or Hinglish — Muse navigates, edits contacts, places calls and shuts machines down on request.", place: "left" },
  { path: "/app", target: '[data-hl="machines"]', title: "Live machine cards", body: "Each card shows live values, health and a time-to-limit forecast when a parameter is drifting toward a limit." },
  { path: "/app/machines", target: '[data-tour="nav-/app/machines"]', title: "Machines", body: "Every onboarded machine with its photo, status and key readings. Click one for charts, incidents, work orders and its device connection.", place: "right" },
  { path: "/app/onboard", target: '[data-tour="nav-/app/onboard"]', title: "Onboard a machine", body: "Upload the PDF manual: Gemini extracts parameters, units and warning/critical limits with page citations. You tick “verified” and get a device key and code samples.", place: "right" },
  { path: "/app/workflow", target: '[data-tour="nav-/app/workflow"]', title: "Workflow builder", body: "Wire machines upstream → downstream. Muse sits above the line, watches every machine (dashed links) and uses the order for cross-machine reasoning. The live log shows the pipeline working.", place: "right" },
  { path: "/app/factory", target: '[data-tour="nav-/app/factory"]', title: "3D factory", body: "A live 3D hall: machines light up by status, lamps and labels follow the data in real time.", place: "right" },
  { path: "/app/telemetry", target: '[data-tour="nav-/app/telemetry"]', title: "Telemetry", body: "Live chart with limit bands per parameter, and every reading received, 50 at a time.", place: "right" },
  { path: "/app/incidents", target: '[data-tour="nav-/app/incidents"]', title: "Incidents", body: "One incident per machine. Muse investigates with evidence, ranks causes, lists the first checks, phones the on-call contact, and auto-closes it when the machine is back to normal. Critical incidents run a shutdown countdown if nobody responds.", place: "right" },
  { path: "/app/voice", target: '[data-tour="nav-/app/voice"]', title: "Voice AI · Gemini Live", body: "Muse's phone line: pick the TeleCMI caller number, read every call script, place a test call, review transcripts, and set auto-dial and auto-shutdown.", place: "right" },
  { path: "/app/observability", target: '[data-tour="nav-/app/observability"]', title: "Observability", body: "Ingest rate, API latency by route, and every agent run with its tool calls.", place: "right" },
  { path: "/app/contacts", target: '[data-tour="nav-/app/contacts"]', title: "Escalation contacts", body: "The ladder Muse climbs: #1 gets email and the call first; no acknowledgement in two minutes → next contact. Quiet hours per person.", place: "right" },
  { path: "/app/settings", target: '[data-tour="nav-/app/settings"]', title: "Settings & API", body: "Organisation details, integrations status, email templates with a test send, blind evaluation of the agent, and the device sample client. That's the whole tour — Muse is one tap away whenever you need it.", place: "right" },
];

type TourCtx = { start: () => void; active: boolean };
const Ctx = createContext<TourCtx>({ start: () => {}, active: false });
export const useTour = () => useContext(Ctx);

export function TourProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [idx, setIdx] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const step = idx != null ? STEPS[idx] : null;

  const stop = useCallback(() => { setIdx(null); setRect(null); try { localStorage.setItem("bg.tour", "done"); } catch {} }, []);
  const start = useCallback(() => { setIdx(0); }, []);

  // navigate for the step, then keep measuring the target (layout shifts, lazy sections, scrolling)
  useEffect(() => {
    if (!step) return;
    if (pathname !== step.path) router.push(step.path);
    let scrolled = false;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(step.target);
      if (!el) { setRect(null); return; }
      if (!scrolled) { el.scrollIntoView({ block: "center", behavior: "smooth" }); scrolled = true; }
      setRect(el.getBoundingClientRect());
    };
    measure();
    timer.current = setInterval(measure, 250);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [step, pathname, router]);

  useEffect(() => {
    if (idx == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") stop(); if (e.key === "ArrowRight") setIdx((i) => (i == null ? i : Math.min(STEPS.length - 1, i + 1))); if (e.key === "ArrowLeft") setIdx((i) => (i == null ? i : Math.max(0, i - 1))); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, stop]);

  const value = useMemo(() => ({ start, active: idx != null }), [start, idx]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <AnimatePresence>
        {step && (
          <motion.div key="tour" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-[95]">
            {/* spotlight: the hole is the target's rect; everything else is dimmed by the giant shadow */}
            {rect ? (
              <motion.div layout transition={{ type: "spring", stiffness: 260, damping: 30 }} className="absolute rounded-2xl ring-2 ring-sky" style={{ left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16, boxShadow: "0 0 0 9999px rgba(11,26,51,.6)" }} />
            ) : (
              <div className="absolute inset-0 bg-ink/60" />
            )}
            <TourCard step={step} idx={idx!} rect={rect} onNext={() => (idx! >= STEPS.length - 1 ? stop() : setIdx(idx! + 1))} onBack={() => setIdx(Math.max(0, idx! - 1))} onStop={stop} />
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

function TourCard({ step, idx, rect, onNext, onBack, onStop }: { step: Step; idx: number; rect: DOMRect | null; onNext: () => void; onBack: () => void; onStop: () => void }) {
  const W = 360;
  let left = 24, top = 24;
  if (rect && typeof window !== "undefined") {
    const vw = window.innerWidth, vh = window.innerHeight;
    const place = step.place ?? (rect.bottom + 200 < vh ? "bottom" : "top");
    if (place === "right") { left = Math.min(vw - W - 16, rect.right + 20); top = Math.max(16, Math.min(vh - 220, rect.top)); }
    else if (place === "left") { left = Math.max(16, rect.left - W - 20); top = Math.max(16, Math.min(vh - 220, rect.top - 60)); }
    else if (place === "top") { left = Math.max(16, Math.min(vw - W - 16, rect.left)); top = Math.max(16, rect.top - 190); }
    else { left = Math.max(16, Math.min(vw - W - 16, rect.left)); top = Math.min(vh - 200, rect.bottom + 20); }
  }
  return (
    <motion.div key={idx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, left, top }} transition={{ type: "spring", stiffness: 260, damping: 28 }} className="pointer-events-auto absolute rounded-2xl border border-line bg-white p-4 shadow-[0_24px_60px_-20px_rgba(11,26,51,.6)]" style={{ width: W }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-blue text-white"><Compass size={14} /></span><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Tour · {idx + 1} / {STEPS.length}</p></div>
        <button onClick={onStop} className="rounded p-1 text-muted hover:text-ink" aria-label="End tour"><X size={16} /></button>
      </div>
      <p className="mt-2 font-display text-xl font-semibold text-ink">{step.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{step.body}</p>
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-sky-soft"><div className="h-full rounded-full bg-blue transition-[width]" style={{ width: `${((idx + 1) / STEPS.length) * 100}%` }} /></div>
      <div className="mt-3 flex items-center justify-between">
        <button onClick={onStop} className="text-xs text-muted hover:text-ink">Skip tour</button>
        <div className="flex gap-2">
          <button onClick={onBack} disabled={idx === 0} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"><ArrowLeft size={12} /> Back</button>
          <button onClick={onNext} className="inline-flex items-center gap-1 rounded-full bg-blue px-3 py-1.5 text-xs font-semibold text-white">{idx >= STEPS.length - 1 ? "Finish" : "Next"} <ArrowRight size={12} /></button>
        </div>
      </div>
    </motion.div>
  );
}

/** Header button. */
export function TourButton() {
  const { start, active } = useTour();
  return (
    <button onClick={start} disabled={active} data-tour="tour-button" className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-blue/50 hover:text-blue disabled:opacity-50">
      <Compass size={14} className="text-blue" /> <span className="hidden sm:inline">Tour guide</span>
    </button>
  );
}
