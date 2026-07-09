import { NextResponse } from "next/server";
import { transcribeProject } from "@/lib/transcribe";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  let projectId = "";
  try {
    const body = await req.json().catch(() => ({}));
    projectId = String(body.projectId ?? "").trim();
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
    if (projectId) {
      try {
        const { getServerSupabase } = await import("@/lib/serverSupabase");
        await getServerSupabase().from("projects").update({ status: "error", error: message }).eq("id", projectId);
      } catch {
        // ignore secondary failure
      }
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
