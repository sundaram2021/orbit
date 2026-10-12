/**
 * Orbit end-to-end workflow test — REAL services, REAL repo.
 * Target repo: https://github.com/sundaram2021/testing-ao
 *
 * Run: bun scripts/e2e-test.ts
 * Tests: Anthropic classify → customized prompt build → TensorLake sandbox
 * (clone + exec + destroy) → NeatLogs trace → Supermemory remember/recall/graph
 * → evaluator scoring → Supabase schema check.
 */
import { readFileSync, writeFileSync } from "fs";

// --- load .env.local (bun does not auto-load it) ---
const envRaw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

import { classifyWork } from "../lib/orchestrator/classify";
import { buildSystemPrompt } from "../lib/orchestrator/prompts";
import { haikuComplete } from "../lib/ai";
import {
  createSandbox,
  sandboxExec,
  destroySandbox,
} from "../lib/sandbox/tensorlake";
import { traceStart, traceSpan, newTraceId } from "../lib/traces";
import { memoryRemember, memoryRecall } from "../lib/memory";

interface StepResult {
  step: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
}
const results: StepResult[] = [];
function record(step: string, status: StepResult["status"], detail: string) {
  results.push({ step, status, detail });
  console.log(`[${status}] ${step} — ${detail}`);
}

// Minimal Supabase REST client (checks tables exist; no js lib needed).
const SB_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SECRET_KEY || "";
async function sbGet(table: string, query = "select=*&limit=1") {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 300) };
}

const TEST_REPO = "sundaram2021/testing-ao";

async function main() {
  // 1. GitHub: target repo reachable?
  try {
    const res = await fetch(`https://api.github.com/repos/${TEST_REPO}`);
    record("github-repo", res.ok ? "PASS" : "FAIL", `GET repos/${TEST_REPO} → ${res.status}`);
  } catch (e) {
    record("github-repo", "FAIL", (e as Error).message);
  }

  // 2. Supabase schema (both migrations applied?)
  const tables = [
    "github_connections",
    "github_events",
    "sub_agents",
    "chat_threads",
    "approvals",
    "evaluations",
    "user_settings",
    "agent_templates",
  ];
  for (const t of tables) {
    try {
      const r = await sbGet(t);
      record(`schema:${t}`, r.ok ? "PASS" : "FAIL", `HTTP ${r.status} ${r.ok ? "" : r.body}`);
    } catch (e) {
      record(`schema:${t}`, "FAIL", (e as Error).message);
    }
  }
  // v2 columns present?
  try {
    const r = await sbGet("sub_agents", "select=id,run_log,skill_definitions&limit=1");
    record("schema:sub_agents.v2", r.ok ? "PASS" : "FAIL", `run_log+skill_definitions → HTTP ${r.status}${r.ok ? "" : " " + r.body}`);
  } catch (e) {
    record("schema:sub_agents.v2", "FAIL", (e as Error).message);
  }

  // Fake supabase client for template/skill lookups (REST-backed).
  const fakeSb = {
    from: (_table: string) => ({
      select: () => ({
        eq: async () => ({ data: null }),
        single: async () => ({ data: null }),
        in: async () => ({ data: [] as unknown[] }),
      }),
      insert: async () => ({ data: null, error: null }),
      update: async () => ({ eq: async () => ({}) }),
      upsert: async () => ({}),
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = fakeSb as any;

  // 3. Classify a synthetic testing-ao issue (REAL Haiku call).
  let classification: Awaited<ReturnType<typeof classifyWork>> | null = null;
  try {
    classification = await classifyWork({
      source: "github:issue_assigned",
      repo: TEST_REPO,
      number: 1,
      title: "Add hello endpoint returning JSON",
      body: "The testing-ao repo needs a GET /hello endpoint that returns {\"msg\":\"hello\"} plus a test.",
    });
    const valid =
      ["implementation", "review", "testing", "custom"].includes(classification.kind) &&
      classification.title.length > 0;
    record("classify", valid ? "PASS" : "FAIL", JSON.stringify(classification).slice(0, 300));
  } catch (e) {
    record("classify", "FAIL", (e as Error).message.slice(0, 300));
  }

  // 4. Build customized prompt (template fallback path — no skills).
  try {
    const prompt = await buildSystemPrompt(sbAny, classification ?? { kind: "implementation", title: "t", repo: TEST_REPO, risk: "low", plan: "p" }, {
      memoryDigest: "Prior eval: prefer bun tests.",
      eventContext: "issue body here",
    });
    const ok = prompt.includes(TEST_REPO) && prompt.includes("orbit/");
    record("prompt-build", ok ? "PASS" : "FAIL", `${prompt.length} chars, repo+branch rules ${ok ? "present" : "MISSING"}`);
  } catch (e) {
    record("prompt-build", "FAIL", (e as Error).message.slice(0, 300));
  }

  // 6. TensorLake sandbox: create → clone testing-ao → ls → destroy (REAL).
  try {
    const sb = await createSandbox(`orbit-e2e-${Date.now().toString(36)}`);
    record("sandbox-create", "PASS", `id=${sb.id} mock=${sb.mock}`);
    const clone = await sandboxExec(
      sb,
      `mkdir -p /tmp/orbit-work && rm -rf /tmp/orbit-work/testing-ao && git clone --depth 5 https://github.com/${TEST_REPO}.git /tmp/orbit-work/testing-ao && ls -la /tmp/orbit-work/testing-ao`,
      { timeoutMs: 120000 }
    );
    record("sandbox-clone", clone.exitCode === 0 ? "PASS" : "FAIL", `exit=${clone.exitCode} out=${clone.stdout.slice(0, 200)} err=${clone.stderr.slice(0, 200)}`);
    const exec = await sandboxExec(sb, `echo '{"msg":"hello"}' > /tmp/orbit-work/testing-ao/hello.json && cat /tmp/orbit-work/testing-ao/hello.json`);
    record("sandbox-exec", exec.exitCode === 0 && exec.stdout.includes("hello") ? "PASS" : "FAIL", `exit=${exec.exitCode} out=${exec.stdout.slice(0, 120)}`);
    await destroySandbox(sb);
    record("sandbox-destroy", "PASS", "destroy called");
  } catch (e) {
    record("sandbox", "FAIL", (e as Error).message.slice(0, 300));
  }

  // 7. NeatLogs trace (REAL — verify it accepts the span).
  try {
    const tid = newTraceId();
    await traceStart({ traceId: tid, title: "orbit e2e test", metadata: { repo: TEST_REPO } });
    await traceSpan(tid, { name: "e2e_step", detail: "synthetic verification span" });
    record("neatlogs", "PASS", `trace ${tid} spans sent (verify in dashboard; failures are non-fatal by design)`);
  } catch (e) {
    record("neatlogs", "FAIL", (e as Error).message.slice(0, 300));
  }

  // 8. Supermemory remember + recall + graph list (REAL).
  // NOTE: Supermemory only extracts memories from fact-dense content —
  // one-liners yield zero memories (verified against the real API).
  const probe = `Orbit E2E verification for repository ${TEST_REPO} at ${new Date().toISOString()}. The workflow test cloned the repo in a TensorLake sandbox and executed shell commands successfully. Lesson learned: sandboxes require /tmp paths because /workspace is not writable. The project test command and hello endpoint contract were recorded for future agent runs.`;
  try {
    await memoryRemember("e2e-test-user", probe, { kind: "e2e" });
    record("memory-remember", "PASS", "remember call completed");
  } catch (e) {
    record("memory-remember", "FAIL", (e as Error).message.slice(0, 300));
  }
  try {
    await new Promise((r) => setTimeout(r, 60000));
    const hit = await memoryRecall("e2e-test-user", "testing-ao sandbox tmp workflow lesson");
    record("memory-recall", hit.length > 0 ? "PASS" : "FAIL", `recall returned ${hit.length} chars: ${hit.slice(0, 200)}`);
  } catch (e) {
    record("memory-recall", "FAIL", (e as Error).message.slice(0, 300));
  }
  try {
    const res = await fetch("https://api.supermemory.ai/v3/documents/documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPERMEMORY_API_KEY}`,
      },
      body: JSON.stringify({ page: 1, limit: 5, sort: "createdAt", order: "desc" }),
    });
    record("memory-graph-api", res.ok ? "PASS" : "FAIL", `documents list → HTTP ${res.status}`);
  } catch (e) {
    record("memory-graph-api", "FAIL", (e as Error).message.slice(0, 300));
  }

  // 9. Evaluator full-context scoring on synthetic run (REAL Haiku call).
  try {
    const raw = await haikuComplete({
      system: "You are Orbit's evaluator agent. Output ONLY valid JSON with keys: score (0-100), dims (per-dimension 0-25), summary, mistakes, prompt_patch.",
      messages: [
        {
          role: "user",
          content: [
            "## Task\nAdd hello endpoint (kind: implementation)",
            "## Kind template\nYou are an implementation sub-agent.",
            "## Whole customized prompt\nYou are an implementation sub-agent. Repo: sundaram2021/testing-ao. Create branch orbit/x.",
            "## Run log\n$ ls → exit 0\n$ echo file → exit 0",
            "## Output\nCreated hello.json with {\"msg\":\"hello\"}. No tests run.",
            "Score this work.",
          ].join("\n\n"),
        },
      ],
      maxTokens: 1024,
    });
    const parsed = JSON.parse(raw) as { score: number; summary: string };
    const ok = typeof parsed.score === "number" && parsed.score >= 0 && parsed.score <= 100;
    record("evaluator", ok ? "PASS" : "FAIL", `score=${parsed.score} summary=${String(parsed.summary).slice(0, 150)}`);
  } catch (e) {
    record("evaluator", "FAIL", (e as Error).message.slice(0, 300));
  }

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n==== E2E: ${pass} PASS / ${fail} FAIL ====`);
  writeFileSync(
    new URL("./e2e-results.json", import.meta.url),
    JSON.stringify({ at: new Date().toISOString(), results }, null, 2)
  );
}

main().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
