import type { Octokit as OctokitType } from "@octokit/rest";

/**
 * Shared Octokit factory: dynamic import (keeps cold starts lean) +
 * bounded request timeout so GitHub hangs can't stall routes.
 */
export async function createOctokit(token: string): Promise<OctokitType> {
  const { Octokit } = await import("@octokit/rest");
  return new Octokit({
    auth: token,
    request: { timeout: 12000 },
  }) as OctokitType;
}

const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

/** Split "owner/name" strictly — "a/b/c" is rejected, not silently truncated. */
export function parseRepo(repo: string): { owner: string; name: string } | null {
  const trimmed = repo.trim();
  if (!REPO_RE.test(trimmed)) return null;
  const [owner, name] = trimmed.split("/");
  return { owner, name };
}

export function isGithubAuthError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return true;
  return /bad credentials|unauthorized|forbidden|token/i.test(String((err as Error)?.message ?? ""));
}

export function isGithubRateLimit(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 403) {
    return /rate.?limit|secondary/i.test(String((err as Error)?.message ?? "")) || status === 429;
  }
  return false;
}

export function githubErrorMessage(err: unknown): string {
  if (isGithubAuthError(err)) return "GitHub authentication failed — reconnect GitHub.";
  if (isGithubRateLimit(err)) return "GitHub rate limit hit — retry in a minute.";
  return (err as Error)?.message?.slice(0, 200) ?? "GitHub request failed";
}
