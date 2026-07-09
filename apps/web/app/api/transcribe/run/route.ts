import { NextResponse } from "next/server";
import { transcribeProject } from "@/lib/transcribe";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = String(body.projectId ?? "").trim();
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    const result = await transcribeProject(projectId);
    return NextResponse.json(result);
  } catch (err: any) {
    const message = String(err?.message ?? err);
    if (message.includes("ASSEMBLYAI_API_KEY")) {
      return NextResponse.json(
        { error: "transcription service not configured — waiting for render worker" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
