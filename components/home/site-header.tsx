import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { OrbitMark } from "@/components/common/orbit-mark";
import { ThemeToggle } from "@/components/common/theme-toggle";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand active" href="/">
        <OrbitMark />
        <span>orbit</span>
      </Link>

      <nav className="header-links">
        <a href="#platform">Platform</a>
        <a href="#how-it-works">How it works</a>
        <a href="#intelligence">Intelligence</a>
      </nav>

      <div className="header-actions">
        <ThemeToggle />
        <Link
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2 sign-in"
          href="/login"
        >
          Sign in
        </Link>
        <Link
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium cursor-pointer transition-colors bg-primary text-primary-foreground shadow hover:bg-primary/90 h-8 rounded-md px-3 text-xs"
          href="/login"
        >
          Get started <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
    </header>
  );
}
