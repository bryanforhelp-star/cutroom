"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// lazy singleton: created on first use in the browser, so `next build`
// doesn't require env vars at prerender time.
let client: SupabaseClient | null = null;

function get(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const value = (get() as any)[prop];
    return typeof value === "function" ? value.bind(get()) : value;
  },
});

export const BUCKET = "media";
