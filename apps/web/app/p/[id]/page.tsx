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
  const lastClicked = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data: p } = await supabase.from("projects").select("*").eq("id", id).single();
    setProject(p);
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

          <p className="hint" style={{ margin: "12px 0" }}>
            click a word to cut it. shift-click to cut a range. struck words are removed from the export.
          </p>

          <div className="transcript">
            {words.map((w, i) => (
              <span
                key={i}
                className={`word ${removed.has(i) ? "removed" : ""}`}
                onClick={(e) => toggleWord(i, e.shiftKey)}
              >
                {w.word}{" "}
              </span>
            ))}
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
