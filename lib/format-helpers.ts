import { TaskStatus } from "@/types/orbit-types";

export function formatRelativeTime(dateString?: string): string {
  if (!dateString) return "just now";
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "just now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  return `${Math.floor(diffInSeconds / 86400)}d ago`;
}

export function getStatusBadgeClass(status: TaskStatus): string {
  switch (status) {
    case "review":
      return "status review";
    case "queued":
      return "status queued";
    case "running":
    case "completed":
    default:
      return "status";
  }
}

export function getUserInitials(name?: string): string {
  if (!name) return "AC";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
