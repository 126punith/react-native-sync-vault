import { SyncVault } from '../core/SyncVault';
import type { SyncEvent } from '../core/types';

export interface SyncMetricsSnapshot {
  enqueued: number;
  succeeded: number;
  deadLettered: number;
  conflicts: number;
  retries: number;
  authBlocked: number;
  attempts: number;
  /** succeeded / (succeeded + deadLettered), or 1 when nothing settled yet. */
  successRate: number;
  /** Mean ms from the first attempt seen in this session to success. */
  averageDeliveryMs: number;
  lastDrainAt: number | null;
  since: number;
}

/**
 * Delivery metrics derived from engine events for the current app session. Native keeps
 * delivering while JS is not running, so these are session-local, not lifetime totals.
 */
class SyncMetrics {
  private counters = { enqueued: 0, succeeded: 0, deadLettered: 0, conflicts: 0, retries: 0, authBlocked: 0, attempts: 0 };
  private firstAttemptAt = new Map<string, number>();
  private totalDeliveryMs = 0;
  private deliveries = 0;
  private lastDrainAt: number | null = null;
  private since = Date.now();
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<(snapshot: SyncMetricsSnapshot) => void>();

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = SyncVault.addEventListener((event) => this.record(event));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  record(event: SyncEvent): void {
    switch (event.type) {
      case 'enqueued':
        this.counters.enqueued++;
        break;
      case 'attempt':
        this.counters.attempts++;
        if (event.id && !this.firstAttemptAt.has(event.id)) this.firstAttemptAt.set(event.id, event.timestamp);
        break;
      case 'succeeded': {
        this.counters.succeeded++;
        const started = event.id ? this.firstAttemptAt.get(event.id) : undefined;
        if (started != null) {
          this.totalDeliveryMs += event.timestamp - started;
          this.deliveries++;
          this.firstAttemptAt.delete(event.id!);
        }
        break;
      }
      case 'retry_scheduled':
        this.counters.retries++;
        break;
      case 'dead_lettered':
        this.counters.deadLettered++;
        if (event.id) this.firstAttemptAt.delete(event.id);
        break;
      case 'conflict':
        this.counters.conflicts++;
        break;
      case 'auth_blocked':
        this.counters.authBlocked++;
        break;
      case 'drain_finished':
        this.lastDrainAt = event.timestamp;
        break;
      default:
        return;
    }
    const snapshot = this.getSnapshot();
    for (const listener of Array.from(this.listeners)) listener(snapshot);
  }

  getSnapshot(): SyncMetricsSnapshot {
    const settled = this.counters.succeeded + this.counters.deadLettered;
    return {
      ...this.counters,
      successRate: settled === 0 ? 1 : this.counters.succeeded / settled,
      averageDeliveryMs: this.deliveries === 0 ? 0 : this.totalDeliveryMs / this.deliveries,
      lastDrainAt: this.lastDrainAt,
      since: this.since,
    };
  }

  subscribe(listener: (snapshot: SyncMetricsSnapshot) => void): () => void {
    this.start();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.counters = { enqueued: 0, succeeded: 0, deadLettered: 0, conflicts: 0, retries: 0, authBlocked: 0, attempts: 0 };
    this.firstAttemptAt.clear();
    this.totalDeliveryMs = 0;
    this.deliveries = 0;
    this.lastDrainAt = null;
    this.since = Date.now();
  }
}

let shared: SyncMetrics | null = null;

export function getSyncMetrics(): SyncMetrics {
  if (!shared) shared = new SyncMetrics();
  return shared;
}

export default SyncMetrics;
