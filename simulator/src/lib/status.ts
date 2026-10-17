import type { SimMachine as Full } from "@/server/engine";
export type SimMachine = Omit<Full, "key" | "counters">;

export type Status = "normal" | "warning" | "critical" | "stopped" | "shutdown";
export function statusOf(m: Pick<SimMachine, "params" | "values" | "running" | "shutdown">): Status {
  if (m.shutdown) return "shutdown";
  if (!m.running) return "stopped";
  let s: Status = "normal";
  for (const p of m.params) {
    const v = m.values[p.name];
    if (v == null) continue;
    if ((p.crit_high != null && v > p.crit_high) || (p.crit_low != null && v < p.crit_low)) return "critical";
    if ((p.warn_high != null && v > p.warn_high) || (p.warn_low != null && v < p.warn_low)) s = "warning";
  }
  return s;
}
