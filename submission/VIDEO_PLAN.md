# BatchGuard AI: demo video plan (5:00 recorded, 4:00 final)

**How the length works:** record and edit a **5:00** cut at normal speed, then export the whole timeline at **1.25×**. 5:00 ÷ 1.25 = **4:00**. Every timestamp below shows both.

**One story, start to finish:** a small packaging line is set up (shown as a quick montage). Its conveyor starts to fail, Muse works out why and phones the maintenance lead, the lead acknowledges, fixes it, and tells Muse on a follow-up call what it really was. Every feature appears because the story needs it, not as a feature tour.

> **Length check:** the submission template asks for a **3-minute** demo video. If that limit is strict, use the 3:00 cut list in section 8 instead of uploading the 4:00 version.

---

## 1. Format, and how to speed it up cleanly

| Choice | Why |
|---|---|
| **Screen recording of the live Cloud Run app** | Judges score a working product. Record the deployed app, not localhost: only the deployment has Vertex AI, so reports say `GEMINI-ADK`, not `RULE-BASED`. |
| **Your own voice-over, recorded against the 5:00 edit** | You can cut out the waiting and still explain. A human voice sounds less "AI demo" than TTS, and Indian English matches the product. |
| **Four moments where the product talks ("sound-up")** | The cold open and section 6 (two clips of the same phone call), the follow-up call, and the voice copilot. Mute your VO and let Muse speak: that's the proof the Gemini Live parts are real. |
| **Light motion text, burned-in captions** | Section labels and a few numbers in Barlow Condensed (the deck's font). Captions because judges often watch muted. |

**Pace for a 1.25× speed-up.** Read the VO slowly and relaxed, at about **130 words a minute** (slower than feels natural). After 1.25× it plays at about 160, which still sounds human. The script below is **552 words** of VO plus about **40 s** of product audio, sized for 5:00.

**How to export at 1.25× without chipmunk voices:**
- Finish the whole edit at 1×. Then speed up the full timeline in one step, **with pitch preserved**: *Premiere Pro* "Speed/Duration → Maintain Audio Pitch", *DaVinci Resolve* "Retime and Scaling" plus "Pitch Correction", *CapCut* "Speed" with pitch preservation on.
- Simplest: speed up the phone calls too; Muse is still clear at 1.25×. If you'd rather keep the calls at 1×, the video ends at about 4:08, so trim about 8 s from sections 4 and 5.
- Export, then check the duration is **≤ 4:00**.

---

## 2. Timeline at a glance

| # | Section | At 1× (record) | Final at 1.25× | What happens |
|---|---|---|---|---|
| 0 | Cold open | 0:00–0:14 | 0:00–0:11 | Your phone rings, Muse briefs you, you acknowledge. Title card. |
| 1 | The problem | 0:14–0:54 | 0:11–0:43 | Old machines, one maintenance lead, limits stuck in a PDF, faults found late, costly downtime |
| 2 | Meet Muse | 0:54–1:09 | 0:43–0:55 | Overview, Ask Muse greeting, 3D factory |
| 3 | Setting up the factory | 1:09–1:34 | 0:55–1:15 | Sped-up montage: manual → Gemini extraction with page numbers → verify → key → line builder |
| 4 | The fault | 1:34–2:09 | 1:15–1:43 | Readings checked live, vibration climbs, trend warning with ETA, incident opens |
| 5 | The investigation | 2:09–2:49 | 1:43–2:15 | ADK report: ranked causes, evidence for/against, manual page, checks, tool trace |
| 6 | The call | 2:49–3:22 | 2:15–2:42 | Muse phones you (sound-up), incident flips to Acknowledged, transcript, email |
| 7 | On site | 3:22–3:40 | 2:42–2:56 | Photo evidence read by Gemini vision, work orders from Muse's checks |
| 8 | Closing the loop | 3:40–4:00 | 2:56–3:12 | Follow-up call "what did you find?" (sound-up), incident resolved with the real cause |
| 9 | Talk to the factory | 4:00–4:20 | 3:12–3:28 | Voice copilot jumps to a chart and highlights it (sound-up) |
| 10 | Under the hood + proof | 4:20–4:52 | 3:28–3:54 | Architecture, ADK pipeline, Google Cloud stack, benchmark numbers, cost |
| 11 | Close | 4:52–5:00 | 3:54–4:00 | Logo, tagline, link |

---

## 3. Script and shot list

Times are at 1×. **VO** is your voice-over. **SOUND-UP** means mute the VO and play the recorded product audio.

### 0 · Cold open (0:00–0:14)

**Shots**
This is a clip of the call you record in section 6, used twice: the opening of Muse's brief here, the acknowledgement there.

1. Phone on a desk (or a phone screen recording): incoming call from your TeleCMI number. 1.5 s.
2. Call connected: phone screen on the left, a waveform on the right. Muse speaks.
3. Hard cut to black. Title card **BatchGuard AI**, with *Your factory, watched by an agent that explains and calls.*

**SOUND-UP (about 9 s; Muse reads the incident's own call script, so the words will differ slightly):**
> Muse: "Hello, this is Muse from BatchGuard. Main conveyor vibration is climbing toward its limit. Most likely a worn bearing. Please check the drive-end bearing first. Can you acknowledge?"
> You: "Acknowledged. I'm there in ten minutes."

**VO over the title card (10 words):**
> "That call came from an AI agent, not a person."

### 1 · The problem (0:14–0:54)

This is the longest talking section, so give it pictures that change every 4–6 s. Free factory b-roll from Pexels or Pixabay works well here, mixed with your own material.

**Shots, in order:**
1. Factory-floor b-roll: an old conveyor or motor running, then a person walking the line (6 s).
2. Slow pans over `public/machines/conveyor.jpg`, `compressor.jpg` and `pump.jpg` (8 s).
3. A clipboard or an HMI panel with a red alarm light, or a close-up of a hot motor (5 s).
4. Scroll through `CX-400_Conveyor_Manual.pdf`; zoom on the limits table on page 4 (6 s).
5. An empty chair, or a phone showing "Shift 2" on a roster: the one person who knows is not there (4 s).
6. A line stopped: b-roll of a still conveyor, then a clock (6 s).
7. 3 s of the landing page's Problem section to land it.

**On-screen text, one per beat:** `Machines 20–30 years old` · `No monitoring` · `Limits stuck in a PDF` · `Know-how in one person's head` · `Found late, fixed slowly`

**VO (88 words):**
> "Walk into a small factory and you'll find machines twenty or thirty years old doing most of the work, and one maintenance lead keeping them all alive. There's no monitoring. Those systems are built and priced for big plants. The safe limits sit in a PDF manual, and the know-how sits in one person's head. So a bearing that's been overheating for forty minutes gets noticed only when the line stops. Then someone hunts for the manual and guesses what to check, while downtime costs thousands an hour."

### 2 · Meet Muse (0:54–1:09)

**Shots:** Overview with the Ask Muse greeting typing in (2 s), machine cards with sparklines (3 s), a slow orbit of the 3D factory (5 s).

**VO (31 words):**
> "Not anymore. Meet BatchGuard AI. It gives every factory an agent called Muse, that reads the manuals, watches every machine, works out what's wrong, and calls you when it matters."

*(Built as motion graphics in `video/src/muse/`, narrated by the same voice as section 1.)*

### 3 · Setting up the factory: a quick montage (1:09–1:34)

Record the real setup once, at normal speed, then show it **sped up 4–8×** with a small `▶▶ 6×` badge in the corner. Slow down to 1× for one second on the page-number row, the one detail judges should notice.

**Shots:**
1. Onboard machine page: drag `CX-400_Conveyor_Manual.pdf` in (sped up).
2. The verify table fills in. **1 s at normal speed, zoomed:** `vibration_rms · warn 5.0 · crit 7.1 · p.4`.
3. Ticks, save, the device key and code samples appear (sped up; blur the key after its prefix).
4. Workflow builder: drag the machine between *Feeder hopper* and *Inspection station*, connect, save (sped up).
5. Land on the 3D factory with the whole line running, all green (2 s at normal speed).

**VO (55 words):**
> "For this demo, we've set up a packaging line in a virtual factory: six machines, streaming live readings into BatchGuard, just like real sensors. Adding a machine takes a couple of minutes. We upload its manual, Gemini pulls out every limit, with the page it came from, a person verifies each one, and the machine gets its own key. Then we drag it into the line, so Muse knows what feeds what."

*(Built as motion graphics in `video/src/setup/`: the virtual factory is our simulator at `batchguard-sim.web.app`, which streams telemetry into the demo account through the same `POST /v1/telemetry` API a real sensor uses.)*

### 3b · A tour of the live app (motion graphics, about 59 s)

Built in `video/src/tour/` and joined after section 3. Pages shown: the 3D factory (a live 3D render, the camera flying across the line), the overview (a question typed to Muse, a tap on the voice orb), machines, telemetry (the live chart drawing and readings arriving), the four checks, observability, and the escalation ladder step by step. It ends on "Now, let's see it live." over dark navy, and the live recordings follow: **Case 1** (`video/src/live/`, from `first.mp4`) is the all-fine check, Muse answering "everything is running smoothly right now, all six machines are healthy."

**VO (157 words):**
> "Here's our line, live in 3D: every machine coloured by what Muse sees, right now. The overview shows the whole factory at a glance, and you can ask Muse anything, by text or by voice. Every machine gets a live card, with its health and latest readings. On the telemetry page, readings stream in as they arrive, and each one is checked the moment it lands, four ways: against its limits, its trend, the machine's own normal, and whether it has gone silent. No language model in that loop, so it takes milliseconds. Observability keeps an eye on the pipeline itself. And when something does go wrong, Muse follows our escalation ladder. A warning emails the first contact. A critical alert emails and calls them. No answer in two minutes? Muse calls the next person. Quiet hours hold back warnings, never emergencies. Now, let's see it live."

Meet Muse + setup + this tour run about 1:43 together.

### 4 · The fault (1:34–2:09)

**Shots:**
1. The machine page of the conveyor that will fail (the CX-400 you added, or the demo line's *Main conveyor*; see setup section 5), all charts inside the green bands (2 s).
2. The fault starts. The `vibration_rms` chart bends upward toward the dashed red line.
3. An *anomaly* event appears, then a *trend* warning. **Zoom on the forecast:** "reaches the critical limit in ~3 min".
4. The 3D factory: the conveyor turns amber. The notification bell gets a red count.

**On-screen text (at the zoom):** `Trend warning: critical in ~3 min`

**VO (73 words):**
> "Every reading is checked the moment it arrives, in four ways: against its limits, its trend, the machine's own normal behaviour, and whether it has gone silent. There's no language model in this loop, so it takes milliseconds. Now the bearing starts to wear. Within seconds, vibration is flagged as unusual. Moments later, the trend says it will hit the critical limit in about three minutes. An incident opens, long before anything breaks."

### 5 · The investigation (2:09–2:49)

**Shots (incident page):**
1. Severity pills and title (1 s).
2. The investigation report with its `GEMINI-ADK` badge. Zoom on the summary.
3. Ranked causes: zoom on **#1** and its support label, with an evidence-for line (for example, vibration rising before motor temperature), then **#2** with its evidence against. Gemini writes its own wording each run; zoom on whatever it says.
4. The manual page citation, then the checks list with its safety note.
5. 3 s on Observability: the agent run with its tool calls (`get_readings`, `get_baseline`, `compute_correlation`, `get_manual_sections`…).
6. If the report has an `[unverified]` marker, a 1 s zoom on it while the last line plays.

**VO (88 words):**
> "Now Muse investigates, like a good engineer. A Google ADK pipeline gathers the evidence in parallel: readings, baselines, neighbouring machines, past incidents and the manual. It proposes possible causes, weighs the evidence for and against each one, and ranks them. Here, bearing wear comes first, because vibration rose before temperature, and the manual's troubleshooting page says exactly that. It lists the checks to do first, each with a safety note. And every number in the report has to match real data. Anything it can't trace is marked unverified."

### 6 · The call (2:49–3:22)

**Shots:**
1. Click **"Call the on-call contact now"** in the call-script box. **Don't press Acknowledge first:** the spoken acknowledgement only counts while the incident is still Open.
2. Split screen: the incident page on the left, your phone ringing on the right, then connected.
3. **SOUND-UP, about 12 s:** Muse's brief, then your "Acknowledged, ten minutes".
4. Cut to the incident status flipping to **ACKNOWLEDGED**, "acknowledged by voice: Ravi". It lands 15–30 s after you hang up, so record the wait and cut it.
5. Voice AI page, call detail: transcript, recording player, extracted outcome (`acknowledged · ETA 10 min`). Then 1.5 s of the "Voice call summary" email in your inbox.

**VO before the sound-up (20 words):**
> "It's critical, so Muse doesn't wait for someone to open a dashboard. It calls the on-call engineer, using Gemini Live."

**VO after (26 words):**
> "The acknowledgement on the call updates the incident by itself, and a summary lands by email. No answer in two minutes? Muse calls the next person."

### 7 · On site (3:22–3:40)

**Shots:**
1. Photo evidence on the incident: upload a phone photo of a motor or bearing housing. Gemini's description and findings appear under it (3 s). Show the **Re-investigate with the photos** button for 1 s.
2. Click **From Muse's checks** in the Work orders card. One card per check appears on the Kanban; drag one to *In progress* (3 s).

**VO (34 words):**
> "On site, the technician snaps a photo. Gemini vision reads it against the suspected causes, and it becomes evidence. Muse's checks turn into work orders in one click, so everyone knows who's doing what."

### 8 · Closing the loop (3:40–4:00)

**Shots:**
1. On the acknowledged incident, the call button now reads **"Call back: what did you find?"**. Click it.
2. **SOUND-UP, about 9 s.** Muse recalls the incident and asks what you found and whether its cause was correct. Answer clearly: *"It was the drive-end bearing. Your cause was correct. We replaced it and it's running normally."*
3. Cut to the incident marked **RESOLVED**, with the verdict, actual cause and fix filled in from the call.

**VO before (13 words):**
> "When the job's done, Muse calls back to ask what they actually found."

**VO after (13 words):**
> "The incident closes with the real cause, and Muse remembers it next time."

### 9 · Talk to the factory (4:00–4:20)

**Shots:** Overview → tap the round voice button. You say **"Muse, take me to the compressor's pressure chart."** Muse answers out loud while the dashboard jumps to that chart and highlights it in yellow. **SOUND-UP, about 10 s.** ("Take me to…" and "show me…" trigger navigation; a plain question only gets a spoken answer.)

**VO before (17 words):**
> "And the plant owner doesn't need to learn a dashboard. They can just talk to the factory."

### 10 · Under the hood + proof (4:20–4:52)

**Shots:** deck slide 12 (system architecture) with a slow push-in, then slide 13 (the ADK pipeline). Google Cloud logos. Then three numbers animate in, one per beat: **16/16 injected faults caught** · **~85 s of warning before the critical limit** · **~$100 a month per plant** (all from the deck's benchmark and cost slides).

**VO (67 words):**
> "Under the hood, it's all Google Cloud. Two Cloud Run services. Vertex AI with Gemini and the Agent Development Kit for the investigation, and Gemini Live for voice. Pub/Sub streams every reading into BigQuery, with Firestore and Cloud Storage alongside. In our tests, it caught all sixteen faults we injected, warned well before the critical limit, and runs for about a hundred dollars a month per plant."

### 11 · Close (4:52–5:00)

**Shots:** black card with the BatchGuard AI wordmark and Muse, the tagline, the link `batchguard-frontend-6our3ivvha-as.a.run.app`, and a small "Built on Google Cloud · AI Builder Cup 2026" line.

**VO (17 words):**
> "BatchGuard AI. Your factory, watched by an agent that explains every alarm, and calls the right person."

---

## 4. Before you record: setup checklist

**Timing risk first.** Vertex AI lists **20 Oct 2026** as the retirement date for `gemini-2.5-flash`, which the app uses by default. Record **before then**, or move the app to the replacement models first, or the agent, extraction and photo analysis may fail on camera.

On the **live app** (signed in as the demo owner):
- [ ] **Escalation contacts:** set contact #1 to **your own phone number and your email** (the call-summary email goes to contact #1) and a name like "Ravi, Maintenance lead". Keep contacts #2 and #3 as numbers you control too, or remove them, so nobody else gets rung.
- [ ] **Voice AI page:** pick the TeleCMI caller number, then **Publish all** five workflows. Place one **test call** to yourself with the "Bearing overheating" preset to check audio and language (English or Hinglish).
- [ ] **Auto-dial:** leave it **off** and press the call button on camera (more reliable), or switch it **on** only while recording if you want the call to happen without a click. Switch it off afterwards.
- [ ] **Email:** the owner email must be the address Resend delivers to. While the sender is `onboarding@resend.dev`, Resend only delivers to the Resend account owner's address.
- [ ] **Clean slate:** resolve old open incidents so the new one starts at "Open", not "Escalation level 12".
- [ ] **Props:** `CX-400_Conveyor_Manual.pdf` (in this folder; 6 pages of fictional equipment, marked as a sample: limits table on p.4, troubleshooting on p.5, so the report can cite those pages), and a phone photo of any motor or bearing housing for the evidence step.

**Screen:**
- Record at 1920×1080, browser zoom 110–125 %, bookmarks bar hidden, notifications off, a clean browser profile.
- Tools: OBS Studio for the screen. For the phone: scrcpy on Android (mirrors the screen and, on Android 11+, the audio), or QuickTime mirroring on an iPhone. Put the call on speaker and also record it with a USB or lapel mic as a backup track.

## 5. Making the fault happen on cue

**Option A, recommended: fail the machine you just onboarded.** This gives story continuity and full control.

1. While recording the factory-setup montage (script section 3), onboard `CX-400 Main Conveyor` from the demo manual. Keep the parameter names exactly as extracted: `motor_temp`, `vibration_rms`, `motor_current`, `belt_speed`, `load`. The simulator posts those names, and readings with any other name are rejected.
2. Copy the device id and key from the machine page, then run:

```bash
python backend/scripts/device_sample.py --url https://batchguard-frontend-6our3ivvha-as.a.run.app --device <device_id> --key <device_key> --type conveyor --fault bearing_wear --start 150 --ramp 150
```

This gives 150 s of normal running (so the trend and baseline layers have history), then a 150 s bearing-wear ramp. Expect the first flag at about +12 s, the incident at about +25 s, and the critical limit at about +130 s. Record the whole thing and cut it down in the edit.

**Option B, backup: the demo line's built-in fault.** The demo producer runs a bearing-wear ramp on *Main conveyor* every 30 minutes: it starts at **:15 and :45 past each hour (IST)**, ramps for 2 min, holds for 2 min, and recovers by :20 / :50. Start recording at :14.

## 6. Editing guide

- **Cut order:** lay the screen footage to the timeline above, then record the VO against the cut, then re-trim.
- **Zooms:** 130–160 % punch-ins on the page citation, the ETA, cause #1, ACKNOWLEDGED and the call outcome. Ease in over 0.3 s. Never zoom on something that isn't in focus.
- **Text:** Barlow Condensed Bold for titles and IBM Plex Mono for small labels, matching the deck. White on a dark navy (`#0E1A36`) lower third.
- **Captions:** burned in, two lines max, Barlow 600.
- **Audio:** VO at about −14 LUFS. Music very low (−28 dB) and ducked fully under the sound-ups. A soft "tick" on each number reveal is enough sound design.
- **Speed:** speed-ramp waiting (2–8×), but never fake a result. If Gemini took 40 s, show a small `+40 s` badge as you cut.
- **Export:** 1080p, H.264, 30 fps. Upload to YouTube as **Unlisted**, with chapters in the description matching the section names. Speed the finished 5:00 edit up to 1.25× with pitch preserved (section 1) and check the final length is 4:00 or less.

## 7. Plan B list (things that go wrong on camera)

| Risk | Backup |
|---|---|
| The phone call fails or the audio is poor | Use the test-call recording from setup (same Muse voice and brief). The call detail page also has the recording player. |
| Gemini is slow on the investigation | Record a second run, and cut with the `+NN s` badge. |
| Extraction picks different parameter names | Rename them on the verify screen before saving (they're editable). |
| Voice copilot mishears you | Retake in a quiet room, close to the mic. Short commands that start with "Take me to…" or "Show me…" work best. |
| The call ends but the incident stays Open | Wait 30 s and refresh: the outcome is applied on the next 15 s poll. If the extraction missed it, use **Re-extract** on the call detail, or acknowledge in the app and say so in the VO. |
| The follow-up call doesn't resolve the incident | Answer Muse's question with one of its three words (correct, partly correct or wrong) and say the machine is running normally. If it still stays open, use **Resolve with feedback** in the app. |
| Email doesn't arrive | Show the email card on Settings → Email (the preview of the same template). |

## 8. If the 3-minute limit is strict: the 3:00 cut

Drop these from the 5:00 edit, then export at 1.25× as before:

| Change | Saves at 1× |
|---|---|
| Cut script section 8 (closing the loop); add "Muse learns from every fix." to the close | 20 s |
| Cut script section 9 (talk to the factory) | 20 s |
| Problem: keep the first two and the last two sentences | 15 s |
| Investigation: drop the checks sentence and the Observability shot | 8 s |
| Under the hood: keep the stack sentence and the three numbers only | 10 s |
| Factory setup montage: drop the line-builder shot and its sentence | 5 s |

Total: 300 − 78 = 222 s at 1×, which is **2:58** at 1.25×.
