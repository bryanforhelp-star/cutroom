import { NextResponse } from "next/server";
import { BUCKET, getServerSupabase } from "@/lib/serverSupabase";

function safeExt(name: string) {
  const ext = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  return ext.slice(0, 8) || "mp4";
}

function absoluteSignedUrl(signedUrl: string, supabaseUrl: string) {
  if (signedUrl.startsWith("http://") || signedUrl.startsWith("https://")) return signedUrl;
  const base = supabaseUrl.replace(/\/$/, "");
  // createSignedUploadUrl may return "/object/upload/sign/..." — storage API lives under /storage/v1
  if (signedUrl.startsWith("/object/")) return `${base}/storage/v1${signedUrl}`;
  if (signedUrl.startsWith("/storage/")) return `${base}${signedUrl}`;
  return `${base}/${signedUrl.replace(/^\//, "")}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = String(body.projectId ?? "").trim();
    const fileName = String(body.fileName ?? "source.mp4");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    const supabase = getServerSupabase();
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const path = `${projectId}/source.${safeExt(fileName)}`;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: true } as any);
    if (error || !data) throw new Error(error?.message ?? "signed upload url failed");

    const signedUrl = absoluteSignedUrl(String((data as any).signedUrl ?? (data as any).url ?? ""), supabaseUrl);
    if (!signedUrl) throw new Error("signed upload url missing");

    return NextResponse.json({
      path,
      token: (data as any).token ?? null,
      signedUrl,
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
