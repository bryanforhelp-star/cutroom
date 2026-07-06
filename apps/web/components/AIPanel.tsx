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
  onScriptDraftChange: (value: string) => void;
};

type Message = { role: "user" | "ai"; text: string };

export default function AIPanel({
  projectId,
  scriptDraft,
  playT,
  clips,
  scriptSections,
  onRunCommands,
  onScriptDraftChange,
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
        <span>ai editor</span>
        <span className="hint">just does it</span>
      </div>
      <textarea
        value={scriptDraft}
        onChange={(e) => onScriptDraftChange(e.target.value)}
        placeholder={"script/order\nhook: ...\nproof: ...\ncta: ..."}
        rows={4}
      />
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
          placeholder="message"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={send} disabled={!input.trim() || busy}>{busy ? "…" : "send"}</button>
      </div>
    </div>
  );
}
