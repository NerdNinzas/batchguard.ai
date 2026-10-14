"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { Badge, Button, Card, Input, Select, Spinner, Stat } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { fmtAgo, get, post, type Machine } from "@/lib/api";

type Score = { runs: { id: string; machine_id: string; injected_fault: string; injected_at: number; detected: boolean; detect_delay: number | null; top1: boolean; top3: boolean; predicted: string[]; report_source?: string | null }[]; summary: { runs: number; detected: number; top1: number; top3: number; mean_detect_delay: number } };
type Health = { gemini: boolean; smtp: boolean };

export default function SettingsPage() {
  const { user, refreshUser } = useApp();
  const { toast } = useToast();
  const [org, setOrg] = useState({ name: user.org?.name ?? "", owner_name: user.org?.owner_name ?? "", owner_email: user.org?.owner_email ?? "", phone: user.org?.phone ?? "", industry: user.org?.industry ?? "", size: user.org?.size ?? "", timezone: user.org?.timezone ?? "Asia/Singapore" });
  const [health, setHealth] = useState<Health | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [run, setRun] = useState({ machine_id: "", injected_fault: "bearing_wear", note: "" });

  const loadScore = () => get<Score>("/api/eval/scoreboard").then(setScore);
  useEffect(() => {
    get<Health>("/api/health").then(setHealth);
    get<Machine[]>("/api/machines").then((ms) => { setMachines(ms); if (ms[0]) setRun((r) => ({ ...r, machine_id: ms[0].id })); });
    loadScore();
  }, []);

  async function saveOrg() { await post("/api/org", org); await refreshUser(); toast("success", "Organisation updated"); }
  async function addRun() { await post("/api/eval/runs", run); toast("info", "Blind run recorded", "Start the fault on the device now; the agent's first report after this timestamp is scored."); loadScore(); }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Organisation">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Name" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} className="sm:col-span-2" />
            <Input label="Owner" value={org.owner_name} onChange={(e) => setOrg({ ...org, owner_name: e.target.value })} />
            <Input label="Owner email" value={org.owner_email} onChange={(e) => setOrg({ ...org, owner_email: e.target.value })} />
            <Input label="Phone" value={org.phone} onChange={(e) => setOrg({ ...org, phone: e.target.value })} />
            <Input label="Industry" value={org.industry} onChange={(e) => setOrg({ ...org, industry: e.target.value })} />
          </div>
          <div className="mt-4 flex justify-end"><Button onClick={saveOrg}>Save</Button></div>
        </Card>
        <Card title="Integrations">
          {!health ? <Spinner /> : (
            <div className="space-y-2 text-sm">
              {[
                ["Gemini on Vertex AI / AI Studio (ADK agent, PDF extraction)", health.gemini, "GOOGLE_API_KEY in backend/.env"],
                ["Firebase Auth (Google sign-in)", Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY), "NEXT_PUBLIC_FIREBASE_* in .env.local + FIREBASE_PROJECT_ID in backend/.env"],
                ["Email escalation (SMTP)", health.smtp, "SMTP_HOST / SMTP_USER / SMTP_PASS in backend/.env"],
                ["Voice escalation (TeleCMI + Gemini Live)", false, "planned — TELECMI_* and GEMINI_LIVE_MODEL reserved"],
                ["Firestore · BigQuery · Pub/Sub · Cloud Storage", false, "local SQLite now; adapters land with GCP credentials"],
              ].map(([k, ok, hint]) => (
                <div key={String(k)} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-white p-3"><div><p className="font-semibold text-ink">{k}</p><p className="text-xs text-muted">{hint}</p></div><Badge tone={ok ? "green" : "amber"}>{ok ? "enabled" : "off"}</Badge></div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Blind evaluation" action={score && <Badge tone="violet">{score.summary.runs} run(s)</Badge>}>
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
      </Card>

      <Card title="Device sample client">
        <p className="text-sm text-muted">A reference device that posts realistic readings every second (optionally with a fault ramp). Use the device ID and key from any verified machine.</p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-ink p-4 font-mono text-xs text-[#cfe3ff]">{`cd backend && .venv/bin/python scripts/device_sample.py \\
  --device <device_id> --key <api_key> --type conveyor --fault bearing_wear --ramp 120`}</pre>
      </Card>
    </div>
  );
}
