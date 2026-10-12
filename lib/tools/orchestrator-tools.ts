import { destroySandbox } from "../sandbox/tensorlake";
import { registerTool } from "./registry";

export function registerOrchestratorTools(): void {
  registerTool({
    name: "list_agents",
    description: "List sub-agents (newest first) with status, kind, and scores.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional filter: awaiting_approval | running | completed | failed" },
        limit: { type: "string", description: "Max rows (default 10, max 30)" },
      },
    },
    permission: "auto",
    handler: async (input, ctx) => {
      let q = ctx.supabase
        .from("sub_agents")
        .select("id,title,kind,status,eval_score,created_at")
        .eq("user_id", ctx.userId)
        .order("created_at", { ascending: false })
        .limit(Math.min(30, Math.max(1, Number(input.limit ?? 10) || 10)));
      if (input.status) q = q.eq("status", input.status);
      const { data, error } = await q;
      if (error) return { ok: false, output: `list failed: ${error.message}` };
      const rows = (data ?? []) as { id: string; title: string; kind: string; status: string; eval_score: number | null }[];
      if (rows.length === 0) return { ok: true, output: "(no agents)" };
      return {
        ok: true,
        output: rows
          .map((a) => `• ${a.title} [${a.kind}/${a.status}] id=${a.id}${a.eval_score != null ? ` score=${a.eval_score}` : ""}`)
          .join("\n"),
      };
    },
  });

  registerTool({
    name: "get_agent",
    description: "Full detail on one sub-agent: customized prompt, run log tail, evaluation.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Sub-agent id" },
      },
      required: ["agent_id"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const { data: agent } = await ctx.supabase
        .from("sub_agents")
        .select("*")
        .eq("id", input.agent_id)
        .eq("user_id", ctx.userId)
        .single();
      if (!agent) return { ok: false, output: "Agent not found." };
      const { data: evaluation } = await ctx.supabase
        .from("evaluations")
        .select("score,summary,status")
        .eq("sub_agent_id", input.agent_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      const ev = evaluation as { score?: number; summary?: string; status?: string } | null;
      return {
        ok: true,
        output: [
          `${agent.title} [${agent.kind}/${agent.status}]`,
          `Prompt: ${String(agent.system_prompt ?? "").slice(0, 1500)}`,
          `Run log tail: ${String(agent.run_log ?? "(empty)").slice(-2000)}`,
          ev ? `Eval: ${ev.score}/100 (${ev.status}) — ${ev.summary}` : "Eval: pending",
        ].join("\n\n"),
      };
    },
  });

  registerTool({
    name: "message_agent",
    description: "Send a steering instruction to a running agent. It is injected at its next step.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Sub-agent id" },
        instruction: { type: "string", description: "What the agent should do differently" },
      },
      required: ["agent_id", "instruction"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const { data: agent } = await ctx.supabase
        .from("sub_agents")
        .select("id,status,steering")
        .eq("id", input.agent_id)
        .eq("user_id", ctx.userId)
        .single();
      if (!agent) return { ok: false, output: "Agent not found." };
      if (agent.status !== "running") {
        return { ok: false, output: `Agent is ${agent.status} — steering only works while running.` };
      }
      const next = `${agent.steering ?? ""}\n[Steering @ ${new Date().toISOString()}] ${input.instruction}`.slice(-4000);
      const { error } = await ctx.supabase
        .from("sub_agents")
        .update({ steering: next })
        .eq("id", input.agent_id);
      if (error) return { ok: false, output: `Steering not stored: ${error.message}` };
      return { ok: true, output: "Instruction queued — the agent picks it up at its next step." };
    },
  });

  registerTool({
    name: "cancel_agent",
    description: "Stop a running or waiting agent immediately and destroy its sandbox.",    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Sub-agent id" },
      },
      required: ["agent_id"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const { data: agent } = await ctx.supabase
        .from("sub_agents")
        .select("id,status,sandbox_id,event_id,title")
        .eq("id", input.agent_id)
        .eq("user_id", ctx.userId)
        .single();
      if (!agent) return { ok: false, output: "Agent not found." };
      if (agent.status === "completed") return { ok: false, output: "Agent already completed." };
      if (agent.sandbox_id) {
        await destroySandbox({ id: agent.sandbox_id as string, mock: false });
      }
      await ctx.supabase.from("sub_agents").update({ status: "failed" }).eq("id", input.agent_id);
      if (agent.event_id) {
        await ctx.supabase.from("github_events").update({ status: "ignored" }).eq("id", agent.event_id);
      }
      await ctx.supabase.from("activities").insert([
        { user_id: ctx.userId, title: `Agent cancelled: ${agent.title}`, description: "Stopped by the orchestrator.", type: "event" },
      ]);
      return { ok: true, output: `Cancelled ${agent.title}; sandbox destroyed.` };
    },
  });

  registerTool({
    name: "running_agents",
    description:
      "What is running RIGHT NOW: each active sub-agent with its task, repo/branch, elapsed time, and current step. Call this whenever the user asks what agents are doing — no parameters needed. Use get_agent for full detail on one.",
    input_schema: { type: "object", properties: {} },
    permission: "auto",
    handler: async (input, ctx) => {
      const { data, error } = await ctx.supabase
        .from("sub_agents")
        .select("id,title,kind,status,created_at,run_log,result")
        .eq("user_id", ctx.userId)
        .eq("status", "running")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return { ok: false, output: `status check failed: ${error.message}` };
      const rows = (data ?? []) as {
        id: string;
        title: string;
        kind: string;
        created_at: string;
        run_log?: string | null;
        result?: { repo?: string; branch?: string; pr_number?: number } | null;
      }[];
      if (rows.length === 0) return { ok: true, output: "(no agents running right now)" };
      const now = Date.now();
      const lines = rows.map((a) => {
        const elapsedMin = Math.max(0, Math.round((now - new Date(a.created_at).getTime()) / 60000));
        const where =
          a.result?.repo && a.result?.branch
            ? `${a.result.repo}@${a.result.branch}`
            : (a.result?.repo ?? "repo pending");
        const pr = a.result?.pr_number ? ` PR #${a.result.pr_number}` : "";
        const tail = (a.run_log ?? "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(-3)
          .map((l) => l.slice(0, 120))
          .join(" / ");
        return `• ${a.title} [${a.kind}] — ${where}${pr} — running ${elapsedMin}m${tail ? `\n  last: ${tail}` : ""}\n  id=${a.id}`;
      });
      return {
        ok: true,
        output: `${rows.length} agent(s) running:\n${lines.join("\n")}`,
      };
    },
  });
}
