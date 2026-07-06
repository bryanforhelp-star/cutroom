"use client";

import { useState } from "react";
import type { Clip } from "@/lib/edl";
import type { EditCommand, ScriptSection } from "@/lib/editorCommands";

type AIPanelProps = {
  projectId: string;
  scriptDraft: string;
  playT: number;
  clips: Clip[];
  scriptSections: ScriptSection[];
  onRunCommands: (commands: EditCommand[]) => void;
};

type Message = { role: "user" | "ai"; text: string };

export default function AIPanel({
  projectId,
  scriptDraft,
  playT,
  clips,
  scriptSections,
  onRunCommands,
}: AIPanelProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: message }]);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          message,
          script: scriptDraft,
          playT,
          currentClipId: clips[0]?.id ?? null,
        }),
      });
      if (!res.ok) throw new Error(`ai failed: ${res.status}`);
      const data = await res.json();
      onRunCommands(data.commands as EditCommand[]);
      setMessages((m) => [...m, { role: "ai", text: data.reply ?? "done." }]);
    } catch (err: any) {
      setMessages((m) => [...m, { role: "ai", text: err?.message ?? "ai failed" }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-panel card">
      <div className="timeline-head">
        <span>AI editor</span>
        <span className="hint">tell it what cut to make</span>
      </div>
      <p className="hint ai-help">Try: “remove filler words”, “make this punchier”, “add a zoom on the hook”, or open Match Script to paste a script and assemble from it.</p>
      {!!scriptSections.length && (
        <div className="script-sections">
          {scriptSections.map((s) => <span key={s.id} className="section-chip">{s.label} · {(s.score * 100).toFixed(0)}%</span>)}
        </div>
      )}
      <div className="ai-messages">
        {messages.slice(-4).map((m, i) => <p key={i} className={`ai-msg ${m.role}`}>{m.text}</p>)}
      </div>
      <div className="ai-input row">
        <input
          type="text"
          value={input}
          placeholder="Tell AI what to do with this video…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={send} disabled={!input.trim() || busy}>{busy ? "…" : "send"}</button>
      </div>
    </div>
  );
}
