import { createBrowserClient } from "@supabase/ssr";

export function createOrbitBrowserClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "https://qzzgrrlzlwobxpbvkyig.supabase.co";

  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_4ZR6wf0nXA7DnIoH319XhQ_INDXRJQP";

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
