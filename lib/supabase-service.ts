import { createServerClient } from "@supabase/ssr";
import { orbitEnv } from "./env";

/**
 * Service-role client for background work (polling, sandbox callbacks).
 * Bypasses RLS — always scope queries by user_id manually.
 */
export function createServiceClient() {
  if (!orbitEnv.supabaseSecretKey) {
    throw new Error("SUPABASE_SECRET_KEY is not configured");
  }
  return createServerClient(orbitEnv.supabaseUrl, orbitEnv.supabaseSecretKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {},
    },
  });
}
