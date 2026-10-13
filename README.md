
https://github.com/user-attachments/assets/fcb1b83a-ad4d-4bb9-9bf7-cb9454c91b4a
# Orbit

> An open-source autonomous multi-agent software factory that orchestrates specialized AI agents from GitHub issue intake to tested pull requests.

Orbit continuously monitors your GitHub repositories, classifies incoming issues and pull requests, and orchestrates specialized sub-agents (implementation, code review, automated testing) running in isolated sandbox environments. It features persistent shared memory, rigorous evaluation quality gates, and a real-time command dashboard.

---
## Demo






https://github.com/user-attachments/assets/b36434e8-c3f3-4e15-bba1-0e44eeab4639



## ✨ Features

- **Automated GitHub Intake & Event Queue**: Listens to polled events and webhooks for repository issues, pull requests, and review comments with deduplication and tracking.
- **Intelligent Work Classification**: Decomposes incoming tasks into structured work orders, assessing complexity, risk, and requisite skills.
- **Dynamic Skill Library**: Resolves task-specific skills on demand, dynamically generates new domain skills when needed, and persists them for future agent reuse.
- **Isolated Sandbox Execution**: Runs agent workloads inside isolated microVM sandboxes (via Tensorlake or local container runners) with full workspace checkout, terminal execution, and file inspection.
- **Persistent Shared Memory**: Maintains contextual memory across agent runs and user interactions via Supermemory graph storage.
- **Quality Gates & Evaluation**: Evaluates agent outputs against verification rubrics and unit test suites before human approval or pull request submission.
- **Dual-Thread Chat & Real-Time Dashboard**: Interactive web console with dedicated Orchestrator and Evaluator conversational threads, live run logs, and approval controls.

---

## 🏗 Architecture

```
                      ┌──────────────────────┐
                      │    GitHub Events     │
                      │  (Issues, PRs, Web)  │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌──────────────────────┐
                      │  Orbit Orchestrator  │
                      │  (Classify & Plan)   │
                      └─────┬──────────┬─────┘
                            │          │
            ┌───────────────┘          └───────────────┐
            ▼                                          ▼
┌──────────────────────┐                    ┌──────────────────────┐
│  Dynamic Skill Store │                    │    Supermemory       │
│   (Reusable Skills)  │                    │   (Context Graph)    │
└──────────────────────┘                    └──────────────────────┘
            │                                          │
            └───────────────────┬──────────────────────┘
                                │
                                ▼
                   ┌────────────────────────┐
                   │ Specialized Sub-Agents │
                   │  - Implementation      │
                   │  - Code Review         │
                   │  - Test Generation     │
                   └───────────┬────────────┘
                               │
                               ▼
                   ┌────────────────────────┐
                   │   Isolated Sandboxes   │
                   │ (Tensorlake microVMs)  │
                   └───────────┬────────────┘
                               │
                               ▼
                   ┌────────────────────────┐
                   │ Evaluation & QA Gates  │
                   │  (Rubrics & Verifier)  │
                   └───────────┬────────────┘
                               │
                               ▼
                   ┌────────────────────────┐
                   │ Tested Pull Request /  │
                   │   Human Approval Gate  │
                   └────────────────────────┘
```

---

## 🛠 Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, React 19)
- **Runtime & Package Manager**: [Bun](https://bun.sh/)
- **Database & Auth**: [Supabase](https://supabase.com/) (PostgreSQL, Realtime, Row Level Security)
- **AI Models**: [Anthropic Claude](https://www.anthropic.com/) (Claude 3.5 Sonnet / Claude Haiku via Anthropic SDK)
- **Persistent Memory**: [Supermemory](https://supermemory.ai/)
- **Execution Sandboxes**: [Tensorlake](https://tensorlake.ai/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) & Lucide Icons

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your machine:
- [Bun](https://bun.sh/) (v1.1+ recommended) or [Node.js](https://nodejs.org/) (v20+)
- [Git](https://git-scm.com/)
- A [Supabase](https://supabase.com/) account and project
- An [Anthropic](https://console.anthropic.com/) API Key

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/orbit.git
cd orbit
```

### 2. Install Dependencies

```bash
bun install
# or
npm install
```

### 3. Configure Environment Variables

Create a `.env.local` file in the project root:

```bash
cp .env.example .env.local
```

Populate the required configuration keys:

```env
# Supabase Configuration
SUPABASE_URL=https://<your-project-id>.supabase.co
SUPABASE_SECRET_KEY=<your-supabase-service-role-key>
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>

# Anthropic AI
AI_API_KEY=sk-ant-...
AI_MODEL_NAME=claude-haiku-4-5

# Shared Memory (Optional / Graceful Degradation)
SUPERMEMORY_API_KEY=sm_...

# Sandboxing (Tensorlake)
TENSORLAKE_API_KEY=tl_...
TENSORLAKE_MOCK=false
```

### 4. Database Setup

Apply the SQL migrations located in `supabase/migrations/` using the Supabase CLI or SQL Editor:

```bash
# Via Supabase CLI (if configured)
supabase db push

# Or run the SQL scripts in supabase/migrations/ via the Supabase Dashboard SQL Editor
```

### 5. Run the Development Server

```bash
bun run dev
# or
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application and visit [http://localhost:3000/dashboard](http://localhost:3000/dashboard) for the agent console.

---

## 📁 Project Structure

```
orbit/
├── app/                  # Next.js App Router pages and API routes
│   ├── api/              # Backend endpoints (events, orchestrator, chat, eval)
│   ├── auth/             # Authentication & OAuth callbacks
│   ├── dashboard/        # Real-time orchestrator & agent dashboard
│   └── page.tsx          # Marketing and overview landing page
├── components/           # Reusable React components
│   ├── chat/             # Interactive thread & message UI
│   ├── common/           # Shared UI primitives and widgets
│   ├── dashboard/        # Sub-agent views, approval dialogs, metric cards
│   └── home/             # Landing page sections
├── lib/                  # Core application logic & orchestrator engine
│   ├── ai.ts             # Anthropic client wrapper & completions
│   ├── env.ts            # Validated server-side environment variables
│   ├── eval/             # Evaluator rubrics, quality gates, and verification
│   ├── memory.ts         # Supermemory graph integration
│   ├── orchestrator/     # Task classification, prompts, dynamic skills, agent spawner
│   ├── sandbox/          # Tensorlake microVM runner and mock drivers
│   ├── supabase-*.ts     # Supabase client, server, and service instances
│   └── tools/            # Agent tool registry (GitHub, terminal exec, file I/O)
├── supabase/
│   └── migrations/       # PostgreSQL tables, indexes, and RLS policies
└── types/                # TypeScript type definitions and interfaces
```

---

## 🧪 Testing & Verification

Run tests and verification scripts:

```bash
# Run linting
bun run lint

# Run end-to-end simulation scripts
bun run scripts/real-e2e.ts
bun run scripts/tools-test.ts
```

---

## 🤝 Contributing

Contributions are warmly welcomed! Please follow these steps:

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request with a clear description of your changes.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
