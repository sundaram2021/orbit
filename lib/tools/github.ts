import { Octokit } from "@octokit/rest";
import { registerTool, type ToolContext } from "./registry";

function octo(ctx: ToolContext): Octokit {
  if (!ctx.githubToken) throw new Error("GitHub is not connected for this user.");
  return new Octokit({ auth: ctx.githubToken });
}

function parseRepo(repo: string): [string, string] {
  const [o, r] = repo.split("/");
  if (!o || !r) throw new Error(`Bad repo, expected owner/name: ${repo}`);
  return [o, r];
}

export function registerGithubTools(): void {
  registerTool({
    name: "github_read",
    description:
      "Read GitHub content: issue (body+comments), pr (metadata+diff), reviews (threads). Use before delegating or answering questions about work.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", description: '"issue" | "pr" | "reviews"' },
        repo: { type: "string", description: "owner/name" },
        number: { type: "string", description: "Issue or PR number" },
      },
      required: ["kind", "repo", "number"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const [o, r] = parseRepo(input.repo);
      const num = Number(input.number);
      const gh = octo(ctx);
      if (input.kind === "issue") {
        const [issue, comments] = await Promise.all([
          gh.issues.get({ owner: o, repo: r, issue_number: num }),
          gh.issues.listComments({ owner: o, repo: r, issue_number: num, per_page: 30 }),
        ]);
        const body = [
          `#${num} ${issue.data.title} [${issue.data.state}]`,
          issue.data.body?.slice(0, 4000) ?? "(no body)",
          "--- comments ---",
          ...comments.data.slice(-10).map((c) => `@${c.user?.login}: ${(c.body ?? "").slice(0, 800)}`),
        ].join("\n");
        return { ok: true, output: body.slice(0, 8000) };
      }
      if (input.kind === "pr") {
        const [pr, diff] = await Promise.all([
          gh.pulls.get({ owner: o, repo: r, pull_number: num }),
          gh.request(`GET /repos/${o}/${r}/pulls/${num}`, {
            headers: { accept: "application/vnd.github.diff" },
          }).then((res) => String(res.data).slice(0, 12000)),
        ]);
        return {
          ok: true,
          output: [
            `#${num} ${pr.data.title} [${pr.data.state}] ${pr.data.head.ref} → ${pr.data.base.ref}`,
            pr.data.body?.slice(0, 2000) ?? "(no body)",
            "--- diff (truncated) ---",
            diff,
          ].join("\n").slice(0, 14000),
        };
      }
      if (input.kind === "reviews") {
        const [reviews, comments] = await Promise.all([
          gh.pulls.listReviews({ owner: o, repo: r, pull_number: num, per_page: 30 }),
          gh.pulls.listReviewComments({ owner: o, repo: r, pull_number: num, per_page: 50 }),
        ]);
        const body = [
          ...reviews.data.slice(-10).map((v) => `Review by @${v.user?.login} [${v.state}]: ${(v.body ?? "").slice(0, 500)}`),
          "--- inline ---",
          ...comments.data.slice(-20).map((c) => `${c.path}:${c.line} @${c.user?.login}: ${(c.body ?? "").slice(0, 400)}`),
        ].join("\n");
        return { ok: true, output: body.slice(0, 8000) || "(no reviews yet)" };
      }
      return { ok: false, output: `Unknown kind: ${input.kind}` };
    },
  });

  registerTool({
    name: "github_comment",
    description: "Post a comment on an issue or PR. Requires user approval unless auto-approve is on.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name" },
        number: { type: "string", description: "Issue or PR number" },
        body: { type: "string", description: "Comment markdown" },
      },
      required: ["repo", "number", "body"],
    },
    permission: "gated",
    handler: async () => ({
      ok: true,
      output: "Queued for approval.",
      needsApproval: "github_comment",
    }),
  });

  registerTool({
    name: "search_memory",
    description: "Search global shared memory for past decisions, lessons, and evaluations.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to recall" },
      },
      required: ["query"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const { memoryRecall } = await import("../memory");
      const hit = await memoryRecall(ctx.userId, input.query, 5);
      return { ok: true, output: hit || "(no matching memories)" };
    },
  });
}
