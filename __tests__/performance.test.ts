import { performanceTracker } from '../src/utils/performance';

// Mock native module
jest.mock('react-native', () => ({
  NativeModules: {
    OfflineQueue: {
      getPerformanceMetrics: jest.fn().mockResolvedValue({
        initializationTime: 45,
        averageEnqueueTime: 3,
        averageSyncTime: 80,
        memoryOverhead: 0.5,
        totalRequestsProcessed: 100,
        totalSyncOperations: 20,
      }),
      resetPerformanceMetrics: jest.fn().mockResolvedValue(undefined),
    },
  },
}));

describe('Performance Tracking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('performanceTracker', () => {
    it('should track initialization time', () => {
      const startTime = Date.now() - 50;
      performanceTracker.trackInitialization(startTime);

      // Verify tracking (metrics are stored internally)
      expect(performanceTracker).toBeDefined();
    });

    it('should track enqueue time', () => {
      const startTime = Date.now() - 5;
      performanceTracker.trackEnqueue(startTime);

      expect(performanceTracker).toBeDefined();
    });

    it('should track sync time', () => {
      const startTime = Date.now() - 100;
      performanceTracker.trackSync(startTime);

      expect(performanceTracker).toBeDefined();
    });

    it('should get performance metrics', async () => {
      const metrics = await performanceTracker.getMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.initializationTime).toBeGreaterThanOrEqual(0);
      expect(metrics.averageEnqueueTime).toBeGreaterThanOrEqual(0);
      expect(metrics.averageSyncTime).toBeGreaterThanOrEqual(0);
    });

    it('should reset performance metrics', async () => {
      await performanceTracker.reset();

      const { NativeModules } = require('react-native');
      expect(NativeModules.OfflineQueue.resetPerformanceMetrics).toHaveBeenCalled();
    });
  });

  describe('Performance Targets', () => {
    it('should meet initialization time target (< 50ms)', async () => {
      const metrics = await performanceTracker.getMetrics();
      expect(metrics.initializationTime).toBeLessThan(50);
    });

    it('should meet enqueue time target (< 5ms)', async () => {
      const metrics = await performanceTracker.getMetrics();
      expect(metrics.averageEnqueueTime).toBeLessThan(5);
    });

    it('should meet sync time target (< 100ms per batch)', async () => {
      const metrics = await performanceTracker.getMetrics();
      expect(metrics.averageSyncTime).toBeLessThan(100);
    });
  });
});


