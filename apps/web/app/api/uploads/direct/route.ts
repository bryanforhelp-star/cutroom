import { NextResponse } from "next/server";
import { BUCKET, getServerSupabase } from "@/lib/serverSupabase";

export const runtime = "nodejs";

function safeExt(name: string) {
  const ext = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  return ext.slice(0, 8) || "mp4";
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const projectId = String(form.get("projectId") ?? "").trim();
    const file = form.get("file");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });

    const supabase = getServerSupabase();
    const path = `${projectId}/source.${safeExt(file.name)}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: file.type || "video/mp4", upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { data: asset, error: aErr } = await supabase
      .from("assets")
      .insert({ project_id: projectId, kind: "source", storage_path: path })
      .select("id")
      .single();
    if (aErr || !asset) throw new Error(aErr?.message ?? "asset insert failed");

    const { error: pErr } = await supabase
      .from("projects")
      .update({ source_asset_id: asset.id, status: "transcribing", error: null })
      .eq("id", projectId);
    if (pErr) throw new Error(pErr.message);

    return NextResponse.json({ assetId: asset.id, path, status: "transcribing" });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
