"use client";

import { motion } from "framer-motion";
import { ArrowRight, AudioLines, MicOff, RotateCcw, Send, Sparkles, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMuse } from "./MuseLive";
import { Button } from "@/components/ui/Primitives";

const SUGGEST = ["How is production running right now?", "Which machine is closest to a limit?", "Take me to the most urgent incident", "Show me the compressor's pressure chart", "Where are the work orders?"];

function Markdownish({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((ln, i) => {
        const bullet = /^\s*[-*•]\s+/.test(ln);
        const body = ln.replace(/^\s*[-*•]\s+/, "").split(/(\*\*[^*]+\*\*)/g).map((seg, j) => (seg.startsWith("**") ? <strong key={j}>{seg.slice(2, -2)}</strong> : <span key={j}>{seg}</span>));
        if (!ln.trim()) return null;
        return bullet ? <p key={i} className="flex gap-2"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue" /><span>{body}</span></p> : <p key={i}>{body}</p>;
      })}
    </div>
  );
}

/* ---------- vibration bars: react to mic level (listening) or Muse's audio level (speaking) ---------- */
const BAR_WEIGHTS = [0.35, 0.6, 1, 0.75, 0.5, 0.85, 0.4];
export function VoiceBars({ level, active, speaking, size = 1, color = "bg-white" }: { level: number; active: boolean; speaking: boolean; size?: number; color?: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 90);
    return () => clearInterval(id);
  }, [active]);
  return (
    <div className="flex items-center justify-center gap-[3px]" style={{ height: 28 * size }}>
      {BAR_WEIGHTS.map((w, i) => {
        const jitter = active ? (Math.sin((tick + i * 1.7) * (speaking ? 1.9 : 1.1)) + 1) / 2 : 0;
        const amp = active ? Math.max(0.12, Math.min(1, (level * 1.2 + 0.15) * w * (0.55 + 0.45 * jitter))) : 0.18 * w + 0.1;
        return <motion.span key={i} animate={{ height: `${Math.round(amp * 100)}%` }} transition={{ duration: 0.09, ease: "linear" }} className={`w-[4px] rounded-full ${color}`} style={{ minHeight: 4 * size, width: 4 * size }} />;
      })}
    </div>
  );
}

/** The round voice button (as in the reference image): blue disc, white bars, dark rounded frame. */
export function VoiceButton({ size = 112, frame = true, rings = true }: { size?: number; frame?: boolean; rings?: boolean }) {
  const { voice, level, outLevel, startVoice, stopVoice } = useMuse();
  const on = voice !== "off";
  const speaking = voice === "speaking";
  const lvl = speaking ? outLevel : voice === "listening" ? level : 0;
  return (
    <button onClick={on ? stopVoice : startVoice} aria-label={on ? "End voice" : "Start voice"} className={`group relative grid place-items-center transition active:scale-95 ${frame ? "rounded-[28%] bg-[#0b1a33] shadow-[0_18px_40px_-18px_rgba(11,26,51,.9)]" : ""}`} style={frame ? { width: size * 1.45, height: size * 1.45 } : { width: size, height: size }}>
      {on && rings && <motion.span animate={{ scale: [1, 1.25 + lvl * 0.5, 1], opacity: [0.25, 0.05, 0.25] }} transition={{ repeat: Infinity, duration: speaking ? 0.7 : 1.6, ease: "easeInOut" }} className={`absolute rounded-full ${speaking ? "bg-blue" : "bg-green"}`} style={{ width: size, height: size }} />}
      <motion.span animate={{ scale: on ? 1 + lvl * 0.12 : 1 }} transition={{ duration: 0.08 }} className={`relative grid place-items-center rounded-full ${voice === "error" ? "bg-red" : voice === "connecting" ? "bg-amber" : on ? (speaking ? "bg-blue" : "bg-[#2b7fff]") : "bg-blue"} shadow-[inset_0_-6px_14px_rgba(0,0,0,.25),0_8px_24px_-8px_rgba(30,111,255,.9)]`} style={{ width: size, height: size }}>
        {on ? <VoiceBars level={lvl} active speaking={speaking} size={size / 56} /> : <VoiceBars level={0} active={false} speaking={false} size={size / 56} />}
      </motion.span>
      {frame && size >= 80 && <span className="pointer-events-none absolute -bottom-7 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.25em] text-muted opacity-0 transition group-hover:opacity-100">{on ? "tap to end" : "tap to talk"}</span>}
    </button>
  );
}

/** Square voice box: the round button inside a dark panel, with status + live transcript. */
export function VoicePanel() {
  const { voice, voiceError, captions, liveCaption, level, outLevel, stopVoice, lang, setLang } = useMuse();
  const voiceOn = voice !== "off";
  const speaking = voice === "speaking";
  const last = liveCaption.muse || liveCaption.user || captions[captions.length - 1]?.text || "";
  return (
    <div className="flex aspect-square w-full flex-col items-center justify-between rounded-3xl bg-[#0b1a33] p-5 text-white shadow-[0_24px_60px_-28px_rgba(11,26,51,.9)]">
      <div className="flex w-full items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/60">Muse · voice</p>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/70">
          <span className={`h-1.5 w-1.5 rounded-full ${speaking ? "bg-blue animate-pulse" : voice === "listening" ? "bg-green animate-pulse" : voice === "connecting" ? "bg-amber animate-pulse" : voice === "error" ? "bg-red" : "bg-white/40"}`} />
          {speaking ? "speaking" : voice === "listening" ? "listening" : voice === "connecting" ? "connecting" : voice === "error" ? "error" : "ready"}
        </span>
      </div>
      <div className="relative grid place-items-center py-2">
        {voiceOn && (
          <>
            <motion.span animate={{ scale: [1, 1.7 + (speaking ? outLevel : level) * 0.8], opacity: [0.2, 0] }} transition={{ repeat: Infinity, duration: speaking ? 0.9 : 1.8, ease: "easeOut" }} className={`absolute h-36 w-36 rounded-full ${speaking ? "bg-blue" : "bg-green"}`} />
            <motion.span animate={{ scale: [1, 1.35 + (speaking ? outLevel : level) * 0.6], opacity: [0.16, 0] }} transition={{ repeat: Infinity, duration: speaking ? 0.9 : 1.8, ease: "easeOut", delay: 0.3 }} className={`absolute h-36 w-36 rounded-full ${speaking ? "bg-blue" : "bg-green"}`} />
          </>
        )}
        <VoiceButton size={108} frame={false} />
      </div>
      <div className="w-full">
        <p className="min-h-[40px] text-center text-[13px] leading-snug text-white/85">
          {voiceError ? <span className="text-red">{voiceError}</span> : voiceOn ? (last ? <>{liveCaption.muse ? "" : last && !liveCaption.user ? "" : ""}{last}{(liveCaption.muse || liveCaption.user) && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-white/80 align-middle" />}</> : "Listening… say how can I help") : "Tap to talk to Muse — ask how the factory is running, or say where you want to go."}
        </p>
        <div className="mt-2 flex items-center justify-between text-[10px] text-white/50">
          <span className="flex items-center gap-1">Gemini Live · Umbriel ·
            {(["en", "hinglish", "hi"] as const).map((l) => <button key={l} onClick={() => setLang(l)} className={`rounded-full px-2 py-0.5 font-mono uppercase tracking-wider ${lang === l ? "bg-white/20 text-white" : "hover:text-white"}`}>{l === "en" ? "English" : l === "hi" ? "हिंदी" : "Hinglish"}</button>)}
          </span>
          {voiceOn && <button onClick={stopVoice} className="inline-flex items-center gap-1 rounded-full bg-red/90 px-2.5 py-1 font-semibold text-white"><MicOff size={11} /> End</button>}
        </div>
      </div>
    </div>
  );
}

/** ChatGPT-style chat with streaming replies. */
export function ChatPanel() {
  const { messages, busy, send, reset, voice, captions, liveCaption, goTo } = useMuse();
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const voiceOn = voice !== "off";
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages, captions, liveCaption]);
  function submit() { const t = input; setInput(""); send(t); }
  return (
    <section data-hl="muse" className="flex min-h-[420px] flex-col overflow-hidden rounded-3xl border border-line bg-[radial-gradient(circle_at_12%_0%,#e6f2ff,transparent_45%),linear-gradient(180deg,#ffffff,#f6f9ff)] shadow-[0_24px_60px_-30px_rgba(30,111,255,.45)]">
      <div className="flex items-center justify-between border-b border-line/70 px-5 py-3">
        <div><p className="font-display text-xl font-semibold text-ink">Ask Muse</p><p className="text-xs text-muted">how your factory is running · answers stream live, and Muse can take you anywhere on the dashboard</p></div>
        <span className="flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted"><span className={`h-1.5 w-1.5 rounded-full ${busy ? "bg-amber animate-pulse" : "bg-green"}`} />{busy ? "Thinking…" : "Gemini · online"}</span>
      </div>
      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-5" style={{ maxHeight: 440 }}>
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "muse" && <div className="mr-2 mt-1.5 hidden h-7 w-7 shrink-0 place-items-center rounded-full bg-blue sm:grid"><VoiceBars level={m.streaming ? 0.7 : 0} active={!!m.streaming} speaking={!!m.streaming} size={0.45} /></div>}
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed ${m.role === "user" ? "rounded-tr-md bg-blue text-white" : "rounded-tl-md border border-line bg-white text-ink shadow-[0_8px_24px_-16px_rgba(11,26,51,.4)]"}`}>
              {m.tool && m.streaming && <p className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-violet"><Wrench size={10} /> {m.tool.replace(/_/g, " ")}…</p>}
              {m.text ? <Markdownish text={m.text} /> : m.streaming ? <span className="inline-flex gap-1 py-1"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue [animation-delay:-.2s]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue [animation-delay:-.1s]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue" /></span> : null}
              {m.streaming && m.text && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-blue align-middle" />}
              {m.action && !m.streaming && (
                <button onClick={() => goTo(m.action!.path, m.action!.highlight)} className="mt-2 inline-flex items-center gap-1 rounded-full bg-sky-soft px-3 py-1 text-xs font-semibold text-blue hover:bg-blue hover:text-white">{m.action.label} <ArrowRight size={12} /></button>
              )}
            </div>
          </div>
        ))}
        {voiceOn && (captions.length > 0 || liveCaption.user || liveCaption.muse) && (
          <div className="rounded-2xl border border-dashed border-blue/30 bg-sky-soft/40 p-3">
            <p className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-blue"><AudioLines size={11} /> Live voice transcript</p>
            <div className="space-y-1 text-[13px]">
              {captions.slice(-6).map((c, i) => <p key={i} className={c.role === "user" ? "text-muted" : "text-ink"}><span className="font-mono text-[10px] uppercase">{c.role === "user" ? "you" : "muse"}</span> {c.text}</p>)}
              {liveCaption.user && <p className="text-muted"><span className="font-mono text-[10px] uppercase">you</span> {liveCaption.user}…</p>}
              {liveCaption.muse && <p className="text-ink"><span className="font-mono text-[10px] uppercase">muse</span> {liveCaption.muse}<span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-blue align-middle" /></p>}
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-line/70 p-4">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGEST.map((s) => <button key={s} onClick={() => send(s)} disabled={busy} className="rounded-full border border-line bg-white px-3 py-1 text-[11px] text-muted transition hover:border-blue/50 hover:text-blue disabled:opacity-50"><Sparkles size={10} className="mr-1 inline" />{s}</button>)}
        </div>
        <div className="flex items-end gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} rows={1} placeholder={voiceOn ? "Voice is live — you can still type…" : "Ask anything… “why is the conveyor warm?”, “show me the sealer's temperature”"}
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-white px-4 py-2.5 text-sm text-ink outline-none transition focus:border-blue" />
          <Button onClick={submit} loading={busy} disabled={!input.trim()}><Send size={16} /></Button>
          <Button variant="ghost" onClick={reset} aria-label="Reset chat"><RotateCcw size={16} /></Button>
        </div>
      </div>
    </section>
  );
}

/** Overview block: square voice box on the left, chat on the right. */
export function MuseConsole() {
  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <VoicePanel />
      <ChatPanel />
    </div>
  );
}

/** Fixed voice button on every page, sitting above the Muse chip in the corner. */
export function MuseVoiceFab() {
  const { voice } = useMuse();
  const on = voice !== "off";
  return (
    <div data-tour="voice-fab" className="fixed bottom-[92px] right-4 z-40">
      <VoiceButton size={56} frame={false} rings={false} />
      {on && <span className="absolute -left-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-green" />}
    </div>
  );
}

/** Small floating bar while voice is live and the user has left the overview. */
export function MuseVoiceBar() {
  const { voice, liveCaption, captions, stopVoice, level, outLevel } = useMuse();
  if (voice === "off") return null;
  const speaking = voice === "speaking";
  const last = liveCaption.muse || liveCaption.user || captions[captions.length - 1]?.text || (voice === "connecting" ? "Connecting to Gemini Live…" : "Listening, boss…");
  return (
    <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="fixed bottom-4 left-1/2 z-[80] flex w-[min(640px,92vw)] -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-white/95 px-2 py-2 shadow-[0_18px_50px_-20px_rgba(30,111,255,.6)] backdrop-blur">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${speaking ? "bg-blue" : "bg-green"}`}><VoiceBars level={speaking ? outLevel : level} active speaking={speaking} size={0.6} /></span>
      <p className="min-w-0 flex-1 truncate text-sm text-ink"><span className="mr-2 font-mono text-[10px] uppercase tracking-wider text-blue">{speaking ? "Muse" : "Live"}</span>{last}</p>
      <button onClick={stopVoice} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red px-3 py-1.5 text-xs font-semibold text-white"><MicOff size={12} /> End</button>
    </motion.div>
  );
}
