import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/serverSupabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, status, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ projects: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("projects")
      .insert({ name })
      .select("id, name, status, created_at")
      .single();

    if (error || !data) throw new Error(error?.message ?? "project insert failed");
    return NextResponse.json({ project: data });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
