"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, BUCKET } from "@/lib/supabase";
import UploadDropzone from "@/components/UploadDropzone";
import { buildClipsFromWords, buildPhase1EDL, keptDuration, fmtTime, type Word } from "@/lib/edl";

type Project = {
  id: string;
  name: string;
  status: string;
  orientation: string;
  source_asset_id: string | null;
  error: string | null;
};
type Job = { id: string; status: string; output_path: string | null; error: string | null };

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [words, setWords] = useState<Word[] | null>(null);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [job, setJob] = useState<Job | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastClicked = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data: p } = await supabase.from("projects").select("*").eq("id", id).single();
    setProject(p);
    if (p?.source_asset_id) {
      const { data: asset } = await supabase
        .from("assets")
        .select("storage_path")
        .eq("id", p.source_asset_id)
        .single();
      if (asset?.storage_path) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(asset.storage_path, 3600);
        setVideoUrl(signed?.signedUrl ?? null);
      }
    }
    if (p?.status === "ready" || p?.status === "error") {
      const { data: t } = await supabase
        .from("transcripts")
        .select("words")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (t?.length) setWords(t[0].words as Word[]);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // poll while transcribing
  useEffect(() => {
    if (project?.status !== "transcribing") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [project?.status, load]);

  // poll active render job
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const t = setInterval(async () => {
      const { data } = await supabase.from("render_jobs").select("*").eq("id", job.id).single();
      if (data) {
        setJob(data);
        if (data.status === "done" && data.output_path) {
          const { data: signed } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(data.output_path, 3600);
          setDownloadUrl(signed?.signedUrl ?? null);
        }
      }
    }, 3000);
    return () => clearInterval(t);
  }, [job]);

  function toggleWord(i: number, shift: boolean) {
    if (!shift && videoRef.current) videoRef.current.currentTime = words?.[i]?.start ?? videoRef.current.currentTime;
    setRemoved((prev) => {
      const next = new Set(prev);
      if (shift && lastClicked.current !== null) {
        const [a, b] = [Math.min(lastClicked.current, i), Math.max(lastClicked.current, i)];
        const striking = !prev.has(i);
        for (let k = a; k <= b; k++) striking ? next.add(k) : next.delete(k);
      } else {
        next.has(i) ? next.delete(i) : next.add(i);
      }
      lastClicked.current = i;
      return next;
    });
  }

  function onPreviewTimeUpdate() {
    const video = videoRef.current;
    if (!video || !clips.length) return;
    const t = video.currentTime;
    setPlayhead(t);
    const inside = clips.find((c) => t >= c.in && t <= c.out);
    if (!inside && !video.paused) {
      const next = clips.find((c) => c.in > t);
      if (next) video.currentTime = next.in;
      else video.pause();
    }
  }

  function currentWordIndex() {
    if (!words) return -1;
    return words.findIndex((w) => playhead >= w.start && playhead <= w.end);
  }

  function seekToStart() {
    if (videoRef.current && clips.length) videoRef.current.currentTime = clips[0].in;
  }

  async function exportCut() {
    if (!words || !project) return;
    setDownloadUrl(null);
    const edl = buildPhase1EDL(words, removed, project.orientation);

    const { data: prev } = await supabase
      .from("edit_lists")
      .select("version")
      .eq("project_id", id)
      .order("version", { ascending: false })
      .limit(1);
    const version = (prev?.[0]?.version ?? 0) + 1;

    const { data: el, error: elErr } = await supabase
      .from("edit_lists")
      .insert({ project_id: id, version, edl })
      .select("id")
      .single();
    if (elErr || !el) return alert(elErr?.message ?? "edit list insert failed");

    const { data: j, error: jErr } = await supabase
      .from("render_jobs")
      .insert({ project_id: id, edit_list_id: el.id, status: "queued" })
      .select("*")
      .single();
    if (jErr || !j) return alert(jErr?.message ?? "render job insert failed");
    setJob(j);
  }

  if (!project) return <main className="wrap"><span className="status">loading…</span></main>;

  const clips = words ? buildClipsFromWords(words, removed) : [];
  const activeWord = currentWordIndex();
  const kept = keptDuration(clips);
  const total = words?.length ? words[words.length - 1].end : 0;
  const rendering = job && job.status !== "done" && job.status !== "error";

  return (
    <main className="wrap">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link href="/" className="brand">cutroom</Link>
        <span className={`status ${project.status === "ready" ? "ok" : project.status === "error" ? "err" : ""}`}>
          {project.status}
        </span>
      </div>
      <h1 className="h1">{project.name}</h1>

      {project.status === "created" && (
        <>
          <p className="sub">no source yet.</p>
          <UploadDropzone projectId={project.id} onDone={load} />
        </>
      )}

      {project.status === "transcribing" && (
        <div className="card">
          <span className="status">transcribing — word timestamps incoming. this page refreshes itself.</span>
        </div>
      )}

      {project.status === "error" && (
        <div className="card">
          <span className="status err">{project.error ?? "something broke"}</span>
        </div>
      )}

      {project.status === "ready" && words && (
        <>
          <div className="toolbar">
            <span className="duration">
              {fmtTime(kept)} kept<s>{fmtTime(total)} original</s>
            </span>
            <div className="row">
              <button className="ghost" onClick={() => setRemoved(new Set())} disabled={!removed.size}>
                reset
              </button>
              <button onClick={exportCut} disabled={!!rendering || clips.length === 0}>
                {rendering ? "rendering…" : "export mp4"}
              </button>
            </div>
          </div>

          <div className="editor-grid">
            <section className="preview-panel">
              {videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    playsInline
                    onTimeUpdate={onPreviewTimeUpdate}
                    onPlay={seekToStart}
                  />
                  <div className="preview-meta">
                    <span className="status">preview skips struck words</span>
                    <span className="duration">{fmtTime(playhead)} / {fmtTime(kept)}</span>
                  </div>
                </>
              ) : (
                <div className="preview-empty">source preview loading…</div>
              )}
            </section>

            <section className="transcript-panel">
              <p className="hint" style={{ margin: "0 0 12px" }}>
                click a word to cut it. shift-click to cut a range. press play to watch the cut.
              </p>
              <div className="transcript">
                {words.map((w, i) => (
                  <span key={i}>
                    {i > 0 && w.start - words[i - 1].end > 1.2 && <><br /><br /></>}
                    <span
                      className={`word ${removed.has(i) ? "removed" : ""} ${activeWord === i ? "playing" : ""}`}
                      onClick={(e) => toggleWord(i, e.shiftKey)}
                    >
                      {w.word}{" "}
                    </span>
                  </span>
                ))}
              </div>
            </section>
          </div>

          {job?.status === "error" && (
            <div className="card" style={{ marginTop: 16 }}>
              <span className="status err">render failed: {job.error}</span>
            </div>
          )}
          {downloadUrl && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="status ok">render done · {clips.length} clips · {fmtTime(kept)}</span>
                <a href={downloadUrl} download>
                  <button>download mp4</button>
                </a>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
