import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { createOctokit, parseRepo, githubErrorMessage } from "@/lib/octokit";

export interface GithubListItem {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string | null;
  created_at: string | null;
}

/**
 * GET /api/github/list?repo=owner/name&type=issues|prs
 * Dynamically lists open issues or PRs for the repo selected in the
 * new-task composer. Used by the "+" attachment menu.
 */
export async function GET(request: Request) {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const repo = (url.searchParams.get("repo") ?? "").trim();
  const type = (url.searchParams.get("type") ?? "issues").trim();
  const parsed = parseRepo(repo);
  if (!parsed) {
    return NextResponse.json({ error: "repo must be owner/name" }, { status: 400 });
  }
  const { owner, name } = parsed;
  if (type !== "issues" && type !== "prs") {
    return NextResponse.json({ error: "type must be issues or prs" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: conn } = await svc
    .from("github_connections")
    .select("provider_token")
    .eq("user_id", user.id)
    .single();
  const token = (conn as { provider_token?: string } | null)?.provider_token;
  if (!token) return NextResponse.json({ items: [], error: "github not connected" });

  try {
    const octokit = await createOctokit(token);
    if (type === "prs") {
      const prs = await octokit.pulls.list({
        owner,
        repo: name,
        state: "open",
        per_page: 50,
        sort: "updated",
        direction: "desc",
      });
      const items: GithubListItem[] = prs.data.map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        url: pr.html_url,
        author: pr.user?.login ?? null,
        created_at: pr.created_at ?? null,
      }));
      return NextResponse.json({ items });
    }
    const issues = await octokit.issues.listForRepo({
      owner,
      repo: name,
      state: "open",
      per_page: 50,
      sort: "updated",
      direction: "desc",
    });
    // Exclude pull requests from the issues list (GitHub returns both).
    const items: GithubListItem[] = issues.data
      .filter((i) => !(i as { pull_request?: unknown }).pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        url: i.html_url,
        author: i.user?.login ?? null,
        created_at: i.created_at ?? null,
      }));
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({ items: [], error: githubErrorMessage(err) }, { status: 502 });
  }
}
