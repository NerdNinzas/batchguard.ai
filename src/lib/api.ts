"use client";

import { useEffect, useRef, useState } from "react";

/** JSON fetch against the Python backend (same-origin via Next rewrites, so cookies just work). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    credentials: "include",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
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
  return res.json();
}

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
export type Latest = Record<string, { value: number; unit?: string | null; ts: number; state: "normal" | "warning" | "critical" }>;
export type Machine = {
  id: string; org_id: string; line_id: string | null; name: string; type: string; location: string; status: string; device_id: string;
  api_key_prefix?: string | null; manual_name?: string | null; knowledge: Knowledge[]; source: string; verified: number; verified_at?: number | null;
  position: number; health: number; last_seen?: number | null; created_at: number; parameters: Parameter[]; latest: Latest;
  endpoint?: string; code?: Record<string, string>; api_key?: string;
};
export type Signal = { parameter: string; layer: string; severity: string; value: number | null; message: string; ts: number; [k: string]: unknown };
export type Evidence = { observation: string; supports: boolean; parameter?: string | null; value?: number | null; source: string };
export type Cause = { name: string; support: string; rationale: string; evidence_for: Evidence[]; evidence_against: Evidence[]; missing_data: string[] };
export type Report = { summary: string; severity: string; timeline: { t: string; what: string }[]; causes: Cause[]; checks: { order: number; action: string; discriminates: string; safety: string }[]; missing_data: string[]; call_script: string; cross_machine?: string | null; guardrail?: { unverified_numbers_removed: string[]; schema: string } };
export type Incident = {
  id: string; org_id: string; machine_id: string; severity: string; status: string; title: string; opened_at: number; acknowledged_at?: number | null;
  acknowledged_by?: string | null; resolved_at?: number | null; signals: Signal[]; report: Report | null; report_source?: string | null;
  feedback?: { verdict: string; actual_cause: string; fix: string } | null; escalation_level: number; machine?: { name: string; device_id: string; type: string };
  runs?: { id: string; source: string; ok: number; error?: string | null; started_at: number; finished_at?: number | null; tool_calls: { tool: string; stage?: string; args: Record<string, unknown> }[] }[];
  chat?: { id: string; role: string; text: string; ts: number }[];
  notifications?: Notification[];
};
/* ---------- voice AI (Dograh · Gemini Live realtime · TeleCMI) ---------- */
export type VoiceNumber = { id: number; config_id: number; config_name: string; provider: string; number: string; label: string | null; country: string | null; active: boolean; default_caller: boolean; telecmi: boolean };
export type VoiceWorkflowRef = { id: number; uuid: string | null; name: string; synced_at: number; version: number };
export type VoiceSettings = { org_id: string; telephony_configuration_id: number | null; from_phone_number_id: number | null; from_number: string | null; auto_dial: number; workflows: Record<string, VoiceWorkflowRef>; updated_at: number };
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
};
export type VoiceCall = {
  id: string; incident_id: string | null; contact_id: string | null; contact_name: string | null; call_type: string; title: string; to_number: string; from_number: string | null;
  workflow_id: number | null; workflow_uuid: string | null; run_id: number | null; run_name: string | null; status: string; duration_seconds: number | null; disposition: string | null;
  initial_context: Record<string, string>; gathered_context: Record<string, unknown> | null; transcript_url: string | null; recording_url: string | null; error: string | null;
  placed_by: string; created_at: number; updated_at: number; transcript?: string; incident?: { id: string; title: string; severity: string; status: string } | null;
};
export type Notification = { id: string; incident_id?: string | null; channel: string; contact_id?: string | null; to_addr?: string | null; subject: string; body: string; status: string; sent_at: number; read: number };

/* ---------- live stream ---------- */
export type LiveEvent = { type: "telemetry" | "incident" | "machine" | "event" | "notification" | "voice_call"; data: Record<string, unknown> & { [k: string]: unknown } };

/** Subscribe to the org's SSE stream. `onEvent` is called for every message; returns connection state. */
export function useLive(onEvent: (e: LiveEvent) => void, enabled = true) {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onEvent);
  useEffect(() => {
    cb.current = onEvent;
  });
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/stream", { withCredentials: true });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      try {
        cb.current(JSON.parse(m.data));
      } catch {}
    };
    return () => es.close();
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
