import { createSandbox, sandboxExec, destroySandbox } from "../sandbox/tensorlake";

/**
 * Independent verification: re-clone the agent's branch in a FRESH sandbox
 * and re-run the repo's test command. The judge gets verified_tests
 * instead of trusting the agent's own tests_passed flag.
 */
export async function verifyBranch(opts: {
  cloneUrl: string;
  repoDir: string;
  branch: string;
  testCommand: string;
}): Promise<{ ok: boolean; output: string }> {
  let sandbox: { id: string; mock: boolean } | null = null;
  try {
    sandbox = await createSandbox(`orbit-verify-${Date.now().toString(36)}`);
    if (sandbox.mock) {
      return { ok: false, output: "verification skipped (mock sandbox)" };
    }
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    const setup = await sandboxExec(
      sandbox,
      `mkdir -p /tmp/orbit-verify && rm -rf /tmp/orbit-verify/repo && git clone --depth 50 ${q(opts.cloneUrl)} /tmp/orbit-verify/repo && cd /tmp/orbit-verify/repo && git checkout ${q(opts.branch)}`,
      { timeoutMs: 3 * 60 * 1000 }
    );
    if (setup.exitCode !== 0) {
      return { ok: false, output: `verify checkout failed: ${setup.stderr.slice(0, 400)}` };
    }
    const test = await sandboxExec(sandbox, `cd /tmp/orbit-verify/repo && ${opts.testCommand}`, {
      workingDir: "/tmp/orbit-verify/repo",
      timeoutMs: 8 * 60 * 1000,
    });
    return {
      ok: test.exitCode === 0,
      output: `exit=${test.exitCode}\n${test.stdout.slice(0, 2000)}\n${test.stderr.slice(0, 800)}`,
    };
  } catch (err) {
    return { ok: false, output: `verification error: ${(err as Error).message.slice(0, 400)}` };
  } finally {
    if (sandbox) await destroySandbox(sandbox);
  }
}

/** Best-guess test command from repo files (package.json → bun/npm test). */
export async function detectTestCommand(opts: {
  cloneUrl: string;
}): Promise<string> {
  let sandbox: { id: string; mock: boolean } | null = null;
  try {
    sandbox = await createSandbox(`orbit-detect-${Date.now().toString(36)}`);
    if (sandbox.mock) return "npm test";
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    const r = await sandboxExec(
      sandbox,
      `rm -rf /tmp/orbit-detect && git clone --depth 1 ${q(opts.cloneUrl)} /tmp/orbit-detect 2>/dev/null; ls /tmp/orbit-detect; cat /tmp/orbit-detect/package.json 2>/dev/null | head -40`,
      { timeoutMs: 2 * 60 * 1000 }
    );
    const out = r.stdout;
    if (out.includes("bun.lock")) return "bun test";
    if (out.includes('"test"')) return "npm test";
    if (/pytest|test_/i.test(out)) return "pytest -q";
    if (/\.go$|go\.mod/.test(out)) return "go test ./...";
    return "npm test";
  } catch {
    return "npm test";
  } finally {
    if (sandbox) await destroySandbox(sandbox);
  }
}
