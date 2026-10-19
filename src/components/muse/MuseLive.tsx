"use client";

/**
 * Muse copilot runtime: streaming chat (SSE), realtime voice (Gemini Live over a websocket relay) and
 * dashboard navigation/highlighting driven by Muse's tool calls. Lives in the Shell so a voice session
 * survives page changes.
 */

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/Toast";
import { apiToken, BACKEND_URL, get } from "@/lib/api";

const QUIPS = ["Yesss boss! Taking you there…", "On it, boss — spotlight's on it.", "Boss, this way 👉", "Done, boss. Highlighted in yellow.", "Ekdum, boss — right here."];

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
  outLevel: number;
  startVoice: () => Promise<void>;
  stopVoice: () => void;
  goTo: (path: string, highlight?: string | null) => void;
  highlight: string | null;
  lastNav: NavCmd | null;
  editedTick: number;
  lastEdit: { what: string; label: string } | null;
  lang: "en" | "hi" | "hinglish";
  setLang: (l: "en" | "hi" | "hinglish") => void;
};

const Ctx = createContext<MuseCtx | null>(null);
export const useMuse = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useMuse outside MuseLiveProvider");
  return c;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const WS_BASE = BACKEND_URL.replace(/^http/, "ws");

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
  const { toast } = useToast();
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
  const [outLevel, setOutLevel] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [lastNav, setLastNav] = useState<NavCmd | null>(null);
  const [editedTick, setEditedTick] = useState(0);
  const [lang, setLangState] = useState<"en" | "hi" | "hinglish">("en");
  useEffect(() => { try { const l = localStorage.getItem("muse.lang"); if (l === "hi" || l === "hinglish" || l === "en") setLangState(l); } catch {} }, []);
  const setLang = useCallback((l: "en" | "hi" | "hinglish") => { setLangState(l); try { localStorage.setItem("muse.lang", l); } catch {} }, []);
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);
  const [lastEdit, setLastEdit] = useState<{ what: string; label: string } | null>(null);
  const onEdited = useCallback((what: string, label: string) => { setLastEdit({ what, label }); setEditedTick((t) => t + 1); }, []);
  const hlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTo = useCallback((path: string, hl?: string | null, quiet = false) => {
    setLastNav({ type: "navigate", path, highlight: hl ?? null });
    if (!quiet) toast("info", QUIPS[Math.floor(Math.random() * QUIPS.length)], hl ? "Look for the yellow spotlight." : undefined, 3500);
    if (hl) {
      setHighlight(hl);
      if (hlTimer.current) clearTimeout(hlTimer.current);
      hlTimer.current = setTimeout(() => setHighlight(null), 14000);
    }
    if (pathRef.current !== path) router.push(path);
  }, [router, toast]);

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
      const token = await apiToken().catch(() => "");
      const res = await fetch(token ? `${BACKEND_URL}/api/muse/chat` : "/api/muse/chat", { method: "POST", credentials: token ? "omit" : "include", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, text: m.text })), page: pathRef.current, lang: langRef.current }) });
      if (!res.ok || !res.body) throw new Error(`Muse is unavailable (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const apply = (ev: Record<string, unknown>) => {
        if (ev.type === "delta") setMessages((ms) => ms.map((m) => (m.id === reply.id ? { ...m, text: m.text + String(ev.text) } : m)));
        else if (ev.type === "tool") setMessages((ms) => ms.map((m) => (m.id === reply.id ? { ...m, tool: String(ev.name) } : m)));
        else if (ev.type === "navigate") goTo(String(ev.path), (ev.highlight as string | null) ?? null);
        else if (ev.type === "edited") { toast("success", "Updated", String(ev.label), 4500); onEdited(String(ev.what), String(ev.label)); goTo(String(ev.path), (ev.highlight as string | null) ?? null, true); }
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
  }, [messages, busy, goTo, toast, onEdited]);

  const reset = useCallback(() => setMessages(greeting ? [{ id: uid(), role: "muse", text: greeting.text, action: greeting.action }] : []), [greeting]);

  /* ---------- voice (Gemini Live relay) ---------- */
  const wsRef = useRef<WebSocket | null>(null);
  const micCtx = useRef<AudioContext | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const outCtx = useRef<AudioContext | null>(null);
  const playHead = useRef(0);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const speakingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Silence watchdog: the realtime session (and its Gemini Live minutes) ends after SILENCE_MS with nobody talking —
  // "activity" is the user's voice above a small threshold, or Muse still playing audio.
  const SILENCE_MS = 10000;
  const lastActivity = useRef(0);
  const silenceTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPlayback = useCallback(() => {
    for (const s of sources.current) { try { s.stop(); } catch {} }
    sources.current = [];
    playHead.current = 0;
  }, []);

  const stopVoice = useCallback(() => {
    if (silenceTimer.current) { clearInterval(silenceTimer.current); silenceTimer.current = null; }
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
    setOutLevel(0);
    setLiveCaption({ user: "", muse: "" });
  }, [stopPlayback]);

  const startVoice = useCallback(async () => {
    if (voice !== "off") return;
    setVoiceError(null);
    setVoice("connecting");
    const fail = (msg: string) => { console.error("[muse voice]", msg); setVoiceError(msg); stopVoice(); setVoice("error"); };
    // 1. short-lived token from the backend (through the Next proxy, cookie auth)
    let token = "";
    try { token = (await get<{ token: string }>("/api/muse/live-token")).token; }
    catch (e) { return fail(`Could not get a voice token: ${e instanceof Error ? e.message : String(e)}. Is the backend running on :8000?`); }
    // 2. microphone
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { return fail(`Microphone blocked: ${e instanceof Error ? e.message : String(e)}. Allow the mic for this site (lock icon in the address bar) and try again.`); }
    micStream.current = stream;
    // 3. speaker context (created inside the click so autoplay rules allow it)
    try {
      const out = new AudioContext({ sampleRate: 24000 });
      outCtx.current = out;
      await out.resume();
    } catch (e) { return fail(`Audio output failed: ${e instanceof Error ? e.message : String(e)}`); }
    // 4. websocket relay straight to the backend (Next rewrites don't carry websockets)
    const url = `${WS_BASE}/api/muse/live?token=${encodeURIComponent(token)}&page=${encodeURIComponent(pathRef.current)}&lang=${langRef.current}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
      wsRef.current = ws;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out after 10 s")), 10000);
        ws.onopen = () => { clearTimeout(timer); resolve(); };
        ws.onerror = () => { clearTimeout(timer); reject(new Error("connection refused")); };
        ws.onclose = (ev) => { clearTimeout(timer); reject(new Error(`closed (${ev.code})${ev.code === 4401 ? " — token rejected" : ""}`)); };
      });
    } catch (e) { return fail(`Voice relay ${WS_BASE} unreachable: ${e instanceof Error ? e.message : String(e)}. Check the backend is up and NEXT_PUBLIC_BACKEND_URL points at it.`); }
    ws.onclose = (ev) => { if (wsRef.current === ws) { if (ev.code !== 1000 && ev.code !== 1005) setVoiceError(`Voice ended (${ev.code}${ev.reason ? ": " + ev.reason : ""})`); stopVoice(); } };
    ws.onerror = () => { /* surfaced through onclose */ };
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
        let acc = 0;
        for (let i = 0; i < f32.length; i += 16) acc += f32[i] * f32[i];
        const rms = Math.sqrt(acc / (f32.length / 16));
        const delay = Math.max(0, (playHead.current - ctx.currentTime) * 1000);
        setTimeout(() => setOutLevel(Math.min(1, rms * 5)), delay);
        setTimeout(() => setOutLevel((v) => v * 0.4), delay + Math.max(80, (f32.length / 24000) * 1000));
        const buf = ctx.createBuffer(1, f32.length, 24000);
        buf.copyToChannel(f32, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        const at = Math.max(ctx.currentTime + 0.02, playHead.current);
        src.start(at);
        playHead.current = at + buf.duration;
        lastActivity.current = Math.max(lastActivity.current, Date.now() + (playHead.current - ctx.currentTime) * 1000);
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
      } else if (t === "edited") {
        toast("success", "Updated", String(msg.label), 4500);
        onEdited(String(msg.what), String(msg.label));
        goTo(String(msg.path), (msg.highlight as string | null) ?? null, true);
      } else if (t === "error") {
        setVoiceError(String(msg.text));
        setVoice("error");
      }
    };
    // 5. mic → 16 kHz PCM16 → relay (resample in JS when the browser refuses a 16 kHz context)
    try {
      let mic: AudioContext;
      try { mic = new AudioContext({ sampleRate: 16000 }); } catch { mic = new AudioContext(); }
      micCtx.current = mic;
      await mic.resume();
      const ratio = mic.sampleRate / 16000;
      const srcNode = mic.createMediaStreamSource(stream);
      const proc = mic.createScriptProcessor(4096, 1, 1);
      const silent = mic.createGain();
      silent.gain.value = 0;
      proc.onaudioprocess = (e) => {
        const f = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < f.length; i += 8) sum += f[i] * f[i];
        const rms = Math.sqrt(sum / (f.length / 8));
        if (rms > 0.015) lastActivity.current = Math.max(lastActivity.current, Date.now());
        setLevel(Math.min(1, rms * 6));
        let out: Float32Array = f;
        if (ratio > 1.01) {
          const n = Math.floor(f.length / ratio);
          out = new Float32Array(n);
          for (let i = 0; i < n; i++) out[i] = f[Math.floor(i * ratio)];
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "audio", data: floatToPcm16Base64(out) }));
      };
      srcNode.connect(proc);
      proc.connect(silent);
      silent.connect(mic.destination);
      lastActivity.current = Date.now();
      if (silenceTimer.current) clearInterval(silenceTimer.current);
      silenceTimer.current = setInterval(() => {
        if (wsRef.current !== ws) return;
        if (Date.now() - lastActivity.current > SILENCE_MS) {
          stopVoice();
          setVoiceError("Voice closed after 10 seconds of silence. Tap the button to talk again.");
        }
      }, 1000);
    } catch (e) { return fail(`Microphone capture failed: ${e instanceof Error ? e.message : String(e)}`); }
  }, [voice, goTo, stopPlayback, stopVoice, toast, onEdited]);

  useEffect(() => () => { wsRef.current?.close(); micStream.current?.getTracks().forEach((t) => t.stop()); }, []);

  const value = useMemo<MuseCtx>(() => ({ messages, busy, send, reset, greeting, voice, voiceError, captions, liveCaption, level, outLevel, startVoice, stopVoice, goTo, highlight, lastNav, editedTick, lastEdit, lang, setLang }),
    [messages, busy, send, reset, greeting, voice, voiceError, captions, liveCaption, level, outLevel, startVoice, stopVoice, goTo, highlight, lastNav, editedTick, lastEdit, lang, setLang]);
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

/** Wrap any block so Muse can spotlight it: <Spot k="checks">…</Spot> (keys are listed in the backend SECTIONS map). */
export function Spot({ k, children, className = "" }: { k: string; children: ReactNode; className?: string }) {
  const hl = useHighlight(k);
  return <div data-hl={k} className={`rounded-2xl ${hl.className} ${className}`}>{children}</div>;
}
