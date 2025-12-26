import { useCallback, useEffect } from 'react';
import { getBackgroundSync } from '../background/BackgroundSync';
import { BackgroundTaskConfig } from '../background/TaskScheduler';

/**
 * Hook for background sync
 */
export function useBackgroundSync() {
  const backgroundSync = getBackgroundSync();

  // Ensure recovery happens on mount
  useEffect(() => {
    // Trigger initialization if not already done
    // This ensures recovery happens even if getBackgroundSync was called before
    if (backgroundSync && typeof backgroundSync.initialize === 'function') {
      if (__DEV__) {
        console.log('[BACKGROUND-SYNC] useBackgroundSync hook mounted, ensuring initialization...');
      }
      // Small delay to ensure native module is ready
      const timer = setTimeout(() => {
        backgroundSync.initialize().catch((error) => {
          if (__DEV__) {
            console.error('[BACKGROUND-SYNC] Hook-initiated initialization failed:', error);
          }
        });
      }, 1500); // Slightly longer delay to ensure everything is ready
      
      return () => clearTimeout(timer);
    }
  }, [backgroundSync]);

  const guarantee = useCallback(
    async (config: BackgroundTaskConfig): Promise<void> => {
      await backgroundSync.guarantee(config);
    },
    [backgroundSync]
  );

  const cancel = useCallback(
    async (taskId: string): Promise<void> => {
      await backgroundSync.cancel(taskId);
    },
    [backgroundSync]
  );

  const getScheduledTasks = useCallback(async (): Promise<string[]> => {
    return backgroundSync.getScheduledTasks();
  }, [backgroundSync]);

  const isSupported = useCallback((): boolean => {
    return backgroundSync.isSupported();
  }, [backgroundSync]);

  return {
    guarantee,
    cancel,
    getScheduledTasks,
    isSupported,
  };
}

