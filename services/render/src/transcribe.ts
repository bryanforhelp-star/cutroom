// Word-level transcription.
// Primary path: AssemblyAI. Local dev/VPS fallback: openai-whisper CLI with
// --word_timestamps True. Writes one transcripts row with source-time words.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { supabase, signedUrl } from "./supabase.js";

const execFileAsync = promisify(execFile);
const AAI = "https://api.assemblyai.com/v2";
const KEY = process.env.ASSEMBLYAI_API_KEY ?? "";

type AaiWord = { text: string; start: number; end: number }; // ms
type Word = { word: string; start: number; end: number };

async function writeTranscript(projectId: string, assetId: string, words: Word[]) {
  if (!words.length) throw new Error("transcription produced no words");
  const { error: insErr } = await supabase.from("transcripts").insert({ project_id: projectId, asset_id: assetId, words });
  if (insErr) throw new Error(`transcript insert failed: ${insErr.message}`);
}

async function transcribeWithAssemblyAI(projectId: string, assetId: string, audioUrl: string) {
  const submit = await fetch(`${AAI}/transcript`, {
    method: "POST",
    headers: { authorization: KEY, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: audioUrl, punctuate: true, format_text: true }),
  });
  if (!submit.ok) throw new Error(`AssemblyAI submit failed: ${submit.status} ${await submit.text()}`);
  const { id: jobId } = (await submit.json()) as { id: string };

  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${AAI}/transcript/${jobId}`, { headers: { authorization: KEY } });
    const body = (await res.json()) as { status: string; error?: string; words?: AaiWord[] };
    if (body.status === "completed") {
      const words = (body.words ?? []).map((w) => ({ word: w.text, start: w.start / 1000, end: w.end / 1000 }));
      await writeTranscript(projectId, assetId, words);
      return;
    }
    if (body.status === "error") throw new Error(`AssemblyAI error: ${body.error}`);
  }
  throw new Error("transcription timed out after 30 minutes");
}

async function transcribeWithLocalWhisper(projectId: string, assetId: string, audioUrl: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cutroom-whisper-"));
  const input = path.join(dir, "source.mp4");
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`download for local whisper failed: ${res.status}`);
  await fs.writeFile(input, Buffer.from(await res.arrayBuffer()));

  await execFileAsync(
    "whisper",
    [input, "--model", process.env.WHISPER_MODEL ?? "base", "--output_format", "json", "--output_dir", dir, "--word_timestamps", "True"],
    { timeout: 30 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 }
  );

  const parsed = JSON.parse(await fs.readFile(path.join(dir, "source.json"), "utf8"));
  const words: Word[] = [];
  for (const seg of parsed.segments ?? []) {
    for (const w of seg.words ?? []) {
      const text = String(w.word ?? "").trim();
      if (text) words.push({ word: text, start: Number(w.start), end: Number(w.end) });
    }
  }
  await writeTranscript(projectId, assetId, words);
}

export async function transcribeProject(projectId: string, assetId: string) {
  const { data: asset, error } = await supabase
    .from("assets")
    .select("id, storage_path")
    .eq("id", assetId)
    .single();
  if (error || !asset) throw new Error(`asset ${assetId} not found`);

  const audioUrl = await signedUrl(asset.storage_path, 7200);
  if (KEY) return transcribeWithAssemblyAI(projectId, assetId, audioUrl);
  return transcribeWithLocalWhisper(projectId, assetId, audioUrl);
}
