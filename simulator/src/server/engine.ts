/**
 * Virtual factory engine. Runs once inside the Next.js server process (started from instrumentation.ts).
 *
 * - signs in to BatchGuard as the demo owner, loads the org's machines and obtains a device key per machine
 * - every second computes each machine's parameters (baseline + controlled targets + noise) and POSTs them
 *   to BatchGuard's device API exactly like a real PLC gateway would
 * - the UI changes targets, triggers fault presets, stops/starts machines, adds/removes machines
 */

export type Param = { name: string; unit: string | null; normal_min: number | null; normal_max: number | null; warn_low: number | null; warn_high: number | null; crit_low: number | null; crit_high: number | null };
export type Control = { target: number; ramp_s: number; started_at: number; from: number };
export type SimMachine = {
  id: string; name: string; type: string; device_id: string; location: string;
  params: Param[];
  values: Record<string, number>;
  clean: Record<string, number>;      // noise-free state the physics acts on
  controls: Record<string, Control>;
  running: boolean;           // false → stops posting (sensor/gateway dropout → BatchGuard marks it stale)
  speed: number;              // production speed factor 0.2–1.5 (affects throughput-ish parameters)
  fault: string | null;       // active preset name
  key: string | null;
  last_post?: { ok: boolean; ms: number; at: number; signals: number; error?: string };
  counters: Record<string, number>;
};
export type FaultPreset = { key: string; label: string; types: string[]; description: string; apply: (m: SimMachine) => void };

const BG = (process.env.BATCHGUARD_URL || "http://localhost:8000").replace(/\/$/, "");
const EMAIL = process.env.DEMO_EMAIL || "demo@batchguard.ai";
const PASSWORD = process.env.DEMO_PASSWORD || "demo1234";

const now = () => Date.now() / 1000;
const gauss = (sd: number) => { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const mid = (p: Param) => (p.normal_min != null && p.normal_max != null ? (p.normal_min + p.normal_max) / 2 : p.warn_high != null ? p.warn_high * 0.8 : p.warn_low != null ? p.warn_low * 1.2 : 50);
const noiseOf = (p: Param) => { const span = p.normal_min != null && p.normal_max != null ? Math.abs(p.normal_max - p.normal_min) : Math.abs(mid(p)) * 0.1; return Math.max(0.01, span * 0.03); };

/* ---------- fault presets (what the operator can inject) ---------- */
export const PRESETS: FaultPreset[] = [
  { key: "bearing_wear", label: "Bearing wear", types: ["conveyor", "motor", "pump", "compressor"], description: "Temperature and vibration climb together over ~2 min (the classic signature Muse recognises).",
    apply: (m) => { ramp(m, ["motor_temp", "bearing_temp", "oil_temp"], (p) => (p.crit_high ?? 90) * 1.08, 150); ramp(m, ["vibration_rms"], (p) => (p.crit_high ?? 7) * 1.1, 110); } },
  { key: "overload", label: "Overload", types: ["conveyor", "motor", "compressor"], description: "Current and load jump above the critical limit quickly.",
    apply: (m) => { ramp(m, ["motor_current", "load"], (p) => (p.crit_high ?? 12) * 1.12, 25); } },
  { key: "belt_slip", label: "Belt slip", types: ["conveyor"], description: "Belt speed drops while current rises.",
    apply: (m) => { ramp(m, ["belt_speed"], (p) => (p.crit_low ?? 0.6) * 0.9, 40); ramp(m, ["motor_current"], (p) => (p.warn_high ?? 10) * 1.05, 40); } },
  { key: "pressure_drop", label: "Pressure drop", types: ["compressor", "pump"], description: "Discharge/outlet pressure falls below the critical low limit (leak or filter).",
    apply: (m) => { ramp(m, ["outlet_pressure", "discharge_pressure"], (p) => (p.crit_low ?? 4) * 0.92, 70); } },
  { key: "cavitation", label: "Cavitation", types: ["pump"], description: "Flow falls, vibration rises, bearing warms.",
    apply: (m) => { ramp(m, ["flow_rate"], (p) => (p.crit_low ?? 15) * 0.9, 60); ramp(m, ["vibration_rms"], (p) => (p.crit_high ?? 6) * 1.1, 60); ramp(m, ["bearing_temp"], (p) => (p.warn_high ?? 65) * 1.02, 120); } },
  { key: "overheat", label: "Seal overheat", types: ["sealer"], description: "Seal bar temperature runs past its critical limit.",
    apply: (m) => { ramp(m, ["seal_temp"], (p) => (p.crit_high ?? 190) * 1.05, 60); } },
  { key: "starvation", label: "Feed starvation", types: ["hopper"], description: "Hopper level and feed rate collapse.",
    apply: (m) => { ramp(m, ["hopper_level"], (p) => (p.crit_low ?? 10) * 0.8, 50); ramp(m, ["feed_rate"], (p) => (p.crit_low ?? 15) * 0.8, 50); } },
  { key: "reject_spike", label: "Reject spike", types: ["inspection"], description: "Reject rate shoots up — quality problem upstream.",
    apply: (m) => { ramp(m, ["reject_rate"], (p) => (p.crit_high ?? 5) * 1.3, 30); ramp(m, ["item_weight"], (p) => (p.warn_low ?? 480) * 0.99, 30); } },
  { key: "sensor_drift", label: "Slow drift", types: ["conveyor", "motor", "pump", "compressor", "sealer", "hopper", "inspection", "other"], description: "Every parameter drifts up 1 %/min — tests the trend layer and the time-to-limit forecast.",
    apply: (m) => { for (const p of m.params) { if (p.crit_high != null) ramp(m, [p.name], (q) => (q.crit_high ?? mid(q)) * 1.02, 600); } } },
];

function ramp(m: SimMachine, names: string[], target: (p: Param) => number, seconds: number) {
  for (const p of m.params) {
    if (!names.includes(p.name)) continue;
    m.controls[p.name] = { target: target(p), ramp_s: seconds, started_at: now(), from: m.clean[p.name] ?? mid(p) };
  }
}

/* ---------- engine ---------- */
type Log = { ts: number; text: string; tone: "muted" | "green" | "amber" | "red" | "blue" };

class Engine {
  machines: SimMachine[] = [];
  cookie = "";
  started = false;
  connected = false;
  posts = 0;
  postsLastMin: number[] = [];
  log: Log[] = [];
  lastError: string | null = null;
  readonly startedAt = now();

  push(text: string, tone: Log["tone"] = "muted") { this.log = [{ ts: now(), text, tone }, ...this.log].slice(0, 80); }

  /* ----- BatchGuard client (as the demo owner) ----- */
  async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${BG}${path}`, { ...init, headers: { "Content-Type": "application/json", cookie: this.cookie, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${(await res.text()).slice(0, 160)}`);
    return res.json() as Promise<T>;
  }
  async login() {
    const res = await fetch(`${BG}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
    if (!res.ok) throw new Error(`login failed ${res.status}`);
    const set = res.headers.get("set-cookie") || "";
    this.cookie = set.split(";")[0];
    this.connected = true;
  }
  async issueKey(m: SimMachine) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const k = await this.api<{ api_key: string }>(`/api/machines/${m.id}/rotate-key`, { method: "POST" });
        m.key = k.api_key;
        if (attempt) this.push(`${m.name}: new device key issued`, "green");
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("401") && attempt === 0) { try { await this.login(); continue; } catch { /* fall through */ } }
        this.push(`${m.name}: could not obtain a device key (${msg})`, "red");
        return;
      }
    }
  }
  private reissueAt = 0;
  async reissueKeys() {
    if (now() - this.reissueAt < 15) return;
    this.reissueAt = now();
    try { await this.login(); } catch { /* keep the old cookie */ }
    await this.loadMachines();
  }
  async loadMachines() {
    type M = { id: string; name: string; type: string; device_id: string; location: string; verified: number; parameters: Param[] };
    const list = await this.api<M[]>("/api/machines");
    const known = new Map(this.machines.map((m) => [m.id, m]));
    const next: SimMachine[] = [];
    for (const m of list) {
      if (!m.verified) continue;
      const prev = known.get(m.id);
      if (prev) {
        prev.params = m.parameters; prev.name = m.name;
        if (!prev.key) await this.issueKey(prev);
        next.push(prev);
        continue;
      }
      const sm: SimMachine = { id: m.id, name: m.name, type: m.type, device_id: m.device_id, location: m.location, params: m.parameters, values: {}, clean: {}, controls: {}, running: true, speed: 1, fault: null, key: null, counters: {} };
      for (const p of m.parameters) { sm.clean[p.name] = mid(p); sm.values[p.name] = mid(p); }
      await this.issueKey(sm);
      next.push(sm);
      this.push(`${m.name} connected (${m.device_id})`, "green");
    }
    this.machines = next;
  }
  async start() {
    if (this.started) return;
    this.started = true;
    const boot = async () => {
      try { await this.login(); await this.loadMachines(); this.push(`Simulator online → ${BG} · ${this.machines.length} machines`, "blue"); }
      catch (e) { this.connected = false; this.lastError = e instanceof Error ? e.message : String(e); this.push(`Cannot reach BatchGuard: ${this.lastError}`, "red"); setTimeout(boot, 10000); }
    };
    await boot();
    setInterval(() => this.tick().catch((e) => { this.lastError = String(e); }), 1000);
    setInterval(() => this.loadMachines().catch(() => {}), 60000); // pick up machines added from the dashboard
  }

  /* ----- physics-ish step ----- */
  step(m: SimMachine) {
    const t = now();
    for (const p of m.params) {
      const base = mid(p);
      let v = m.clean[p.name] ?? base;
      const c = m.controls[p.name];
      if (c) {
        const f = Math.min(1, (t - c.started_at) / Math.max(1, c.ramp_s));
        v = f < 1 ? c.from + (c.target - c.from) * (1 - Math.pow(1 - f, 2)) : c.target;
      } else {
        v += (base - v) * 0.15; // relax toward baseline (noise-free, so the relax never random-walks)
      }
      if (p.name === "items_packed") { m.counters.items = (m.counters.items ?? 0) + (m.running ? Math.round(1 * m.speed) : 0); v = m.counters.items; }
      else if (p.name === "belt_speed" && !c) v = base * m.speed;
      else if (p.name === "feed_rate" && !c) v = base * m.speed;
      else if (p.name === "cycle_time" && !c) v = base / Math.max(0.2, m.speed);
      m.clean[p.name] = v;
      m.values[p.name] = p.name === "items_packed" ? v : v + gauss(noiseOf(p)); // independent sensor noise per reading
    }
  }

  async post(m: SimMachine) {
    if (!m.key) return;
    const t0 = Date.now();
    const readings = m.params.map((p) => ({ parameter: p.name, value: Number(m.values[p.name].toFixed(3)), unit: p.unit ?? undefined, ts: now() }));
    try {
      const res = await fetch(`${BG}/v1/telemetry`, { method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": m.key }, body: JSON.stringify({ device_id: m.device_id, readings }) });
      const ms = Date.now() - t0;
      if (!res.ok) { m.last_post = { ok: false, ms, at: now(), signals: 0, error: `${res.status}` }; if (res.status === 401) { m.key = null; this.push(`${m.name}: key rejected, re-issuing…`, "amber"); this.reissueKeys().catch(() => {}); } return; }
      const body = (await res.json()) as { signals?: { layer: string; severity: string; message: string }[] };
      const sig = body.signals ?? [];
      m.last_post = { ok: true, ms, at: now(), signals: sig.length };
      for (const s of sig) if (s.severity !== "info") this.push(`${m.name} · BatchGuard flagged ${s.layer} ${s.severity}: ${s.message}`, s.severity === "critical" ? "red" : "amber");
      this.posts++;
      this.postsLastMin.push(now());
    } catch (e) {
      m.last_post = { ok: false, ms: Date.now() - t0, at: now(), signals: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async tick() {
    if (!this.connected) return;
    if (this.machines.some((m) => !m.key)) this.reissueKeys().catch(() => {});
    this.postsLastMin = this.postsLastMin.filter((t) => now() - t < 60);
    await Promise.all(this.machines.map(async (m) => { this.step(m); if (m.running) await this.post(m); }));
  }

  /* ----- controls (called by API routes) ----- */
  get(id: string) { const m = this.machines.find((x) => x.id === id); if (!m) throw new Error("machine not found"); return m; }
  setTarget(id: string, parameter: string, target: number, ramp_s = 30) {
    const m = this.get(id); const p = m.params.find((x) => x.name === parameter); if (!p) throw new Error("parameter not found");
    m.controls[parameter] = { target, ramp_s: Math.max(1, ramp_s), started_at: now(), from: m.clean[parameter] ?? mid(p) };
    m.fault = "manual";
    this.push(`${m.name} · ${parameter} → ${target}${p.unit ? " " + p.unit : ""} over ${ramp_s}s`, "blue");
  }
  release(id: string, parameter?: string) {
    const m = this.get(id);
    if (parameter) delete m.controls[parameter]; else { m.controls = {}; m.fault = null; }
    if (!Object.keys(m.controls).length) m.fault = null;
    this.push(`${m.name} · ${parameter ? parameter + " released" : "back to normal"}`, "green");
  }
  preset(id: string, key: string) {
    const m = this.get(id); const f = PRESETS.find((x) => x.key === key); if (!f) throw new Error("unknown preset");
    f.apply(m); m.fault = key; this.push(`${m.name} · fault injected: ${f.label}`, "red");
  }
  setRunning(id: string, running: boolean) { const m = this.get(id); m.running = running; this.push(`${m.name} · ${running ? "started — telemetry resumes" : "stopped — no telemetry (BatchGuard will see it go stale)"}`, running ? "green" : "amber"); }
  setSpeed(id: string, speed: number) { const m = this.get(id); m.speed = Math.max(0.2, Math.min(1.5, speed)); }
  allNormal() { for (const m of this.machines) { m.controls = {}; m.fault = null; m.running = true; m.speed = 1; } this.push("Whole line reset to normal", "green"); }

  async addMachine(type: string, name?: string) {
    type Tpl = { templates: Record<string, Param[]>; types: { id: string; name: string }[] };
    const tpl = await this.api<Tpl>("/api/machines/types");
    const params = (tpl.templates[type] ?? tpl.templates.other ?? []).map((p) => ({ ...p, verified: true }));
    const n = this.machines.filter((m) => m.type === type).length + 1;
    const body = { name: name || `${tpl.types.find((t) => t.id === type)?.name ?? type} #${n}`, type, location: "Virtual line", parameters: params, knowledge: [], source: "template", verified: true };
    const created = await this.api<{ id: string; name: string; device_id: string; api_key?: string; parameters: Param[] }>("/api/machines", { method: "POST", body: JSON.stringify(body) });
    await this.loadMachines();
    const m = this.machines.find((x) => x.id === created.id);
    if (m && created.api_key) m.key = created.api_key;
    this.push(`Added ${created.name} (${created.device_id}) to the line`, "green");
    return created.id;
  }
  async removeMachine(id: string) {
    const m = this.get(id);
    await this.api(`/api/machines/${id}`, { method: "DELETE" });
    this.machines = this.machines.filter((x) => x.id !== id);
    this.push(`Removed ${m.name}`, "amber");
  }

  snapshot() {
    return {
      connected: this.connected, backend: BG, dashboard: process.env.NEXT_PUBLIC_DASHBOARD_URL || "http://localhost:3000", posts: this.posts, posts_per_min: this.postsLastMin.length,
      uptime_s: Math.round(now() - this.startedAt), error: this.lastError, presets: PRESETS.map(({ key, label, types, description }) => ({ key, label, types, description })),
      machines: this.machines.map((m) => ({ id: m.id, name: m.name, type: m.type, device_id: m.device_id, location: m.location, params: m.params, values: m.values, clean: m.clean, controls: m.controls, running: m.running, speed: m.speed, fault: m.fault, has_key: !!m.key, last_post: m.last_post })),
      log: this.log.slice(0, 40),
    };
  }
}

declare global { var __bgSim: Engine | undefined; }
export function engine(): Engine {
  if (!globalThis.__bgSim) globalThis.__bgSim = new Engine();
  return globalThis.__bgSim;
}
