# Problem statement: voice-over takes

Start with **`AUDITION_all_voices.wav`** (1:52): each voice's opening line, introduced by a short label in a female voice so the labels don't blur into the takes.

| # | File | Voice | Length | Accuracy check |
|---|---|---|---|---|
| 1 | `problem_vo_am_michael.wav` | Warm American narrator | 37.0 s | clean |
| 2 | `problem_vo_narrator_deep.wav` | Deep cinematic narrator (blend of Michael and Onyx) | 35.5 s | clean |
| 3 | `problem_vo_am_onyx.wav` | Deep, low and serious | 34.1 s | says "maintenance **leader**" (this voice can't say "lead" clearly) |
| 4 | `problem_vo_am_fenrir.wav` | Energetic, punchy | 34.1 s | clean |
| 5 | `problem_vo_am_puck.wav` | Young, lively | 33.1 s | clean |
| 6 | `problem_vo_bm_george.wav` | British, authoritative documentary | 38.1 s | slight slur: "the line stops" heard as "lines stops" |
| 7 | `problem_vo_bm_lewis.wav` | British, deep and calm | 36.8 s | "big plants" heard as "big plans" |
| 8 | `problem_vo_hm_omega.wav` | Experimental: Indian-accented male | 37.4 s | clean |

**How these were made:** Kokoro, an open neural text-to-speech model (Apache-2.0), run locally. Kokoro has no emotion setting, so each line is directed by hand: its own pace, hand-placed pauses, and punctuation for phrasing. The opening is warm and unhurried, "There's no monitoring" is blunt, "one person's head" slows down, the overheating line speeds up, and "only when the line stops" lands slowly and heavily. Each take is mastered (EQ, gentle compression) to about −16 LUFS and a −1 dBFS peak, 48 kHz, 16-bit.

**Accuracy check:** every take was transcribed back with whisper.cpp and compared with the script. "Clean" means the only differences were numbers written as digits ("twenty" → "20").

**Regenerate or change:** `video/scripts/make_voiceover.py` holds the script, the pace and pause per line, and the voice list. Run `python scripts/make_voiceover.py am_michael` from `video/` to redo one voice.

**Next step:** pick a take and the animation will be re-timed to it (`video/scripts/sync-problem.mjs`), with the background score ducked under it.
