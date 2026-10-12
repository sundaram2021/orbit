/**
 * Stage 1 of the evaluator pipeline: deterministic programmatic gates.
 * Gates run BEFORE the LLM judge — a run that fails gates is scored low
 * without spending a judge call on the obvious, and the gate results
 * become rubric inputs.
 */

export interface GateResults {
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
}

const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /sk-ant-[A-Za-z0-9_-]{10,}/, label: "anthropic key" },
  { re: /sk-[A-Za-z0-9]{20,}/, label: "api key" },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/, label: "github token" },
  { re: /x-access-token:[^@\s]+@/, label: "embedded git credential" },
  { re: /sb_secret_[A-Za-z0-9_-]{10,}/, label: "supabase secret" },
  { re: /tl_apiKey_[A-Za-z0-9_-]{10,}/, label: "tensorlake key" },
  { re: /-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----/, label: "private key" },
  { re: /AKIA[0-9A-Z]{16}/, label: "aws key" },
];

export function scanSecrets(text: string): string[] {
  const hits: string[] = [];
  for (const { re, label } of SECRET_PATTERNS) {
    if (re.test(text)) hits.push(label);
  }
  return [...new Set(hits)];
}

/** Mask credentials before persisting logs/traces (defense in depth). */
export function scrubSecrets(text: string): string {
  let out = text;
  out = out.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@");
  out = out.replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, "sk-ant-***");
  out = out.replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "ghp-***");
  out = out.replace(/sb_secret_[A-Za-z0-9_-]{10,}/g, "sb_secret-***");
  out = out.replace(/tl_apiKey_[A-Za-z0-9_-]{10,}/g, "tl_apiKey-***");
  out = out.replace(/-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |OPENSSH )?PRIVATE KEY-----/g, "***PRIVATE KEY***");
  return out;
}

/** Detect the agent looping on the same command 3+ times. */
export function detectLoops(runLog: string): string[] {
  const cmds: string[] = [];
  for (const m of runLog.matchAll(/(?:\$ |\[sandbox_exec\] "?\{?"command"?: ?"?)([^\n]{1,120})/g)) {
    cmds.push(m[1].trim().slice(0, 80));
  }
  const counts = new Map<string, number>();
  for (const c of cmds) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= 3).map(([c, n]) => `${c} (×${n})`);
}

export function runGates(input: {
  summary: string;
  runLog: string;
  testsPassed: boolean;
  diffStat: string;
  prOpened: boolean;
}): GateResults {
  const checks: GateResults["checks"] = [];

  const secretHits = scanSecrets(`${input.summary}\n${input.runLog}\n${input.diffStat}`);
  checks.push({
    name: "no_secrets",
    passed: secretHits.length === 0,
    detail: secretHits.length === 0 ? "no secrets detected" : `LEAKED: ${secretHits.join(", ")}`,
  });

  const loops = detectLoops(input.runLog);
  checks.push({
    name: "no_loops",
    passed: loops.length === 0,
    detail: loops.length === 0 ? "no repeated-command loops" : `loops: ${loops.join("; ").slice(0, 300)}`,
  });

  const hasOutput = input.summary.trim().length > 30;
  checks.push({
    name: "has_output",
    passed: hasOutput,
    detail: hasOutput ? "agent produced a summary" : "empty summary",
  });

  const filesChanged = /(\d+ files? changed|\+\+\+ b\/)/.test(input.diffStat) || input.diffStat.includes("files_changed:");
  checks.push({
    name: "files_changed",
    passed: filesChanged,
    detail: filesChanged ? input.diffStat.slice(0, 200) : "no file changes detected",
  });

  checks.push({
    name: "tests_passed",
    passed: input.testsPassed,
    detail: input.testsPassed ? "test command exited 0" : "no passing test run recorded",
  });

  const fatal = checks.filter((c) => (c.name === "no_secrets" || c.name === "has_output") && !c.passed);
  return { passed: fatal.length === 0, checks };
}
