import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";

/** Live repo list for the repo selector (user's GitHub, not the stale table). */
export async function GET() {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = createServiceClient();
  const { data: conn } = await svc
    .from("github_connections")
    .select("provider_token")
    .eq("user_id", user.id)
    .single();
  const token = (conn as { provider_token?: string } | null)?.provider_token;
  if (!token) return NextResponse.json({ repos: [], error: "github not connected" });

  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: token });
    const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
      affiliation: "owner,collaborator,organization_member",
      sort: "pushed",
      per_page: 100,
    });
    return NextResponse.json({
      repos: repos.slice(0, 100).map((r) => ({
        full_name: r.full_name,
        default_branch: r.default_branch,
        private: r.private,
        updated_at: r.pushed_at,
      })),
    });
  } catch (err) {
    return NextResponse.json({ repos: [], error: (err as Error).message.slice(0, 200) });
  }
}
