import { createClient } from "@supabase/supabase-js";

export const BUCKET = "media";

export function getServerSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for real Cutroom backend actions");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
