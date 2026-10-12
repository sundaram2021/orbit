import React from "react";
import {
  Radio,
  Terminal,
  Brain,
  Sparkles,
  Activity,
  GitBranch,
  GitPullRequest,
  Check,
  Network,
} from "lucide-react";
import { OrbitMark } from "@/components/common/orbit-mark";
import { LiveDot } from "@/components/common/live-dot";

export function BentoSection() {
  return (
    <section className="screen-stage bento-stage" id="intelligence">
      <div className="section-content">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Built for the whole lifecycle</span>
            <h2>Everything in its orbit.</h2>
          </div>
          <p>
            Real environments. Persistent context.
            <br />
            A feedback loop that never stops learning.
          </p>
        </div>

        <div className="bento">
          {/* Card 1: Event list */}
          <article className="feature wide">
            <div className="feature-visual">
              <div className="event-list">
                <div>
                  <svg
                    className="size-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                    <path d="M9 18c-4.51 2-5-2-7-2" />
                  </svg>
                  <span>Issue #128 assigned to you</span>
                  <time>just now</time>
                  <LiveDot />
                </div>
                <div>
                  <Network className="size-3.5" />
                  <span>Orchestrator created a task plan</span>
                  <time>+0.4s</time>
                </div>
                <div>
                  <Terminal className="size-3.5" />
                  <span>Implementation agent is working</span>
                  <time>+1.2s</time>
                </div>
              </div>
            </div>
            <div className="feature-copy">
              <h3>
                <Radio className="size-4" /> In sync with your GitHub
              </h3>
              <p>
                Issues and pull requests become actionable plans. Webhooks keep your
                agents connected to what’s happening, as it happens.
              </p>
            </div>
          </article>

          {/* Card 2: Terminal */}
          <article className="feature wide">
            <div className="feature-visual">
              <div className="terminal">
                <div className="terminal-head">◦ ◦ ◦ &nbsp; agent-012 / workspace</div>
                <div>$ git worktree add ./fix-auth orbit/issue-128</div>
                <div>$ bun test auth.test.ts</div>
                <div className="terminal-success">✓ 12 tests passed &nbsp; [0.82s]</div>
                <div>$ git commit -m &quot;fix: refresh token race&quot;</div>
              </div>
            </div>
            <div className="feature-copy">
              <h3>
                <Terminal className="size-4" /> Real work. Real environments.
              </h3>
              <p>
                Isolated sandboxes with full OS access. Agents clone, code, test,
                and collaborate in separate worktrees. No stepping on toes.
              </p>
            </div>
          </article>

          {/* Card 3: Memory visual */}
          <article className="feature">
            <div className="feature-visual">
              <div className="memory-visual">
                <span>
                  <GitBranch className="size-6" />
                </span>
                <span>
                  <OrbitMark />
                </span>
                <span>
                  <Brain className="size-6" />
                </span>
              </div>
            </div>
            <div className="feature-copy">
              <h3>
                <Brain className="size-4" /> Context that stays
              </h3>
              <p>
                Memory powered by Supermemory. Your conventions, your decisions,
                your way of building. Never starting from zero.
              </p>
            </div>
          </article>

          {/* Card 4: Skills lines */}
          <article className="feature">
            <div className="feature-visual">
              <div className="skill-lines">
                <div>
                  <Sparkles className="size-3" /> react-patterns <span>SKILL</span>
                </div>
                <div>
                  <GitPullRequest className="size-3" /> review-checklist <span>SKILL</span>
                </div>
                <div>
                  <Terminal className="size-3" /> testing-strategy <span>SKILL</span>
                </div>
              </div>
            </div>
            <div className="feature-copy">
              <h3>
                <Sparkles className="size-4" /> Skills, not just prompts
              </h3>
              <p>
                Task-specific instructions and reusable skills, created by the
                orchestrator. The right expertise for every issue.
              </p>
            </div>
          </article>

          {/* Card 5: Eval bars */}
          <article className="feature">
            <div className="feature-visual">
              <div className="eval-visual">
                <div>
                  <span>Subagent quality</span>
                  <span className="status">
                    <Check className="size-2.5" /> +18.6%
                  </span>
                </div>
                <div className="eval-bars">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
            <div className="feature-copy">
              <h3>
                <Activity className="size-4" /> Better with every run
              </h3>
              <p>
                Neatlogs traces meet continuous evaluation. An evaluator refines
                subagent prompts, skills, and memory with every task.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
