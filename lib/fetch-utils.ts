/**
 * Shared fetch hardening: timeouts, retries, and non-throwing JSON.
 * Every external call should go through these so a hung or failing
 * dependency degrades gracefully instead of hanging a request forever.
 */

export class FetchTimeoutError extends Error {
  constructor(url: string, ms: number) {
    super(`fetch timed out after ${ms}ms: ${url}`);
    this.name = "FetchTimeoutError";
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = 15000
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new FetchTimeoutError(url, ms);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Parse JSON without ever throwing (returns null on HTML/empty bodies). */
export async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isRetryable(err: unknown, res?: Response): boolean {
  if (res) return res.status === 429 || res.status >= 500;
  const msg = String((err as Error)?.message ?? "");
  return (
    (err as Error)?.name === "FetchTimeoutError" ||
    /timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(msg)
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry fn up to `retries` times with exponential backoff on retryable failures. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    retries?: number;
    baseMs?: number;
    isRetryable?: (err: unknown) => boolean;
    onRetry?: (attempt: number, err: unknown) => void;
  }
): Promise<T> {
  const retries = opts?.retries ?? 2;
  const baseMs = opts?.baseMs ?? 1000;
  const retryable = opts?.isRetryable ?? isRetryable;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !retryable(err)) throw err;
      opts?.onRetry?.(attempt + 1, err);
      await sleep(baseMs * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** Race a promise against a timeout — resolves { timedOut: true } instead of hanging. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "operation"
): Promise<{ result?: T; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new FetchTimeoutError(label, ms)), ms);
      }),
    ]);
    return { result, timedOut: false };
  } catch (err) {
    if ((err as Error)?.name === "FetchTimeoutError") return { timedOut: true };
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
