import { sandboxExec } from "../sandbox/tensorlake";
import { registerTool } from "./registry";

/** Commands the model may never run (hang, escape, exfiltrate, destroy). */
const DENY_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\brm\s+-rf\s+(\/|~|\$HOME|\*)/, reason: "destructive rm -rf" },
  { re: /\b(vim|vi|nano|emacs|less|more)\b/, reason: "interactive editors hang the shell" },
  { re: /\bmkfs\b|\bdd\s+.*of=\/dev/, reason: "disk destruction" },
  { re: /:\(\)\s*{\s*:\|:&\s*};:/, reason: "fork bomb" },
  { re: /\bcurl\b.*\|\s*(bash|sh)\b/, reason: "remote code execution via pipe-to-shell" },
  { re: /\bwget\b.*\|\s*(bash|sh)\b/, reason: "remote code execution via pipe-to-shell" },
  { re: /GITHUB_TOKEN|AI_API_KEY|SUPABASE_SECRET|TENSORLAKE_API_KEY/, reason: "secret exfiltration attempt" },
  { re: />\s*~\/(?!)/, reason: "writes outside repo" },
  { re: /\bgit\s+push\b.*--force/, reason: "force push" },
  { re: /\bgit\s+push\b\s+origin\s+(main|master)\b/, reason: "direct push to default branch" },
  // No direct GitHub API writes: publishing goes through approval gates.
  { re: /api\.github\.com.*(Authorization|access_token|client_secret)/i, reason: "direct GitHub API write — use finish_task and let the orchestrator publish" },
  { re: /curl\b.*(-X\s*(POST|PUT|PATCH|DELETE)|--request\s*(POST|PUT|PATCH|DELETE)).*api\.github\.com/i, reason: "direct GitHub API write — use finish_task and let the orchestrator publish" },
  { re: /\bgh\s+(pr|issue|repo)\s+(create|merge|edit|comment)/, reason: "direct GitHub write — use finish_task and let the orchestrator publish" },
];

export function checkDenied(command: string): string | null {
  for (const { re, reason } of DENY_PATTERNS) {
    if (re.test(command)) return reason;
  }
  return null;
}

export function registerSandboxExecTools(): void {
  registerTool({
    name: "sandbox_exec",
    description:
      "Run a bash command in the sandbox repo checkout (tests, builds, git). Destructive/interactive/secret-touching commands are blocked. Prefer read_file/write_file/edit_file/glob/grep for file work.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Bash command to run" },
        timeout_secs: { type: "string", description: "Timeout in seconds (default 240, max 600)" },
      },
      required: ["command"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const denied = checkDenied(input.command ?? "");
      if (denied) {
        return { ok: false, output: `Command blocked by policy: ${denied}.` };
      }
      if (!ctx.sandboxId || !ctx.workdir) {
        return { ok: false, output: "No active sandbox for this agent." };
      }
      const timeoutMs =
        Math.min(600, Math.max(10, Number(input.timeout_secs ?? 240) || 240)) * 1000;
      const r = await sandboxExec(
        { id: ctx.sandboxId, mock: false },
        input.command,
        { workingDir: ctx.workdir, timeoutMs }
      );
      const out = `exit=${r.exitCode}\nSTDOUT:\n${r.stdout.slice(0, 8000)}\nSTDERR:\n${r.stderr.slice(0, 3000)}`;
      return { ok: r.exitCode === 0, output: out };
    },
  });

  registerTool({
    name: "track_tasks",
    description:
      "Maintain the work plan checklist. Call with the full updated list whenever scope changes or a step completes.",
    input_schema: {
      type: "object",
      properties: {
        tasks: { type: "string", description: 'JSON array, e.g. [{"t":"explore auth","done":true},{"t":"fix login","done":false}]' },
      },
      required: ["tasks"],
    },
    permission: "auto",
    handler: async (input) => {
      try {
        const tasks = JSON.parse(input.tasks ?? "[]") as { t: string; done: boolean }[];
        const lines = tasks.map((t) => `${t.done ? "[x]" : "[ ]"} ${t.t}`).join("\n");
        return { ok: true, output: `Plan updated:\n${lines}` };
      } catch {
        return { ok: false, output: "track_tasks failed: tasks must be a JSON array." };
      }
    },
  });

  registerTool({
    name: "finish_task",
    description:
      "End the run when the work is complete (or blocked). Provide a summary: files changed, tests run + result, and the PR title/body to publish.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Final summary of the work" },
        tests_passed: { type: "string", description: '"true" or "false"' },
      },
      required: ["summary"],
    },
    permission: "auto",
    handler: async (input) => {
      // Handled by the loop driver (terminates the loop). Reaching the
      // handler directly still yields a clean result shape.
      return {
        ok: true,
        output: `FINISH::${input.tests_passed === "true" ? "tests_passed" : "tests_unknown"}::${input.summary ?? ""}`,
      };
    },
  });

  registerTool({
    name: "self_diff",
    description:
      "Review your own changes: current branch, uncommitted status, commits vs base, and diff stat (or full diff). Call before finish_task to catch scope creep and write an accurate summary. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        base: { type: "string", description: "Base ref to compare against (auto-detected from origin when omitted)" },
        full: { type: "string", description: 'Set to "true" for the full diff, not just the stat' },
      },
    },
    permission: "auto",
    handler: async (input, ctx) => {
      if (!ctx.sandboxId || !ctx.workdir) {
        return { ok: false, output: "No active sandbox for this agent." };
      }
      const sb = { id: ctx.sandboxId, mock: false };
      const workdir: string = ctx.workdir;
      const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
      const run = async (cmd: string): Promise<string> => {
        const r = await sandboxExec(sb, `cd ${q(workdir)} && ${cmd}`, {
          workingDir: workdir,
        });
        return r.stdout.trim();
      };
      try {
        // Resolve the base ref: explicit > origin/HEAD > origin/main > origin/master.
        let base = (input.base ?? "").trim();
        if (!base) {
          const headRef = await run("git symbolic-ref --quiet --short refs/remotes/origin/HEAD || true");
          const candidates = [headRef, "origin/main", "origin/master"].filter(Boolean);
          base = "";
          for (const c of candidates) {
            const ok = await run(`git rev-parse --verify --quiet ${q(c)} || true`);
            if (ok) {
              base = c;
              break;
            }
          }
        }
        const branch = (await run("git branch --show-current")) || "(detached)";
        const status = (await run("git status --short | head -30")) || "(clean)";
        const sections = [`Branch: ${branch}`, `Uncommitted:\n${status}`];
        if (base) {
          const log = (await run(`git log --oneline ${q(base)}..HEAD | head -20`)) || "(no commits yet)";
          const stat =
            (await run(`git diff --stat ${q(base)}...HEAD | tail -20`)) || "(no changes vs base)";
          sections.push(`Commits vs ${base}:\n${log}`, `Diff stat vs ${base}:\n${stat}`);
          if ((input.full ?? "").toLowerCase() === "true") {
            const diff = await run(`git diff ${q(base)}...HEAD | head -400`);
            sections.push(`Full diff (truncated):\n${diff || "(empty)"}`);
          }
        } else {
          sections.push("(could not resolve base ref — showing working tree only)");
        }
        const out = sections.join("\n\n");
        return { ok: true, output: out.length > 9000 ? out.slice(0, 9000) + "\n…(truncated)" : out };
      } catch (err) {
        return { ok: false, output: `self_diff failed: ${(err as Error).message.slice(0, 300)}` };
      }
    },
  });
}
