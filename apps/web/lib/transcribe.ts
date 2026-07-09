import { BUCKET, getServerSupabase } from "./serverSupabase";

const AAI = "https://api.assemblyai.com/v2";
const KEY = process.env.ASSEMBLYAI_API_KEY ?? "";

type AaiWord = { text: string; start: number; end: number };
export type TranscriptWord = { word: string; start: number; end: number };

async function signedUrl(path: string) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 7200);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "signed url failed");
  return data.signedUrl;
}

async function writeTranscript(projectId: string, assetId: string, words: TranscriptWord[]) {
  if (!words.length) throw new Error("transcription produced no words");
  const supabase = getServerSupabase();
  const { error } = await supabase.from("transcripts").insert({ project_id: projectId, asset_id: assetId, words });
  if (error) throw new Error(`transcript insert failed: ${error.message}`);
}

async function transcribeWithAssemblyAI(projectId: string, assetId: string, audioUrl: string) {
  if (!KEY) throw new Error("ASSEMBLYAI_API_KEY is not configured");

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
      return words;
    }
    if (body.status === "error") throw new Error(`AssemblyAI error: ${body.error}`);
  }
  throw new Error("transcription timed out after 30 minutes");
}

export async function transcribeProject(projectId: string) {
  const supabase = getServerSupabase();

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, status, source_asset_id")
    .eq("id", projectId)
    .single();
  if (pErr || !project) throw new Error(pErr?.message ?? "project not found");
  if (!project.source_asset_id) throw new Error("no source video uploaded yet");
  if (project.status === "ready") {
    const { data: existing } = await supabase
      .from("transcripts")
      .select("words")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { words: (existing?.words as TranscriptWord[] | null) ?? [], status: "ready" as const };
  }
  if (project.status !== "transcribing") throw new Error(`project is ${project.status}, not transcribing`);

  const { data: existing } = await supabase
    .from("transcripts")
    .select("id")
    .eq("project_id", projectId)
    .limit(1);
  if (existing?.length) {
    await supabase.from("projects").update({ status: "ready", error: null }).eq("id", projectId);
    const { data: transcript } = await supabase
      .from("transcripts")
      .select("words")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    return { words: (transcript?.words as TranscriptWord[]) ?? [], status: "ready" as const };
  }

  const { data: asset, error: aErr } = await supabase
    .from("assets")
    .select("id, storage_path")
    .eq("id", project.source_asset_id)
    .single();
  if (aErr || !asset) throw new Error(aErr?.message ?? "source asset not found");

  const audioUrl = await signedUrl(asset.storage_path);
  const words = await transcribeWithAssemblyAI(projectId, asset.id, audioUrl);
  await supabase.from("projects").update({ status: "ready", error: null }).eq("id", projectId);
  return { words, status: "ready" as const };
}
