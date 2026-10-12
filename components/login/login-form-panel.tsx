"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, ArrowLeft, ShieldCheck, Loader2 } from "lucide-react";
import { OrbitMark } from "@/components/common/orbit-mark";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { useAuth } from "@/hooks/use-auth";

export function LoginFormPanel() {
  const { loginWithGithub, isLoading, error } = useAuth();

  return (
    <section className="login-form-side">
      <div className="login-theme">
        <ThemeToggle />
      </div>

      <div className="login-form">
        <OrbitMark />
        <h1>Welcome to Orbit.</h1>
        <p>Your next engineering team is one connection away.</p>

        {error && (
          <div className="mb-4 text-xs text-red-500 bg-red-50 dark:bg-red-950/40 p-2.5 rounded border border-red-200 dark:border-red-900 text-left">
            {error}
          </div>
        )}

        <button
          onClick={loginWithGithub}
          disabled={isLoading}
          type="button"
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-4 py-2 github-login disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <svg
              className="size-4"
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
          )}
          {isLoading ? "Connecting to GitHub..." : "Continue with GitHub"}
          <ArrowRight className="size-4" />
        </button>

        <div className="permission-note">
          <h3>
            <ShieldCheck className="size-3.5 text-success" />
            Connected to your workflow
          </h3>
          <p>
            When live, Orbit will request repository access to read code, receive
            issue and PR events, and open pull requests. You stay in control of
            every merge.
          </p>
        </div>

        <div className="demo-note">
          GitHub OAuth is active. Sign in with GitHub to connect your repositories,
          or explore the demo workspace directly from the dashboard.
        </div>

        <div className="login-legal">
          GitHub is the only sign-in method.
          <br />
          Your code stays yours. Always.
        </div>

        <Link
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2 mt-6"
          href="/"
        >
          <ArrowLeft className="size-4" /> Back to Orbit
        </Link>
      </div>
    </section>
  );
}
