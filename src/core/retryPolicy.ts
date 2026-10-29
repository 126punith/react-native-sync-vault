/**
 * Delivery outcome classification and backoff. Mirrors RetryPolicy.kt and RetryPolicy.swift;
 * the three implementations must stay identical (covered by __tests__/retryPolicy.test.ts).
 */

export type Outcome = 'success' | 'conflict' | 'auth' | 'retryable' | 'permanent';

export function classify(httpStatus: number): Outcome {
  if (httpStatus >= 200 && httpStatus <= 299) return 'success';
  if (httpStatus === 409 || httpStatus === 412) return 'conflict';
  if (httpStatus === 401) return 'auth';
  if (httpStatus === 408 || httpStatus === 425 || httpStatus === 429 || httpStatus >= 500) return 'retryable';
  return 'permanent';
}

/** Exponential backoff with full jitter: random(0, min(max, base * 2^(attempt-1))). */
export function backoffMs(attempt: number, baseMs: number, maxMs: number, random: number): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.max(attempt - 1, 0)));
  return Math.floor(exp * Math.min(Math.max(random, 0), 1));
}

/** Parses Retry-After as delta-seconds or an HTTP-date. Returns a delay in ms, or null. */
export function parseRetryAfterMs(value: string | null | undefined, nowMs: number): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (/^-?\d+$/.test(trimmed)) {
    return Math.max(parseInt(trimmed, 10), 0) * 1000;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(date - nowMs, 0);
}

export function nextAttemptAt(
  nowMs: number,
  attempt: number,
  baseMs: number,
  maxMs: number,
  retryAfterMs: number | null,
  random: number
): number {
  return nowMs + Math.max(retryAfterMs ?? 0, backoffMs(attempt, baseMs, maxMs, random));
}
