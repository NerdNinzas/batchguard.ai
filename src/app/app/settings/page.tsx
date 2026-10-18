"use client";
import { Spot, useMuse } from "@/components/muse/MuseLive";

import { ExternalLink, Mail, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { Badge, Button, Card, Input, Select, Spinner, Stat } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { fmtAgo, get, post, type Machine } from "@/lib/api";

type Score = { runs: { id: string; machine_id: string; injected_fault: string; injected_at: number; detected: boolean; detect_delay: number | null; top1: boolean; top3: boolean; predicted: string[]; report_source?: string | null }[]; summary: { runs: number; detected: number; top1: number; top3: number; mean_detect_delay: number } };
type Health = { gemini: boolean; email: boolean; voice: boolean; vertex: boolean; cloud: { project: string | null; firestore: boolean; pubsub: boolean; bigquery: boolean; gcs: boolean } };
type EmailInfo = { enabled: boolean; from: string; templates: string[]; asset_base: string };
const TEMPLATE_LABEL: Record<string, string> = { incident_opened: "Incident opened", incident_escalated: "Escalation", report_ready: "Muse's report", incident_resolved: "Resolved", voice_summary: "Voice call summary", daily_digest: "Daily digest", welcome: "Welcome", test: "Test" };

function EmailCard({ email }: { email: EmailInfo | null }) {
  const { user } = useApp();
  const { toast } = useToast();
  const [preview, setPreview] = useState("incident_opened");
  const [sending, setSending] = useState(false);
  async function sendTest() {
    setSending(true);
    try {
      const r = await post<{ status: string; to: string; from: string }>("/api/notifications/test-email");
      if (r.status.startsWith("sent")) toast("success", `Test email sent to ${r.to}`, `from ${r.from}`);
      else if (r.status === "simulated") toast("warning", "Simulated — no RESEND_API_KEY yet", "Add the key to backend/.env and the same email goes out for real.");
      else toast("error", "Resend rejected the email", r.status);
    } catch (e) { toast("error", "Could not send", e instanceof Error ? e.message : String(e)); }
    finally { setSending(false); }
  }
  return (
    <Card title={<span className="flex items-center gap-2"><Mail size={18} className="text-blue" /> Email · Resend</span>} action={email && <Badge tone={email.enabled ? "green" : "amber"}>{email.enabled ? "live" : "simulated"}</Badge>}>
      {!email ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-3">
            <p className="text-sm text-muted">Every alert Muse sends is a branded template with the Muse portrait: incidents, escalations, the investigation report, resolutions, voice call summaries, the daily digest and the welcome mail.</p>
            <div className="rounded-xl border border-line bg-white p-3 text-xs"><p className="text-muted">From</p><p className="font-mono text-ink">{email.from}</p><p className="mt-2 text-muted">Images served from</p><p className="truncate font-mono text-ink" title={email.asset_base}>{email.asset_base}</p></div>
            <Button onClick={sendTest} loading={sending} className="w-full"><Send size={15} /> Send me a test email</Button>
            <p className="text-[11px] text-muted">Goes to the owner email, {user.org?.owner_email || user.email}. Every incident, report, resolution and call summary is copied there too. {email.enabled ? "" : "RESEND_API_KEY is empty, so the backend records it as simulated."}</p>
            <div className="flex flex-wrap gap-1.5">
              {email.templates.map((t) => <button key={t} onClick={() => setPreview(t)} className={`rounded-full border px-2.5 py-1 text-[11px] ${preview === t ? "border-blue bg-sky-soft text-blue" : "border-line bg-white text-muted hover:text-ink"}`}>{TEMPLATE_LABEL[t] ?? t}</button>)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted"><span>Preview · {TEMPLATE_LABEL[preview] ?? preview} (sample data)</span><a href={`/api/email/preview/${preview}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue hover:underline">open <ExternalLink size={11} /></a></div>
            <iframe title="email preview" src={`/api/email/preview/${preview}`} className="h-[520px] w-full rounded-2xl border border-line bg-[#f6f9ff]" sandbox="" />
          </div>
        </div>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { user, refreshUser, subscribe } = useApp();
  const { toast } = useToast();
  const [org, setOrg] = useState({ name: user.org?.name ?? "", owner_name: user.org?.owner_name ?? "", owner_email: user.org?.owner_email ?? "", phone: user.org?.phone ?? "", industry: user.org?.industry ?? "", size: user.org?.size ?? "", timezone: user.org?.timezone ?? "Asia/Singapore" });
  const [health, setHealth] = useState<Health | null>(null);
  const [email, setEmail] = useState<EmailInfo | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [run, setRun] = useState({ machine_id: "", injected_fault: "bearing_wear", note: "" });
  const { editedTick, lastEdit } = useMuse();
  useEffect(() => {
    if (!lastEdit || lastEdit.what !== "org") return;
    refreshUser().then(() => get<{ name: string; owner_name: string; owner_email: string; phone: string; industry: string; size: string; timezone: string }>("/api/org").then((o) => setOrg({ name: o.name, owner_name: o.owner_name, owner_email: o.owner_email, phone: o.phone, industry: o.industry, size: o.size, timezone: o.timezone })).catch(() => {}));
  }, [editedTick, lastEdit, refreshUser]);
  useEffect(() => subscribe((e) => {
    if (e.type === "org") { const o = e.data as Record<string, string>; setOrg((cur) => ({ ...cur, name: o.name ?? cur.name, owner_name: o.owner_name ?? cur.owner_name, owner_email: o.owner_email ?? cur.owner_email, phone: o.phone ?? cur.phone, industry: o.industry ?? cur.industry, timezone: o.timezone ?? cur.timezone })); refreshUser(); }
  }), [subscribe, refreshUser]);

  const loadScore = () => get<Score>("/api/eval/scoreboard").then(setScore);
  useEffect(() => {
    get<Health>("/api/health").then(setHealth);
    get<EmailInfo>("/api/email/templates").then(setEmail).catch(() => setEmail({ enabled: false, from: "", templates: [], asset_base: "" }));
    get<Machine[]>("/api/machines").then((ms) => { setMachines(ms); if (ms[0]) setRun((r) => ({ ...r, machine_id: ms[0].id })); });
    loadScore();
  }, []);

  async function saveOrg() { await post("/api/org", org); await refreshUser(); toast("success", "Organisation updated"); }
  async function addRun() { await post("/api/eval/runs", run); toast("info", "Blind run recorded", "Start the fault on the device now; the agent's first report after this timestamp is scored."); loadScore(); }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Spot k="org"><Card title="Organisation">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Name" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} className="sm:col-span-2" />
            <Input label="Owner" value={org.owner_name} onChange={(e) => setOrg({ ...org, owner_name: e.target.value })} />
            <Input label="Owner email" value={org.owner_email} onChange={(e) => setOrg({ ...org, owner_email: e.target.value })} />
            <Input label="Phone" value={org.phone} onChange={(e) => setOrg({ ...org, phone: e.target.value })} />
            <Input label="Industry" value={org.industry} onChange={(e) => setOrg({ ...org, industry: e.target.value })} />
          </div>
          <div className="mt-4 flex justify-end"><Button onClick={saveOrg}>Save</Button></div>
        </Card></Spot>
        <Spot k="integrations"><Card title="Integrations">
          {!health ? <Spinner /> : (
            <div className="space-y-2 text-sm">
              {[
                ["Gemini on Vertex AI (ADK agent, PDF extraction, call outcomes)", health.gemini, health.vertex ? "Vertex AI · GOOGLE_CLOUD_PROJECT" : "GOOGLE_API_KEY in backend/.env"],
                ["Firebase Auth (Google sign-in)", Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY), "NEXT_PUBLIC_FIREBASE_* in .env.local + FIREBASE_PROJECT_ID in backend/.env"],
                ["Email via Resend (Muse templates)", health.email, "RESEND_API_KEY / RESEND_FROM in backend/.env"],
                ["Voice escalation (Dograh · Gemini Live · TeleCMI)", health.voice, "DOGRAH_API_KEY in backend/.env · numbers on /app/voice"],
                ["Firestore · BigQuery · Pub/Sub · Cloud Storage", Boolean(health.cloud?.firestore), health.cloud?.project ? `project ${health.cloud.project}` : "GCP_PROJECT in backend/.env"],
              ].map(([k, ok, hint]) => (
                <div key={String(k)} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-white p-3"><div><p className="font-semibold text-ink">{k}</p><p className="text-xs text-muted">{hint}</p></div><Badge tone={ok ? "green" : "amber"}>{ok ? "enabled" : "off"}</Badge></div>
              ))}
            </div>
          )}
        </Card></Spot>
      </div>

      <Spot k="email"><EmailCard email={email} /></Spot>

      <Spot k="eval"><Card title="Blind evaluation" action={score && <Badge tone="violet">{score.summary.runs} run(s)</Badge>}>
        <p className="text-sm text-muted">Record the hidden fault label first (stored where the agent&apos;s tools cannot read it), then start the fault on the device. The first incident after that timestamp is scored against the label.</p>
        {score && (
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Stat label="Detected" value={`${Math.round(score.summary.detected * 100)}%`} tone="green" />
            <Stat label="Top-1" value={`${Math.round(score.summary.top1 * 100)}%`} tone="blue" />
            <Stat label="Top-3" value={`${Math.round(score.summary.top3 * 100)}%`} tone="violet" />
            <Stat label="Mean detect delay" value={`${score.summary.mean_detect_delay}s`} tone="amber" />
          </div>
        )}
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <Select label="Machine" value={run.machine_id} onChange={(e) => setRun({ ...run, machine_id: e.target.value })}>{machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
          <Select label="Injected fault" value={run.injected_fault} onChange={(e) => setRun({ ...run, injected_fault: e.target.value })}>{["bearing_wear", "fan_failure", "belt_slip", "jam", "overfeed", "sealer_heater", "sensor_failure"].map((f) => <option key={f}>{f}</option>)}</Select>
          <Input label="Note" value={run.note} onChange={(e) => setRun({ ...run, note: e.target.value })} placeholder="ramp 2 min" />
          <Button onClick={addRun} disabled={!run.machine_id}>Record blind run</Button>
        </div>
        {score && score.runs.length > 0 && (
          <table className="mt-4 w-full text-left text-xs"><thead className="font-mono text-[10px] uppercase tracking-wider text-muted"><tr><th className="py-1">when</th><th className="py-1">label</th><th className="py-1">predicted</th><th className="py-1">detected</th><th className="py-1">delay</th><th className="py-1">top-1</th><th className="py-1">top-3</th></tr></thead>
            <tbody>{score.runs.map((r) => <tr key={r.id} className="border-t border-line"><td className="py-1.5 text-muted">{fmtAgo(r.injected_at)}</td><td className="py-1.5 font-mono">{r.injected_fault}</td><td className="py-1.5">{r.predicted.join(" › ") || "—"}</td><td className="py-1.5">{r.detected ? "yes" : "no"}</td><td className="py-1.5 font-mono">{r.detect_delay ?? "—"}s</td><td className="py-1.5">{r.top1 ? "✓" : "✗"}</td><td className="py-1.5">{r.top3 ? "✓" : "✗"}</td></tr>)}</tbody></table>
        )}
      </Card></Spot>

      <Spot k="device-sample"><Card title="Device sample client">
        <p className="text-sm text-muted">A reference device that posts realistic readings every second (optionally with a fault ramp). Use the device ID and key from any verified machine.</p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-ink p-4 font-mono text-xs text-[#cfe3ff]">{`cd backend && .venv/bin/python scripts/device_sample.py \\
  --device <device_id> --key <api_key> --type conveyor --fault bearing_wear --ramp 120`}</pre>
      </Card></Spot>
    </div>
  );
}
