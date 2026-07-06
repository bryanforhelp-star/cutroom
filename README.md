# cutroom

personal editor for talking-head UGC. upload → transcribe → cut by striking words → export MP4. AI editing (via Hermes) lands in Phase 3.

**Phase 1 is fully implemented in this repo.** Phases 2–5 build on the same EDL contract — see `docs/PLAN-FIXES.md` for what changed from the original handoff spec and why.

```
apps/web          Next.js editor (Vercel)
services/render   worker: transcription + ffmpeg render (Railway, Docker)
supabase/         schema.sql — run once
hermes/           editor_ai.py — Phase 3 drop-in router, contract locked
docs/             PLAN-FIXES.md
```

## setup (~20 min)

### 1 · Supabase
1. New project (or reuse an existing one — tables are namespaced by nothing, so a fresh one is cleaner).
2. SQL editor → paste `supabase/schema.sql` → run.
3. Storage → create **private** bucket `media` → edit bucket → raise file size limit (2GB).
4. Auth → URL configuration → add your Vercel URL as site URL (magic links land there).
5. Grab: project URL, anon key, service role key.

### 2 · render worker (Railway)
1. New service → deploy from this repo, root directory `services/render` (Dockerfile is picked up automatically).
2. Env vars (see `services/render/.env.example`):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `ASSEMBLYAI_API_KEY` (assemblyai.com → free tier covers a lot of testing; swap for Deepgram later if you want — only `src/transcribe.ts` changes)
3. It's a pure worker — no public networking needed beyond the `/health` port.

### 3 · web (Vercel)
1. Import repo → root directory `apps/web`.
2. Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Deploy. Sign in with magic link. You're the only user.

### local dev
```bash
# web
cd apps/web && npm install && cp .env.example .env.local  # fill it
npm run dev

# worker
cd services/render && npm install && cp .env.example .env  # fill it
npm run dev   # needs ffmpeg installed locally
```

## how a project flows
1. create project → upload clip (resumable upload kicks in over 6MB)
2. web flips project to `transcribing` → worker sees it, runs AssemblyAI, writes word-level transcript, flips to `ready`
3. transcript panel: click a word to strike it, shift-click for ranges
4. **export mp4** → EDL version saved → render job queued → worker ffmpeg-cuts → download link

## fixed interfaces (don't move these)
- **EDL contract:** `apps/web/lib/edl.ts` — clips are SOURCE time, everything else TIMELINE time, captions derived not stored, transitions anchor to clip ids
- **Hermes AI contract:** `hermes/editor_ai.py` — `POST /editor/ai`, shared-secret header, patch-not-rewrite responses

## next phases
- **Phase 2** — Remotion component library (animated captions, lower-thirds, transitions) + timeline + WYSIWYG preview. Render path becomes: ffmpeg flattens cuts → Remotion composites over the flat file in timeline time.
- **Phase 3** — wire `hermes/editor_ai.py` to Hermes's Claude client + memory, add the chat panel + apply/suggest toggle + EDL diff UI.
- **Phase 4** — b-roll: AI-suggested placements, Pexels search, manual upload.
- **Phase 5** — presets, shortcuts, ducking, AI SFX suggestions.
