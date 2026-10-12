import React from "react";
import Link from "next/link";
import { OrbitMark } from "@/components/common/orbit-mark";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { LiveDot } from "@/components/common/live-dot";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-left">
        <Link className="brand active" href="/">
          <OrbitMark />
          <span>orbit</span>
        </Link>
        <span>© 2026 Orbit. Built to keep shipping.</span>
      </div>

      <div className="footer-links">
        <a href="#platform">Platform</a>
        <a href="#intelligence">Intelligence</a>
        <a href="#how-it-works">How it works</a>
        <Link href="/dashboard">Dashboard</Link>
        <span className="footer-status">
          <LiveDot /> All swarms operational
        </span>
        <ThemeToggle />
      </div>
    </footer>
  );
}
