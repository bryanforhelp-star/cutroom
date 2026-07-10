import { NextResponse } from "next/server";
import { BUCKET, getServerSupabase } from "@/lib/serverSupabase";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = String(body.projectId ?? "").trim();
    const path = String(body.path ?? "").trim();
    if (!projectId || !path) return NextResponse.json({ error: "projectId and path are required" }, { status: 400 });

    const supabase = getServerSupabase();
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

    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 7200);

    return NextResponse.json({
      assetId: asset.id,
      status: "transcribing",
      videoUrl: signed?.signedUrl ?? null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
