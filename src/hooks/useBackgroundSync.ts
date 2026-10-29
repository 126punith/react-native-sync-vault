import { useCallback } from 'react';
import { SyncVault } from '../core/SyncVault';
import type { BackgroundDrainOptions } from '../core/types';

/**
 * Controls the native periodic drain (WorkManager on Android, BGAppRefreshTask on iOS).
 * SyncVault.configure() already schedules it from `backgroundIntervalMinutes`.
 */
export function useBackgroundSync() {
  const schedule = useCallback((options?: BackgroundDrainOptions) => SyncVault.scheduleBackgroundDrain(options), []);
  const cancel = useCallback(() => SyncVault.cancelBackgroundDrain(), []);
  const drainNow = useCallback(() => SyncVault.drainNow(), []);
  return { schedule, cancel, drainNow };
}
