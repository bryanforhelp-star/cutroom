import { NextResponse } from "next/server";

type Req = {
  projectId: string;
  message: string;
  script?: string;
  currentClipId?: string | null;
  playT?: number;
};

type Command = Record<string, unknown> & { type: string };

const FILLER_RE = /\b(filler|fillers|ums?|uhs?|likes?|dead air|tighten|clean ?up)\b/i;
const TRANSITION_RE = /\b(transition|crossfade|fade|smooth cut|between cuts)\b/i;
const OVERLAY_RE = /\b(overlay|text|title|headline|hook text|caption card)\b/i;
const ZOOM_RE = /\b(zoom|punch ?in|key ?frame|keyframe|push in)\b/i;
const SCRIPT_RE = /\b(script|order|assemble|reorder|structure|find the order)\b/i;

export async function POST(req: Request) {
  const body = (await req.json()) as Req;
  const message = body.message ?? "";
  const commands = interpret(message, body);
  return NextResponse.json({
    reply: summarize(commands),
    commands,
    requiresApproval: false,
  });
}

function interpret(message: string, body: Req): Command[] {
  const commands: Command[] = [];
  const lower = message.toLowerCase();
  const script = body.script?.trim() || extractScript(message);

  if ((SCRIPT_RE.test(message) || script) && script) {
    commands.push({ type: "assemble_from_script", script });
  }

  if (FILLER_RE.test(message)) commands.push({ type: "remove_fillers" });

  if (TRANSITION_RE.test(message)) {
    commands.push({
      type: "add_transition",
      afterClipId: body.currentClipId ?? "c1",
      transition: lower.includes("punch") ? "punch_in" : "crossfade",
      duration: lower.includes("quick") ? 0.12 : 0.18,
    });
  }

  if (OVERLAY_RE.test(message)) {
    commands.push({
      type: "add_text_overlay",
      text: extractQuoted(message) ?? extractOverlayText(message) ?? "hook moment",
      start: Math.max(0, body.playT ?? 0),
      end: Math.max((body.playT ?? 0) + 2.2, 2.2),
      position: "bottom-center",
      preset: lower.includes("minimal") ? "minimal" : "bold",
    });
  }

  if (ZOOM_RE.test(message)) {
    commands.push({
      type: "add_zoom_keyframes",
      clipId: body.currentClipId ?? "c1",
      keyframes: [
        { at: Math.max(0, body.playT ?? 0), scale: 1 },
        { at: Math.max(0.7, (body.playT ?? 0) + 0.7), scale: lower.includes("subtle") ? 1.08 : 1.14, x: 0.5, y: 0.42 },
      ],
    });
  }

  if (!commands.length) {
    commands.push({ type: "remove_fillers" });
  }

  return commands;
}

function summarize(commands: Command[]) {
  const names = commands.map((c) => c.type.replaceAll("_", " "));
  return `done — ${names.join(", ")}.`;
}

function extractQuoted(s: string) {
  return s.match(/["“](.+?)["”]/)?.[1]?.trim() ?? null;
}

function extractOverlayText(s: string) {
  const m = s.match(/(?:overlay|text|title|headline)\s*:?\s*(.+)$/i);
  if (!m) return null;
  return m[1].replace(/^(that says|saying)\s+/i, "").trim().slice(0, 80) || null;
}

function extractScript(s: string) {
  const marker = s.match(/(?:script|order)\s*:?\s*([\s\S]+)/i)?.[1]?.trim();
  if (marker && marker.includes("\n")) return marker;
  return null;
}
