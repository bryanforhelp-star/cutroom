"use client";

import { useState } from "react";
import { matchScript, type MatchResult } from "@/lib/align";
import type { Word } from "@/lib/edl";

export default function ScriptMatch({
  words,
  onApply,
}: {
  words: Word[];
  onApply: (removed: Set<number>) => void;
}) {
  const [script, setScript] = useState("");
  const [result, setResult] = useState<MatchResult | null>(null);

  function preview() {
    setResult(matchScript(words, script));
  }

  function apply() {
    if (!result) return;
    onApply(result.removed);
    setResult(null);
  }

  const pct = result
    ? Math.round((result.matchedScriptWords / Math.max(1, result.totalScriptWords)) * 100)
    : 0;

  return (
    <div className="script-body">
      <p className="script-title">match your script</p>
      <p className="hint">
        paste the script you meant to read. cutroom finds those lines in the recording and cuts everything else — repeated lines keep your last take.
      </p>
      <textarea
        value={script}
        onChange={(e) => {
          setScript(e.target.value);
          setResult(null);
        }}
        placeholder="paste your script…"
        rows={6}
      />
      <div className="row">
        <button onClick={preview} disabled={!script.trim() || !words.length}>
          find in video
        </button>
        {result && (
          <button className="ghost" onClick={apply}>
            apply cuts
          </button>
        )}
      </div>
      {result && (
        <p className={`status ${pct < 85 ? "warn" : "ok"}`}>
          matched {pct}% of script · will cut {result.cutWords} words
          {pct < 85 && " — low match, review before applying"}
        </p>
      )}
    </div>
  );
}
