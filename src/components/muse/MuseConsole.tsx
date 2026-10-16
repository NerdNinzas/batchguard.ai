"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, AudioLines, Mic, MicOff, RotateCcw, Send, Sparkles, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MuseFace, type Mood } from "./MuseFace";
import { useMuse } from "./MuseLive";
import { Button } from "@/components/ui/Primitives";

const SUGGEST = ["How is production running right now?", "Which machine is closest to a limit?", "Take me to the most urgent incident", "What should maintenance do first today?"];

function Markdownish({ text }: { text: string }) {
  // tiny renderer: paragraphs, bullets, **bold**
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

/** "Ask Muse how your factory is running": chat + voice, ChatGPT-style, for the top of the overview. */
export function MuseConsole() {
  const { messages, busy, send, reset, voice, voiceError, captions, liveCaption, level, startVoice, stopVoice, goTo } = useMuse();
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const voiceOn = voice !== "off";

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages, captions, liveCaption]);

  const mood: Mood = voice === "speaking" ? "talk" : voice === "listening" ? "happy" : busy ? "thinking" : messages.some((m) => m.streaming) ? "talk" : "grin";

  function submit() { const t = input; setInput(""); send(t); }

  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-[radial-gradient(circle_at_12%_0%,#e6f2ff,transparent_45%),linear-gradient(180deg,#ffffff,#f6f9ff)] shadow-[0_24px_60px_-30px_rgba(30,111,255,.45)]">
      <div className="grid lg:grid-cols-[300px_1fr]">
        {/* Muse side */}
        <div className="relative flex flex-col items-center justify-center gap-3 border-b border-line/70 p-6 lg:border-b-0 lg:border-r">
          <div className="relative">
            <AnimatePresence>
              {voiceOn && (
                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 + level * 0.35 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 200, damping: 18 }}
                  className={`absolute inset-[-18px] rounded-full ${voice === "speaking" ? "bg-blue/15" : "bg-green/15"}`} />
              )}
            </AnimatePresence>
            <motion.div animate={voice === "speaking" ? { y: [0, -3, 0] } : busy ? { rotate: [0, -3, 3, 0] } : { y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: voice === "speaking" ? 0.5 : 2.6, ease: "easeInOut" }}>
              <MuseFace size={150} mood={mood} />
            </motion.div>
          </div>
          <div className="text-center">
            <p className="font-display text-2xl font-semibold text-ink">Ask Muse</p>
            <p className="text-sm text-muted">how your factory is running</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${voice === "speaking" ? "bg-blue animate-pulse" : voice === "listening" ? "bg-green animate-pulse" : voice === "connecting" ? "bg-amber animate-pulse" : voice === "error" ? "bg-red" : busy ? "bg-amber animate-pulse" : "bg-green"}`} />
            {voice === "speaking" ? "Muse is speaking" : voice === "listening" ? "Listening · Gemini Live" : voice === "connecting" ? "Connecting voice…" : voice === "error" ? "Voice error" : busy ? "Thinking…" : "Gemini · online"}
          </div>
          {!voiceOn ? (
            <Button onClick={startVoice} size="lg" className="w-full"><Mic size={18} /> Start voice</Button>
          ) : (
            <Button onClick={stopVoice} size="lg" variant="danger" className="w-full"><MicOff size={18} /> End voice</Button>
          )}
          <p className="text-center text-[11px] text-muted">{voiceOn ? "Talk naturally. Say “take me to the incident” and Muse will navigate and highlight it." : "Realtime voice with Gemini Live. Muse talks, answers and can navigate the dashboard for you."}</p>
          {voiceError && <p className="rounded-xl border border-red/30 bg-red/5 p-2 text-center text-[11px] text-red">{voiceError}</p>}
        </div>

        {/* conversation */}
        <div className="flex min-h-[420px] flex-col">
          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-5" style={{ maxHeight: 460 }}>
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "muse" && <div className="mr-2 mt-1 hidden shrink-0 sm:block"><MuseFace size={30} mood="happy" track={false} hat={false} /></div>}
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
              <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} rows={1} placeholder={voiceOn ? "Voice is live — you can still type…" : "Ask anything about the factory… e.g. “why is the conveyor warm?”"}
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-white px-4 py-2.5 text-sm text-ink outline-none transition focus:border-blue" />
              <Button onClick={submit} loading={busy} disabled={!input.trim()}><Send size={16} /></Button>
              <Button variant="ghost" onClick={reset} aria-label="Reset chat"><RotateCcw size={16} /></Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Small floating bar while voice is live and the user has left the overview. */
export function MuseVoiceBar() {
  const { voice, liveCaption, captions, stopVoice, level } = useMuse();
  if (voice === "off") return null;
  const last = liveCaption.muse || liveCaption.user || captions[captions.length - 1]?.text || (voice === "connecting" ? "Connecting to Gemini Live…" : "Listening…");
  return (
    <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="fixed bottom-4 left-1/2 z-[80] flex w-[min(640px,92vw)] -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-white/95 px-3 py-2 shadow-[0_18px_50px_-20px_rgba(30,111,255,.6)] backdrop-blur">
      <div className="relative shrink-0">
        <span className={`absolute inset-[-6px] rounded-full ${voice === "speaking" ? "bg-blue/15" : "bg-green/15"}`} style={{ transform: `scale(${1 + level * 0.4})` }} />
        <MuseFace size={38} mood={voice === "speaking" ? "talk" : "happy"} track={false} hat={false} />
      </div>
      <p className="min-w-0 flex-1 truncate text-sm text-ink"><span className="mr-2 font-mono text-[10px] uppercase tracking-wider text-blue">{voice === "speaking" ? "Muse" : "Live"}</span>{last}</p>
      <button onClick={stopVoice} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red px-3 py-1.5 text-xs font-semibold text-white"><MicOff size={12} /> End</button>
    </motion.div>
  );
}
