<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Orbit — Agent Guidelines & System Architecture

This file provides system instructions, architectural patterns, and operational guidelines for AI coding agents operating within the **Orbit** codebase.

---

## 1. System Overview

**Orbit** is an autonomous multi-agent software factory. It automates software engineering workflows by bridging GitHub events with specialized agent execution teams:

```
GitHub Intake ──> Orchestrator Classifier ──> Dynamic Skill Resolution
                          │
                          ▼
            Sub-Agent Spawning (Sandbox Runner)
                          │
                          ▼
         Evaluator & QA Gates (Rubrics & Verifier)
                          │
                          ▼
                Pull Request / Approval
```

### Core Roles
- **Orchestrator**: Ingests events, classifies incoming work orders, plans sub-agent tasks, and resolves skills from the skill library.
- **Sub-Agents**:
  - `implementation`: Code generation, bug fixing, and refactoring in an isolated workspace.
  - `review`: Automated pull request and diff critique, finding edge cases and anti-patterns.
  - `testing`: Generates unit, integration, and regression test suites.
  - `custom`: Specialized domain tasks with dynamically synthesized skill sets.
- **Evaluator**: Runs automated rubrics, checks test results, gates pull request creation, and provides iterative feedback.

---

## 2. Codebase Conventions & Standards

### Framework & Stack
- **Next.js 16 (App Router)** with **React 19** and **Bun** package manager.
- **Tailwind CSS v4** for styling and UI tokens.
- **Supabase** for PostgreSQL database, realtime subscriptions, authentication, and storage.
- **Anthropic Claude SDK** (`@anthropic-ai/sdk`) for model completions.

### Server vs. Client Boundary Rules
- **Client Components**: Always mark components that require interactive hooks (`useState`, `useEffect`, event handlers) with `'use client';` at line 1.
- **Server Components & Route Handlers**: Default to server execution.
- **CRITICAL**: Never import server-only utilities (`@/lib/env`, `@/lib/supabase-service`, `@anthropic-ai/sdk`) into client components. Keep API keys and secrets strictly on the server side.

### Environment Variable Access
- Always import `orbitEnv` from `lib/env.ts` when accessing environment variables in server-side code:
  ```ts
  import { orbitEnv } from "@/lib/env";
  const apiKey = orbitEnv.anthropicApiKey;
  ```
- Do **not** access `process.env.*` directly in application logic; use `lib/env.ts` to guarantee sanitized values and standard fallbacks.
- Never hardcode API keys, passwords, or secrets into code or commits.

### Supabase Patterns & RLS
- Client-side browser access: Use `createClient` from `@/lib/supabase-client`.
- Server-side request access (with user session): Use `createClient` from `@/lib/supabase-server`.
- System/Service actions: Use `createServiceClient` from `@/lib/supabase-service` **only** for automated background workflows that require service role elevation.
- Respect Row Level Security (RLS) policies (`auth.uid() = user_id`) on all queries.

### Sandboxing & Agent Tools
- Sandboxed execution is managed under `lib/sandbox/` (Tensorlake microVMs with local mock fallback).
- Tools must be registered and executed via `lib/tools/`:
  - `sandbox-exec.ts`: Terminal commands within the sandbox environment.
  - `sandbox-files.ts`: File reads, writes, and directory listings.
  - `github.ts`: GitHub PR creation, comments, and issue interactions.

### Graceful Degradation & Memory
- External integrations (Supermemory, Tensorlake, telemetry) must fail gracefully. Agent runs must not crash completely if an external API is slow or temporarily unavailable.
- Shared memory operations live in `lib/memory.ts` and are namespaced per user (`orbit-<userId>`).

---

## 3. Directory Layout

| Directory | Purpose |
| :--- | :--- |
| `app/` | Next.js App Router (pages, dashboard UI, API route handlers) |
| `components/` | Modular UI components (chat, dashboard widgets, approval dialogs) |
| `lib/orchestrator/` | Task classification, prompt templates, skill resolution, sub-agent spawner |
| `lib/sandbox/` | MicroVM sandbox lifecycle and execution runners |
| `lib/eval/` | Verification gates, evaluation rubrics, scoring logic |
| `lib/tools/` | Tool definitions and execution dispatchers |
| `supabase/` | Database migrations and SQL schema definitions |
| `types/` | Shared TypeScript types and database entity schemas |
| `scripts/` | E2E test scenarios and verification scripts |

---

## 4. Agent Work Protocol

When executing coding tasks in this repository:
1. **Analyze First**: Check existing code conventions, types in `types/orbit-types.ts`, and server/client boundaries before proposing edits.
2. **Type Safety**: Maintain strict TypeScript typing. Do not introduce loose `any` types when a concrete type exists.
3. **Verify Changes**:
   - Run `bun run lint` to prevent linting and syntax regressions.
   - Run type checks (`bun run build` or `bun x tsc --noEmit`) when refactoring core modules.
4. **Preserve Next.js Rule Block**: Never delete or alter the `<!-- BEGIN:nextjs-agent-rules -->` section at the top of this file.
