// Phase 1 render: download source, ffmpeg trim/concat re-encode, upload MP4.
// Now also honors simple EDL effects: lower-third text overlays and clip-level zoom keyframes.

import { createWriteStream } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { supabase, signedUrl, BUCKET } from "./supabase.js";

type Clip = { id: string; asset: string; in: number; out: number };
type Overlay = { id: string; type: "lower_third" | "broll"; text?: string; start: number; end: number; preset?: string };
type Transition = { after_clip: string; type: "cut" | "crossfade" | "punch_in"; duration: number };
type KeyframeTrack = { id: string; clipId: string; property: "zoom"; keyframes: { at: number; scale: number; x?: number; y?: number }[] };
type EDL = {
  version: number;
  canvas: { w: number; h: number; fps: number };
  clips: Clip[];
  overlays?: Overlay[];
  transitions?: Transition[];
  keyframes?: KeyframeTrack[];
};

export async function processRenderJob(projectId: string, editListId: string, jobId: string) {
  const { data: el, error } = await supabase
    .from("edit_lists")
    .select("edl")
    .eq("id", editListId)
    .single();
  if (error || !el) throw new Error(`edit_list ${editListId} not found`);
  const edl = el.edl as EDL;
  if (!edl.clips?.length) throw new Error("EDL has no clips");

  const { data: project } = await supabase
    .from("projects")
    .select("source_asset_id")
    .eq("id", projectId)
    .single();
  const { data: asset } = await supabase
    .from("assets")
    .select("storage_path")
    .eq("id", project!.source_asset_id)
    .single();
  if (!asset) throw new Error("source asset not found");

  const work = await mkdtemp(join(tmpdir(), "cutroom-"));
  try {
    const src = join(work, "source.mp4");
    const out = join(work, "output.mp4");

    const url = await signedUrl(asset.storage_path, 3600);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`source download failed: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(src));

    await runFfmpeg(src, edl, out);

    const outputPath = `${projectId}/renders/${jobId}.mp4`;
    const bytes = await readFile(out);
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(outputPath, bytes, { contentType: "video/mp4", upsert: true });
    if (upErr) throw new Error(`output upload failed: ${upErr.message}`);
    return outputPath;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function runFfmpeg(src: string, edl: EDL, out: string) {
  const parts: string[] = [];
  const refs: string[] = [];
  const zoomByClip = new Map((edl.keyframes ?? []).map((k) => [k.clipId, Math.max(...k.keyframes.map((f) => f.scale), 1)]));

  edl.clips.forEach((c, i) => {
    const explicitZoom = zoomByClip.get(c.id);
    const punchZoom = (edl.transitions ?? []).some((t) => t.after_clip === c.id && t.type === "punch_in") ? 1.12 : 1;
    const scale = explicitZoom ?? punchZoom;
    const zoom = scale > 1
      ? `,scale=trunc(iw*${scale}/2)*2:trunc(ih*${scale}/2)*2,crop=trunc(iw/${scale}/2)*2:trunc(ih/${scale}/2)*2`
      : "";
    parts.push(`[0:v]trim=start=${c.in}:end=${c.out},setpts=PTS-STARTPTS${zoom}[v${i}]`);
    parts.push(`[0:a]atrim=start=${c.in}:end=${c.out},asetpts=PTS-STARTPTS[a${i}]`);
    refs.push(`[v${i}][a${i}]`);
  });

  const videoChain = buildVideoPostChain(edl.overlays ?? []);
  const filter = `${parts.join(";")};${refs.join("")}concat=n=${edl.clips.length}:v=1:a=1[vcat][a];${videoChain}`;

  const args = [
    "-y", "-i", src,
    "-filter_complex", filter,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    out,
  ];

  return new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`))
    );
    proc.on("error", reject);
  });
}

function buildVideoPostChain(overlays: Overlay[]) {
  const lowerThirds = overlays.filter((o) => o.type === "lower_third" && o.text && o.end > o.start);
  if (!lowerThirds.length) return "[vcat]format=yuv420p[v]";
  let input = "vcat";
  const filters: string[] = [];
  lowerThirds.forEach((o, i) => {
    const out = i === lowerThirds.length - 1 ? "v" : `ov${i}`;
    filters.push(`[${input}]drawtext=text='${escapeDrawtext(o.text!)}':x=(w-text_w)/2:y=h-(text_h*3):fontsize=54:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=24:enable='between(t,${o.start},${o.end})'[${out}]`);
    input = out;
  });
  return filters.join(";");
}

function escapeDrawtext(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%");
}
