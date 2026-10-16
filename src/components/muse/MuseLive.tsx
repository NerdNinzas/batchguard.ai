"use client";

/**
 * Muse copilot runtime: streaming chat (SSE), realtime voice (Gemini Live over a websocket relay) and
 * dashboard navigation/highlighting driven by Muse's tool calls. Lives in the Shell so a voice session
 * survives page changes.
 */

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { get } from "@/lib/api";

export type ChatMsg = { id: string; role: "user" | "muse"; text: string; streaming?: boolean; tool?: string; action?: { label: string; path: string; highlight?: string | null } | null };
export type VoiceState = "off" | "connecting" | "listening" | "speaking" | "error";
type NavCmd = { type: "navigate"; path: string; highlight?: string | null; page?: string; reason?: string };

type MuseCtx = {
  messages: ChatMsg[];
  busy: boolean;
  send: (text: string) => Promise<void>;
  reset: () => void;
  greeting: { text: string; action: { label: string; path: string; highlight?: string | null } | null } | null;
  voice: VoiceState;
  voiceError: string | null;
  captions: { role: "user" | "muse"; text: string }[];
  liveCaption: { user: string; muse: string };
  level: number;
  startVoice: () => Promise<void>;
  stopVoice: () => void;
  goTo: (path: string, highlight?: string | null) => void;
  highlight: string | null;
  lastNav: NavCmd | null;
};

const Ctx = createContext<MuseCtx | null>(null);
export const useMuse = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useMuse outside MuseLiveProvider");
  return c;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");
const WS_BASE = BACKEND.replace(/^http/, "ws");

/* ---------- audio helpers ---------- */
function floatToPcm16Base64(f32: Float32Array): string {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  const bytes = new Uint8Array(i16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function pcm16Base64ToFloat(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const f32 = new Float32Array(new ArrayBuffer(i16.length * 4));
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
  return f32;
}

export function MuseLiveProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [greeting, setGreeting] = useState<MuseCtx["greeting"]>(null);
  const [voice, setVoice] = useState<VoiceState>("off");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<{ role: "user" | "muse"; text: string }[]>([]);
  const [liveCaption, setLiveCaption] = useState({ user: "", muse: "" });
  const [level, setLevel] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [lastNav, setLastNav] = useState<NavCmd | null>(null);
  const hlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTo = useCallback((path: string, hl?: string | null) => {
    setLastNav({ type: "navigate", path, highlight: hl ?? null });
    if (hl) {
      setHighlight(hl);
      if (hlTimer.current) clearTimeout(hlTimer.current);
      hlTimer.current = setTimeout(() => setHighlight(null), 14000);
    }
    if (pathRef.current !== path) router.push(path);
  }, [router]);

  /* ---------- greeting (once per session) ---------- */
  useEffect(() => {
    get<{ text: string; action: MuseCtx["greeting"] extends infer G ? (G extends { action: infer A } ? A : never) : never }>("/api/muse/greeting")
      .then((g) => {
        setGreeting({ text: g.text, action: g.action });
        setMessages((m) => (m.length ? m : [{ id: uid(), role: "muse", text: g.text, action: g.action }]));
      })
      .catch(() => setGreeting({ text: "Hi, I'm Muse. Ask me how the factory is running.", action: null }));
  }, []);

  /* ---------- streaming chat ---------- */
  const send = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || busy) return;
    const history = [...messages, { id: uid(), role: "user" as const, text: clean }];
    const reply: ChatMsg = { id: uid(), role: "muse", text: "", streaming: true };
    setMessages([...history, reply]);
    setBusy(true);
    try {
      const res = await fetch("/api/muse/chat", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, text: m.text })), page: pathRef.current }) });
      if (!res.ok || !res.body) throw new Error(`Muse is unavailable (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const apply = (ev: Record<string, unknown>) => {
        if (ev.type === "delta") setMessages((ms) => ms.map((m) => (m.id === reply.id ? { ...m, text: m.text + String(ev.text) } : m)));
        else if (ev.type === "tool") setMessages((ms) => ms.map((m) => (m.id === reply.id ? { ...m, tool: String(ev.name) } : m)));
        else if (ev.type === "navigate") goTo(String(ev.path), (ev.highlight as string | null) ?? null);
        else if (ev.type === "error") setMessages((ms) => ms.map((m) => (m.id === reply.id ? { ...m, text: m.text || String(ev.text) } : m)));
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const block of parts) {
          for (const line of block.split("\n")) {
            if (line.startsWith("data:")) { try { apply(JSON.parse(line.slice(5).trim())); } catch {} }
          }
        }
      }
    } catch (e) {
      setMessages((ms) => ms.map((m) => (m.id === reply.id ? { ...m, text: m.text || (e instanceof Error ? e.message : "Something went wrong") } : m)));
    } finally {
      setMessages((ms) => ms.map((m) => (m.id === reply.id ? { ...m, streaming: false, tool: undefined } : m)));
      setBusy(false);
    }
  }, [messages, busy, goTo]);

  const reset = useCallback(() => setMessages(greeting ? [{ id: uid(), role: "muse", text: greeting.text, action: greeting.action }] : []), [greeting]);

  /* ---------- voice (Gemini Live relay) ---------- */
  const wsRef = useRef<WebSocket | null>(null);
  const micCtx = useRef<AudioContext | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const outCtx = useRef<AudioContext | null>(null);
  const playHead = useRef(0);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const speakingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPlayback = useCallback(() => {
    for (const s of sources.current) { try { s.stop(); } catch {} }
    sources.current = [];
    playHead.current = 0;
  }, []);

  const stopVoice = useCallback(() => {
    try { wsRef.current?.send(JSON.stringify({ type: "end" })); } catch {}
    wsRef.current?.close();
    wsRef.current = null;
    micStream.current?.getTracks().forEach((t) => t.stop());
    micStream.current = null;
    micCtx.current?.close().catch(() => {});
    micCtx.current = null;
    stopPlayback();
    outCtx.current?.close().catch(() => {});
    outCtx.current = null;
    setVoice("off");
    setLevel(0);
    setLiveCaption({ user: "", muse: "" });
  }, [stopPlayback]);

  const startVoice = useCallback(async () => {
    if (voice !== "off") return;
    setVoiceError(null);
    setVoice("connecting");
    try {
      const { token } = await get<{ token: string }>("/api/muse/live-token");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      micStream.current = stream;
      const out = new AudioContext({ sampleRate: 24000 });
      outCtx.current = out;
      await out.resume();
      const ws = new WebSocket(`${WS_BASE}/api/muse/live?token=${encodeURIComponent(token)}&page=${encodeURIComponent(pathRef.current)}`);
      wsRef.current = ws;
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("Could not reach the voice relay. Is the backend running?"));
      });
      ws.onclose = () => { if (wsRef.current === ws) stopVoice(); };
      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const t = msg.type;
        if (t === "ready") {
          setVoice("listening");
          ws.send(JSON.stringify({ type: "text", text: "(The user just opened voice mode. Greet them in two short sentences with how the factory is running right now, then offer the most urgent thing — an open incident if any.)" }));
        } else if (t === "audio") {
          const f32 = pcm16Base64ToFloat(String(msg.data));
          const ctx = outCtx.current;
          if (!ctx) return;
          const buf = ctx.createBuffer(1, f32.length, 24000);
          buf.copyToChannel(f32, 0);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          const at = Math.max(ctx.currentTime + 0.02, playHead.current);
          src.start(at);
          playHead.current = at + buf.duration;
          sources.current.push(src);
          src.onended = () => { sources.current = sources.current.filter((s) => s !== src); };
          setVoice("speaking");
          if (speakingTimer.current) clearTimeout(speakingTimer.current);
          speakingTimer.current = setTimeout(() => setVoice((v) => (v === "speaking" ? "listening" : v)), Math.max(200, (playHead.current - ctx.currentTime) * 1000 + 150));
        } else if (t === "interrupted") {
          stopPlayback();
          setVoice("listening");
          setLiveCaption((c) => ({ ...c, muse: "" }));
        } else if (t === "caption") {
          const role = msg.role === "user" ? "user" : "muse";
          const text = String(msg.text ?? "");
          setLiveCaption((c) => ({ ...c, [role]: (c[role] + text).slice(-400) }));
        } else if (t === "turn_complete") {
          setLiveCaption((c) => {
            const out: { role: "user" | "muse"; text: string }[] = [];
            if (c.user.trim()) out.push({ role: "user", text: c.user.trim() });
            if (c.muse.trim()) out.push({ role: "muse", text: c.muse.trim() });
            if (out.length) setCaptions((cs) => [...cs, ...out].slice(-40));
            return { user: "", muse: "" };
          });
        } else if (t === "navigate") {
          goTo(String(msg.path), (msg.highlight as string | null) ?? null);
        } else if (t === "error") {
          setVoiceError(String(msg.text));
          setVoice("error");
        }
      };
      // mic → 16 kHz PCM16 → relay
      const mic = new AudioContext({ sampleRate: 16000 });
      micCtx.current = mic;
      const srcNode = mic.createMediaStreamSource(stream);
      const proc = mic.createScriptProcessor(2048, 1, 1);
      const silent = mic.createGain();
      silent.gain.value = 0;
      proc.onaudioprocess = (e) => {
        const f = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < f.length; i += 8) sum += f[i] * f[i];
        setLevel(Math.min(1, Math.sqrt(sum / (f.length / 8)) * 6));
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "audio", data: floatToPcm16Base64(f) }));
      };
      srcNode.connect(proc);
      proc.connect(silent);
      silent.connect(mic.destination);
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : String(e));
      setVoice("error");
      stopVoice();
      setVoice("error");
    }
  }, [voice, goTo, stopPlayback, stopVoice]);

  useEffect(() => () => { wsRef.current?.close(); micStream.current?.getTracks().forEach((t) => t.stop()); }, []);

  const value = useMemo<MuseCtx>(() => ({ messages, busy, send, reset, greeting, voice, voiceError, captions, liveCaption, level, startVoice, stopVoice, goTo, highlight, lastNav }),
    [messages, busy, send, reset, greeting, voice, voiceError, captions, liveCaption, level, startVoice, stopVoice, goTo, highlight, lastNav]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Yellow highlight for an element Muse navigated to. Put `data-hl={id}` on the element so it scrolls into view. */
export function useHighlight(id: string | null | undefined) {
  const { highlight } = useMuse();
  const on = Boolean(id) && highlight === id;
  useEffect(() => {
    if (!on || !id) return;
    const t = setTimeout(() => document.querySelector<HTMLElement>(`[data-hl="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 150);
    return () => clearTimeout(t);
  }, [on, id]);
  return { on, className: on ? "muse-highlight" : "" };
}
