/**
 * Single typed tool registry for all three Orbit agents.
 * Every tool declares a permission:
 *  - auto:   reads and sandbox-local writes, always allowed
 *  - gated:  needs an approvals row (user click or auto-approve setting)
 *  - deny:   never offered to the model
 * Execution stays server-side: the model emits the call, our code runs it.
 */

export type ToolPermission = "auto" | "gated" | "deny";

export interface OrbitToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  permission: ToolPermission;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  /** When true, the orchestrator must seek approval before considering it done. */
  needsApproval?: string;
}

export type ToolHandler = (
  input: Record<string, string>,
  ctx: ToolContext
) => Promise<ToolResult>;

export interface ToolContext {
  userId: string;
  /** Service-role supabase client (RLS bypassed; scope manually by userId). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  traceId: string;
  githubToken?: string | null;
  sandboxId?: string | null;
  workdir?: string | null;
  agentId?: string | null;
}

export interface RegisteredTool extends OrbitToolDef {
  handler: ToolHandler;
}

const registry = new Map<string, RegisteredTool>();

export function registerTool(tool: RegisteredTool): void {
  registry.set(tool.name, tool);
}

export function getTool(name: string): RegisteredTool | undefined {
  return registry.get(name);
}

/** Anthropic-compatible JSON schemas for a set of registered tools. */
export function toolSchemas(names: string[]): Omit<OrbitToolDef, "permission">[] {
  return names
    .map((n) => registry.get(n))
    .filter((t): t is RegisteredTool => Boolean(t))
    .filter((t) => t.permission !== "deny")
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ handler, permission, ...def }) => def);
}

export async function runTool(
  name: string,
  input: Record<string, string>,
  ctx: ToolContext
): Promise<ToolResult> {
  const tool = registry.get(name);
  if (!tool) return { ok: false, output: `Unknown tool: ${name}` };
  if (tool.permission === "deny") {
    return { ok: false, output: `Tool ${name} is disabled by policy.` };
  }
  try {
    return await tool.handler(input, ctx);
  } catch (err) {
    return { ok: false, output: `Tool ${name} failed: ${(err as Error).message.slice(0, 500)}` };
  }
}
