export interface OrbitUser {
  id: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  githubUsername?: string;
}

export type TaskStatus = "running" | "review" | "completed" | "queued";

export interface OrbitTask {
  id: string;
  title: string;
  description?: string;
  repo_name: string;
  issue_number?: number;
  pr_number?: number;
  assigned_agent: string;
  status: TaskStatus;
  created_at?: string;
  updated_at?: string;
}

export interface OrbitActivity {
  id: string;
  title: string;
  description: string;
  type: "pr" | "sparkles" | "brain" | "issue" | "event";
  created_at?: string;
}

export interface OrbitRepo {
  id: string;
  name: string;
  full_name: string;
  branch: string;
  is_active: boolean;
}

export interface OrbitStats {
  activeAgents: number;
  tasksCompleted: number;
  prsMerged: number;
  avgScore: number;
}

export type SubAgentStatus =
  | "awaiting_approval"
  | "running"
  | "completed"
  | "failed";

export type SubAgentKind =
  | "implementation"
  | "review"
  | "testing"
  | "custom";

export interface SubAgent {
  id: string;
  user_id: string;
  event_id?: string | null;
  kind: SubAgentKind;
  title: string;
  system_prompt: string;
  skills: string[];
  status: SubAgentStatus;
  sandbox_id?: string | null;
  trace_id?: string | null;
  eval_score?: number | null;
  created_at?: string;
}

export type GithubEventStatus =
  | "received"
  | "proposed"
  | "running"
  | "done"
  | "ignored";

export interface GithubEvent {
  id: string;
  user_id: string;
  delivery_id: string;
  type: string;
  repo: string;
  number?: number | null;
  title?: string | null;
  payload: Record<string, unknown>;
  status: GithubEventStatus;
  created_at?: string;
}

export type ApprovalKind =
  | "run_agent"
  | "publish_pr"
  | "merge"
  | "prompt_update"
  | "skill_update";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Approval {
  id: string;
  user_id: string;
  kind: ApprovalKind;
  ref_id: string;
  status: ApprovalStatus;
  created_at?: string;
  decided_at?: string | null;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export type ChatKind = "orchestrator" | "evaluator";

export interface Evaluation {
  id: string;
  sub_agent_id: string;
  score: number;
  rubric: Record<string, number>;
  summary: string;
  prompt_patch?: string | null;
  skills_patch?: string[] | null;
  status: "proposed" | "applied" | "dismissed";
  created_at?: string;
}

export interface UserSettings {
  user_id: string;
  orchestrator_auto_approve: boolean;
  evaluator_auto_apply: boolean;
}
