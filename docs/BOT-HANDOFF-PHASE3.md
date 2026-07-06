# fable handoff — phase 3 only (AI editing)

**Budget note for the operator (Kyndall):** you have limited usage. This prompt is scoped to Phase 3 only and written to minimize exploration. Open the session with BOTH repos available (cutroom + Hermes), paste everything below the line, attach nothing else — the file paths in here are exact.

---

You are building **Phase 3 of cutroom** — the AI editing layer. Phases 0–1 are already built, deployed, and working. Do not touch, refactor, or "improve" them. Do not scaffold Phases 2, 4, or 5.

## token discipline (follow strictly)
- Do NOT explore the repos. The exact files you need are listed below — read only those.
- Do NOT re-derive architecture. The contracts are fixed and already in code.
- No new dependencies unless something below is impossible without one.
- Build in the order given. Confirm each part compiles before the next. No end-of-task summaries longer than 5 lines.

## fixed contracts — read these two files first, change neither interface
1. `cutroom/apps/web/lib/edl.ts` — EDL v1.1. Clips = SOURCE time; overlays/sfx/music = TIMELINE time; captions are config-only (derived, never stored); transitions anchor to clip ids.
2. `cutroom/hermes/editor_ai.py` — the `POST /editor/ai` request/response contract, shared-secret header, patch-not-rewrite format. The system prompt and patch schema in this file are the spec.

## part A — wire Hermes (python repo)
1. Read Hermes's main entrypoint to find: the existing Anthropic/Claude client, the memory/voice retrieval (voice_v3 / taste rules), and how config/env is loaded. Read only what you need for those three things.
2. Move `cutroom/hermes/editor_ai.py` into the Hermes repo. Replace the `TODO(wire)` blocks:
   - `mode="chat"` → Claude call with Kyndall's voice/brand context injected from Hermes memory. Return `{reply}`.
   - `mode="edit"` → Claude call with the EDIT_SYSTEM prompt in the file + the EDL + transcript excerpt. Parse the JSON patch. Return `{reply, edl_patch, requires_approval}` where `requires_approval` echoes the request flag.
   - Load per-project chat history from Supabase `ai_messages` (last ~20), append the new exchange after responding.
3. Run FastAPI alongside the existing bot: uvicorn in a daemon thread from Hermes's main, port from `PORT` env (Railway). Auth stays the shared-secret header; secret from `CUTROOM_SHARED_SECRET` env.
4. Defensive: if memory retrieval fails, proceed with a minimal system prompt rather than erroring.
5. Done when: `curl -X POST /editor/ai` with a sample edit request returns a valid patch.

## part B — cutroom chat panel (next.js repo)
Files to create/modify — nothing else:
- `apps/web/app/api/ai/route.ts` (new): server route that forwards to Hermes. Reads `HERMES_URL` + `CUTROOM_SHARED_SECRET` from server env (never expose to browser). Passes through the contract verbatim.
- `apps/web/components/AIPanel.tsx` (new): chat panel scoped to the project. Message list (persist to `ai_messages` table), input, and a toggle: **apply directly ⟷ suggest & approve** (sets `requires_approval` on the request).
- `apps/web/lib/patch.ts` (new): `applyPatch(edl, patch)` implementing the patch ops from editor_ai.py's EDIT_SYSTEM: full `clips` replacement, `add_overlays`, `remove_ids`, `modify` (by id, shallow `set`), `add_sfx`, full `transitions` replacement. Pure function, unit-testable.
- `apps/web/app/p/[id]/page.tsx` (modify minimally): mount AIPanel; hold current EDL in state (build from words+removed as today); on edit response:
  - `requires_approval=false` → apply patch immediately, show one-line reply.
  - `requires_approval=true` → show a diff card (human summary: "removes 7 segments (~9s), adds 1 lower-third") with accept / reject.
  - When a patch changes `clips`, reverse-map: mark transcript words outside the new clip ranges as removed so the strikethrough view stays in sync.
- Export flow unchanged — an applied patch just feeds the same EDL versioning + render job path that exists.

Context sent to Hermes per request: current EDL + transcript words (cap at ~1500 words — send all if under, else the window around the current edit) + orientation.

## env vars to tell the operator to add at the end
- Vercel: `HERMES_URL`, `CUTROOM_SHARED_SECRET`
- Hermes/Railway: `CUTROOM_SHARED_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (for ai_messages)

## acceptance (stop when these pass)
1. "cut the filler and the ums" in suggest mode → diff card → accept → strikethroughs update → export produces the tightened MP4.
2. Same command in apply-directly mode → applies with no approval step.
3. "give me a stronger hook for the open" → chat reply, no patch, in her voice.
4. Refresh the page → chat history persists.

Do not continue past acceptance. Phase 2 (Remotion/captions) is a separate future session.
