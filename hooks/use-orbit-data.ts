"use client";

import useSWR from "swr";

async function orbitFetcher(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  return res.json();
}

// Shared SWR hooks dedupe the dashboard's overlapping pollers
// (/api/agents, /api/activity fire 3-4x per window today).
export function useAgentsData(refreshInterval = 15000) {
  return useSWR("/api/agents", orbitFetcher, {
    refreshInterval,
    dedupingInterval: 10000,
    revalidateOnFocus: false,
  });
}

export function useActivityData(refreshInterval = 15000) {
  return useSWR("/api/activity", orbitFetcher, {
    refreshInterval,
    dedupingInterval: 10000,
    revalidateOnFocus: false,
  });
}

export function useApprovalsData(status = "pending", refreshInterval = 10000) {
  return useSWR(`/api/approvals?status=${status}`, orbitFetcher, {
    refreshInterval,
    dedupingInterval: 8000,
    revalidateOnFocus: false,
  });
}
