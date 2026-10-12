import { createOrbitBrowserClient } from "./supabase-client";

export const GITHUB_OAUTH_SCOPES = "repo workflow read:org user:email";

export async function signInWithGithubOAuth() {
  const supabase = createOrbitBrowserClient();
  const origin = window.location.origin;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      scopes: GITHUB_OAUTH_SCOPES,
      redirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    console.error("GitHub OAuth error:", error);
    throw error;
  }

  return data;
}

export async function signOutGithubUser() {
  const supabase = createOrbitBrowserClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Sign out error:", error);
    throw error;
  }
}
