"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, BUCKET } from "@/lib/supabase";
import UploadDropzone from "@/components/UploadDropzone";
import Player from "@/components/Player";
import ScriptMatch from "@/components/ScriptMatch";
import { isFiller } from "@/lib/align";
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

const PARAGRAPH_GAP = 1.2; // seconds of silence that starts a new paragraph

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [words, setWords] = useState<Word[] | null>(null);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [job, setJob] = useState<Job | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [seek, setSeek] = useState<{ t: number; nonce: number } | null>(null);
  const [playT, setPlayT] = useState(0);
  const history = useRef<Set<number>[]>([]);

  // every edit goes through commit so ⌘Z can walk back
  const commit = useCallback((next: Set<number>) => {
    setRemoved((prev) => {
      history.current.push(new Set(prev));
      if (history.current.length > 200) history.current.shift();
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (prev) setRemoved(prev);
  }, []);

  const load = useCallback(async () => {
    const { data: p } = await supabase.from("projects").select("*").eq("id", id).single();
    setProject(p);
    if (p?.status === "ready") {
      const { data: t } = await supabase
        .from("transcripts")
        .select("words")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (t?.length) setWords(t[0].words as Word[]);
      if (p.source_asset_id) {
        const { data: asset } = await supabase
          .from("assets")
          .select("storage_path")
          .eq("id", p.source_asset_id)
          .single();
        if (asset) {
          const { data: signed } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(asset.storage_path, 7200);
          setVideoUrl(signed?.signedUrl ?? null);
        }
      }
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (project?.status !== "transcribing") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [project?.status, load]);

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

  const clips = useMemo(() => (words ? buildClipsFromWords(words, removed) : []), [words, removed]);

  const paragraphs = useMemo(() => {
    if (!words) return [];
    const out: number[][] = [[]];
    words.forEach((w, i) => {
      if (i > 0 && w.start - words[i - 1].end > PARAGRAPH_GAP) out.push([]);
      out[out.length - 1].push(i);
    });
    return out;
  }, [words]);

  const activeIdx = useMemo(() => {
    if (!words) return -1;
    return words.findIndex((w) => playT >= w.start && playT < w.end);
  }, [words, playT]);

  // ── editing model: select text, press delete. that's it. ──
  function wordIdxFromNode(node: Node | null): number | null {
    let el: Element | null = node instanceof Element ? node : node?.parentElement ?? null;
    while (el && !(el instanceof HTMLElement && el.dataset.i !== undefined)) el = el.parentElement;
    return el ? parseInt((el as HTMLElement).dataset.i!, 10) : null;
  }

  const rangeFromSelection = useCallback((): [number, number] | null => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const a = wordIdxFromNode(sel.anchorNode);
    const b = wordIdxFromNode(sel.focusNode);
    if (a === null || b === null) return null;
    return [Math.min(a, b), Math.max(a, b)];
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        const r = rangeFromSelection();
        if (!r) return;
        e.preventDefault();
        const [a, b] = r;
        setRemoved((prev) => {
          history.current.push(new Set(prev));
          const next = new Set(prev);
          let allStruck = true;
          for (let k = a; k <= b; k++) if (!prev.has(k)) { allStruck = false; break; }
          for (let k = a; k <= b; k++) allStruck ? next.delete(k) : next.add(k);
          return next;
        });
        window.getSelection()?.removeAllRanges();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rangeFromSelection, undo]);

  // click a word → the video jumps there (only when it's a click, not a drag)
  function handleWordClick(i: number) {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (!words) return;
    setSeek({ t: words[i].start, nonce: Date.now() });
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

  const kept = keptDuration(clips);
  const total = words?.length ? words[words.length - 1].end : 0;
  const rendering = job && job.status !== "done" && job.status !== "error";

  return (
    <main className={project.status === "ready" ? "wrap wide" : "wrap"}>
      <div className="toolbar">
        <div className="row">
          <Link href="/" className="brand">‹ cutroom</Link>
          <span className="proj-name">{project.name}</span>
        </div>
        <div className="row">
          {words && (
            <span className="duration">
              {fmtTime(kept)}<s>{fmtTime(total)}</s>
            </span>
          )}
          <button className="ghost" onClick={undo} disabled={!history.current.length}>
            undo
          </button>
          <button onClick={exportCut} disabled={!!rendering || clips.length === 0 || !words}>
            {rendering ? "rendering…" : "export"}
          </button>
        </div>
      </div>

      {project.status === "created" && (
        <>
          <p className="sub" style={{ marginTop: 24 }}>no source yet.</p>
          <UploadDropzone projectId={project.id} onDone={load} />
        </>
      )}

      {project.status === "transcribing" && (
        <div className="card" style={{ marginTop: 24 }}>
          <span className="status">transcribing — this page refreshes itself.</span>
        </div>
      )}

      {project.status === "error" && (
        <div className="card" style={{ marginTop: 24 }}>
          <span className="status err">{project.error ?? "something broke"}</span>
        </div>
      )}

      {project.status === "ready" && words && (
        <div className="editor-grid">
          <aside className="player-col">
            {videoUrl ? (
              <Player src={videoUrl} clips={clips} seek={seek} onTime={setPlayT} />
            ) : (
              <div className="card"><span className="status">loading video…</span></div>
            )}
            {job?.status === "error" && (
              <div className="card"><span className="status err">render failed: {job.error}</span></div>
            )}
            {downloadUrl && (
              <div className="card done-card">
                <span className="status ok">done · {fmtTime(kept)}</span>
                <a href={downloadUrl} download><button>download</button></a>
              </div>
            )}
          </aside>

          <section className="doc-col">
            <ScriptMatch
              words={words}
              onApply={(r) => commit(r)}
              onUndo={undo}
              canUndo={history.current.length > 0}
            />
            <div className="transcript">
              {paragraphs.map((para, pi) => (
                <p key={pi}>
                  {para.map((i) => (
                    <span
                      key={i}
                      data-i={i}
                      className={[
                        "word",
                        removed.has(i) ? "removed" : "",
                        i === activeIdx ? "playing" : "",
                        isFiller(words[i].word) ? "filler" : "",
                      ].join(" ")}
                      onClick={() => handleWordClick(i)}
                    >
                      {words[i].word}{" "}
                    </span>
                  ))}
                </p>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 20 }}>
              highlight text and press delete to cut · delete again to restore · click a word to jump the video · ⌘z to undo
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
