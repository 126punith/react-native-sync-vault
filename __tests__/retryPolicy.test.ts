import { backoffMs, classify, nextAttemptAt, parseRetryAfterMs } from '../src/core/retryPolicy';

/**
 * Shared vectors: RetryPolicy.kt and RetryPolicy.swift implement the same table, so any change
 * here must be mirrored there.
 */
const CLASSIFICATION: [number, ReturnType<typeof classify>][] = [
  [200, 'success'],
  [201, 'success'],
  [204, 'success'],
  [299, 'success'],
  [304, 'permanent'],
  [400, 'permanent'],
  [401, 'auth'],
  [403, 'permanent'],
  [404, 'permanent'],
  [408, 'retryable'],
  [409, 'conflict'],
  [410, 'permanent'],
  [412, 'conflict'],
  [422, 'permanent'],
  [425, 'retryable'],
  [429, 'retryable'],
  [500, 'retryable'],
  [502, 'retryable'],
  [503, 'retryable'],
  [504, 'retryable'],
  [599, 'retryable'],
];

describe('classify', () => {
  it.each(CLASSIFICATION)('HTTP %i is %s', (status, outcome) => {
    expect(classify(status)).toBe(outcome);
  });
});

describe('backoffMs', () => {
  it('grows exponentially up to the cap', () => {
    expect([1, 2, 3, 4, 5].map((a) => backoffMs(a, 1000, 60_000, 1))).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(backoffMs(20, 1000, 60_000, 1)).toBe(60_000);
    expect(backoffMs(1000, 1000, 60_000, 1)).toBe(60_000);
  });

  it('applies full jitter within [0, exp]', () => {
    expect(backoffMs(3, 1000, 60_000, 0)).toBe(0);
    expect(backoffMs(3, 1000, 60_000, 0.5)).toBe(2000);
    for (let i = 0; i < 200; i++) {
      const value = backoffMs(4, 1000, 60_000, Math.random());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(8000);
    }
  });

  it('clamps out-of-range random values and attempt 0', () => {
    expect(backoffMs(0, 1000, 60_000, 1)).toBe(1000);
    expect(backoffMs(2, 1000, 60_000, 7)).toBe(2000);
    expect(backoffMs(2, 1000, 60_000, -1)).toBe(0);
  });
});

describe('parseRetryAfterMs', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');

  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('120', now)).toBe(120_000);
    expect(parseRetryAfterMs(' 0 ', now)).toBe(0);
    expect(parseRetryAfterMs('-5', now)).toBe(0);
  });

  it('parses HTTP-dates relative to now', () => {
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfterMs('Wed, 31 Dec 2025 23:59:00 GMT', now)).toBe(0);
  });

  it('ignores missing or malformed values', () => {
    expect(parseRetryAfterMs(null, now)).toBeNull();
    expect(parseRetryAfterMs(undefined, now)).toBeNull();
    expect(parseRetryAfterMs('', now)).toBeNull();
    expect(parseRetryAfterMs('soon', now)).toBeNull();
  });
});

describe('nextAttemptAt', () => {
  it('waits for the larger of Retry-After and backoff', () => {
    expect(nextAttemptAt(1000, 1, 1000, 60_000, null, 1)).toBe(2000);
    expect(nextAttemptAt(1000, 1, 1000, 60_000, 30_000, 1)).toBe(31_000);
    expect(nextAttemptAt(1000, 5, 1000, 60_000, 2000, 1)).toBe(17_000);
  });
});
