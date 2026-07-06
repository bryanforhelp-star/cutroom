# cutroom — project plan (now / next / later)

## current build status (read this first)
- **Phase 0–1: BUILT.** Real code, in the repo, compile-verified, cut engine tested against video. Covers: auth, projects, resumable upload, AssemblyAI transcription, transcript word-striking, EDL versioning, ffmpeg render worker, download. **Not yet deployed** — deployment is the NOW block below.
- **Phase 3: STUBBED.** `hermes/editor_ai.py` exists with the contract locked and `TODO(wire)` blocks; returns 501 until wired. No chat panel in the web app yet.
- **Phases 2, 4, 5: NOT BUILT.** Spec only (`docs/INTERFACE-SPEC.md`, `docs/PLAN-FIXES.md`).
- Never run against real infra yet — expect one or two small integration fixes on first deploy, not a rebuild.

One session per block. Each block says exactly what to paste to the bot and what "done" looks like. The Phase-3 handoff doc is bot-agnostic — works for Codex, Fable, whatever. Never let a session touch the two fixed interfaces: `apps/web/lib/edl.ts` (EDL contract) and `hermes/editor_ai.py` (AI contract).

---

## NOW — launch (you, no bot, ~25 min)
Follow `docs/LAUNCH-TODAY.md`. Dashboard clicks only. Bots can't do this part and will waste tokens pretending to.

**Done =** you cut a real clip by striking words and downloaded the MP4.

---

## SESSION 1 — Phase 3: AI editing (the point of the tool)
**Give the bot:** the cutroom repo + Hermes repo + `docs/BOT-HANDOFF-PHASE3.md` pasted verbatim (ignore the filename, it's bot-agnostic).

**Scope:** Hermes `/editor/ai` wiring · chat panel · apply-directly ⟷ suggest-approve toggle · EDL patch application + diff card. Part A (Hermes) is a clean stopping point if the session dies.

**Done =** "cut the filler and the ums" → diff card → accept → strikethroughs update → export is tighter. "give me a stronger hook" → chat reply in your voice, no patch.

**After:** add `HERMES_URL` + `CUTROOM_SHARED_SECRET` to Vercel, `CUTROOM_SHARED_SECRET` + Supabase creds to Hermes.

---

## SESSION 2 — Phase 1.5: cheap preview (small, high value)
**Give the bot:** cutroom repo + the "preview v1" section of `docs/INTERFACE-SPEC.md`.

**Scope:** a native `<video>` player above the transcript that plays the *cut* (skips removed ranges via `timeupdate` + seek). Click a word → seek there. Playhead highlights the current word. No Remotion yet — this is ~150 lines and makes the editor feel real.

**Done =** press play, watch the edit as it will export, without rendering.

---

## SESSION 3 — Phase 2: captions + overlays + WYSIWYG (the big one)
**Give the bot:** cutroom repo + full `docs/INTERFACE-SPEC.md` + `docs/PLAN-FIXES.md` §4.

**Scope:** Remotion component library (animated captions 3–4 presets, lower-thirds, transitions) · Remotion Player replaces the v1 preview · timeline strip · render path becomes ffmpeg-flatten → Remotion composite (Docker image adds Chromium). Biggest session by far — budget accordingly, split into 3a (captions only, end-to-end) and 3b (overlays + timeline) if needed.

**Done =** karaoke captions visible in preview, identical in the export.

---

## SESSION 4 — Phase 4: b-roll
**Scope:** Pexels search + manual upload + AI-suggested placements (Hermes already returns overlay patches — this is mostly UI + asset handling).

## SESSION 5 — Phase 5: polish
Keyboard shortcuts (⌫ strikes selection, space plays), export presets per orientation, music + ducking, AI SFX auto-suggestions.

---

## rules for every bot session (paste at the top each time)
1. Read only the files named in the brief. Do not explore or refactor.
2. `lib/edl.ts` and the Hermes contract are frozen interfaces.
3. Build in the order given; compile-check between parts; stop at acceptance.
4. No new deps without asking. No summaries over 5 lines.
