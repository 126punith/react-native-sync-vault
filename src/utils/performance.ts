import { PerformanceMetrics } from '../types';
import { NativeModules } from 'react-native';

// Get native module with error handling
let NativeModule: any = null;
try {
  NativeModule = NativeModules.OfflineQueue;
} catch (error) {
  console.warn('Failed to access native module in performance tracker:', error);
}

/**
 * Performance tracking utilities
 */
export class PerformanceTracker {
  private static instance: PerformanceTracker;
  private metrics: Partial<PerformanceMetrics> = {};

  private constructor() {}

  static getInstance(): PerformanceTracker {
    if (!PerformanceTracker.instance) {
      PerformanceTracker.instance = new PerformanceTracker();
    }
    return PerformanceTracker.instance;
  }

  /**
   * Track initialization time
   */
  trackInitialization(startTime: number): void {
    const duration = Date.now() - startTime;
    this.metrics.initializationTime = duration;
  }

  /**
   * Track enqueue operation time
   */
  trackEnqueue(startTime: number): void {
    const duration = Date.now() - startTime;
    const current = this.metrics.averageEnqueueTime || 0;
    this.metrics.averageEnqueueTime = (current + duration) / 2;
  }

  /**
   * Track sync operation time
   */
  trackSync(startTime: number): void {
    const duration = Date.now() - startTime;
    const current = this.metrics.averageSyncTime || 0;
    this.metrics.averageSyncTime = (current + duration) / 2;
  }

  /**
   * Get current performance metrics
   */
  async getMetrics(): Promise<PerformanceMetrics> {
    if (!NativeModule) {
      // Return metrics from JS-only tracking when native module is not available
      return {
        initializationTime: this.metrics.initializationTime || 0,
        memoryOverhead: 0,
        averageEnqueueTime: this.metrics.averageEnqueueTime || 0,
        averageSyncTime: this.metrics.averageSyncTime || 0,
        totalRequestsProcessed: 0,
        totalSyncOperations: 0,
      };
    }

    try {
      const nativeMetrics = await NativeModule.getPerformanceMetrics();
      return {
        initializationTime: nativeMetrics.initializationTime || this.metrics.initializationTime || 0,
        memoryOverhead: nativeMetrics.memoryOverhead || 0,
        averageEnqueueTime: nativeMetrics.averageEnqueueTime || this.metrics.averageEnqueueTime || 0,
        averageSyncTime: nativeMetrics.averageSyncTime || this.metrics.averageSyncTime || 0,
        totalRequestsProcessed: nativeMetrics.totalRequestsProcessed || 0,
        totalSyncOperations: nativeMetrics.totalSyncOperations || 0,
      };
    } catch (error) {
      console.warn('Failed to get native performance metrics:', error);
      return {
        initializationTime: this.metrics.initializationTime || 0,
        memoryOverhead: 0,
        averageEnqueueTime: this.metrics.averageEnqueueTime || 0,
        averageSyncTime: this.metrics.averageSyncTime || 0,
        totalRequestsProcessed: 0,
        totalSyncOperations: 0,
      };
    }
  }

  /**
   * Reset performance metrics
   */
  async reset(): Promise<void> {
    this.metrics = {};
    if (!NativeModule) {
      // Silently return when native module is not available
      return;
    }
    try {
      await NativeModule.resetPerformanceMetrics();
    } catch (error) {
      console.warn('Failed to reset native performance metrics:', error);
    }
  }
}

export const performanceTracker = PerformanceTracker.getInstance();

