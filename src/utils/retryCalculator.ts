import { FailureType } from '../types';

/**
 * Calculate retry delay using exponential backoff
 */
export function calculateRetryDelay(
  attemptCount: number,
  baseDelay: number = 1000,
  maxDelay: number = 60000
): number {
  const delay = Math.min(baseDelay * Math.pow(2, attemptCount), maxDelay);
  return Math.floor(delay);
}

/**
 * Determine if a request should be retried based on error type
 */
export function shouldRetry(
  failureType: FailureType,
  attemptCount: number,
  maxRetries: number
): boolean {
  if (attemptCount >= maxRetries) {
    return false;
  }

  switch (failureType) {
    case 'network':
    case 'timeout':
    case 'server': // 5xx errors
      return true;
    case 'validation': // 4xx validation errors
      return false;
    case 'conflict':
      return false; // Conflicts need manual resolution
    case 'unknown':
      return attemptCount < 3; // Retry unknown errors up to 3 times
    default:
      return false;
  }
}

/**
 * Calculate next retry timestamp
 */
export function calculateNextRetryAt(
  attemptCount: number,
  baseDelay: number = 1000
): number {
  const delay = calculateRetryDelay(attemptCount, baseDelay);
  return Date.now() + delay;
}


