// script → transcript alignment ("match my script, cut everything else")
//
// The script is the reference; the recording contains retakes, fillers, and
// rambles. Semi-global affine alignment:
//   - script must be fully consumed, in order
//   - transcript words outside the match get cut
//   - leading/trailing transcript (false starts, outro ramble) is FREE to skip
//   - opening a cut mid-content is EXPENSIVE, extending it is cheap
//     → one contiguous take beats stitching fragments of two takes
//   - sequences are aligned REVERSED, biasing ties toward your LAST take
//
// Deterministic, instant, no AI cost. Phase 3's AI handles the fuzzy leftovers.

import type { Word } from "./edl";

export type MatchResult = {
  removed: Set<number>; // transcript indices to strike
  matchedScriptWords: number;
  totalScriptWords: number;
  cutWords: number;
};

export function normalizeToken(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, "");
}

function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length > 4 && b.length > 4) return levenshtein1(a, b);
  return false;
}

function levenshtein1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const MATCH = 2;
const OPEN_T = -1.2;  // opening a cut inside content (a jump cut) — costly
const EXT_T = -0.02;  // extending an existing cut — nearly free
const OPEN_S = -1.5;  // dropping a script word — content missing
const EXT_S = -0.8;
const NEG = -1e9;

export function matchScript(words: Word[], script: string): MatchResult {
  const scriptTokens = script.split(/\s+/).map(normalizeToken).filter(Boolean);
  const transcriptTokens = words.map((w) => normalizeToken(w.word));
  if (!scriptTokens.length || !transcriptTokens.length) {
    return { removed: new Set(), matchedScriptWords: 0, totalScriptWords: scriptTokens.length, cutWords: 0 };
  }

  // reversed for last-take bias
  const S = [...scriptTokens].reverse();
  const T = [...transcriptTokens].reverse();
  const n = T.length, m = S.length, W = m + 1;

  // three states: M = last was match, X = in transcript-gap, Y = in script-gap
  const M = new Float64Array((n + 1) * W).fill(NEG);
  const X = new Float64Array((n + 1) * W).fill(NEG);
  const Y = new Float64Array((n + 1) * W).fill(NEG);
  const bM = new Uint8Array((n + 1) * W); // traceback: state we came from (1=M 2=X 3=Y)
  const bX = new Uint8Array((n + 1) * W);
  const bY = new Uint8Array((n + 1) * W);

  M[0] = 0;
  for (let i = 1; i <= n; i++) { X[i * W] = 0; bX[i * W] = 2; } // free leading transcript skip
  for (let j = 1; j <= m; j++) {
    Y[j] = (j === 1 ? OPEN_S : Y[j - 1] + EXT_S);
    bY[j] = j === 1 ? 1 : 3;
  }

  for (let i = 1; i <= n; i++) {
    const ti = T[i - 1];
    for (let j = 1; j <= m; j++) {
      const c = i * W + j, up = (i - 1) * W + j, left = i * W + (j - 1), diag = (i - 1) * W + (j - 1);

      if (similar(ti, S[j - 1])) {
        let best = M[diag], from = 1;
        if (X[diag] > best) { best = X[diag]; from = 2; }
        if (Y[diag] > best) { best = Y[diag]; from = 3; }
        M[c] = best + MATCH; bM[c] = from;
      }

      {
        let best = M[up] + OPEN_T, from = 1;
        if (X[up] + EXT_T > best) { best = X[up] + EXT_T; from = 2; }
        if (Y[up] + OPEN_T > best) { best = Y[up] + OPEN_T; from = 3; }
        X[c] = best; bX[c] = from;
      }

      {
        let best = M[left] + OPEN_S, from = 1;
        if (Y[left] + EXT_S > best) { best = Y[left] + EXT_S; from = 3; }
        if (X[left] + OPEN_S > best) { best = X[left] + OPEN_S; from = 2; }
        Y[c] = best; bY[c] = from;
      }
    }
  }

  // free trailing transcript skip: end anywhere in the last column
  let endI = 0, endState = 1, best = NEG;
  for (let i = 0; i <= n; i++) {
    const c = i * W + m;
    if (M[c] > best) { best = M[c]; endI = i; endState = 1; }
    if (Y[c] > best) { best = Y[c]; endI = i; endState = 3; }
  }

  // traceback
  const matched = new Set<number>();
  let matchedScript = 0;
  let i = endI, j = m, state = endState;
  while (i > 0 || j > 0) {
    if (state === 1) {
      matched.add(n - i); // reversed → original index
      matchedScript++;
      state = bM[i * W + j]; i--; j--;
    } else if (state === 2) {
      state = bX[i * W + j]; i--;
    } else {
      state = bY[i * W + j]; j--;
    }
    if (i <= 0 && j <= 0) break;
  }

  const removed = new Set<number>();
  for (let k = 0; k < words.length; k++) if (!matched.has(k)) removed.add(k);

  return {
    removed,
    matchedScriptWords: matchedScript,
    totalScriptWords: scriptTokens.length,
    cutWords: removed.size,
  };
}

// ── filler detection (visual hint only — never auto-cut) ──
const FILLERS = new Set(["um", "uh", "uhm", "erm", "hmm", "like", "literally", "basically", "actually"]);
export function isFiller(word: string): boolean {
  return FILLERS.has(normalizeToken(word));
}
