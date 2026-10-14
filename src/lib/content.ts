// Single source of truth for landing-page copy. Mirrors the PRD.

export const NAV = [
  { label: "Live incident", href: "#story" },
  { label: "Problem", href: "#problem" },
  { label: "How it works", href: "#journey" },
  { label: "Pipeline", href: "#pipeline" },
  { label: "Agent", href: "#agent" },
  { label: "Architecture", href: "#architecture" },
  { label: "Evaluation", href: "#evaluation" },
];

export const PROBLEMS = [
  {
    title: "Onboarding is slow",
    body: "Monitoring means hand-typing every limit from a machine manual into a SCADA tool. Hours per machine.",
    icon: "FileWarning",
  },
  {
    title: "Alarms don't explain",
    body: "\"Motor temperature high\" says nothing about why, which readings moved first, or what to check.",
    icon: "BellOff",
  },
  {
    title: "Alarm fatigue",
    body: "Repeated, duplicate, low-value alerts train operators to ignore them. The serious one gets missed.",
    icon: "AlarmClockOff",
  },
  {
    title: "Nobody watches at night",
    body: "On a night shift or weekend a critical fault can run for hours before anyone sees the dashboard.",
    icon: "MoonStar",
  },
  {
    title: "Expertise is scarce",
    body: "Junior operators can't reproduce the diagnosis a senior maintenance engineer would make.",
    icon: "UserX",
  },
];

export const JOURNEY = [
  {
    step: "01",
    title: "Create a factory",
    body: "Owner creates Factory A, adds a line, and sets escalation contacts with order and quiet hours.",
    tag: "Setup",
  },
  {
    step: "02",
    title: "Upload the manual",
    body: "Drop the conveyor's PDF datasheet. Gemini reads it and pre-fills parameters, units, normal ranges, warning and critical limits.",
    tag: "Gemini multimodal",
  },
  {
    step: "03",
    title: "Verify, side by side",
    body: "Every extracted value is shown next to its source page with a confidence score. Nothing goes live unverified.",
    tag: "Human-in-the-loop",
  },
  {
    step: "04",
    title: "Get a device key",
    body: "Platform issues a device ID, API key and endpoint URL with a copy-paste code sample.",
    tag: "POST /v1/telemetry",
  },
  {
    step: "05",
    title: "Stream telemetry",
    body: "The machine posts readings every 1–2 s. Dashboard shows live charts against its own limits.",
    tag: "Pub/Sub + Firestore",
  },
  {
    step: "06",
    title: "Something drifts",
    body: "Vibration starts rising. Trend detection projects time-to-limit: ~4 minutes. A warning opens before anything breaks.",
    tag: "Predictive",
  },
  {
    step: "07",
    title: "Agent investigates",
    body: "Pulls readings, neighbours, events and the manual's troubleshooting pages. Ranks causes with evidence for and against.",
    tag: "ADK + Gemini",
  },
  {
    step: "08",
    title: "Phone rings",
    body: "Critical and unacknowledged? An automated voice call reads out the machine, the problem and the first check. Press 1 to acknowledge.",
    tag: "Twilio + Cloud TTS",
  },
  {
    step: "09",
    title: "Human closes the loop",
    body: "Engineer marks the diagnosis correct or wrong and records the fix. Feedback becomes the machine's history.",
    tag: "Feedback",
  },
];

export const DETECTION_LAYERS = [
  {
    name: "Limits",
    method: "Value vs verified warning / critical limits from onboarding",
    catches: "Clear breaches",
    example: "Motor temp 92 °C > critical 90 °C",
    color: "red",
  },
  {
    name: "Trend",
    method: "Linear fit over the last 60 s → projected time to limit",
    catches: "Slow drift before a breach",
    example: "Vibration rising; limit reached in ~4 min",
    color: "amber",
  },
  {
    name: "Anomaly",
    method: "Rolling z-score vs the machine's own baseline; cross-signal checks",
    catches: "Odd patterns still inside limits",
    example: "Current +30 % at the same speed and load",
    color: "blue",
  },
  {
    name: "Staleness",
    method: "No telemetry for 10 s",
    catches: "Offline machine or sensor failure",
    example: "conv-01 silent since 10:42:05",
    color: "violet",
  },
];

export const AGENT_PIPELINE = [
  { name: "Context builder", body: "Incident window (5 min before → now), all parameters, upstream/downstream machines, events, verified spec." },
  { name: "Retriever", body: "Pulls troubleshooting and maintenance passages from the machine's own manual, with page refs." },
  { name: "Hypothesis generator", body: "Proposes 3–5 candidate causes, each tied to specific observations." },
  { name: "Hypothesis evaluator", body: "Supporting evidence, contradicting evidence, missing data. Support level: strong / plausible / weak / inconclusive." },
  { name: "Recommender", body: "Ordered checks, most discriminating first: \"IR-gun the bearing; if normal, inspect belt tension.\"" },
  { name: "Reporter", body: "Schema-validated incident report plus a 20-second phone script." },
];

export const AGENT_TOOLS = [
  "get_readings(machine, params, window)",
  "get_baseline(machine, param)",
  "get_events(machine, window)",
  "get_line_neighbours(machine)",
  "get_manual_sections(machine, query)",
  "get_past_incidents(machine)",
  "compute_correlation(machine, a, b, window)",
];

export const GUARDRAILS = [
  "Every number in the report is checked against stored readings; unsupported numbers are removed.",
  "Output must pass a JSON schema; retry once, then fall back to a rule-based summary.",
  "The agent has no tool that changes a machine. Recommendations are text only.",
  "In blind test mode the fault label is stored where the agent's tools cannot read it.",
];

export const SEVERITY = [
  { level: "Info", trigger: "Single anomaly, inside limits", action: "Dashboard only", color: "blue" },
  { level: "Warning", trigger: "Warning limit crossed, or time-to-limit < 10 min", action: "Dashboard + email", color: "amber" },
  { level: "Critical", trigger: "Critical limit crossed, or several parameters in warning", action: "Dashboard + email + voice call", color: "red" },
  { level: "Emergency", trigger: "Critical not acknowledged in 2 min, or a safety event", action: "Call next contact; repeat until acknowledged", color: "red" },
];

export const MACHINES = [
  { id: "feeder", name: "Feeder hopper", params: ["feed_rate", "hopper_level", "vibration_rms"], visual: "Hopper drops boxes onto the belt" },
  { id: "conveyor", name: "Main conveyor", params: ["belt_speed", "motor_temp", "motor_current", "vibration_rms", "load"], visual: "Moving belt carrying boxes" },
  { id: "inspection", name: "Inspection station", params: ["item_weight", "reject_rate"], visual: "Gate pushes rejected boxes aside" },
  { id: "sealer", name: "Sealer / packer", params: ["seal_temp", "cycle_time", "items_packed"], visual: "Sealed boxes stack at the end" },
];

export const FAULTS = [
  { name: "Bearing wear", machine: "Conveyor", signature: "Vibration rises slowly, then temperature; current slightly up; speed normal" },
  { name: "Belt slip / low tension", machine: "Conveyor", signature: "Speed drops while current falls; throughput down; vibration normal" },
  { name: "Overload / jam", machine: "Conveyor", signature: "Load and current spike, speed falls to zero, jam event logged" },
  { name: "Cooling fan failure", machine: "Conveyor", signature: "Temperature climbs while current and vibration stay normal" },
  { name: "Upstream over-feed", machine: "Feeder → Conveyor", signature: "Feed rate up first, then conveyor load and current" },
  { name: "Sealer heater degradation", machine: "Sealer → Inspection", signature: "Seal temperature drifts down, reject rate climbs" },
  { name: "Sensor failure", machine: "Any", signature: "Value flat-lines, jumps to an impossible number, or drops out" },
];

export const GCP = [
  { layer: "AI", items: ["Vertex AI (Gemini Flash + Pro)", "Agent Development Kit", "Cloud Text-to-Speech", "Vertex AI Agent Engine", "RAG Engine / Vector Search", "Gen AI evaluation service"] },
  { layer: "Data", items: ["BigQuery", "BigQuery ML forecasting", "ML.DETECT_ANOMALIES", "Firestore", "Cloud Storage", "Looker Studio"] },
  { layer: "Streaming", items: ["Pub/Sub", "BigQuery subscription", "Dataflow"] },
  { layer: "App & ops", items: ["Cloud Run", "Firebase Auth", "Cloud Tasks", "Cloud Scheduler", "Secret Manager", "Cloud Logging & Trace"] },
];

export const GENAI_USES = [
  { n: 1, feature: "Read machine manual / datasheet", cap: "Multimodal PDF + image → structured JSON", p: "P0" },
  { n: 2, feature: "Link each value to its source page", cap: "Citation of page and snippet", p: "P0" },
  { n: 3, feature: "Incident investigation", cap: "Multi-step agent, function calling over 7 tools", p: "P0" },
  { n: 4, feature: "Incident report", cap: "Schema-validated JSON", p: "P0" },
  { n: 5, feature: "Phone call script", cap: "Gemini + Cloud Text-to-Speech", p: "P0" },
  { n: 6, feature: "Ask the agent", cap: "Grounded chat over the same evidence", p: "P1" },
  { n: 7, feature: "Photo as evidence", cap: "Vision: worn belt, burnt cable", p: "P1" },
  { n: 8, feature: "Alerts in operator's language", cap: "Translation + plain-language rewrite", p: "P1" },
  { n: 9, feature: "Similar past incidents", cap: "Embeddings + BigQuery vector search", p: "P1" },
  { n: 10, feature: "Weekly health digest", cap: "AI.GENERATE in BigQuery", p: "P1" },
];

export const METRICS = [
  { area: "Detection", metric: "Fault runs detected", target: "≥ 90%" },
  { area: "Detection", metric: "False incidents / hour of normal running", target: "≤ 1" },
  { area: "Detection", metric: "Fault start → incident (sudden)", target: "< 10 s" },
  { area: "Prediction", metric: "Trend warning before critical limit", target: "≥ 80%" },
  { area: "Diagnosis", metric: "Top-1 accuracy", target: "≥ 60%" },
  { area: "Diagnosis", metric: "Top-3 accuracy", target: "≥ 85%" },
  { area: "Evidence", metric: "Report numbers matching stored readings", target: "100%" },
  { area: "Onboarding", metric: "PDF upload → verified machine", target: "< 3 min" },
  { area: "Escalation", metric: "Critical incident → phone ringing", target: "< 60 s" },
];

export const PRINCIPLES = [
  { title: "Human-in-the-loop", body: "The agent recommends; people decide. It never changes machine settings." },
  { title: "Evidence or silence", body: "Every claim links to a reading, timestamp or manual page. Missing data is said out loud." },
  { title: "Fewer, better alerts", body: "Deduplicate, group symptoms into one incident, escalate only when it matters." },
];

export const THEME_ALIGNMENT = [
  { goal: "Reliability", how: "Detects abnormal behaviour early and predicts time-to-breach before a limit is crossed" },
  { goal: "Quality", how: "Flags process drift (speed, load, temperature) that causes defective output" },
  { goal: "Efficiency", how: "Cuts time-to-diagnosis: the agent gathers evidence and ranks causes" },
  { goal: "Predictive maintenance", how: "Trend-based early warnings plus checks drawn from the machine's own manual" },
  { goal: "Sustainability", how: "Less scrap, less energy on faulty runs, less unplanned downtime" },
];
