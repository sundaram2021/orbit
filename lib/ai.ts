import Anthropic from "@anthropic-ai/sdk";
import { orbitEnv } from "./env";
import { withRetry, withTimeout } from "./fetch-utils";

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    if (!orbitEnv.anthropicApiKey) {
      throw new Error("AI_API_KEY is not configured");
    }
    client = new Anthropic({
      apiKey: orbitEnv.anthropicApiKey,
      maxRetries: 2,
    });
  }
  return client;
}

/** True when the model backend is reachable-ish (key configured). */
export function isAiConfigured(): boolean {
  return Boolean(orbitEnv.anthropicApiKey);
}

/** All agents (orchestrator, sub-agents, evaluator) run on this model. */
export function orbitModel(): string {
  return orbitEnv.aiModel;
}

export interface HaikuMessage {
  role: "user" | "assistant";
  content: string;
}

function isTransientAnthropicError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429 || (status != null && status >= 500)) return true;
  const msg = String((err as Error)?.message ?? "");
  return /overloaded|rate.?limit|timeout|529|503|500/i.test(msg);
}

export async function haikuComplete(opts: {
  system: string;
  messages: HaikuMessage[];
  maxTokens?: number;
}): Promise<string> {
  const anthropic = getAnthropicClient();
  return withRetry(
    async () => {
      const { result, timedOut } = await withTimeout(
        anthropic.messages.create({
          model: orbitModel(),
          max_tokens: opts.maxTokens ?? 2048,
          system: opts.system,
          messages: opts.messages,
        }),
        60000,
        "haikuComplete"
      );
      if (timedOut || !result) throw new Error("Anthropic request timed out");
      const block = result.content.find((b) => b.type === "text");
      return block && block.type === "text" ? block.text : "";
    },
    {
      retries: 2,
      baseMs: 1500,
      isRetryable: isTransientAnthropicError,
      onRetry: (attempt, err) => console.warn(`haikuComplete retry ${attempt}:`, (err as Error).message),
    }
  );
}
