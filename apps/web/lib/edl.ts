// EDL contract v1.1 — the fixed interface between editor, AI, and render.
//
// TIME-SPACE CONVENTION (locked, see docs/PLAN-FIXES.md §3):
//   clips.in / clips.out           -> SOURCE time (reference the raw upload)
//   overlays / sfx / music / etc.  -> TIMELINE time (post-cut)
// Captions are NOT stored here — they're derived from transcript ∩ clips at
// preview/render time (PLAN-FIXES §1). Transitions anchor to clip ids (§2).

export type Word = { word: string; start: number; end: number }; // source time, seconds

export type Clip = { id: string; asset: "source"; in: number; out: number };

export type Overlay =
  | { id: string; type: "lower_third"; text: string; start: number; end: number; preset: string }
  | { id: string; type: "broll"; asset: string; start: number; end: number; fit: "cover" | "contain" };

export type Transition = { after_clip: string; type: "cut" | "crossfade" | "punch_in"; duration: number };

export type EDL = {
  version: 1;
  canvas: { w: number; h: number; fps: number };
  clips: Clip[];
  captions: { enabled: boolean; preset: string };
  overlays: Overlay[];
  transitions: Transition[];
  audio: {
    music?: { asset: string; volume: number; duck: boolean };
    sfx: { id: string; asset: string; at: number }[];
  };
};

export const CANVAS_PRESETS: Record<string, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 },
};

const PAD = 0.05; // seconds of breathing room around kept runs

/** Group contiguous kept words into source-time clips. */
export function buildClipsFromWords(words: Word[], removed: Set<number>): Clip[] {
  const clips: Clip[] = [];
  let run: Word[] = [];
  const flush = () => {
    if (!run.length) return;
    clips.push({
      id: `c${clips.length + 1}`,
      asset: "source",
      in: Math.max(0, run[0].start - PAD),
      out: run[run.length - 1].end + PAD,
    });
    run = [];
  };
  words.forEach((w, i) => {
    if (removed.has(i)) flush();
    else run.push(w);
  });
  flush();
  // guard against overlaps introduced by padding across a tiny cut
  for (let i = 1; i < clips.length; i++) {
    if (clips[i].in < clips[i - 1].out) clips[i].in = clips[i - 1].out;
  }
  return clips;
}

export function buildPhase1EDL(
  words: Word[],
  removed: Set<number>,
  orientation: string
): EDL {
  const canvas = CANVAS_PRESETS[orientation] ?? CANVAS_PRESETS["9:16"];
  return {
    version: 1,
    canvas: { ...canvas, fps: 30 },
    clips: buildClipsFromWords(words, removed),
    captions: { enabled: false, preset: "none" },
    overlays: [],
    transitions: [],
    audio: { sfx: [] },
  };
}

export function keptDuration(clips: Clip[]): number {
  return clips.reduce((s, c) => s + (c.out - c.in), 0);
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
