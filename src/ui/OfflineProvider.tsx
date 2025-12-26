import React, { createContext, useContext, ReactNode, useEffect, useState } from 'react';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { OfflineQueueConfig } from '../types';
import NetworkMonitor from '../NetworkMonitor';
import QueueManager from '../QueueManager';

/**
 * Offline context value
 */
interface OfflineContextValue {
  isOnline: boolean;
  queueSize: number;
  isSyncing: boolean;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

/**
 * Offline Provider Props
 */
interface OfflineProviderProps {
  children: ReactNode;
  config?: OfflineQueueConfig;
}

/**
 * Offline Provider
 * Provides offline state to child components
 * Uses event listeners instead of polling for reactive updates
 */
export function OfflineProvider({
  children,
  config,
}: OfflineProviderProps) {
  const queue = useOfflineQueue(config);
  const [isOnline, setIsOnline] = useState(true);
  const [queueSize, setQueueSize] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [networkMonitor] = useState(() => new NetworkMonitor());

  useEffect(() => {
    // Monitor network status
    const updateNetworkStatus = () => {
      const status = networkMonitor.getStatus();
      setIsOnline(status === 'online');
    };

    updateNetworkStatus();
    networkMonitor.on('online', updateNetworkStatus);
    networkMonitor.on('offline', updateNetworkStatus);

    return () => {
      networkMonitor.off('online', updateNetworkStatus);
      networkMonitor.off('offline', updateNetworkStatus);
    };
  }, [networkMonitor]);

  useEffect(() => {
    // Initial fetch of queue size
    const fetchQueueSize = async () => {
      try {
        const pending = await queue.getPendingRequests(100, 0);
        setQueueSize(pending.length);
      } catch (error) {
        // Ignore errors
      }
    };

    fetchQueueSize();

    // Listen to queue status changes
    const handleStatusChange = async (status: any) => {
      if (status && typeof status.totalPending === 'number') {
        setQueueSize(status.totalPending);
      } else {
        // Fallback: fetch directly
        fetchQueueSize();
      }
    };

    const handlePendingChange = (pendingRequests: any[]) => {
      setQueueSize(pendingRequests.length);
    };

    const handleSyncStarted = () => {
      setIsSyncing(true);
    };

    const handleSyncCompleted = () => {
      setIsSyncing(false);
      fetchQueueSize();
    };

    const handleSyncFailed = () => {
      setIsSyncing(false);
    };

    // Subscribe to events
    if (QueueManager && typeof QueueManager.on === 'function') {
      QueueManager.on('queue:status:changed', handleStatusChange);
      QueueManager.on('queue:pending:changed', handlePendingChange);
      QueueManager.on('queue:request:added', fetchQueueSize);
      QueueManager.on('queue:request:synced', fetchQueueSize);
      QueueManager.on('sync:started', handleSyncStarted);
      QueueManager.on('sync:completed', handleSyncCompleted);
      QueueManager.on('sync:failed', handleSyncFailed);

      return () => {
        QueueManager.off('queue:status:changed', handleStatusChange);
        QueueManager.off('queue:pending:changed', handlePendingChange);
        QueueManager.off('queue:request:added', fetchQueueSize);
        QueueManager.off('queue:request:synced', fetchQueueSize);
        QueueManager.off('sync:started', handleSyncStarted);
        QueueManager.off('sync:completed', handleSyncCompleted);
        QueueManager.off('sync:failed', handleSyncFailed);
      };
    }
  }, [queue]);

  const value: OfflineContextValue = {
    isOnline,
    queueSize,
    isSyncing,
  };

  return (
    <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
  );
}

/**
 * Hook to access offline context
 */
export function useOfflineContext(): OfflineContextValue {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error('useOfflineContext must be used within OfflineProvider');
  }
  return context;
}

