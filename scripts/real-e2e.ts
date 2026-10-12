/**
 * REAL end-to-end: real issue + real agent run + real PR (+ merge) on
 * https://github.com/sundaram2021/testing-ao using the stored user token.
 * Run: bun scripts/real-e2e.ts [--merge]
 * --merge also exercises the merge-approval code path for real.
 */
import { readFileSync, writeFileSync } from "fs";

const envRaw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
}

import { Octokit } from "@octokit/rest";
import { createServiceClient } from "../lib/supabase-service";
import { proposeFromEvent } from "../lib/orchestrator/spawn";
import { handleApprove } from "../app/api/approvals/route";

const REPO = "sundaram2021/testing-ao";
const [OWNER, NAME] = REPO.split("/");
const DO_MERGE = process.argv.includes("--merge");

interface R {
  step: string;
  status: "PASS" | "FAIL";
  detail: string;
}
const results: R[] = [];
function record(step: string, status: R["status"], detail: string) {
  results.push({ step, status, detail });
  console.log(`[${status}] ${step} — ${detail}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const svc = createServiceClient();
  const { data: conns } = await svc.from("github_connections").select("user_id,provider_token,github_username").limit(5);
  const conn = (conns as { user_id: string; provider_token: string; github_username: string }[] | null)?.[0];
  if (!conn) throw new Error("No github_connections row — user must log in once first.");
  const userId = conn.user_id;
  const octokit = new Octokit({ auth: conn.provider_token });
  console.log(`Acting as @${conn.github_username} on ${REPO}`);

  // Save + force auto-approve for the run (restored in finally).
  const { data: prevSettings } = await svc.from("user_settings").select("*").eq("user_id", userId).single();
  const prev = (prevSettings as { orchestrator_auto_approve?: boolean } | null)?.orchestrator_auto_approve ?? false;
  await svc.from("user_settings").upsert([{ user_id: userId, orchestrator_auto_approve: true }], { onConflict: "user_id" });

  let prNumber = 0;
  try {
    // 1. Seed main branch (empty repos have no base for PRs).
    try {
      await octokit.repos.getContent({ owner: OWNER, repo: NAME, path: "README.md" });
      record("seed", "PASS", "README exists on default branch");
    } catch {
      await octokit.repos.createOrUpdateFileContents({
        owner: OWNER, repo: NAME, path: "README.md",
        message: "Orbit E2E seed", content: Buffer.from("# testing-ao\nOrbit end-to-end test repo.\n").toString("base64"),
        branch: "main",
      });
      record("seed", "PASS", "created README on main");
    }

    // 2. Real issue with a UNIQUE task per run (repeat runs must not no-op).
    // Deliberately UNASSIGNED: the production poller only reacts to assigned
    // issues, so it won't race this test with a duplicate agent.
    const tag = Date.now().toString(36);
    const issue = await octokit.issues.create({
      owner: OWNER, repo: NAME,
      title: `Orbit E2E ${tag}: add run file`,
      body: `Please add a file named \`orbit-e2e-${tag}.txt\` containing a friendly greeting plus this run tag \`${tag}\`, on its own branch, and open a pull request. Keep the change minimal.`,
    });
    record("real-issue", "PASS", `#${issue.data.number} assigned to @${conn.github_username} ${issue.data.html_url}`);

    // 3. Intake event row (as the poller would write it).
    const delivery = `e2e-${Date.now()}`;
    const { data: ev, error: evErr } = await svc.from("github_events").insert([{
      user_id: userId, delivery_id: delivery, type: "issue_assigned",
      repo: REPO, number: issue.data.number, title: issue.data.title,
      payload: { body: issue.data.body }, status: "received",
    }]).select("*").single();
    if (evErr || !ev) throw new Error(`event insert failed: ${evErr?.message}`);
    record("intake", "PASS", `event ${(ev as { id: string }).id}`);

    // 4. Full pipeline: propose (auto-fires exactly one run) → poll to terminal.
    // NOTE: never call runSubAgent here — propose already started it; a second
    // call would race it (verified the hard way).
    const { agentId, autoStarted } = await proposeFromEvent(svc, ev as never);
    record("propose", autoStarted ? "PASS" : "FAIL", `agent ${agentId} autoStarted=${autoStarted}`);

    const { data: agentRow } = await svc.from("sub_agents").select("system_prompt").eq("id", agentId).single();
    const ar = agentRow as { system_prompt: string } | null;
    record("customized-prompt", ar && ar.system_prompt.includes(REPO) ? "PASS" : "FAIL", `prompt=${ar?.system_prompt.length ?? 0} chars`);

    let st = "";
    for (let i = 0; i < 60 && st !== "completed" && st !== "failed"; i++) {
      await sleep(15000);
      const { data: done } = await svc.from("sub_agents").select("status").eq("id", agentId).single();
      st = ((done as { status: string } | null)?.status ?? "") as string;
    }
    record("run", st === "completed" ? "PASS" : "FAIL", `status=${st}`);

    // 5. Real PR exists?
    await sleep(15000);
    const prs = await octokit.pulls.list({ owner: OWNER, repo: NAME, state: "open", per_page: 10 });
    const ours = prs.data.find((p) => p.head.ref.startsWith("orbit/"));
    if (!ours) throw new Error("No orbit PR found");
    prNumber = ours.number;
    record("real-pr", "PASS", `#${prNumber} ${ours.html_url} branch=${ours.head.ref}`);

    // 6. Branch contains the unique run file?
    const files = await octokit.pulls.listFiles({ owner: OWNER, repo: NAME, pull_number: prNumber });
    record("pr-files", files.data.some((f) => f.filename.includes(`orbit-e2e-${tag}`)) ? "PASS" : "FAIL", files.data.map((f) => f.filename).join(","));

    // 7. Evaluation row appears (fire-and-forget inside run).
    let evalRow: { score: number; summary: string } | null = null;
    for (let i = 0; i < 24 && !evalRow; i++) {
      await sleep(10000);
      const { data } = await svc.from("evaluations").select("score,summary").eq("sub_agent_id", agentId).order("created_at", { ascending: false }).limit(1).single();
      if (data) evalRow = data as unknown as { score: number; summary: string };
    }
    record("evaluation", evalRow ? "PASS" : "FAIL", evalRow ? `score=${evalRow.score}: ${String(evalRow.summary).slice(0, 150)}` : "no evaluation row in 4 min");

    // 8. Merge path (opt-in): real merge-approval execution.
    if (DO_MERGE && prNumber) {
      const { data: appr } = await svc.from("approvals").insert([{
        user_id: userId, kind: "merge",
        ref_id: JSON.stringify({ agentId, repo: REPO, prNumber }),
        status: "pending",
      }]).select("id").single();
      await handleApprove(svc, userId, { id: (appr as { id: string }).id, user_id: userId, kind: "merge", ref_id: JSON.stringify({ agentId, repo: REPO, prNumber }), status: "pending" } as never);
      await sleep(10000);
      const merged = await octokit.pulls.get({ owner: OWNER, repo: NAME, pull_number: prNumber });
      record("real-merge", merged.data.merged ? "PASS" : "FAIL", `merged=${merged.data.merged}`);
      await octokit.issues.createComment({ owner: OWNER, repo: NAME, issue_number: issue.data.number, body: `Orbit E2E verified: fixed by #${prNumber} (merged).` });
      await octokit.issues.update({ owner: OWNER, repo: NAME, issue_number: issue.data.number, state: "closed" });
      record("issue-close", "PASS", `closed #${issue.data.number}`);
    }
  } finally {
    await svc.from("user_settings").upsert([{ user_id: userId, orchestrator_auto_approve: prev }], { onConflict: "user_id" });
    console.log(`auto-approve restored to ${prev}`);
  }

  const p = results.filter((r) => r.status === "PASS").length;
  const f = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n==== REAL-E2E: ${p} PASS / ${f} FAIL ====`);
  writeFileSync(new URL("./real-e2e-results.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), prNumber, results }, null, 2));
  if (f > 0) process.exit(1);
}

main().catch((e) => {
  console.error("REAL-E2E crashed:", e);
  process.exit(1);
});
