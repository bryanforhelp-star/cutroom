# plan fixes — what changed from the handoff spec and why

The architecture holds up. These are the specific things I changed before building, so the spec and the code don't drift.

## 1 · captions are no longer stored in the EDL
The spec duplicated word timestamps into `caption_track.words`. That's a sync bug factory: every cut would require re-deriving and re-writing the caption words, and the AI patching one but not the other silently desyncs them. **Fix:** the EDL stores only caption *config* (`enabled`, `preset`, style overrides). Caption words are derived at preview/render time from `transcript ∩ clips`, remapped to timeline time. One source of truth.

## 2 · transitions anchor to clip ids, not timestamps
`"at": 18.7` breaks the moment you nudge a cut. **Fix:** `{ "after_clip": "c1", "type": "crossfade", "duration": 0.3 }`. Survives any re-trim or reorder.

## 3 · explicit time-space convention (this was the biggest ambiguity)
The spec mixed source time and timeline time without saying which was which (`clips.in/out` were source, overlay `start/end` looked like timeline, SFX `at: 18.7` matched a *source* timestamp). Locked convention, now stated in the EDL itself:
- **`clips.in/out` → SOURCE time** (they reference the raw upload)
- **everything else (overlays, sfx, music, caption rendering) → TIMELINE time** (post-cut)

Known consequence: changing cuts shifts timeline-anchored items. Acceptable for v1; Phase 2 can optionally anchor overlays to clip ids too.

## 4 · Phase 1 renders with pure ffmpeg — Remotion enters at Phase 2
Phase 1 is plain cuts. Spinning up headless Chromium to concatenate video is ~10x slower and heavier for zero visual benefit. **Fix:** Phase 1 = ffmpeg trim/concat re-encode. Phase 2 = ffmpeg flattens the cuts first, then Remotion composites captions/overlays over the flattened file in timeline time (this is also the performant pattern — Remotion never seeks around a long source). WYSIWYG principle is untouched: the browser preview and server render still share the same Remotion components from Phase 2 on.

## 5 · render service is a pure worker — zero inbound API
The spec had the frontend calling the render service (job submit + a transcription endpoint), which means exposing a Railway URL and managing a shared secret in the web app. **Fix:** the worker polls Postgres. Web inserts a `render_jobs` row → worker claims it. Web sets `projects.status='transcribing'` → worker picks it up and runs AssemblyAI. No inbound surface except `/health`, no secrets in the browser, jobs survive restarts for free.

## 6 · uploads: resumable, and raise the bucket limit
Supabase Storage defaults to a 50MB per-file limit — a 60s 1080×1920 source will blow past it. The web app uses Supabase's resumable (TUS) upload for anything over 6MB. You still need to raise the `media` bucket limit in the dashboard (note in schema.sql).

## 7 · transcription runs on the worker, not Vercel
AssemblyAI jobs take longer than a Vercel function timeout wants to hold. The worker (long-running box) submits a signed URL and polls. Nothing serverless ever waits on it.

## 8 · Hermes: run FastAPI alongside the bot, contract unchanged
Hermes is an APScheduler/Telegram process — adding a synchronous route means running uvicorn in the same service (thread) or as a sibling process. `hermes/editor_ai.py` is a drop-in router with the exact §7 contract, stubbed where it needs your existing Claude client + memory retrieval. Phase 3 work; included now so the contract is locked in code.

## 9 · Remotion licensing note
Remotion needs a paid license for companies >3 people. Solo/individual use is free — you qualify — just flagging it before it's load-bearing.

## everything else
Stack, EDL-as-contract, build order, single-user auth (magic link), export-file-only, AI-through-Hermes-only: unchanged. §6 and §7 remain the fixed interfaces.
