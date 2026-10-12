import Anthropic from "@anthropic-ai/sdk";
import { orbitEnv } from "./env";

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    if (!orbitEnv.anthropicApiKey) {
      throw new Error("AI_API_KEY is not configured");
    }
    client = new Anthropic({ apiKey: orbitEnv.anthropicApiKey });
  }
  return client;
}

/** All agents (orchestrator, sub-agents, evaluator) run on this model. */
export function orbitModel(): string {
  return orbitEnv.aiModel;
}

export interface HaikuMessage {
  role: "user" | "assistant";
  content: string;
}

export async function haikuComplete(opts: {
  system: string;
  messages: HaikuMessage[];
  maxTokens?: number;
}): Promise<string> {
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: orbitModel(),
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: opts.messages,
  });
  const block = response.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}
