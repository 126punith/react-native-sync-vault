import ResourceManager from '../resources/ResourceManager';
import { QueuedRequest } from '../types';

/**
 * Resource-Aware Sync
 * Filters and prioritizes sync requests based on device resources
 */
class ResourceAwareSync {
  private resourceManager: ResourceManager;

  constructor(resourceManager: ResourceManager) {
    this.resourceManager = resourceManager;
  }

  /**
   * Filter requests based on resources
   */
  filterRequests(requests: QueuedRequest[]): QueuedRequest[] {
    return requests.filter((request) => {
      // Check if sync should proceed
      const isCritical = (request.priority || 0) >= 8;
      if (!this.resourceManager.shouldSync(isCritical)) {
        return false;
      }

      // Check if large upload should be deferred
      const bodySize = request.body
        ? JSON.stringify(request.body).length
        : 0;
      if (this.resourceManager.shouldDeferLargeUpload(bodySize)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Sort requests by priority (resource-aware)
   */
  sortByPriority(requests: QueuedRequest[]): QueuedRequest[] {
    return [...requests].sort((a, b) => {
      const priorityA =
        this.resourceManager.getSyncPriority((a.priority || 0) >= 8) +
        (a.priority || 0);
      const priorityB =
        this.resourceManager.getSyncPriority((b.priority || 0) >= 8) +
        (b.priority || 0);

      // Higher priority first
      if (priorityB !== priorityA) {
        return priorityB - priorityA;
      }

      // Then by creation time (older first)
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  /**
   * Get batch size based on resources
   */
  getBatchSize(defaultSize: number = 5): number {
    // Reduce batch size if battery is low
    if (this.resourceManager.isBatteryLow()) {
      return Math.max(1, Math.floor(defaultSize / 2));
    }

    // Reduce batch size if network quality is poor
    const quality = this.resourceManager.getNetworkQuality();
    if (quality === 'poor') {
      return Math.max(1, Math.floor(defaultSize / 3));
    } else if (quality === 'fair') {
      return Math.max(2, Math.floor(defaultSize / 2));
    }

    return defaultSize;
  }

  /**
   * Check if request should be synced now
   */
  shouldSyncNow(request: QueuedRequest): boolean {
    const isCritical = (request.priority || 0) >= 8;
    return this.resourceManager.shouldSync(isCritical);
  }

  /**
   * Get estimated sync time for requests
   */
  estimateSyncTime(requests: QueuedRequest[]): number {
    const totalSize = requests.reduce((size, req) => {
      const bodySize = req.body ? JSON.stringify(req.body).length : 0;
      return size + bodySize;
    }, 0);

    return this.resourceManager.estimateTransferTime(totalSize);
  }
}

export default ResourceAwareSync;

