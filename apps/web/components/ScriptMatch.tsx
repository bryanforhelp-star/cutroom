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

  function run() {
    const r = matchScript(words, script);
    setResult(r);
    onApply(r.removed);
  }

  const pct = result
    ? Math.round((result.matchedScriptWords / Math.max(1, result.totalScriptWords)) * 100)
    : 0;

  return (
    <div className="script-body">
      <p className="hint">
        paste the script you meant to read. everything off-script gets cut — repeated lines keep your last take. ⌘z undoes it.
      </p>
      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        placeholder="paste your script…"
        rows={4}
      />
      <div className="row">
        <button onClick={run} disabled={!script.trim() || !words.length}>
          match & cut
        </button>
        {result && (
          <span className="status">
            matched {pct}%{pct < 85 && " — low, check the result"}
          </span>
        )}
      </div>
    </div>
  );
}
