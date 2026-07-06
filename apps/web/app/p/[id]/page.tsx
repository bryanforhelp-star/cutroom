"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, BUCKET } from "@/lib/supabase";
import UploadDropzone from "@/components/UploadDropzone";
import AIPanel from "@/components/AIPanel";
import Player from "@/components/Player";
import ScriptMatch from "@/components/ScriptMatch";
import Timeline from "@/components/Timeline";
import { isFiller } from "@/lib/align";
import { applyEditCommand, createInitialEditState, type EditCommand, type EditState } from "@/lib/editorCommands";
import { buildPhase1EDL, keptDuration, fmtTime, type Word } from "@/lib/edl";

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
  const [editState, setEditState] = useState<EditState | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [seek, setSeek] = useState<{ t: number; nonce: number } | null>(null);
  const [playT, setPlayT] = useState(0);
  const [scriptDraft, setScriptDraft] = useState("");
  const history = useRef<Set<number>[]>([]);

  // every edit goes through this path so ⌘Z can walk back
  const commitRemoved = useCallback((next: Set<number>) => {
    setEditState((prev) => {
      if (!prev) return prev;
      history.current.push(new Set(prev.removedWordIndexes));
      if (history.current.length > 200) history.current.shift();
      const nextState = createInitialEditState(prev.sourceWords, next);
      return { ...nextState, transitions: prev.transitions, overlays: prev.overlays, keyframes: prev.keyframes, scriptSections: prev.scriptSections };
    });
  }, []);

  const runCommand = useCallback((command: EditCommand) => {
    setEditState((prev) => {
      if (!prev) return prev;
      history.current.push(new Set(prev.removedWordIndexes));
      if (history.current.length > 200) history.current.shift();
      return applyEditCommand(prev, command);
    });
  }, []);

  const runCommands = useCallback((commands: EditCommand[]) => {
    setEditState((prev) => {
      if (!prev) return prev;
      history.current.push(new Set(prev.removedWordIndexes));
      if (history.current.length > 200) history.current.shift();
      return commands.reduce((state, command) => applyEditCommand(state, command), prev);
    });
  }, []);

  const undo = useCallback(() => {
    const prevRemoved = history.current.pop();
    if (prevRemoved) {
      setEditState((prev) => {
        if (!prev) return prev;
        const nextState = createInitialEditState(prev.sourceWords, prevRemoved);
        return { ...nextState, transitions: prev.transitions, overlays: prev.overlays, keyframes: prev.keyframes, scriptSections: prev.scriptSections };
      });
    }
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
      if (t?.length) {
        const nextWords = t[0].words as Word[];
        setWords(nextWords);
        setEditState((prev) => prev?.sourceWords.length === nextWords.length ? prev : createInitialEditState(nextWords));
      }
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

  const removed = editState?.removedWordIndexes ?? new Set<number>();
  const clips = editState?.clips ?? [];

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
        const next = new Set(removed);
        let allStruck = true;
        for (let k = a; k <= b; k++) if (!removed.has(k)) { allStruck = false; break; }
        for (let k = a; k <= b; k++) allStruck ? next.delete(k) : next.add(k);
        commitRemoved(next);
        window.getSelection()?.removeAllRanges();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rangeFromSelection, undo, removed, commitRemoved]);

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
    if (editState) {
      edl.clips = editState.clips;
      edl.transitions = editState.transitions;
      edl.keyframes = editState.keyframes;
      edl.overlays = editState.overlays.map(({ position, ...overlay }) => overlay);
    }

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

      {project.status === "ready" && words && editState && (
        <>
          <div className="editor-grid">
            <section className="doc-col">
              <ScriptMatch
                words={words}
                onApply={(r) => commitRemoved(r)}
                onUndo={undo}
                canUndo={history.current.length > 0}
              />
              <div className="script-assembly card">
                <div className="timeline-head">
                  <span>script order</span>
                  <button className="small" disabled={!scriptDraft.trim()} onClick={() => runCommand({ type: "assemble_from_script", script: scriptDraft })}>find + assemble</button>
                </div>
                <textarea
                  value={scriptDraft}
                  onChange={(e) => setScriptDraft(e.target.value)}
                  placeholder={"hook: paste the first beat\nproof: paste the proof beat\ncta: paste the ending"}
                  rows={4}
                />
                {!!editState.scriptSections.length && (
                  <div className="script-sections">
                    {editState.scriptSections.map((s) => (
                      <button key={s.id} className="ghost small" onClick={() => setSeek({ t: words[s.wordStartIndex].start, nonce: Date.now() })}>
                        {s.label} · {(s.score * 100).toFixed(0)}%
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="ai-command-bar">
                <button className="ghost small" onClick={() => runCommand({ type: "remove_fillers" })}>ai: remove fillers</button>
                <button className="ghost small" onClick={() => clips[0] && runCommand({ type: "add_transition", afterClipId: clips[0].id, transition: "crossfade", duration: 0.18 })}>ai: add transition</button>
              </div>
              <div className="transcript">
                {paragraphs.map((para, pi) => (
                  <p key={pi}>
                    {para.filter((i) => !removed.has(i)).map((i) => (
                      <span
                        key={i}
                        data-i={i}
                        className={[
                          "word",
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
                highlight text and press delete to cut · drag timeline range for precision cuts · click a word to jump · ⌘z to undo
              </p>
            </section>

            <aside className="player-col">
              <AIPanel
                projectId={project.id}
                scriptDraft={scriptDraft}
                playT={playT}
                clips={clips}
                scriptSections={editState.scriptSections}
                onRunCommands={runCommands}
                onScriptDraftChange={setScriptDraft}
              />
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
          </div>

          <Timeline
            words={words}
            clips={clips}
            playT={playT}
            overlays={editState.overlays}
            keyframes={editState.keyframes}
            scriptSections={editState.scriptSections}
            onSeek={(t) => setSeek({ t, nonce: Date.now() })}
            onCutRange={(sourceStart, sourceEnd) => runCommand({ type: "cut_range", sourceStart, sourceEnd })}
            onAddTransition={(afterClipId) => runCommand({ type: "add_transition", afterClipId, transition: "crossfade", duration: 0.18 })}
            onAddOverlay={() => runCommand({ type: "add_text_overlay", text: "hook moment", start: Math.max(0, playT), end: Math.max(playT + 2, 2), position: "bottom-center", preset: "bold" })}
            onAddZoom={(clipId) => runCommand({ type: "add_zoom_keyframes", clipId, keyframes: [{ at: playT, scale: 1 }, { at: playT + 0.7, scale: 1.14, x: 0.5, y: 0.42 }] })}
          />
        </>
      )}
    </main>
  );
}
