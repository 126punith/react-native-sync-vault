import { SyncVault } from '../core/SyncVault';
import type { SyncEvent } from '../core/types';

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  event?: SyncEvent;
}

const LEVELS: Partial<Record<SyncEvent['type'], LogEntry['level']>> = {
  retry_scheduled: 'warn',
  auth_blocked: 'warn',
  conflict: 'warn',
  dead_lettered: 'error',
};

/** Ring buffer of engine events for debug screens and bug reports. Off until start(). */
class QueueLoggerClass {
  private logs: LogEntry[] = [];
  private maxLogs = 500;
  private unsubscribe: (() => void) | null = null;

  start(maxLogs = 500): void {
    this.maxLogs = maxLogs;
    if (this.unsubscribe) return;
    this.unsubscribe = SyncVault.addEventListener((event) => this.append(event));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  isRunning(): boolean {
    return this.unsubscribe != null;
  }

  private append(event: SyncEvent): void {
    const details = [event.id, event.httpStatus ? `HTTP ${event.httpStatus}` : null, event.error].filter(Boolean).join(' ');
    this.logs.push({
      timestamp: event.timestamp,
      level: LEVELS[event.type] ?? 'info',
      message: details ? `${event.type} ${details}` : event.type,
      event,
    });
    if (this.logs.length > this.maxLogs) this.logs.splice(0, this.logs.length - this.maxLogs);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
  }

  export(): string {
    return this.logs.map((l) => `${new Date(l.timestamp).toISOString()} [${l.level}] ${l.message}`).join('\n');
  }
}

export const QueueLogger = new QueueLoggerClass();
