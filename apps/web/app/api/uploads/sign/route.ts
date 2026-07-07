import { NextResponse } from "next/server";
import { BUCKET, getServerSupabase } from "@/lib/serverSupabase";

function safeExt(name: string) {
  const ext = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  return ext.slice(0, 8) || "mp4";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = String(body.projectId ?? "").trim();
    const fileName = String(body.fileName ?? "source.mp4");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    const supabase = getServerSupabase();
    const path = `${projectId}/source.${safeExt(fileName)}`;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true } as any);
    if (error || !data) throw new Error(error?.message ?? "signed upload url failed");

    return NextResponse.json({ path, token: data.token, signedUrl: data.signedUrl });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
