# launch today — ~25 min, zero code, zero fable usage

Do these in order. Everything is dashboard clicks + pasting env vars. Don't hand this part to the bot — it can't click dashboards and will burn tokens narrating.

## 1 · Supabase (~8 min)
- [ ] New project (fresh one, don't share with Joltra's DB)
- [ ] SQL editor → paste all of `supabase/schema.sql` → run → confirm 6 tables exist
- [ ] Storage → new bucket → name `media` → **private** → create
- [ ] Edit bucket → file size limit → **2 GB**
- [ ] Copy three values somewhere: **Project URL**, **anon key**, **service_role key** (Settings → API)

## 2 · AssemblyAI (~3 min)
- [ ] assemblyai.com → sign up → copy API key (free tier ≈ hundreds of transcription minutes, plenty)

## 3 · Railway — render worker (~6 min)
- [ ] Push the cutroom repo to GitHub (private)
- [ ] Railway → new service → deploy from repo → **root directory: `services/render`** (Dockerfile auto-detected)
- [ ] Variables:
  ```
  SUPABASE_URL=            (project URL from step 1)
  SUPABASE_SERVICE_ROLE_KEY=
  ASSEMBLYAI_API_KEY=
  ```
- [ ] Deploy → logs should show `cutroom render worker up`
- [ ] No public domain needed. It's a worker.

## 4 · Vercel — web (~5 min)
- [ ] Import same repo → **root directory: `apps/web`**
- [ ] Env vars:
  ```
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_ANON_KEY=
  ```
- [ ] Deploy → copy the deployment URL
- [ ] Back in Supabase: Authentication → URL Configuration → **Site URL = your Vercel URL** (magic links break without this)

## 5 · smoke test (~5 min)
- [ ] Open the Vercel URL → enter your email → click the magic link
- [ ] Create a project → drop in a short talking-head clip (30–60s)
- [ ] Status flips to `transcribing`, then `ready` (~30–90s) — page polls itself
- [ ] Strike a few words / a filler sentence → **export mp4** → wait for the download card
- [ ] Watch the export. Cuts should be clean at word boundaries.

**If transcription stalls:** check Railway logs first — it's always the AssemblyAI key or the bucket name.
**If magic link 404s:** step 4's Site URL.

You're live. Cut something real with it today before spending Fable on Phase 3 — one real edit session will tell the bot (and you) what actually matters next.
