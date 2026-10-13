"use client";

import React from "react";
import { Loader2, AlertTriangle } from "lucide-react";

/** Pulsing placeholder block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-muted/60 ${className}`} />;
}

/** Row-style skeleton used by activity/history/approval lists. */
export function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2.5" aria-hidden="true">
      <Skeleton className="size-7 shrink-0 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/2 opacity-70" />
      </div>
    </div>
  );
}

/** Card-style skeleton used by agent/eval/prompt grids. */
export function CardSkeleton() {
  return (
    <div className="panel space-y-2.5 p-4" aria-hidden="true">
      <Skeleton className="h-4 w-1/2" />
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="h-3 w-3/4 opacity-70" />
    </div>
  );
}

/** Log-block skeleton used by the traces view. */
export function LogSkeleton() {
  return (
    <div className="panel space-y-2.5 p-4" aria-hidden="true">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-40 w-full bg-black/60" />
    </div>
  );
}

/**
 * Inline fetch-failure notice with a Retry button. Render this INSTEAD of
 * the empty state when a load failed — never let errors masquerade as empty.
 */
export function FetchError({
  message = "Couldn't load. Check your connection and retry.",
  onRetry,
  retryLabel = "Retry",
}: {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="chat-error" role="alert">
      <span className="inline-flex items-center gap-1.5">
        <AlertTriangle className="size-3.5 shrink-0" />
        {message}
      </span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="chat-error-retry">
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Loading indicator with spinner + label (first-load only). */
export function LoadingNote({ label }: { label: string }) {
  return (
    <div className="chat-loading" role="status" aria-live="polite">
      <span className="inline-flex animate-spin">
        <Loader2 className="size-4" />
      </span>{" "}
      {label}
    </div>
  );
}
