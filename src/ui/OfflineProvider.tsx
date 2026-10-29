import React, { createContext, useContext, useEffect, type ReactNode } from 'react';
import { SyncVault } from '../core/SyncVault';
import type { SyncVaultConfig } from '../core/types';
import { useSyncStatus, type SyncStatusResult } from '../hooks/useSyncStatus';

export interface OfflineContextValue extends SyncStatusResult {
  /** @deprecated Use pendingCount. */
  queueSize: number;
  /** @deprecated Use isDraining. */
  isSyncing: boolean;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

interface OfflineProviderProps {
  children: ReactNode;
  /**
   * Optional: configures the engine on mount if it was not configured yet. Prefer calling
   * SyncVault.configure() at app start, outside React, so background launches are covered.
   */
  config?: SyncVaultConfig;
}

export function OfflineProvider({ children, config }: OfflineProviderProps) {
  useEffect(() => {
    if (config && !SyncVault.isConfigured) {
      SyncVault.configure(config).catch(() => undefined);
    }
    // Configuration is applied once; later prop changes require SyncVault.configure().
  }, []);

  const status = useSyncStatus();
  const value: OfflineContextValue = { ...status, queueSize: status.pendingCount, isSyncing: status.isDraining };
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOfflineContext(): OfflineContextValue {
  const context = useContext(OfflineContext);
  if (!context) throw new Error('useOfflineContext must be used within OfflineProvider');
  return context;
}
