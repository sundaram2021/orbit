import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";
import { proposeAndMaybeRun } from "@/lib/orchestrator/spawn";

import { createOrbitServerClient } from "@/lib/supabase-server";

export const maxDuration = 120;

/**
 * Polling intake (Option A — zero user setup).
 * Trigger via cron every ~60s (Vercel Cron, Render cron, or scheduler):
 *   GET or POST /api/github/poll
 * Walks connected GitHub users, finds assigned issues and review requests,
 * and proposes a sub-agent for anything unseen.
 *
 * Supports:
 * - Render / external cron with x-cron-secret header or ?secret= param
 * - Authenticated in-app user triggers (Sync button / background poll)
 * - Local development without secret
 */
export async function GET(request: Request) {
  return handlePoll(request);
}

export async function POST(request: Request) {
  return handlePoll(request);
}

async function handlePoll(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const provided =
    request.headers.get("x-cron-secret") ??
    new URL(request.url).searchParams.get("secret");

  let isAuthorized = false;

  // 1. Check CRON_SECRET if provided
  if (cronSecret && provided === cronSecret) {
    isAuthorized = true;
  }

  // 2. Allow if running in development mode
  if (!isAuthorized && process.env.NODE_ENV !== "production") {
    isAuthorized = true;
  }

  // 3. Check for authenticated user session from the app
  let sessionUserId: string | null = null;
  if (!isAuthorized) {
    try {
      const authSupabase = await createOrbitServerClient();
      const {
        data: { user },
      } = await authSupabase.auth.getUser();
      if (user) {
        isAuthorized = true;
        sessionUserId = user.id;
      }
    } catch {
      // not logged in via cookie
    }
  }

  if (!isAuthorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  let query = supabase
    .from("github_connections")
    .select("user_id, provider_token, github_username");

  // If triggered by a specific logged-in user in the browser, scope to that user
  if (sessionUserId) {
    query = query.eq("user_id", sessionUserId);
  }

  const { data: connections } = await query;

  if (!connections || connections.length === 0) {
    return NextResponse.json({ ok: true, users: 0, proposed: 0 });
  }

  let proposed = 0;
  const errors: string[] = [];
  const details: Array<{
    user_id: string;
    type: string;
    repo: string;
    number: number | null;
    outcome: "proposed" | "duplicate" | "capped" | "failed";
    agentId?: string;
    autoStarted?: boolean;
    error?: string;
  }> = [];

  const CONCURRENCY = 5;
  for (let i = 0; i < connections.length; i += CONCURRENCY) {
    const batch = (connections as {
      user_id: string;
      provider_token: string;
      github_username: string | null;
    }[]).slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map((conn) =>
        pollUser(supabase, conn, details).then(
          (n) => {
            proposed += n;
          },
          (err) => {
            errors.push(`${conn.user_id}: ${(err as Error).message.slice(0, 200)}`);
          }
        )
      )
    );
  }

  return NextResponse.json({
    ok: true,
    users: connections.length,
    proposed,
    errors,
    details,
  });
}

async function pollUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  conn: { user_id: string; provider_token: string; github_username: string | null },
  details: Array<{
    user_id: string;
    type: string;
    repo: string;
    number: number | null;
    outcome: "proposed" | "duplicate" | "capped" | "failed";
    agentId?: string;
    autoStarted?: boolean;
    error?: string;
  }>
): Promise<number> {
  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: conn.provider_token });
  const me =
    conn.github_username ??
    (await octokit.users.getAuthenticated()).data.login;

  interface RawItem {
    id: number;
    repository_url: string;
    number: number;
    title: string;
    body?: string | null;
    updated_at: string;
    pull_request?: unknown;
    type?: string;
  }

  const rawCandidates: RawItem[] = [];

  // 1) Issues/PRs assigned to the user via issues endpoint
  try {
    const { data: assigned } = await octokit.issues.listForAuthenticatedUser({
      filter: "assigned",
      state: "open",
      per_page: 30,
    });
    for (const item of assigned) {
      rawCandidates.push({
        id: item.id,
        repository_url: item.repository_url,
        number: item.number,
        title: item.title,
        body: item.body ?? null,
        updated_at: item.updated_at,
        pull_request: item.pull_request,
        type: item.pull_request ? "pr_assigned" : "issue_assigned",
      });
    }
  } catch (err) {
    console.warn("issues.listForAuthenticatedUser failed:", err);
  }

  // 2) Search assigned issues across accessible repositories
  try {
    const searchAssigned = await octokit.search.issuesAndPullRequests({
      q: `assignee:${me} is:open`,
      per_page: 30,
    });
    for (const item of searchAssigned.data.items) {
      rawCandidates.push({
        id: item.id,
        repository_url: item.repository_url,
        number: item.number,
        title: item.title,
        body: (item as { body?: string }).body ?? null,
        updated_at: item.updated_at,
        pull_request: item.pull_request,
        type: item.pull_request ? "pr_assigned" : "issue_assigned",
      });
    }
  } catch (err) {
    console.warn("search assignee failed:", err);
  }

  // 3) PRs where the user is a requested reviewer
  try {
    const searchReviews = await octokit.search.issuesAndPullRequests({
      q: `review-requested:${me} is:open`,
      per_page: 30,
    });
    for (const item of searchReviews.data.items) {
      rawCandidates.push({
        id: item.id,
        repository_url: item.repository_url,
        number: item.number,
        title: item.title,
        body: (item as { body?: string }).body ?? null,
        updated_at: item.updated_at,
        pull_request: true,
        type: "review_requested",
      });
    }
  } catch (err) {
    console.warn("search review-requested failed:", err);
  }

  // Deduplicate by item id (prefer review_requested if both present)
  const dedupedMap = new Map<number, RawItem>();
  for (const item of rawCandidates) {
    const existing = dedupedMap.get(item.id);
    if (!existing || item.type === "review_requested") {
      dedupedMap.set(item.id, item);
    }
  }

  const candidates = Array.from(dedupedMap.values()).map((c) => ({
    githubId: c.id,
    type: c.type ?? (c.pull_request ? "pr_assigned" : "issue_assigned"),
    repo: repoFromUrl(c.repository_url),
    number: c.number,
    title: c.title,
    body: c.body ?? null,
    updatedAt: c.updated_at,
  }));

  let count = 0;
  for (const c of candidates) {
    if (!c.repo) continue;
    const deliveryId = `poll-${c.type}-${c.githubId}`;

    // Check if event already exists
    const { data: existingRows } = await supabase
      .from("github_events")
      .select("id, status")
      .eq("user_id", conn.user_id)
      .eq("delivery_id", deliveryId)
      .limit(1);

    const existing = existingRows?.[0];
    let eventRowId = existing?.id as string | undefined;

    if (existing) {
      // If already processed or active, skip
      if (existing.status !== "received") {
        details.push({
          user_id: conn.user_id,
          type: c.type,
          repo: c.repo,
          number: c.number,
          outcome: "duplicate",
        });
        continue;
      }
    } else {
      // Insert new event
      const { data: inserted, error } = await supabase
        .from("github_events")
        .insert([
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
        ])
        .select("id");

      if (error || !inserted || (inserted as unknown[]).length === 0) {
        details.push({
          user_id: conn.user_id,
          type: c.type,
          repo: c.repo,
          number: c.number,
          outcome: "duplicate",
        });
        continue;
      }

      eventRowId = (inserted as { id: string }[])[0].id;

      // Immediately notify the user in the activities feed
      const isReview = c.type === "review_requested" || c.type === "pr_assigned";
      const notifTitle = isReview
        ? `Review requested: ${c.repo}#${c.number}`
        : `Issue assigned: ${c.repo}#${c.number}`;
      const notifDesc = `${c.title} — Orchestrator is preparing a sub-agent.`;

      await supabase.from("activities").insert([
        {
          user_id: conn.user_id,
          title: notifTitle,
          description: notifDesc,
          type: isReview ? "pr" : "issue",
        },
      ]);
    }

    if (!eventRowId) continue;

    if (count >= 5) {
      details.push({
        user_id: conn.user_id,
        type: c.type,
        repo: c.repo,
        number: c.number,
        outcome: "capped",
      });
      continue;
    }

    try {
      const isReview = c.type === "review_requested" || c.type === "pr_assigned";
      const isPR = isReview || c.type === "pr_assigned";
      const result = await proposeAndMaybeRun(supabase, {
        userId: conn.user_id,
        source: `github:${c.type}`,
        repo: c.repo,
        number: c.number,
        title: c.title,
        body: c.body,
        eventId: eventRowId,
        issueNumber: isPR ? null : c.number,
        prNumber: isPR ? c.number : null,
      });

      details.push({
        user_id: conn.user_id,
        type: c.type,
        repo: c.repo,
        number: c.number,
        outcome: "proposed",
        agentId: result.agentId,
        autoStarted: result.autoStarted,
      });
      count++;
    } catch (err) {
      // Don't leave a 'received' event that will block retries
      await supabase.from("github_events").delete().eq("id", eventRowId);
      const message = (err as Error).message.slice(0, 200);
      console.warn("propose failed:", err);
      details.push({
        user_id: conn.user_id,
        type: c.type,
        repo: c.repo,
        number: c.number,
        outcome: "failed",
        error: message,
      });
    }
  }
  return count;
}

const REPO_FROM_URL_RE = /\/repos\/([^/]+\/[^/]+)/;

function repoFromUrl(repositoryUrl: string): string {
  const m = REPO_FROM_URL_RE.exec(repositoryUrl);
  return m ? m[1] : "";
}
