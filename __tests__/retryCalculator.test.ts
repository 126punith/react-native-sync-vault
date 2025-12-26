import { calculateNextRetryAt, shouldRetry, calculateRetryDelay } from '../src/utils/retryCalculator';
import { FailureType } from '../src/types';

describe('retryCalculator', () => {
  describe('shouldRetry', () => {
    it('should retry network errors', () => {
      expect(shouldRetry('network', 0, 3)).toBe(true);
      expect(shouldRetry('network', 1, 3)).toBe(true);
      expect(shouldRetry('network', 2, 3)).toBe(true);
    });

    it('should retry server errors (5xx)', () => {
      expect(shouldRetry('server', 0, 3)).toBe(true);
      expect(shouldRetry('server', 1, 3)).toBe(true);
    });

    it('should retry timeout errors', () => {
      expect(shouldRetry('timeout', 0, 3)).toBe(true);
      expect(shouldRetry('timeout', 1, 3)).toBe(true);
    });

    it('should not retry after max attempts', () => {
      expect(shouldRetry('network', 3, 3)).toBe(false);
      expect(shouldRetry('network', 4, 3)).toBe(false);
    });

    it('should not retry validation errors', () => {
      expect(shouldRetry('validation', 0, 3)).toBe(false);
      expect(shouldRetry('validation', 1, 3)).toBe(false);
    });

    it('should not retry conflict errors', () => {
      expect(shouldRetry('conflict', 0, 3)).toBe(false);
      expect(shouldRetry('conflict', 3, 3)).toBe(false);
    });

    it('should handle unknown errors conservatively', () => {
      expect(shouldRetry('unknown', 0, 3)).toBe(true);
      expect(shouldRetry('unknown', 2, 3)).toBe(true);
      expect(shouldRetry('unknown', 3, 3)).toBe(false);
    });
  });

  describe('calculateRetryDelay', () => {
    it('should calculate exponential backoff', () => {
      const delay1 = calculateRetryDelay(1);
      const delay2 = calculateRetryDelay(2);
      const delay3 = calculateRetryDelay(3);

      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });

    it('should respect max delay', () => {
      const delay = calculateRetryDelay(100, 1000, 60000);
      expect(delay).toBeLessThanOrEqual(60000);
    });

    it('should use custom base delay', () => {
      const delay = calculateRetryDelay(1, 2000);
      expect(delay).toBeGreaterThanOrEqual(2000);
    });
  });

  describe('calculateNextRetryAt', () => {
    const baseTime = 1000000; // Fixed timestamp for testing

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(baseTime);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should calculate next retry timestamp', () => {
      const nextRetry = calculateNextRetryAt(1);
      expect(nextRetry).toBeGreaterThan(baseTime);
    });

    it('should increase delay with attempt count', () => {
      const retry1 = calculateNextRetryAt(1);
      const retry2 = calculateNextRetryAt(2);
      const retry3 = calculateNextRetryAt(3);

      const delay1 = retry1 - baseTime;
      const delay2 = retry2 - baseTime;
      const delay3 = retry3 - baseTime;

      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });

    it('should use custom base delay', () => {
      const retry1 = calculateNextRetryAt(1, 2000);
      const retry2 = calculateNextRetryAt(1, 1000);

      const delay1 = retry1 - baseTime;
      const delay2 = retry2 - baseTime;

      expect(delay1).toBeGreaterThan(delay2);
    });
  });
});

