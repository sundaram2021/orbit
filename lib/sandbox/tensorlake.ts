import { orbitEnv } from "../env";
import { fetchWithTimeout, safeJson } from "../fetch-utils";

const API = "https://api.tensorlake.ai";
const FETCH_TIMEOUT_MS = 20000;

export interface SandboxHandle {
  id: string;
  mock: boolean;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${orbitEnv.tensorlakeApiKey}`,
    "Content-Type": "application/json",
  };
}

function shouldMock(): boolean {
  return orbitEnv.tensorlakeMock || !orbitEnv.tensorlakeApiKey;
}

/** List active sandboxes. */
export async function listSandboxes(): Promise<Array<{ id: string; name?: string; status?: string }>> {
  if (shouldMock()) return [];
  try {
    const res = await fetchWithTimeout(
      `${API}/sandboxes`,
      { method: "GET", headers: authHeaders() },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) return [];
    const data = await safeJson<
      | { sandboxes?: Array<{ id: string; name?: string; status?: string }>; data?: Array<{ id: string; name?: string; status?: string }> }
      | Array<{ id: string; name?: string; status?: string }>
    >(res);
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.sandboxes ?? data.data ?? [];
  } catch {
    return [];
  }
}

/**
 * Terminate orphaned sandboxes. Scoped by name prefix — never touches
 * sandboxes outside our prefix (other users' live runs are safe).
 */
export async function cleanupSandboxes(namePrefix = "orbit-"): Promise<number> {
  const sandboxes = await listSandboxes();
  let cleaned = 0;
  for (const s of sandboxes) {
    const id = s.id;
    if (!id) continue;
    if (namePrefix && s.name && !s.name.startsWith(namePrefix)) continue;
    try {
      await destroySandbox({ id, mock: false });
      cleaned++;
    } catch (err) {
      console.warn(`cleanup sandbox ${id} failed:`, err);
    }
  }
  return cleaned;
}

/** Create an ephemeral sandbox with internet access (for git + npm). */
export async function createSandbox(name: string): Promise<SandboxHandle> {
  if (shouldMock()) {
    console.warn("TensorLake: MOCK mode (no API key or TENSORLAKE_MOCK=true)");
    return { id: `mock-${Date.now().toString(36)}`, mock: true };
  }
  const createOnce = (sandboxName: string) =>
    fetchWithTimeout(
      `${API}/sandboxes`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: sandboxName,
          network: { allow_internet_access: true },
          timeout_secs: 3600,
          wait: true,
        }),
      },
      45000
    );
  let res = await createOnce(name);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (/quota/i.test(text)) {
      console.warn("TensorLake quota reached — attempting auto-cleanup of orphaned sandboxes...");
      await cleanupSandboxes("orbit-");
      // Retry once after cleanup
      res = await createOnce(`${name}-retry`);
      if (!res.ok) {
        const retryText = await res.text().catch(() => "");
        throw new Error(`TensorLake create failed after quota cleanup (${res.status}): ${retryText.slice(0, 300)}`);
      }
    } else {
      throw new Error(`TensorLake create failed (${res.status}): ${text.slice(0, 300)}`);
    }
  }
  const data = await safeJson<{ sandbox_id?: string; id?: string }>(res);
  const id = data?.sandbox_id ?? data?.id;
  if (!id) throw new Error("TensorLake create: no sandbox_id in response");
  return { id, mock: false };
}

async function startProcess(
  sandboxId: string,
  command: string,
  workingDir?: string,
  env?: Record<string, string>
): Promise<number> {
  const res = await fetchWithTimeout(
    `https://${sandboxId}.sandbox.tensorlake.ai/api/v1/processes`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        command: "bash",
        args: ["-lc", command],
        env: env ?? {},
        ...(workingDir ? { working_dir: workingDir } : {}),
        stdout_mode: "capture",
        stderr_mode: "capture",
      }),
    },
    FETCH_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`process start failed (${res.status})`);
  const data = await safeJson<{ pid?: number; handle?: number }>(res);
  const pid = data?.pid ?? data?.handle;
  if (pid == null) throw new Error("process start: no pid in response");
  return pid;
}

async function processStatus(
  sandboxId: string,
  pid: number
): Promise<{ status: string; exitCode: number | null }> {
  const res = await fetchWithTimeout(
    `https://${sandboxId}.sandbox.tensorlake.ai/api/v1/processes/${pid}`,
    { headers: authHeaders() },
    FETCH_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`process status failed (${res.status})`);
  const data = await safeJson<{ status?: string; exit_code?: number | null }>(res);
  return { status: data?.status ?? "unknown", exitCode: data?.exit_code ?? null };
}

async function processOutput(
  sandboxId: string,
  pid: number
): Promise<{ stdout: string; stderr: string }> {
  // Output endpoints return JSON {pid, lines[], line_count} — join lines,
  // falling back to raw text for any other shape.
  const fetchStream = async (kind: "stdout" | "stderr"): Promise<string> => {
    try {
      const res = await fetchWithTimeout(
        `https://${sandboxId}.sandbox.tensorlake.ai/api/v1/processes/${pid}/${kind}`,
        { headers: authHeaders() },
        FETCH_TIMEOUT_MS
      );
      if (!res.ok) return "";
      const text = await res.text();
      try {
        const parsed = JSON.parse(text) as { lines?: unknown };
        if (Array.isArray(parsed.lines)) {
          return parsed.lines.map((l) => String(l)).join("\n");
        }
      } catch {
        // not JSON — use raw text
      }
      return text;
    } catch {
      return "";
    }
  };
  const [stdout, stderr] = await Promise.all([fetchStream("stdout"), fetchStream("stderr")]);
  return { stdout, stderr };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run a shell command in the sandbox and wait for it to exit. */
export async function sandboxExec(
  sandbox: SandboxHandle,
  command: string,
  opts?: { workingDir?: string; env?: Record<string, string>; timeoutMs?: number }
): Promise<ExecResult> {
  if (sandbox.mock) {
    return {
      exitCode: 0,
      stdout: `[mock sandbox ${sandbox.id}] ran: ${command.slice(0, 200)}`,
      stderr: "",
    };
  }
  const pid = await startProcess(sandbox.id, command, opts?.workingDir, opts?.env);
  const deadline = Date.now() + (opts?.timeoutMs ?? 5 * 60 * 1000);
  let status = "running";
  let exitCode: number | null = null;
  let statusFailures = 0;
  while (Date.now() < deadline) {
    await sleep(2000);
    try {
      const s = await processStatus(sandbox.id, pid);
      status = s.status;
      exitCode = s.exitCode;
      statusFailures = 0;
    } catch {
      // Tolerate a couple of transient status failures; bail after 3 in a row.
      statusFailures++;
      if (statusFailures >= 3) break;
      continue;
    }
    if (status === "exited" || status === "signaled" || status === "oom_killed") break;
  }
  const timedOut = Date.now() >= deadline && status !== "exited" && status !== "signaled" && status !== "oom_killed";
  const { stdout, stderr } = await processOutput(sandbox.id, pid);
  return { exitCode, stdout: stdout.slice(-8000), stderr: stderr.slice(-4000), timedOut };
}

export async function destroySandbox(sandbox: SandboxHandle, retries = 2): Promise<void> {
  if (sandbox.mock) return;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `${API}/sandboxes/${encodeURIComponent(sandbox.id)}`,
        { method: "DELETE", headers: authHeaders() },
        FETCH_TIMEOUT_MS
      );
      if (res.ok || res.status === 404) return;
      lastErr = new Error(`destroy failed (${res.status})`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) await sleep(1000 * (attempt + 1));
  }
  console.warn("TensorLake destroy failed:", lastErr);
}
