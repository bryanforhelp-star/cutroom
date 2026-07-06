"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, BUCKET } from "@/lib/supabase";
import UploadDropzone from "@/components/UploadDropzone";
import Player from "@/components/Player";
import Timeline from "@/components/Timeline";
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

const PARAGRAPH_GAP = 1.2; // silence that starts a new paragraph in the doc
const SILENCE_GAP = 0.8;   // "cut silences" trims dead air longer than this

const DEMO_WORDS: Word[] = [
  { word: "Here", start: 0.0, end: 0.25 },
  { word: "is", start: 0.25, end: 0.4 },
  { word: "the", start: 0.4, end: 0.55 },
  { word: "new", start: 0.55, end: 0.78 },
  { word: "Cutroom", start: 0.78, end: 1.22 },
  { word: "editor", start: 1.22, end: 1.62 },
  { word: "with", start: 1.62, end: 1.85 },
  { word: "transcript", start: 1.85, end: 2.35 },
  { word: "cuts", start: 2.35, end: 2.7 },
  { word: "and", start: 2.7, end: 2.88 },
  { word: "a", start: 2.88, end: 3.0 },
  { word: "timeline", start: 3.0, end: 3.52 },
  { word: "below.", start: 3.52, end: 4.0 },
  { word: "Um", start: 5.2, end: 5.42 },
  { word: "you", start: 5.42, end: 5.62 },
  { word: "can", start: 5.62, end: 5.84 },
  { word: "delete", start: 5.84, end: 6.2 },
  { word: "words", start: 6.2, end: 6.55 },
  { word: "or", start: 6.55, end: 6.74 },
  { word: "use", start: 6.74, end: 6.98 },
  { word: "script", start: 6.98, end: 7.35 },
  { word: "matching", start: 7.35, end: 7.9 },
  { word: "to", start: 7.9, end: 8.08 },
  { word: "assemble", start: 8.08, end: 8.62 },
  { word: "the", start: 8.62, end: 8.78 },
  { word: "cut.", start: 8.78, end: 9.2 },
];

function demoProjectName(id: string) {
  if (typeof window === "undefined") return "Demo project";
  try {
    const projects = JSON.parse(window.localStorage.getItem("cutroom.demo.projects") ?? "[]") as Array<{ id: string; name: string }>;
    return projects.find((p) => p.id === id)?.name ?? "Demo project";
  } catch {
    return "Demo project";
  }
}

type EditState = { removed: Set<number>; tighten: boolean };

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [words, setWords] = useState<Word[] | null>(null);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [tighten, setTighten] = useState(false);
  const [showCuts, setShowCuts] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [demoFileName, setDemoFileName] = useState<string | null>(null);
  const [seek, setSeek] = useState<{ t: number; nonce: number } | null>(null);
  const [playT, setPlayT] = useState(0);
  const [tlSel, setTlSel] = useState<[number, number] | null>(null);
  const history = useRef<EditState[]>([]);

  const commit = useCallback((next: Partial<EditState>) => {
    setRemoved((prevR) => {
      setTighten((prevT) => {
        history.current.push({ removed: new Set(prevR), tighten: prevT });
        if (history.current.length > 200) history.current.shift();
        return next.tighten ?? prevT;
      });
      return next.removed ?? prevR;
    });
  }, []);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (prev) {
      setRemoved(prev.removed);
      setTighten(prev.tighten);
    }
  }, []);

  const load = useCallback(async () => {
    if (id.startsWith("demo-")) {
      setProject({
        id,
        name: demoProjectName(id),
        status: videoUrl ? "ready" : "created",
        orientation: "9:16",
        source_asset_id: null,
        error: null,
      });
      return;
    }

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
  }, [id, videoUrl]);

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

  const clips = useMemo(
    () => (words ? buildClipsFromWords(words, removed, tighten ? { maxGap: SILENCE_GAP } : undefined) : []),
    [words, removed, tighten]
  );

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

  // ── cutting from the transcript: select text, press delete ──
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

  // ── cutting from the timeline: drag range, press delete ──
  const cutTimelineRange = useCallback(
    (a: number, b: number) => {
      if (!words) return;
      const intervals: [number, number][] = [];
      let acc = 0;
      for (const c of clips) {
        const d = c.out - c.in;
        const s = Math.max(a, acc);
        const e = Math.min(b, acc + d);
        if (e > s) intervals.push([c.in + (s - acc), c.in + (e - acc)]);
        acc += d;
      }
      const next = new Set(removed);
      words.forEach((w, i) => {
        if (removed.has(i)) return;
        if (intervals.some(([s, e]) => w.start < e && w.end > s)) next.add(i);
      });
      commit({ removed: next });
      setTlSel(null);
    },
    [words, clips, removed, commit]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key === "Escape") {
        setTlSel(null);
        window.getSelection()?.removeAllRanges();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        if (tlSel) {
          e.preventDefault();
          cutTimelineRange(tlSel[0], tlSel[1]);
          return;
        }
        const r = rangeFromSelection();
        if (!r) return;
        e.preventDefault();
        const next = new Set(removed);
        for (let k = r[0]; k <= r[1]; k++) next.add(k);
        commit({ removed: next });
        window.getSelection()?.removeAllRanges();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tlSel, cutTimelineRange, rangeFromSelection, removed, commit, undo]);

  function handleWordClick(i: number) {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (!words) return;
    setSeek({ t: words[i].start, nonce: Date.now() });
  }

  function removeFillers() {
    if (!words) return;
    const next = new Set(removed);
    words.forEach((w, i) => { if (isFiller(w.word)) next.add(i); });
    commit({ removed: next });
  }

  function handleDemoUpload(file: File, objectUrl: string) {
    setDemoFileName(file.name);
    setVideoUrl(objectUrl);
    setWords(DEMO_WORDS);
    setRemoved(new Set());
    setTighten(false);
    history.current = [];
    setProject({
      id,
      name: demoProjectName(id),
      status: "ready",
      orientation: "9:16",
      source_asset_id: null,
      error: null,
    });
  }

  async function exportCut() {
    if (!words || !project) return;
    setDownloadUrl(null);
    const edl = buildPhase1EDL(words, removed, project.orientation);
    edl.clips = clips; // includes silence-tightening if enabled

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
  const rendering = job && job.status !== "done" && job.status !== "error";
  const isDemo = id.startsWith("demo-");

  return (
    <main className={project.status === "ready" ? "wrap wide" : "wrap"}>
      <div className="toolbar">
        <div className="row">
          <Link href="/" className="brand">‹ cutroom</Link>
          <span className="proj-name">{project.name}</span>
        </div>
        <div className="row">
          {words && <span className="duration">{fmtTime(kept)}</span>}
          <button className="ghost" onClick={undo} disabled={!history.current.length}>undo</button>
          <button onClick={exportCut} disabled={isDemo || !!rendering || clips.length === 0 || !words} title={isDemo ? "export needs a real Supabase project" : undefined}>
            {rendering ? "rendering…" : "export"}
          </button>
        </div>
      </div>

      {project.status === "created" && (
        <>
          <p className="sub" style={{ marginTop: 24 }}>{isDemo ? "drop a video to preview the editor locally." : "no source yet."}</p>
          <UploadDropzone projectId={project.id} onDone={load} demoMode={isDemo} onDemoUpload={handleDemoUpload} />
        </>
      )}

      {project.status === "transcribing" && (
        <p className="status" style={{ marginTop: 48, textAlign: "center" }}>transcribing…</p>
      )}

      {project.status === "error" && (
        <p className="status err" style={{ marginTop: 48 }}>{project.error ?? "something broke"}</p>
      )}

      {project.status === "ready" && words && (
        <>
          <div className="editor-grid three">
            {/* left: the document */}
            <section className="doc-col">
              <div className="transcript">
                {paragraphs.map((para, pi) => {
                  const visible = para.filter((i) => showCuts || !removed.has(i));
                  if (!visible.length) return null;
                  return (
                    <p key={pi}>
                      {visible.map((i) => (
                        <span
                          key={i}
                          data-i={i}
                          className={[
                            "word",
                            removed.has(i) ? "removed" : "",
                            i === activeIdx ? "playing" : "",
                            isFiller(words[i].word) && !removed.has(i) ? "filler" : "",
                          ].join(" ")}
                          onClick={() => handleWordClick(i)}
                        >
                          {words[i].word}{" "}
                        </span>
                      ))}
                    </p>
                  );
                })}
              </div>
              <p className="hint" style={{ marginTop: 18 }}>
                highlight + delete to cut · click a word to jump · ⌘z undo ·{" "}
                <a className="text-link" onClick={() => setShowCuts(!showCuts)}>
                  {showCuts ? "hide cuts" : "show cuts"}
                </a>
              </p>
            </section>

            {/* center: video */}
            <aside className="player-col">
              {videoUrl ? (
                <>
                  <Player src={videoUrl} clips={clips} seek={seek} onTime={setPlayT} />
                  {demoFileName && <span className="status">local preview · {demoFileName}</span>}
                </>
              ) : (
                <span className="status">loading video…</span>
              )}
              {job?.status === "error" && (
                <span className="status err">render failed: {job.error}</span>
              )}
              {downloadUrl && (
                <div className="card done-card">
                  <span className="status ok">done · {fmtTime(kept)}</span>
                  <a href={downloadUrl} download><button>download</button></a>
                </div>
              )}
            </aside>

            {/* right: tools + chat */}
            <aside className="side-col">
              <div className="chips">
                <button className={`chip ${scriptOpen ? "active" : ""}`} onClick={() => setScriptOpen(!scriptOpen)}>
                  script
                </button>
                <button className="chip" onClick={removeFillers}>remove fillers</button>
                <button
                  className={`chip ${tighten ? "active" : ""}`}
                  onClick={() => commit({ tighten: !tighten })}
                >
                  cut silences
                </button>
                <button className="chip" disabled title="phase 2">captions</button>
                <button className="chip" disabled title="phase 2">music</button>
              </div>
              {scriptOpen && (
                <ScriptMatch
                  words={words}
                  onApply={(r) => { commit({ removed: r }); setScriptOpen(false); }}
                />
              )}
              <div className="chat">
                <div className="chat-scroll">
                  <p className="hint" style={{ textAlign: "center", marginTop: 24 }}>
                    ai chat comes online in phase 3
                  </p>
                </div>
                <input type="text" className="chat-input" placeholder="message" disabled />
              </div>
            </aside>
          </div>

          <Timeline
            clips={clips}
            videoSrc={videoUrl}
            playSourceT={playT}
            sel={tlSel}
            onSel={setTlSel}
            onSeek={(t) => setSeek({ t, nonce: Date.now() })}
          />
        </>
      )}
    </main>
  );
}
