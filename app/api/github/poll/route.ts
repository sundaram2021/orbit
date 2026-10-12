import { NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { createServiceClient } from "@/lib/supabase-service";
import { proposeAndMaybeRun } from "@/lib/orchestrator/spawn";

export const maxDuration = 120;

/**
 * Polling intake (Option A — zero user setup).
 * Trigger via cron every ~60s (Vercel Cron, Render cron, or any scheduler):
 *   GET /api/github/poll
 * Walks every connected GitHub user, finds assigned issues, review requests
 * and mentions, and proposes a sub-agent for anything unseen.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const provided =
      request.headers.get("x-cron-secret") ??
      new URL(request.url).searchParams.get("secret");
    if (provided !== cronSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const supabase = createServiceClient();
  const { data: connections } = await supabase
    .from("github_connections")
    .select("user_id, provider_token, github_username");

  if (!connections || connections.length === 0) {
    return NextResponse.json({ ok: true, users: 0, proposed: 0 });
  }

  let proposed = 0;
  const errors: string[] = [];

  for (const conn of connections as {
    user_id: string;
    provider_token: string;
    github_username: string | null;
  }[]) {
    try {
      proposed += await pollUser(supabase, conn);
    } catch (err) {
      errors.push(`${conn.user_id}: ${(err as Error).message.slice(0, 200)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    users: connections.length,
    proposed,
    errors,
  });
}

async function pollUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  conn: { user_id: string; provider_token: string; github_username: string | null }
): Promise<number> {
  const octokit = new Octokit({ auth: conn.provider_token });
  const me =
    conn.github_username ??
    (await octokit.users.getAuthenticated()).data.login;

  // 1) Issues/PRs assigned to the user (across all accessible repos).
  const { data: assigned } = await octokit.issues.listForAuthenticatedUser({
    filter: "assigned",
    state: "open",
    per_page: 20,
  });

  // 2) PRs where the user is a requested reviewer.
  let reviewRequested: { id: number; repository_url: string; number: number; title: string; body?: string | null; updated_at: string }[] = [];
  try {
    const search = await octokit.search.issuesAndPullRequests({
      q: `review-requested:${me} is:open`,
      per_page: 20,
    });
    reviewRequested = search.data.items.map((i) => ({
      id: i.id,
      repository_url: i.repository_url,
      number: i.number,
      title: i.title,
      body: (i as { body?: string }).body ?? null,
      updated_at: i.updated_at,
    }));
  } catch {
    reviewRequested = [];
  }

  const candidates = [
    ...assigned.map((i) => ({
      githubId: i.id,
      type: i.pull_request ? "pr_assigned" : "issue_assigned",
      repo: repoFromUrl(i.repository_url),
      number: i.number,
      title: i.title,
      body: i.body ?? null,
      updatedAt: i.updated_at,
    })),
    ...reviewRequested.map((i) => ({
      githubId: i.id,
      type: "review_requested",
      repo: repoFromUrl(i.repository_url),
      number: i.number,
      title: i.title,
      body: i.body ?? null,
      updatedAt: i.updated_at,
    })),
  ];

  let count = 0;
  for (const c of candidates.slice(0, 10)) {
    if (!c.repo) continue;
    const deliveryId = `poll-${c.type}-${c.githubId}`;
    const { data: inserted, error } = await supabase
      .from("github_events")
      .upsert(
        [
          {
            user_id: conn.user_id,
            delivery_id: deliveryId,
            type: c.type,
            repo: c.repo,
            number: c.number,
            title: c.title,
            payload: { body: c.body, updated_at: c.updatedAt, github_id: c.githubId },
            status: "received",
          },
        ],
        { onConflict: "user_id,delivery_id", ignoreDuplicates: true }
      )
      .select("id");
    if (error || !inserted || (inserted as unknown[]).length === 0) continue; // already seen
    if (count >= 3) continue; // bound Haiku calls per poll run; rest stay 'received'

    const row = (inserted as { id: string }[])[0];
    try {
      await proposeAndMaybeRun(supabase, {
        userId: conn.user_id,
        source: `github:${c.type}`,
        repo: c.repo,
        number: c.number,
        title: c.title,
        body: c.body,
        eventId: row.id,
      });
      count++;
    } catch (err) {
      console.warn("propose failed:", err);
    }
  }
  return count;
}

function repoFromUrl(repositoryUrl: string): string {
  const m = repositoryUrl.match(/\/repos\/([^/]+\/[^/]+)/);
  return m ? m[1] : "";
}
