import { useCallback } from 'react';
import ResourceManager from '../resources/ResourceManager';

/**
 * Hook for resource-aware sync
 */
export function useResourceAwareSync(resourceManager: ResourceManager | null) {
  const getBatteryLevel = useCallback((): number => {
    if (!resourceManager) {
      return 100;
    }
    return resourceManager.getBatteryLevel();
  }, [resourceManager]);

  const isBatteryLow = useCallback((): boolean => {
    if (!resourceManager) {
      return false;
    }
    return resourceManager.isBatteryLow();
  }, [resourceManager]);

  const getNetworkQuality = useCallback(() => {
    if (!resourceManager) {
      return 'unknown';
    }
    return resourceManager.getNetworkQuality();
  }, [resourceManager]);

  const getNetworkType = useCallback(() => {
    if (!resourceManager) {
      return 'unknown';
    }
    return resourceManager.getNetworkType();
  }, [resourceManager]);

  const shouldSync = useCallback(
    (isCritical: boolean = false): boolean => {
      if (!resourceManager) {
        return true;
      }
      return resourceManager.shouldSync(isCritical);
    },
    [resourceManager]
  );

  const shouldDeferLargeUpload = useCallback(
    (sizeBytes: number): boolean => {
      if (!resourceManager) {
        return false;
      }
      return resourceManager.shouldDeferLargeUpload(sizeBytes);
    },
    [resourceManager]
  );

  const estimateTransferTime = useCallback(
    (sizeBytes: number): number => {
      if (!resourceManager) {
        return 0;
      }
      return resourceManager.estimateTransferTime(sizeBytes);
    },
    [resourceManager]
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!resourceManager) {
      return;
    }
    await resourceManager.refresh();
  }, [resourceManager]);

  return {
    getBatteryLevel,
    isBatteryLow,
    getNetworkQuality,
    getNetworkType,
    shouldSync,
    shouldDeferLargeUpload,
    estimateTransferTime,
    refresh,
    isEnabled: resourceManager !== null,
  };
}

