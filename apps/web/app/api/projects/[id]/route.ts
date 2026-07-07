import { NextResponse } from "next/server";
import { BUCKET, getServerSupabase } from "@/lib/serverSupabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const supabase = getServerSupabase();

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();
    if (pErr || !project) throw new Error(pErr?.message ?? "project not found");

    let words = null;
    let videoUrl = null;

    if (project.status === "ready" || project.status === "transcribing") {
      const { data: transcriptRows, error: tErr } = await supabase
        .from("transcripts")
        .select("words")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (tErr) throw new Error(tErr.message);
      words = transcriptRows?.[0]?.words ?? null;

      if (project.source_asset_id) {
        const { data: asset, error: aErr } = await supabase
          .from("assets")
          .select("storage_path")
          .eq("id", project.source_asset_id)
          .single();
        if (aErr) throw new Error(aErr.message);
        if (asset) {
          const { data: signed, error: sErr } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(asset.storage_path, 7200);
          if (sErr) throw new Error(sErr.message);
          videoUrl = signed?.signedUrl ?? null;
        }
      }
    }

    return NextResponse.json({ project, words, videoUrl });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
