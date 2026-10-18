"use client";

import { useEffect, useRef, useState } from "react";

/** JSON fetch against the Python backend (same-origin via Next rewrites, so cookies just work). */
export const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const _cache = new Map<string, unknown>();
/** Last known GET result for a path (so a page can render instantly while it refetches). */
export function cached<T>(path: string): T | null { return (_cache.get(path) as T) ?? null; }
export function invalidate(prefix = "") { for (const k of Array.from(_cache.keys())) if (k.startsWith(prefix)) _cache.delete(k); }

let _direct: { token: string; exp: number } | null = null;
async function directToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (_direct && _direct.exp > Date.now() + 60_000) return _direct.token;
  try {
    const r = await fetch("/api/auth/token", { credentials: "include" });
    if (!r.ok) return null;
    const d = (await r.json()) as { token: string; expires_in: number };
    _direct = { token: d.token, exp: Date.now() + d.expires_in * 1000 };
    return d.token;
  } catch { return null; }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const method = (rest.method || "GET").toUpperCase();
  // Auth endpoints and uploads keep using the cookie through the proxy; everything else talks to the backend origin
  // directly with a bearer token, which removes two network hops behind Firebase Hosting.
  const useDirect = !path.startsWith("/api/auth/") && !(rest.body instanceof FormData);
  const token = useDirect ? await directToken() : null;
  const body = json !== undefined ? JSON.stringify(json) : rest.body;
  const baseHeaders = { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(headers || {}) };
  let res: Response;
  try {
    res = await fetch(token ? `${BACKEND_URL}${path}` : path, {
      credentials: token ? "omit" : "include",
      ...rest,
      headers: { ...baseHeaders, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body,
    });
  } catch (err) {
    // The direct call never reached the backend (CORS, DNS, network). Fall back to the same-origin proxy with the cookie.
    if (!token) throw err;
    res = await fetch(path, { credentials: "include", ...rest, headers: baseHeaders, body });
  }
  if (!res.ok) {
    if (res.status === 401 && token) _direct = null;
    let msg = res.statusText;
    try {
      const d = await res.json();
      msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail ?? d);
    } catch {
      // Not JSON → the Next proxy could not reach the Python backend
      if (res.status >= 500) msg = "Backend not reachable. Start it with `npm run backend` (FastAPI on :8000).";
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json()) as T;
  if (method === "GET") _cache.set(path, data);
  else invalidate("/api/");
  return data;
}

/* ---------- direct backend access (streaming endpoints bypass the hosting/Next proxy) ---------- */
let _tok: { token: string; exp: number } | null = null;
/** Short-lived bearer token for calling the backend origin directly (cached, refreshed before expiry). */
export async function apiToken(): Promise<string> {
  const d = await directToken();
  if (d) return d;
  if (_tok && _tok.exp > Date.now() + 60_000) return _tok.token;
  const r = await api<{ token: string; expires_in: number }>("/api/auth/token");
  _tok = { token: r.token, exp: Date.now() + r.expires_in * 1000 };
  return r.token;
}
export const clearApiToken = () => { _tok = null; };

export const get = <T,>(p: string) => api<T>(p);
export const post = <T,>(p: string, json?: unknown) => api<T>(p, { method: "POST", json });
export const put = <T,>(p: string, json?: unknown) => api<T>(p, { method: "PUT", json });
export const del = <T,>(p: string) => api<T>(p, { method: "DELETE" });

/* ---------- types (mirror backend) ---------- */
export type User = { id: string; email: string; name: string; provider: string; photo_url?: string | null; org: Org | null };
export type Org = { id: string; name: string; owner_name: string; owner_email: string; phone: string; industry: string; size: string; timezone: string; use_cases: string[]; onboarded: number };
export type Contact = { id: string; name: string; role: string; phone: string; email: string; escalation_order: number; quiet_start?: string | null; quiet_end?: string | null };
export type Parameter = { id?: string; name: string; unit?: string | null; normal_min?: number | null; normal_max?: number | null; warn_low?: number | null; warn_high?: number | null; crit_low?: number | null; crit_high?: number | null; sample_rate?: number | null; source_page?: number | null; source_snippet?: string | null; confidence?: number | null; verified: boolean | number };
export type Knowledge = { title: string; page?: number | null; kind: string; text: string };
export type Forecast = { direction: "rising" | "falling"; slope_per_min: number; r2: number; warn_limit: number | null; crit_limit: number | null; eta_warn_seconds: number | null; eta_crit_seconds: number | null; computed_at: number };
export type Latest = Record<string, { value: number; unit?: string | null; ts: number; state: "normal" | "warning" | "critical"; forecast?: Forecast | null }>;
export type WorkOrder = { id: string; org_id: string; machine_id: string; incident_id: string | null; title: string; description: string; status: "open" | "in_progress" | "done"; priority: "low" | "medium" | "high" | "urgent"; assignee: string | null; due_at: number | null; source: string; position: number; created_by: string | null; created_at: number; updated_at: number; done_at: number | null; machine?: { name: string; device_id: string } };
export type EvidenceItem = { id: string; incident_id: string; machine_id: string; kind: string; filename: string | null; url: string; mime: string | null; caption: string | null; uploaded_by: string | null; ts: number; analysis: { description?: string; observations?: string[]; findings?: { cause: string; supports: boolean; rationale: string }[]; safety_flags?: string[]; confidence?: string; relevant?: boolean; model?: string | null; error?: string } };
/** The most urgent projected limit crossing across a machine's parameters (for cards). */
export function worstForecast(latest: Latest | undefined): { parameter: string; seconds: number; level: "warning" | "critical"; f: Forecast } | null {
  let best: { parameter: string; seconds: number; level: "warning" | "critical"; f: Forecast } | null = null;
  for (const [parameter, l] of Object.entries(latest ?? {})) {
    const f = l.forecast;
    if (!f) continue;
    const cands: { seconds: number; level: "warning" | "critical" }[] = [];
    if (f.eta_crit_seconds != null && f.eta_crit_seconds > 0) cands.push({ seconds: f.eta_crit_seconds, level: "critical" });
    if (f.eta_warn_seconds != null && f.eta_warn_seconds > 0 && l.state === "normal") cands.push({ seconds: f.eta_warn_seconds, level: "warning" });
    for (const c of cands) if (!best || c.seconds < best.seconds) best = { parameter, ...c, f };
  }
  return best;
}
export const fmtEta = (s: number) => (s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
export type Machine = {
  id: string; org_id: string; line_id: string | null; name: string; type: string; location: string; status: string; device_id: string;
  api_key_prefix?: string | null; manual_name?: string | null; knowledge: Knowledge[]; source: string; verified: number; verified_at?: number | null;
  position: number; health: number; last_seen?: number | null; created_at: number; parameters: Parameter[]; latest: Latest;
  endpoint?: string; code?: Record<string, string>; api_key?: string;
};
export type Signal = { parameter: string; layer: string; severity: string; value: number | null; message: string; ts: number; [k: string]: unknown };
export type Evidence = { observation: string; supports: boolean; parameter?: string | null; value?: number | null; source: string };
export type Cause = { name: string; support: string; rationale: string; evidence_for: Evidence[]; evidence_against: Evidence[]; missing_data: string[] };
export type Report = { summary: string; severity: string; timeline: { t: string; what: string }[]; causes: Cause[]; checks: { order: number; action: string; discriminates: string; safety: string }[]; missing_data: string[]; call_script: string; cross_machine?: string | null; guardrail?: { unverified_numbers_removed: string[]; schema: string }; photo_evidence?: { id: string; caption?: string | null; description?: string; confidence?: string; safety_flags?: string[] }[] };
export type Incident = {
  id: string; org_id: string; machine_id: string; severity: string; status: string; title: string; opened_at: number; acknowledged_at?: number | null;
  acknowledged_by?: string | null; resolved_at?: number | null; resolved_reason?: string | null; shutdown_at?: number | null; shutdown_state?: "pending" | "warned" | "done" | "cancelled" | null; signals: Signal[]; report: Report | null; report_source?: string | null;
  feedback?: { verdict: string; actual_cause: string; fix: string } | null; escalation_level: number; machine?: { name: string; device_id: string; type: string };
  runs?: { id: string; source: string; ok: number; error?: string | null; started_at: number; finished_at?: number | null; tool_calls: { tool: string; stage?: string; args: Record<string, unknown> }[] }[];
  chat?: { id: string; role: string; text: string; ts: number }[];
  notifications?: Notification[];
  evidence?: EvidenceItem[];
  work_orders?: WorkOrder[];
};
/* ---------- voice AI (Dograh · Gemini Live realtime · TeleCMI) ---------- */
export type VoiceNumber = { id: number; config_id: number; config_name: string; provider: string; number: string; label: string | null; country: string | null; active: boolean; default_caller: boolean; telecmi: boolean };
export type VoiceWorkflowRef = { id: number; uuid: string | null; name: string; synced_at: number; version: number };
export type VoiceSettings = { org_id: string; telephony_configuration_id: number | null; from_phone_number_id: number | null; from_number: string | null; auto_dial: number; auto_shutdown?: number; shutdown_after_seconds?: number; workflows: Record<string, VoiceWorkflowRef>; updated_at: number };
export type VoiceStatus = {
  enabled: boolean; host: string | null; realtime_model: string; settings: VoiceSettings;
  telephony: { configs: { id: number; name: string; provider: string; connectivity: string; is_default_outbound: boolean; is_ready_for_outbound: boolean; phone_number_count: number; outbound_blocked_reason: string | null }[]; numbers: VoiceNumber[]; error: string | null };
  call_types: { key: string; title: string; synced: VoiceWorkflowRef | null }[];
  contacts: { id: string; name: string; role: string; phone: string; escalation_order: number }[];
};
export type WfNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> };
export type WfEdge = { id: string; source: string; target: string; data?: { label?: string; condition?: string } };
export type CallType = {
  key: string; title: string; icon: string; tone: string; description: string; trigger: string; severity: string[];
  variables: { name: string; description: string; example: string }[]; template_variables: { name: string; default: string }[];
  workflow_definition: { nodes: WfNode[]; edges: WfEdge[] }; synced: VoiceWorkflowRef | null;
  scenarios: { key: string; label: string; severity: string; context: Record<string, string> }[];
};
export type VoiceCall = {
  id: string; incident_id: string | null; contact_id: string | null; contact_name: string | null; call_type: string; title: string; to_number: string; from_number: string | null;
  workflow_id: number | null; workflow_uuid: string | null; run_id: number | null; run_name: string | null; status: string; duration_seconds: number | null; disposition: string | null;
  initial_context: Record<string, string>; gathered_context: Record<string, unknown> | null; transcript_url: string | null; recording_url: string | null; error: string | null;
  placed_by: string; created_at: number; updated_at: number; outcome: Record<string, unknown>; telemetry: Record<string, unknown>;
  transcript?: string; turns?: { ts: string; role: string; text: string }[]; incident?: { id: string; title: string; severity: string; status: string } | null;
};
export type Notification = { id: string; incident_id?: string | null; channel: string; contact_id?: string | null; to_addr?: string | null; subject: string; body: string; status: string; sent_at: number; read: number };

/* ---------- live stream ---------- */
export type LiveEvent = { type: "telemetry" | "incident" | "machine" | "event" | "notification" | "voice_call" | "work_order" | "contact" | "org" | "parameter" | "voice_settings"; data: Record<string, unknown> & { [k: string]: unknown } };

/** Subscribe to the org's SSE stream. `onEvent` is called for every message; returns connection state. */
export function useLive(onEvent: (e: LiveEvent) => void, enabled = true) {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onEvent);
  useEffect(() => {
    cb.current = onEvent;
  });
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let closed = false;
    // connect straight to the backend with a token (works through Firebase Hosting, which buffers proxied streams)
    apiToken()
      .then((t) => {
        if (closed) return;
        es = new EventSource(`${BACKEND_URL}/api/stream?token=${encodeURIComponent(t)}`);
        es.onopen = () => setConnected(true);
        es.onerror = () => setConnected(false);
        es.onmessage = (m) => { try { cb.current(JSON.parse(m.data)); } catch {} };
      })
      .catch(() => {
        if (closed) return;
        es = new EventSource("/api/stream", { withCredentials: true });
        es.onopen = () => setConnected(true);
        es.onerror = () => setConnected(false);
        es.onmessage = (m) => { try { cb.current(JSON.parse(m.data)); } catch {} };
      });
    return () => { closed = true; es?.close(); };
  }, [enabled]);
  return connected;
}

/* ---------- helpers ---------- */
export const fmtTime = (ts?: number | null) => (ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
export const fmtAgo = (ts?: number | null) => {
  if (!ts) return "never";
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};
export const SEV_COLOR: Record<string, string> = { info: "blue", warning: "amber", critical: "red", emergency: "red", normal: "green", stale: "amber", offline: "muted" };

/** m:ss until a unix timestamp (0:00 when passed). */
export const fmtCountdown = (ts?: number | null, nowMs = Date.now()) => { const s = Math.max(0, Math.round((ts ?? 0) - nowMs / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
