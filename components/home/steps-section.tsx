import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function StepsSection() {
  return (
    <div className="steps-section" id="how-it-works">
      <section className="section">
        <span className="eyebrow">From your backlog to your next release</span>
        <div className="section-heading">
          <h2>Less setup. More shipping.</h2>
          <Link
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2"
            href="/login"
          >
            Enter your orbit <ArrowUpRight className="size-4" />
          </Link>
        </div>

        <div className="steps">
          <article>
            <span className="step-number">01 / CONNECT</span>
            <h3>Bring your repositories.</h3>
            <p>
              Sign in with GitHub and connect your repos. Orbit learns the codebase
              and finds its place in your workflow.
            </p>
          </article>

          <article>
            <span className="step-number">02 / ORCHESTRATE</span>
            <h3>Give your work a team.</h3>
            <p>
              Assign an issue or a PR. Your orchestrator plans the work and spins up
              the right agents, with the right context.
            </p>
          </article>

          <article>
            <span className="step-number">03 / EVOLVE</span>
            <h3>Review. Merge. Get better.</h3>
            <p>
              Stay close to every run. Review the result, merge with confidence,
              and let every task make the next one smarter.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
