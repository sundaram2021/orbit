import React from "react";
import Link from "next/link";
import { OrbitMark } from "@/components/common/orbit-mark";
import { ThemeToggle } from "@/components/common/theme-toggle";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link className="brand active" href="/">
        <OrbitMark />
        <span>orbit</span>
      </Link>

      <span>© 2026 Orbit. Built to keep moving.</span>

      <div className="footer-links">
        <a href="#platform">Platform</a>
        <a href="#how-it-works">How it works</a>
        <ThemeToggle />
      </div>
    </footer>
  );
}
