/**
 * The scripted incident story the 3D factory plays.
 * Shared by the hero (autoplay loop) and the scroll-driven Story section.
 */
export type Stage =
  | "running"
  | "drift"
  | "warning"
  | "critical"
  | "investigating"
  | "calling"
  | "acknowledged"
  | "resolved";

export const STAGES: Stage[] = [
  "running",
  "drift",
  "warning",
  "critical",
  "investigating",
  "calling",
  "acknowledged",
  "resolved",
];

export const STAGE_INFO: Record<
  Stage,
  { title: string; body: string; tag: string; health: "normal" | "warning" | "critical"; tone: "blue" | "amber" | "red" | "green" | "violet" }
> = {
  running: {
    title: "Line A is running",
    body: "Four machines post telemetry every second through their own device keys. Dashboard shows everything inside its verified limits.",
    tag: "telemetry · 4 devices online",
    health: "normal",
    tone: "blue",
  },
  drift: {
    title: "A bearing starts to wear",
    body: "Vibration on the conveyor motor creeps up: 3.1 → 4.4 mm/s. Still inside limits — a threshold alarm would stay silent.",
    tag: "anomaly layer · z-score 2.8",
    health: "normal",
    tone: "blue",
  },
  warning: {
    title: "Trend detection predicts the breach",
    body: "A linear fit over the last 60 s projects the critical limit in ~4 minutes. A Warning opens before anything breaks. Email sent.",
    tag: "time-to-limit · 4 min",
    health: "warning",
    tone: "amber",
  },
  critical: {
    title: "Motor temperature crosses 90 °C",
    body: "The limit layer fires. The symptoms attach to the same incident — one fault, one incident, not 200 alerts.",
    tag: "INC-0419 · critical",
    health: "critical",
    tone: "red",
  },
  investigating: {
    title: "The agent investigates",
    body: "Gemini pulls 5 minutes of readings, neighbours, events and the manual's bearing section. It ranks causes with evidence for and against.",
    tag: "ADK agent · 7 tool calls · 6 s",
    health: "critical",
    tone: "violet",
  },
  calling: {
    title: "The phone rings",
    body: "“Conveyor conv-01 critical. Bearing wear likely — vibration led temperature by nine minutes. Check the drive-end bearing. Press 1 to acknowledge.”",
    tag: "Twilio voice · Cloud TTS",
    health: "critical",
    tone: "red",
  },
  acknowledged: {
    title: "Engineer acknowledges",
    body: "Escalation stops. The engineer IR-guns the bearing — 118 °C. Diagnosis confirmed and recorded against the machine's history.",
    tag: "ack · 00:41 after call",
    health: "warning",
    tone: "green",
  },
  resolved: {
    title: "Bearing replaced. Back to green.",
    body: "Vibration returns to baseline. The incident, the evidence and the fix become training data for next time.",
    tag: "resolved · feedback: correct",
    health: "normal",
    tone: "green",
  },
};

/** Fake live readings per stage for the HUD. */
export function readingsFor(stage: Stage) {
  const i = STAGES.indexOf(stage);
  const vib = [3.1, 4.4, 5.6, 6.8, 6.9, 7.0, 6.1, 3.0][i];
  const temp = [74, 76, 83, 91, 92, 92, 88, 73][i];
  const amps = [8.4, 8.6, 9.1, 9.6, 9.6, 9.6, 9.0, 8.3][i];
  const speed = [1.2, 1.2, 1.2, 1.0, 0.8, 0.8, 0.8, 1.2][i];
  return { vib, temp, amps, speed };
}
