import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

// service role: bypasses RLS. never ships to a browser.
export const supabase = createClient(url, key, { auth: { persistSession: false } });

export const BUCKET = "media";

export async function signedUrl(path: string, seconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error(`signed url failed for ${path}: ${error?.message}`);
  return data.signedUrl;
}
