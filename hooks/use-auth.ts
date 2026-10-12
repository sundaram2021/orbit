"use client";

import { useState } from "react";
import { signInWithGithubOAuth, signOutGithubUser } from "@/lib/github-helpers";
import { OrbitUser } from "@/types/orbit-types";

export function useAuth(initialUser: OrbitUser | null = null) {
  const [user, setUser] = useState<OrbitUser | null>(initialUser);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginWithGithub = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signInWithGithubOAuth();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "GitHub authentication failed";
      setError(message);
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await signOutGithubUser();
      setUser(null);
      window.location.href = "/login";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Logout failed";
      setError(message);
      setIsLoading(false);
    }
  };

  return {
    user,
    isLoading,
    error,
    loginWithGithub,
    logout,
  };
}
