/**
 * Structured logging for queue operations
 */
class QueueLoggerClass {
  private enabled: boolean = __DEV__;
  private logs: Array<{
    timestamp: number;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    data?: any;
  }> = [];
  private maxLogs: number = 1000;

  /**
   * Enable or disable logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Log info message
   */
  info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: any): void {
    this.log('warn', message, data);
  }

  /**
   * Log error message
   */
  error(message: string, data?: any): void {
    this.log('error', message, data);
  }

  /**
   * Log debug message
   */
  debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }

  /**
   * Internal log method
   */
  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: any): void {
    const logEntry = {
      timestamp: Date.now(),
      level,
      message,
      data,
    };

    this.logs.push(logEntry);

    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    if (this.enabled) {
      const prefix = `[OfflineQueue:${level.toUpperCase()}]`;
      switch (level) {
        case 'info':
          console.log(prefix, message, data || '');
          break;
        case 'warn':
          console.warn(prefix, message, data || '');
          break;
        case 'error':
          console.error(prefix, message, data || '');
          break;
        case 'debug':
          console.debug(prefix, message, data || '');
          break;
      }
    }
  }

  /**
   * Get all logs
   */
  getLogs(): Array<{
    timestamp: number;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    data?: any;
  }> {
    return [...this.logs];
  }

  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level: 'info' | 'warn' | 'error' | 'debug'): Array<{
    timestamp: number;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    data?: any;
  }> {
    return this.logs.filter((log) => log.level === level);
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

export const QueueLogger = new QueueLoggerClass();

