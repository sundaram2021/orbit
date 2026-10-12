"use client";

import { useEffect, useState } from "react";
import { getInitialTheme, applyTheme } from "@/lib/theme-helpers";

export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const current = getInitialTheme();
    // Intentional: hydrate persisted theme on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(current);
    applyTheme(current);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  return { theme, toggleTheme, isDark: theme === "dark" };
}
