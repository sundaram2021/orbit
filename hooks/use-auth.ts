"use client";

import { useState, useCallback } from "react";
import { signInWithGithubOAuth, signOutGithubUser } from "@/lib/github-helpers";
import { OrbitUser } from "@/types/orbit-types";

export function useAuth(initialUser: OrbitUser | null = null) {
  const [user, setUser] = useState<OrbitUser | null>(initialUser);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginWithGithub = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signInWithGithubOAuth();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "GitHub authentication failed";
      setError(message);
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      try {
        localStorage.removeItem("orbit:v1:repo");
        localStorage.removeItem("orbit:v1:thread");
        // Legacy keys (pre-v1) — best-effort cleanup.
        localStorage.removeItem("orbit-active-repo");
        localStorage.removeItem("orbit-thread-id");
      } catch {
        // storage unavailable
      }
      await signOutGithubUser();
      setUser(null);
      window.location.href = "/login";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Logout failed";
      setError(message);
      setIsLoading(false);
    }
  }, []);

  return {
    user,
    isLoading,
    error,
    loginWithGithub,
    logout,
  };
}
