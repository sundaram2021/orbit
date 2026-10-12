import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") || "/dashboard";

  if (code) {
    const supabase = await createOrbitServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Persist the GitHub provider token so server-side polling,
      // sandboxes, and PR actions can act on the user's behalf.
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const providerToken =
          (session as { provider_token?: string } | null)?.provider_token;
        const user = session?.user;
        if (user && providerToken) {
          const metadata = (user.user_metadata || {}) as Record<string, string>;
          await supabase.from("github_connections").upsert(
            {
              user_id: user.id,
              provider_token: providerToken,
              github_username:
                metadata.user_name ||
                metadata.preferred_username ||
                metadata.userName ||
                null,
              scopes: "repo workflow read:org user:email",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );
        }
      } catch (persistError) {
        // Auth succeeded; token persistence must not block login.
        console.error("GitHub token persistence error:", persistError);
      }
      return NextResponse.redirect(new URL(next, requestUrl.origin));
    }
    console.error("Exchange code error:", error);
  }

  // Fallback to dashboard or login
  return NextResponse.redirect(new URL("/dashboard", requestUrl.origin));
}
