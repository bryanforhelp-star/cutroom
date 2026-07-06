"use client";

import { useState } from "react";
import { matchScript, type MatchResult } from "@/lib/align";
import type { Word } from "@/lib/edl";

export default function ScriptMatch({
  words,
  onApply, // receives the new removed set
  onUndo,
  canUndo,
}: {
  words: Word[];
  onApply: (removed: Set<number>) => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [script, setScript] = useState("");
  const [result, setResult] = useState<MatchResult | null>(null);

  function run() {
    const r = matchScript(words, script);
    setResult(r);
    onApply(r.removed);
  }

  const pct = result ? Math.round((result.matchedScriptWords / Math.max(1, result.totalScriptWords)) * 100) : 0;

  return (
    <div className="script-match">
      <button className="ghost small" onClick={() => setOpen(!open)}>
        {open ? "▾ match script" : "▸ match script"}
      </button>

      {open && (
        <div className="script-body">
          <p className="hint">
            paste the script you meant to read. everything off-script — retakes, ums, rambles — gets cut.
            repeated lines keep your last take.
          </p>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="paste your script…"
            rows={5}
          />
          <div className="row">
            <button onClick={run} disabled={!script.trim() || !words.length}>
              match & cut
            </button>
            {canUndo && (
              <button className="ghost" onClick={() => { onUndo(); setResult(null); }}>
                undo match
              </button>
            )}
            {result && (
              <span className={`status ${pct >= 85 ? "ok" : ""}`}>
                matched {pct}% of script · cut {result.cutWords} words
                {pct < 85 && " · low match — check the strikethroughs before exporting"}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
