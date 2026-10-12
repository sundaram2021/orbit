import { registerSandboxFileTools } from "./sandbox-files";
import { registerSandboxExecTools } from "./sandbox-exec";
import { registerGithubTools } from "./github";
import { registerOrchestratorTools } from "./orchestrator-tools";

/** Register every Orbit tool exactly once per process (idempotent). */
export function ensureAllTools(): void {
  registerSandboxFileTools();
  registerSandboxExecTools();
  registerGithubTools();
  registerOrchestratorTools();
}
