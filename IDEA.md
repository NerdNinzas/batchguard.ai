# BatchGuard AI — the idea and the problem

**Theme:** Google Cloud AI Builder Cup 2026 · Manufacturing
**One line:** A factory-monitoring agent that reads a machine's manual, watches its telemetry, works out what is going wrong with evidence, and then calls the right person.

---

## 1. The problem

Small and mid-sized factories run on machines that are decades old and still do most of the work: conveyors, fillers, sealers, compressors, pumps, labellers. Three things are true for almost all of them:

1. **They have no monitoring.** SCADA, MES and condition-monitoring suites are priced and staffed for large plants. An SME with eight machines and one maintenance lead cannot buy, integrate or operate them.
2. **The knowledge lives in a PDF and in one person's head.** The manual says the bearing temperature must stay under 85 °C and that rising vibration with rising temperature means wear. Nobody has typed that into a system. The one technician who knows the machine is on the other shift when it fails.
3. **Failures are discovered late and diagnosed slowly.** A bearing that has been warming for forty minutes is noticed when the line stops. Then someone has to guess the cause, find the manual, and decide what to check first. Downtime is measured in hours; the loss is measured in thousands per hour.

The result: unplanned downtime, scrap, overtime, and a maintenance team that only ever reacts.

### Why existing answers fall short

| Approach | What goes wrong for an SME |
|---|---|
| Industrial IoT platforms | Weeks of integration, per-point pricing, dashboards that still need a human to interpret them |
| Threshold alarms on a PLC | Fire late (limit already crossed), say nothing about *why*, no escalation |
| Hiring more technicians | Not available, and they still cannot watch every gauge every second |
| Generic "chat with your PDF" | Knows the manual but cannot see the machine; no telemetry, no detection, no action |

The gap is not *more data*. It is turning operational data into **a diagnosis with evidence and a person on the phone** within minutes, without a six-figure platform.

---

## 2. The idea

Give every factory a monitoring agent that behaves like a sharp plant manager who has read every manual and watches every gauge.

**Muse** (the agent) does five things:

1. **Learns the machine from its manual.** Upload the PDF; Gemini extracts the parameters, units, normal ranges and warning/critical limits, with the page it found them on. A human ticks "verified" before anything goes live.
2. **Watches the telemetry.** Each machine posts readings to its own endpoint with its own key. Three deterministic detection layers run on every reading: limits, trend (linear fit → time-to-limit), and anomaly (z-score against the machine's own baseline). Nothing waits on an LLM to notice a problem.
3. **Investigates like an engineer.** When an incident opens, a Google ADK agent pipeline gathers evidence in parallel (readings, baseline, events, neighbouring machines, the manual, cross-signal correlation), generates hypotheses, scores them for and against, and produces a ranked list of causes, the most discriminating checks to do first, and a 20-second call script. A guardrail strips any number the agent cannot trace to stored data.
4. **Escalates to a human.** Dashboard and email first; for critical incidents Muse phones the on-call contact with Gemini Live over a TeleCMI line, reads the brief, and takes the acknowledgement on the call. No answer in two minutes → next contact, and so on.
5. **Acts and learns.** Checks become work orders on a Kanban. A technician's photo becomes evidence. The resolution verdict feeds back so the next diagnosis is better. And the owner can simply *talk* to the factory: "how are we running?", "take me to the compressor's pressure chart" — Muse answers in Indian English and drives the dashboard.

### Who it is for

- **Owners and plant heads** of SME factories (food & beverage packaging, plastics, light engineering, pharma secondary packaging) with 5–50 machines and no monitoring today.
- **Maintenance leads** who want to be told *what to check first*, not shown another chart.
- **System integrators** who onboard dozens of such plants and need a repeatable, manual-driven setup.

### Why now

- Gemini can read a 60-page scanned manual and return structured limits with page citations.
- Google ADK makes a multi-stage evidence pipeline buildable in days, not months.
- Gemini Live gives a natural, realtime voice with tool calling, so "the agent calls you" and "you talk to the agent" are both practical.
- Cloud Run, Firestore, Pub/Sub and BigQuery remove the ops burden; an SME deployment costs tens of dollars a month.

### What success looks like

- Mean time to detect a developing fault: **minutes before** the limit is crossed, not after.
- Mean time to a diagnosis with evidence: **under three minutes** from the first signal.
- Mean time to a human acknowledgement: **under five minutes**, including a phone call.
- Onboarding a new machine: **under ten minutes** from PDF to live telemetry.

Everything in BatchGuard is advisory. The agent recommends; qualified people act, under their site's safety and lockout procedures.
