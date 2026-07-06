// cutroom render worker
// pure worker: polls Supabase Postgres for work. no inbound API except /health.
//  - projects with status='transcribing'  -> run AssemblyAI, write transcript
//  - render_jobs with status='queued'     -> ffmpeg cut/concat, upload MP4

import http from "node:http";
import { supabase } from "./supabase.js";
import { transcribeProject } from "./transcribe.js";
import { processRenderJob } from "./render.js";

const POLL_MS = 3000;
let busyTranscribe = false;
let busyRender = false;

async function pollTranscriptions() {
  if (busyTranscribe) return;
  const { data, error } = await supabase
    .from("projects")
    .select("id, source_asset_id")
    .eq("status", "transcribing")
    .limit(1);
  if (error || !data?.length) return;

  busyTranscribe = true;
  const project = data[0];
  try {
    console.log(`[transcribe] project ${project.id}`);
    await transcribeProject(project.id, project.source_asset_id);
    await supabase.from("projects").update({ status: "ready" }).eq("id", project.id);
    console.log(`[transcribe] done ${project.id}`);
  } catch (err: any) {
    console.error(`[transcribe] failed ${project.id}:`, err);
    await supabase
      .from("projects")
      .update({ status: "error", error: String(err?.message ?? err) })
      .eq("id", project.id);
  } finally {
    busyTranscribe = false;
  }
}

async function pollRenders() {
  if (busyRender) return;
  const { data, error } = await supabase
    .from("render_jobs")
    .select("id, project_id, edit_list_id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error || !data?.length) return;

  const job = data[0];
  // claim: only proceed if we flipped it from queued -> processing
  const { data: claimed } = await supabase
    .from("render_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id");
  if (!claimed?.length) return;

  busyRender = true;
  try {
    console.log(`[render] job ${job.id}`);
    const outputPath = await processRenderJob(job.project_id, job.edit_list_id, job.id);
    await supabase
      .from("render_jobs")
      .update({ status: "done", output_path: outputPath, updated_at: new Date().toISOString() })
      .eq("id", job.id);
    console.log(`[render] done ${job.id} -> ${outputPath}`);
  } catch (err: any) {
    console.error(`[render] failed ${job.id}:`, err);
    await supabase
      .from("render_jobs")
      .update({ status: "error", error: String(err?.message ?? err), updated_at: new Date().toISOString() })
      .eq("id", job.id);
  } finally {
    busyRender = false;
  }
}

setInterval(pollTranscriptions, POLL_MS);
setInterval(pollRenders, POLL_MS);

// health check so Railway is happy
const port = Number(process.env.PORT ?? 8080);
http
  .createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "cutroom-render" }));
  })
  .listen(port, () => console.log(`cutroom render worker up · health on :${port}`));
