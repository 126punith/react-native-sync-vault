import { SyncVault } from '../core/SyncVault';
import type { NetworkState, QueueCounts, SyncEvent } from '../core/types';

export interface VaultStatus {
  counts: QueueCounts;
  network: NetworkState;
  isDraining: boolean;
  lastEvent: SyncEvent | null;
  lastDrainAt: number | null;
  /** Bumped on every request event; hooks use it to refetch lists. */
  version: number;
}

const EMPTY_COUNTS: QueueCounts = { pending: 0, inflight: 0, conflict: 0, deadLetter: 0, succeeded: 0, authBlocked: 0 };
const UNKNOWN_NETWORK: NetworkState = {
  isConnected: true,
  isInternetReachable: true,
  type: 'unknown',
  isExpensive: false,
  isConstrained: false,
};

let state: VaultStatus = {
  counts: EMPTY_COUNTS,
  network: UNKNOWN_NETWORK,
  isDraining: false,
  lastEvent: null,
  lastDrainAt: null,
  version: 0,
};
const listeners = new Set<() => void>();
let unsubscribers: Array<() => void> = [];
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function setState(patch: Partial<VaultStatus>): void {
  state = { ...state, ...patch };
  for (const listener of Array.from(listeners)) listener();
}

async function refreshCounts(): Promise<void> {
  try {
    setState({ counts: await SyncVault.getCounts() });
  } catch {
    // Native not ready yet; the next event refreshes.
  }
}

function scheduleRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshCounts();
  }, 50);
}

function start(): void {
  if (unsubscribers.length > 0) return;
  try {
    setState({ network: SyncVault.getNetworkState() });
  } catch {
    return;
  }
  unsubscribers = [
    SyncVault.addEventListener((event) => {
      const patch: Partial<VaultStatus> = { lastEvent: event, version: state.version + 1 };
      if (event.type === 'drain_started') patch.isDraining = true;
      if (event.type === 'drain_finished') {
        patch.isDraining = false;
        patch.lastDrainAt = event.timestamp;
      }
      setState(patch);
      scheduleRefresh();
    }),
    SyncVault.addNetworkListener((network) => setState({ network })),
  ];
  void refreshCounts();
}

export const statusStore = {
  subscribe(listener: () => void): () => void {
    start();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): VaultStatus {
    return state;
  },
  refresh: refreshCounts,
};

/** For tests: drop subscriptions and state. */
export function resetStatusStore(): void {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  listeners.clear();
  state = { counts: EMPTY_COUNTS, network: UNKNOWN_NETWORK, isDraining: false, lastEvent: null, lastDrainAt: null, version: 0 };
}
