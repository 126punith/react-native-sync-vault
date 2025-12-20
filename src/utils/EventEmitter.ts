/**
 * Simple EventEmitter implementation for React Native
 * (Node.js 'events' module is not available in React Native)
 */
export class EventEmitter {
  private listeners: Map<string, Array<(...args: any[]) => void>> = new Map();

  /**
   * Register an event listener
   */
  on(event: string, listener: (...args: any[]) => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
    return this;
  }

  /**
   * Remove an event listener
   */
  off(event: string, listener: (...args: any[]) => void): this {
    const listeners = this.listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
    return this;
  }

  /**
   * Emit an event
   */
  emit(event: string, ...args: any[]): boolean {
    const listeners = this.listeners.get(event);
    if (listeners && listeners.length > 0) {
      listeners.forEach((listener) => {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
      return true;
    }
    return false;
  }

  /**
   * Remove all listeners for an event or all events
   */
  removeAllListeners(event?: string): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: string): number {
    return this.listeners.get(event)?.length || 0;
  }
}

