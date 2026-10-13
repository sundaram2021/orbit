import { createOctokit, parseRepo as parseRepoStrict, githubErrorMessage } from "../octokit";
import { sandboxExec } from "../sandbox/tensorlake";
import { registerTool, type ToolContext } from "./registry";

async function octo(ctx: ToolContext): Promise<ReturnType<typeof createOctokit>> {
  if (!ctx.githubToken) throw new Error("GitHub is not connected for this user.");
  return createOctokit(ctx.githubToken);
}

function parseRepo(repo: string): [string, string] {
  const parsed = parseRepoStrict(repo);
  if (!parsed) throw new Error(`Bad repo, expected owner/name: ${repo}`);
  return [parsed.owner, parsed.name];
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
      const gh = await octo(ctx);
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
          }).then(
            (res) => String(res.data).slice(0, 12000),
            () => "(diff unavailable)"
          ),
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
    description:
      "Post a comment on an issue or PR. Sub-agents (autonomous) post immediately; the orchestrator chat queues it for user approval.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name" },
        number: { type: "string", description: "Issue or PR number" },
        body: { type: "string", description: "Comment markdown" },
      },
      required: ["repo", "number", "body"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      // Sub-agent path: independent — post directly, no approval queue.
      if (ctx.agentId) {
        const [o, r] = parseRepo((input.repo ?? "").trim());
        const num = Number(input.number);
        if (!Number.isFinite(num)) return { ok: false, output: `Bad number: ${input.number}` };
        const body = (input.body ?? "").trim();
        if (!body) return { ok: false, output: "Empty comment body." };
        const gh = await octo(ctx);
        try {
          const comment = await gh.issues.createComment({
            owner: o,
            repo: r,
            issue_number: num,
            body,
          });
          return { ok: true, output: `Comment posted on ${input.repo}#${num}: ${comment.data.html_url}` };
        } catch (err) {
          return { ok: false, output: `Comment failed: ${(err as Error).message.slice(0, 300)}` };
        }
      }
      // Orchestrator path: gated, queued for approval.
      return {
        ok: true,
        output: "Queued for approval.",
        needsApproval: "github_comment",
      };
    },
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

  registerTool({
    name: "github_code_search",
    description:
      "Search code in the selected repo (or across accessible repos) for symbols, functions, or usage examples. Use BEFORE delegating to ground the sub-agent brief in exact files/symbols instead of guessing.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Code to find, e.g. 'refreshToken' or 'webhook retry'" },
        repo: { type: "string", description: "owner/name to scope the search (defaults to active repo)" },
      },
      required: ["query"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const q = (input.query ?? "").trim();
      if (!q) return { ok: false, output: "Empty query." };
      const repo = (input.repo ?? "").trim();
      const gh = await octo(ctx);
      try {
        const res = await gh.search.code({
          q: repo ? `${q} repo:${repo}` : q,
          per_page: 10,
        });
        const items = res.data.items ?? [];
        if (items.length === 0) return { ok: true, output: "(no code matches)" };
        const out = items
          .slice(0, 10)
          .map(
            (it) =>
              `• ${(it.repository as { full_name?: string } | undefined)?.full_name ?? "?"}:${it.path}\n  ${it.html_url}`
          )
          .join("\n");
        return { ok: true, output: out.slice(0, 4000) };
      } catch (err) {
        return { ok: false, output: `Code search failed: ${(err as Error).message.slice(0, 300)}` };
      }
    },
  });

  registerTool({
    name: "repo_overview",
    description:
      "Understand an unfamiliar repo before delegating: description, default branch, top-level layout, stack hints (package.json deps), and README head. Use when the repo is new to you or the request's applicability is unclear.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name of the repo" },
      },
      required: ["repo"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const [o, r] = parseRepo((input.repo ?? "").trim());
      const gh = await octo(ctx);
      try {
        const [meta, tree] = await Promise.all([
          gh.repos.get({ owner: o, repo: r }),
          gh.git.getTree({ owner: o, repo: r, tree_sha: "HEAD", recursive: "1" }),
        ]);
        const paths = (tree.data.tree ?? []).map((t) => t.path ?? "").filter(Boolean);
        const topLevel = [...new Set(paths.map((p) => p.split("/")[0]))].slice(0, 30);
        const sections: string[] = [
          `${meta.data.full_name}: ${meta.data.description || "(no description)"}`,
          `Default branch: ${meta.data.default_branch} | Language: ${meta.data.language || "?"} | ${meta.data.private ? "private" : "public"}`,
          `Top-level: ${topLevel.join(", ") || "(empty)"}`,
        ];
        try {
          const pkg = await gh.repos.getContent({ owner: o, repo: r, path: "package.json" });
          const file = pkg.data as { content?: string; encoding?: string };
          if (file.content) {
            const parsed = JSON.parse(
              Buffer.from(file.content, (file.encoding as BufferEncoding) ?? "base64").toString("utf8")
            ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
            const deps = Object.keys(parsed.dependencies ?? {}).slice(0, 15);
            if (deps.length > 0) sections.push(`Deps: ${deps.join(", ")}`);
          }
        } catch {
          // no package.json — not a node repo or unreadable; skip
        }
        try {
          const readme = await gh.repos.getContent({ owner: o, repo: r, path: "README.md" });
          const file = readme.data as { content?: string; encoding?: string };
          if (file.content) {
            const text = Buffer.from(
              file.content,
              (file.encoding as BufferEncoding) ?? "base64"
            ).toString("utf8");
            sections.push(`README head:\n${text.slice(0, 1500)}`);
          }
        } catch {
          // no README — skip
        }
        return { ok: true, output: sections.join("\n\n").slice(0, 6000) };
      } catch (err) {
        return { ok: false, output: `Repo overview failed: ${(err as Error).message.slice(0, 300)}` };
      }
    },
  });

  registerTool({
    name: "ci_status",
    description:
      "Check CI check-runs on a branch, commit, or PR head. Use to confirm your branch is green before finishing, or to see why CI is red. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name of the repo" },
        ref: { type: "string", description: "Branch name or commit SHA (defaults to your current branch)" },
        pr: { type: "string", description: "PR number — checks its head commit instead of ref" },
      },
      required: ["repo"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const [o, r] = parseRepo((input.repo ?? "").trim());
      const gh = await octo(ctx);
      try {
        let ref = (input.ref ?? "").trim();
        if (input.pr) {
          const prNum = Number(input.pr);
          if (!Number.isFinite(prNum)) return { ok: false, output: `Bad PR number: ${input.pr}` };
          const pr = await gh.pulls.get({ owner: o, repo: r, pull_number: prNum });
          ref = pr.data.head.sha;
        }
        if (!ref) return { ok: false, output: "Provide ref (branch/SHA) or pr." };
        const checks = await gh.checks.listForRef({ owner: o, repo: r, ref, per_page: 50 });
        const runs = checks.data.check_runs ?? [];
        if (runs.length === 0) {
          return { ok: true, output: `(no check runs reported for ${ref})` };
        }
        const tally = { pass: 0, fail: 0, pending: 0 };
        const lines = runs.slice(0, 30).map((c) => {
          const done = c.status === "completed";
          if (!done) tally.pending++;
          else if (c.conclusion === "success" || c.conclusion === "skipped") tally.pass++;
          else tally.fail++;
          return `• ${c.name} — ${done ? c.conclusion : c.status}`;
        });
        lines.unshift(
          `CI on ${ref}: ${tally.pass} passing, ${tally.fail} failing, ${tally.pending} pending (${runs.length} total)`
        );
        return { ok: true, output: lines.join("\n").slice(0, 4000) };
      } catch (err) {
        return { ok: false, output: `CI status failed: ${(err as Error).message.slice(0, 300)}` };
      }
    },
  });

  registerTool({
    name: "create_issue",
    description:
      "Create a GitHub issue immediately (sub-agents are autonomous — no approval needed). Use for filing follow-ups you discovered but must not fix (out-of-scope bugs), or when the task explicitly asks for an issue.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name of the repo" },
        title: { type: "string", description: "Issue title" },
        body: { type: "string", description: "Issue body: what, where, reproduction" },
      },
      required: ["repo", "title", "body"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const [o, r] = parseRepo((input.repo ?? "").trim());
      const title = (input.title ?? "").trim();
      const body = (input.body ?? "").trim();
      if (!title || !body) return { ok: false, output: "Title and body are required." };
      const gh = await octo(ctx);
      try {
        const issue = await gh.issues.create({ owner: o, repo: r, title, body });
        try {
          await ctx.supabase.from("activities").insert([
            {
              user_id: ctx.userId,
              title: `Issue created: ${input.repo}#${issue.data.number}`,
              description: title.slice(0, 200),
              type: "issue",
            },
          ]);
        } catch { /* visibility only — non-fatal */ }
        return {
          ok: true,
          output: `Issue created: ${input.repo}#${issue.data.number} ${issue.data.html_url}`,
        };
      } catch (err) {
        return { ok: false, output: `Create issue failed: ${(err as Error).message.slice(0, 300)}` };
      }
    },
  });

  registerTool({
    name: "create_pr",
    description:
      "Push your branch and open a pull request immediately (sub-agents are autonomous — no approval needed). Commits pending changes first. Only works from orbit/* branches; refuses default branches. Adopts the existing PR if one is already open on your branch. NEVER merge — merging stays with the user.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name of the repo" },
        title: { type: "string", description: "PR title" },
        body: { type: "string", description: "PR body: summary, files changed, tests run" },
        base: { type: "string", description: "Base branch (auto-detected from origin when omitted)" },
      },
      required: ["repo", "title"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const repo = (input.repo ?? "").trim();
      const [o, r] = parseRepo(repo);
      const title = (input.title ?? "").trim();
      if (!title) return { ok: false, output: "PR title is required." };
      if (!ctx.sandboxId || !ctx.workdir) {
        return { ok: false, output: "No active sandbox for this agent." };
      }
      const token = ctx.githubToken;
      if (!token) return { ok: false, output: "GitHub is not connected for this user." };
      const sb = { id: ctx.sandboxId, mock: false };
      const workdir: string = ctx.workdir;
      const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
      try {
        const run = async (cmd: string): Promise<{ code: number; out: string }> => {
          const res = await sandboxExec(sb, `cd ${q(workdir)} && ${cmd}`, { workingDir: workdir });
          return { code: res.exitCode ?? -1, out: `${res.stdout}\n${res.stderr}`.trim() };
        };
        const branch = (await run("git branch --show-current")).out.split("\n")[0].trim();
        if (!branch.startsWith("orbit/")) {
          return { ok: false, output: `Refused: not on an orbit/* branch (on ${branch || "unknown"}).` };
        }
        let base = (input.base ?? "").trim();
        if (!base) {
          const headRef = (await run("git symbolic-ref --quiet --short refs/remotes/origin/HEAD || true")).out.split("\n")[0].trim();
          for (const c of [headRef, "origin/main", "origin/master"].filter(Boolean)) {
            const ok = await run(`git rev-parse --verify --quiet ${q(c)} || true`);
            if (ok.out) {
              base = c.replace(/^origin\//, "");
              break;
            }
          }
        }
        if (!base) return { ok: false, output: "Could not detect base branch." };
        // Commit pending work with the agent identity (nothing persisted).
        await run(
          `git add -A && (git diff --cached --quiet || git -c user.name="Orbit Agent" -c user.email="orbit@users.noreply.github.com" commit -m ${q(`orbit: ${title}`)})`
        );
        // Push via one-shot URL (never stored; remote stays anonymous; the
        // token never appears in tool outputs or logs).
        const pushUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
        const pushed = await run(`git push '${pushUrl.replace(/'/g, "'\\''")}' HEAD:${branch}`);
        if (pushed.code !== 0) {
          return { ok: false, output: `Push failed: ${pushed.out.slice(0, 300)}` };
        }
        const gh = await octo(ctx);
        const open = await gh.pulls.list({ owner: o, repo: r, state: "open", head: `${o}:${branch}` });
        let prNumber: number;
        let prUrl: string;
        if (open.data[0]) {
          prNumber = open.data[0].number;
          prUrl = open.data[0].html_url;
        } else {
          const pr = await gh.pulls.create({
            owner: o,
            repo: r,
            title: title.slice(0, 120),
            head: branch,
            base,
            body: `${(input.body ?? "").trim() || title}\n\n---\n*Opened by Orbit sub-agent*`,
          });
          prNumber = pr.data.number;
          prUrl = pr.data.html_url;
        }
        // Record on the agent row (best-effort) so the dashboard + the
        // end-of-run flow adopt this PR instead of opening a duplicate.
        // Uses a local merge (no import of the runner — avoids a cycle).
        try {
          const { data } = await ctx.supabase
            .from("sub_agents")
            .select("result")
            .eq("id", ctx.agentId)
            .single();
          const current = ((data as { result?: Record<string, unknown> } | null)?.result ?? {}) as Record<string, unknown>;
          await ctx.supabase
            .from("sub_agents")
            .update({ result: { ...current, repo, branch, pr_number: prNumber, pr_url: prUrl } })
            .eq("id", ctx.agentId);
          await ctx.supabase.from("activities").insert([
            { user_id: ctx.userId, title: `PR opened: ${repo}#${prNumber}`, description: title.slice(0, 200), type: "pr" },
          ]);
        } catch { /* visibility only — non-fatal */ }
        return { ok: true, output: `PR ${repo}#${prNumber} is open: ${prUrl}` };
      } catch (err) {
        return { ok: false, output: `Create PR failed: ${(err as Error).message.slice(0, 300)}` };
      }
    },
  });

  registerTool({
    name: "submit_pr_review",
    description:
      "Submit a pull request review on GitHub (sub-agents are autonomous — no approval needed). Decision can be 'COMMENT', 'APPROVE', or 'REQUEST_CHANGES'.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name of the repo" },
        pr_number: { type: "string", description: "Pull request number to review" },
        event: {
          type: "string",
          enum: ["COMMENT", "APPROVE", "REQUEST_CHANGES"],
          description: "Review action: COMMENT (neutral feedback), APPROVE (accept), or REQUEST_CHANGES (blocking issues found)",
        },
        body: { type: "string", description: "Markdown review feedback and recommendations" },
      },
      required: ["repo", "pr_number", "body"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const repo = (input.repo ?? "").trim();
      const [o, r] = parseRepo(repo);
      const prNum = Number(input.pr_number);
      if (!Number.isFinite(prNum)) return { ok: false, output: `Bad PR number: ${input.pr_number}` };
      const body = (input.body ?? "").trim();
      if (!body) return { ok: false, output: "Review body is required." };
      const event = (input.event ?? "COMMENT").toUpperCase() as "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

      const gh = await octo(ctx);
      try {
        const review = await gh.pulls.createReview({
          owner: o,
          repo: r,
          pull_number: prNum,
          event,
          body,
        });

        try {
          await ctx.supabase.from("activities").insert([
            {
              user_id: ctx.userId,
              title: `PR review submitted: ${repo}#${prNum} (${event})`,
              description: body.slice(0, 200),
              type: "pr",
            },
          ]);
        } catch { /* non-fatal */ }

        return {
          ok: true,
          output: `Review (${event}) posted on ${repo}#${prNum}: ${review.data.html_url}`,
        };
      } catch (err) {
        return {
          ok: false,
          output: `Submit review failed: ${(err as Error).message.slice(0, 300)}`,
        };
      }
    },
  });

  registerTool({
    name: "close_issue",
    description:
      "Close an open GitHub issue when the user asks to close it. Supports closing reason ('completed' | 'not_planned') and an optional closing comment. From orchestrator chat this is queued for user approval first; sub-agents close directly.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name of the repo" },
        issue_number: { type: "string", description: "Issue number to close" },
        reason: { type: "string", description: "Optional closing reason: 'completed' (default) or 'not_planned'" },
        comment: { type: "string", description: "Optional comment to post before closing" },
      },
      required: ["repo", "issue_number"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const num = Number(input.issue_number);
      if (!Number.isFinite(num)) return { ok: false, output: `Bad issue number: ${input.issue_number}` };
      if (!(input.repo ?? "").includes("/")) return { ok: false, output: "Provide repo as owner/name." };
      // Orchestrator path: destructive — queue for user approval, never close silently.
      if (!ctx.agentId) {
        return { ok: true, output: "Queued for approval.", needsApproval: "close_issue" };
      }
      // Sub-agent path: autonomous — close immediately.
      return executeCloseIssue({
        supabase: ctx.supabase,
        userId: ctx.userId,
        githubToken: ctx.githubToken ?? null,
        repo: (input.repo ?? "").trim(),
        issueNumber: num,
        reason: (input.reason ?? "completed").trim(),
        comment: (input.comment ?? "").trim(),
      });
    },
  });

  registerTool({
    name: "close_pr",
    description:
      "Close an open GitHub pull request without merging when the user asks to close it. Optionally posts a closing comment first. From orchestrator chat this is queued for user approval first; sub-agents close directly.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name of the repo" },
        pr_number: { type: "string", description: "Pull request number to close" },
        comment: { type: "string", description: "Optional comment to post before closing" },
      },
      required: ["repo", "pr_number"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const num = Number(input.pr_number);
      if (!Number.isFinite(num)) return { ok: false, output: `Bad PR number: ${input.pr_number}` };
      if (!(input.repo ?? "").includes("/")) return { ok: false, output: "Provide repo as owner/name." };
      // Orchestrator path: destructive — queue for user approval, never close silently.
      if (!ctx.agentId) {
        return { ok: true, output: "Queued for approval.", needsApproval: "close_pr" };
      }
      // Sub-agent path: autonomous — close immediately.
      return executeClosePR({
        supabase: ctx.supabase,
        userId: ctx.userId,
        githubToken: ctx.githubToken ?? null,
        repo: (input.repo ?? "").trim(),
        prNumber: num,
        comment: (input.comment ?? "").trim(),
      });
    },
  });

  registerTool({
    name: "list_issues",
    description: "List or count issues in a repository. Supports filtering by state ('open' | 'closed' | 'all').",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name of the repo" },
        state: { type: "string", description: "State filter: 'open' (default), 'closed', or 'all'" },
        per_page: { type: "string", description: "Number of issues to return (default 30, max 100)" },
      },
      required: ["repo"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const repo = (input.repo ?? "").trim();
      const [o, r] = parseRepo(repo);
      const gh = await octo(ctx);
      const state = (input.state as "open" | "closed" | "all") || "open";
      const perPage = Math.min(100, Math.max(1, Number(input.per_page) || 30));
      try {
        const { data } = await gh.issues.listForRepo({
          owner: o,
          repo: r,
          state,
          per_page: perPage,
        });
        const issuesOnly = data.filter((item) => !item.pull_request);
        if (issuesOnly.length === 0) {
          return { ok: true, output: `No ${state} issues found in ${repo}.` };
        }
        const summary = issuesOnly
          .map((i) => `#${i.number} [${i.state}] ${i.title}${i.assignee ? ` (@${i.assignee.login})` : ""}`)
          .join("\n");
        return {
          ok: true,
          output: `Found ${issuesOnly.length} ${state} issue(s) in ${repo}:\n${summary}`,
        };
      } catch (err) {
        return { ok: false, output: `List issues failed: ${(err as Error).message.slice(0, 300)}` };
      }
    },
  });

  registerTool({
    name: "list_prs",
    description: "List or count pull requests in a repository. Supports filtering by state ('open' | 'closed' | 'all').",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name of the repo" },
        state: { type: "string", description: "State filter: 'open' (default), 'closed', or 'all'" },
        per_page: { type: "string", description: "Number of PRs to return (default 30, max 100)" },
      },
      required: ["repo"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const repo = (input.repo ?? "").trim();
      const [o, r] = parseRepo(repo);
      const gh = await octo(ctx);
      const state = (input.state as "open" | "closed" | "all") || "open";
      const perPage = Math.min(100, Math.max(1, Number(input.per_page) || 30));
      try {
        const { data } = await gh.pulls.list({
          owner: o,
          repo: r,
          state,
          per_page: perPage,
        });
        if (data.length === 0) {
          return { ok: true, output: `No ${state} pull requests found in ${repo}.` };
        }
        const summary = data
          .map((p) => `#${p.number} [${p.state}] ${p.title} (${p.head.ref} → ${p.base.ref})`)
          .join("\n");
        return {
          ok: true,
          output: `Found ${data.length} ${state} pull request(s) in ${repo}:\n${summary}`,
        };
      } catch (err) {
        return { ok: false, output: `List PRs failed: ${(err as Error).message.slice(0, 300)}` };
      }
    },
  });
}

export interface CloseIssueParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  githubToken: string | null | undefined;
  repo: string;
  issueNumber: number;
  reason?: string;
  comment?: string;
}

export interface ClosePRParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  githubToken: string | null | undefined;
  repo: string;
  prNumber: number;
  comment?: string;
}

/** Shared executor: close an issue (used by the tool handler AND the approval pipeline). */
export async function executeCloseIssue(params: CloseIssueParams): Promise<{ ok: boolean; output: string }> {
  const { supabase, userId, githubToken, repo, issueNumber } = params;
  if (!githubToken) return { ok: false, output: "GitHub is not connected for this user." };
  try {
    const [o, r] = parseRepo(repo.trim());
    const gh = await createOctokit(githubToken);
    const comment = (params.comment ?? "").trim();
    let commentPosted = true;
    if (comment) {
      commentPosted = await gh.issues
        .createComment({ owner: o, repo: r, issue_number: issueNumber, body: comment })
        .then(() => true)
        .catch(() => false);
    }
    const stateReason = params.reason === "not_planned" ? "not_planned" : "completed";
    await gh.issues.update({ owner: o, repo: r, issue_number: issueNumber, state: "closed", state_reason: stateReason });
    try {
      await supabase.from("activities").insert([
        {
          user_id: userId,
          title: `Issue closed: ${repo}#${issueNumber}`,
          description: `Closed as ${stateReason}${comment ? `: "${comment.slice(0, 100)}"` : ""}${comment && !commentPosted ? " (comment failed to post)" : ""}`,
          type: "issue",
        },
      ]);
    } catch { /* non-fatal */ }
    return { ok: true, output: `Issue #${issueNumber} in ${repo} closed successfully (${stateReason}).${comment && !commentPosted ? " Note: the comment failed to post." : ""}` };
  } catch (err) {
    return { ok: false, output: `Close issue failed: ${githubErrorMessage(err)}` };
  }
}

/** Shared executor: close a PR without merging (used by the tool handler AND the approval pipeline). */
export async function executeClosePR(params: ClosePRParams): Promise<{ ok: boolean; output: string }> {
  const { supabase, userId, githubToken, repo, prNumber } = params;
  if (!githubToken) return { ok: false, output: "GitHub is not connected for this user." };
  try {
    const [o, r] = parseRepo(repo.trim());
    const gh = await createOctokit(githubToken);
    const comment = (params.comment ?? "").trim();
    let commentPosted = true;
    if (comment) {
      commentPosted = await gh.issues
        .createComment({ owner: o, repo: r, issue_number: prNumber, body: comment })
        .then(() => true)
        .catch(() => false);
    }
    await gh.pulls.update({ owner: o, repo: r, pull_number: prNumber, state: "closed" });
    try {
      await supabase.from("activities").insert([
        {
          user_id: userId,
          title: `PR closed: ${repo}#${prNumber}`,
          description: `Closed without merge${comment ? `: "${comment.slice(0, 100)}"` : ""}${comment && !commentPosted ? " (comment failed to post)" : ""}`,
          type: "pr",
        },
      ]);
    } catch { /* non-fatal */ }
    return { ok: true, output: `Pull request #${prNumber} in ${repo} closed successfully.${comment && !commentPosted ? " Note: the comment failed to post." : ""}` };
  } catch (err) {
    return { ok: false, output: `Close PR failed: ${githubErrorMessage(err)}` };
  }
}
