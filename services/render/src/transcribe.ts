// AssemblyAI word-level transcription (§9 decision).
// worker submits a signed Storage URL, polls until complete, writes transcripts row.

import { supabase, signedUrl } from "./supabase.js";

const AAI = "https://api.assemblyai.com/v2";
const KEY = process.env.ASSEMBLYAI_API_KEY ?? "";

type AaiWord = { text: string; start: number; end: number }; // ms

export async function transcribeProject(projectId: string, assetId: string) {
  if (!KEY) throw new Error("ASSEMBLYAI_API_KEY not set");

  const { data: asset, error } = await supabase
    .from("assets")
    .select("id, storage_path")
    .eq("id", assetId)
    .single();
  if (error || !asset) throw new Error(`asset ${assetId} not found`);

  const audioUrl = await signedUrl(asset.storage_path, 7200);

  const submit = await fetch(`${AAI}/transcript`, {
    method: "POST",
    headers: { authorization: KEY, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: audioUrl, punctuate: true, format_text: true }),
  });
  if (!submit.ok) throw new Error(`AssemblyAI submit failed: ${submit.status} ${await submit.text()}`);
  const { id: jobId } = (await submit.json()) as { id: string };

  // poll
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${AAI}/transcript/${jobId}`, { headers: { authorization: KEY } });
    const body = (await res.json()) as { status: string; error?: string; words?: AaiWord[] };
    if (body.status === "completed") {
      const words = (body.words ?? []).map((w) => ({
        word: w.text,
        start: w.start / 1000, // seconds, SOURCE time
        end: w.end / 1000,
      }));
      const { error: insErr } = await supabase
        .from("transcripts")
        .insert({ project_id: projectId, asset_id: assetId, words });
      if (insErr) throw new Error(`transcript insert failed: ${insErr.message}`);
      return;
    }
    if (body.status === "error") throw new Error(`AssemblyAI error: ${body.error}`);
  }
  throw new Error("transcription timed out after 30 minutes");
}
