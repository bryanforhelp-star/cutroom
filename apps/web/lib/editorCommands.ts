import { buildClipsFromWords, type Clip, type Overlay, type Transition, type Word } from "./edl";

export type TimelineOverlay = Extract<Overlay, { type: "lower_third" }> & {
  position?: "top-center" | "center" | "bottom-center";
};

export type ZoomKeyframe = {
  at: number; // timeline seconds
  scale: number;
  x?: number;
  y?: number;
};

export type ClipKeyframes = {
  id: string;
  clipId: string;
  property: "zoom";
  keyframes: ZoomKeyframe[];
};

export type ScriptSection = {
  id: string;
  label: string;
  text: string;
  wordStartIndex: number;
  wordEndIndex: number;
  clipId: string;
  score: number;
};

export type EditState = {
  sourceWords: Word[];
  removedWordIndexes: Set<number>;
  clips: Clip[];
  transitions: Transition[];
  overlays: TimelineOverlay[];
  keyframes: ClipKeyframes[];
  scriptSections: ScriptSection[];
};

export type EditCommand =
  | { type: "remove_words"; wordIndexes: number[] }
  | { type: "restore_words"; wordIndexes: number[] }
  | { type: "toggle_words"; wordIndexes: number[] }
  | { type: "cut_range"; sourceStart: number; sourceEnd: number }
  | { type: "remove_fillers" }
  | { type: "add_transition"; afterClipId: string; transition: Transition["type"]; duration: number }
  | { type: "add_text_overlay"; text: string; start: number; end: number; position?: TimelineOverlay["position"]; preset?: string }
  | { type: "add_zoom_keyframes"; clipId: string; keyframes: ZoomKeyframe[] }
  | { type: "create_clip_from_words"; wordStartIndex: number; wordEndIndex: number; label?: string }
  | { type: "reorder_clips"; clipIds: string[] }
  | { type: "assemble_from_script"; script: string; allowPartialMatches?: boolean; removeUnmatched?: boolean };

const FILLERS = new Set(["um", "uh", "like", "literally", "basically", "actually", "so", "yeah", "right"]);

function normalizeWord(word: string) {
  return word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

function withClips(words: Word[], state: Omit<EditState, "clips" | "sourceWords">): EditState {
  return { ...state, sourceWords: words, clips: buildClipsFromWords(words, state.removedWordIndexes) };
}

export function createInitialEditState(words: Word[], removedWordIndexes: Set<number> = new Set()): EditState {
  return withClips(words, {
    removedWordIndexes: new Set([...removedWordIndexes].sort((a, b) => a - b)),
    transitions: [],
    overlays: [],
    keyframes: [],
    scriptSections: [],
  });
}

export function wordIndexesForSourceRange(words: Word[], sourceStart: number, sourceEnd: number): number[] {
  const a = Math.min(sourceStart, sourceEnd);
  const b = Math.max(sourceStart, sourceEnd);
  return words
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => w.end > a && w.start < b)
    .map(({ i }) => i);
}

export function applyEditCommand(state: EditState, command: EditCommand): EditState {
  const words = state.sourceWords;
  const removed = new Set(state.removedWordIndexes);

  if (command.type === "remove_words") {
    command.wordIndexes.forEach((i) => removed.add(i));
    return withClips(words, { ...state, removedWordIndexes: sortedSet(removed) });
  }

  if (command.type === "restore_words") {
    command.wordIndexes.forEach((i) => removed.delete(i));
    return withClips(words, { ...state, removedWordIndexes: sortedSet(removed) });
  }

  if (command.type === "toggle_words") {
    const allRemoved = command.wordIndexes.every((i) => removed.has(i));
    command.wordIndexes.forEach((i) => allRemoved ? removed.delete(i) : removed.add(i));
    return withClips(words, { ...state, removedWordIndexes: sortedSet(removed) });
  }

  if (command.type === "cut_range") {
    wordIndexesForSourceRange(words, command.sourceStart, command.sourceEnd).forEach((i) => removed.add(i));
    return withClips(words, { ...state, removedWordIndexes: sortedSet(removed) });
  }

  if (command.type === "remove_fillers") {
    words.forEach((w, i) => {
      if (FILLERS.has(normalizeWord(w.word))) removed.add(i);
    });
    return withClips(words, { ...state, removedWordIndexes: sortedSet(removed) });
  }

  if (command.type === "add_transition") {
    const transitions = state.transitions.filter((t) => t.after_clip !== command.afterClipId);
    transitions.push({ after_clip: command.afterClipId, type: command.transition, duration: clamp(command.duration, 0, 1.5) });
    return { ...state, transitions };
  }

  if (command.type === "add_text_overlay") {
    const id = `o${state.overlays.length + 1}`;
    return {
      ...state,
      overlays: [...state.overlays, {
        id,
        type: "lower_third",
        text: command.text,
        start: Math.max(0, Math.min(command.start, command.end)),
        end: Math.max(command.start, command.end),
        preset: command.preset ?? "bold",
        position: command.position ?? "bottom-center",
      }],
    };
  }

  if (command.type === "add_zoom_keyframes") {
    const next: ClipKeyframes = {
      id: `k${state.keyframes.length + 1}`,
      clipId: command.clipId,
      property: "zoom",
      keyframes: command.keyframes
        .map((k) => ({ ...k, at: Math.max(0, k.at), scale: clamp(k.scale, 1, 3) }))
        .sort((a, b) => a.at - b.at),
    };
    return { ...state, keyframes: [...state.keyframes.filter((k) => !(k.clipId === command.clipId && k.property === "zoom")), next] };
  }

  if (command.type === "create_clip_from_words") {
    const a = clamp(Math.min(command.wordStartIndex, command.wordEndIndex), 0, Math.max(0, words.length - 1));
    const b = clamp(Math.max(command.wordStartIndex, command.wordEndIndex), 0, Math.max(0, words.length - 1));
    const id = `s${state.scriptSections.length + 1}`;
    const clipId = `clip_${id}`;
    const clip: Clip = { id: clipId, asset: "source", in: words[a]?.start ?? 0, out: words[b]?.end ?? 0 };
    const section: ScriptSection = { id, label: command.label ?? id, text: words.slice(a, b + 1).map((w) => w.word).join(" "), wordStartIndex: a, wordEndIndex: b, clipId, score: 1 };
    return { ...state, clips: [...state.clips, clip], scriptSections: [...state.scriptSections, section] };
  }

  if (command.type === "reorder_clips") {
    const byId = new Map(state.clips.map((clip) => [clip.id, clip]));
    const ordered = command.clipIds.map((id) => byId.get(id)).filter(Boolean) as Clip[];
    const rest = state.clips.filter((clip) => !command.clipIds.includes(clip.id));
    return { ...state, clips: [...ordered, ...rest] };
  }

  if (command.type === "assemble_from_script") {
    return assembleFromScript(state, command.script, command.removeUnmatched ?? true);
  }

  return state;
}

export function sortedSet(values: Set<number>): Set<number> {
  return new Set([...values].sort((a, b) => a - b));
}

export function parseScriptSections(script: string): { label: string; text: string }[] {
  return script
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-*•\d.)\s]+/, ""))
    .filter(Boolean)
    .map((line, i) => {
      const m = line.match(/^([^:→-]{2,32})\s*[:→-]\s*(.+)$/);
      return m ? { label: m[1].trim().toLowerCase(), text: m[2].trim() } : { label: `section ${i + 1}`, text: line };
    });
}

export function matchScriptSection(words: Word[], text: string): Omit<ScriptSection, "id" | "label" | "clipId"> | null {
  const target = text.split(/\s+/).map(normalizeWord).filter(Boolean);
  if (!target.length || !words.length) return null;
  const targetSet = new Set(target);
  const normalizedWords = words.map((w) => normalizeWord(w.word));
  let best: { start: number; end: number; score: number } | null = null;
  const minWindow = Math.max(1, Math.floor(target.length * 0.55));
  const maxWindow = Math.min(words.length, Math.max(target.length + 6, Math.ceil(target.length * 1.8)));

  for (let start = 0; start < words.length; start++) {
    for (let len = minWindow; len <= maxWindow && start + len <= words.length; len++) {
      const end = start + len - 1;
      const windowTokens = normalizedWords.slice(start, end + 1).filter(Boolean);
      const hits = windowTokens.filter((t) => targetSet.has(t)).length;
      const orderBonus = target.filter((t) => windowTokens.includes(t)).length / target.length;
      const score = (hits / Math.max(windowTokens.length, target.length)) * 0.75 + orderBonus * 0.25;
      if (!best || score > best.score) best = { start, end, score };
    }
  }

  if (!best || best.score < 0.18) return null;
  return { text, wordStartIndex: best.start, wordEndIndex: best.end, score: Number(best.score.toFixed(3)) };
}

export function assembleFromScript(state: EditState, script: string, removeUnmatched = true): EditState {
  const sections = parseScriptSections(script);
  const used = new Set<number>();
  const matchedSections: ScriptSection[] = [];
  const clips: Clip[] = [];

  sections.forEach((section, index) => {
    const match = matchScriptSection(state.sourceWords, section.text);
    if (!match) return;
    const id = `s${index + 1}`;
    const clipId = `clip_${id}`;
    for (let i = match.wordStartIndex; i <= match.wordEndIndex; i++) used.add(i);
    clips.push({
      id: clipId,
      asset: "source",
      in: state.sourceWords[match.wordStartIndex]?.start ?? 0,
      out: state.sourceWords[match.wordEndIndex]?.end ?? 0,
    });
    matchedSections.push({ id, label: section.label, clipId, ...match });
  });

  const removed = new Set(state.removedWordIndexes);
  if (removeUnmatched && used.size) {
    state.sourceWords.forEach((_w, i) => {
      if (!used.has(i)) removed.add(i);
      else removed.delete(i);
    });
  }

  return {
    ...state,
    removedWordIndexes: sortedSet(removed),
    clips: clips.length ? clips : state.clips,
    scriptSections: matchedSections,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
