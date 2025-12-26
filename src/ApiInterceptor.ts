import { InterceptorConfig } from './types';

/**
 * API Interceptor - Automatically intercepts fetch() calls and queues them when offline
 */
class ApiInterceptor {
  private originalFetch: typeof fetch | null = null;
  private isEnabled: boolean = false;
  private urlFilter?: string[];
  private queueManager: any = null;

  /**
   * Enable automatic API interception
   */
  enable(config: InterceptorConfig, queueManager: any): void {
    if (this.isEnabled) {
      return; // Already enabled, idempotent
    }

    if (!config.enabled) {
      return; // Not enabled in config
    }

    // Verify global.fetch exists
    if (typeof global.fetch !== 'function') {
      if (__DEV__) {
        console.error('ApiInterceptor: global.fetch is not a function');
      }
      return;
    }

    // Store original fetch before overriding
    this.originalFetch = global.fetch;
    this.isEnabled = true;
    this.urlFilter = config.urlFilter;
    this.queueManager = queueManager;

    // Override global fetch
    const interceptedFetch = this.interceptedFetch.bind(this);
    global.fetch = interceptedFetch;
    
    if (__DEV__) {
      console.log('[INTERCEPTOR-FETCH] Enabled fetch interception with filters:', { 
        urlFilter: config.urlFilter || [] 
      });
    }
  }

  /**
   * Disable automatic API interception
   */
  disable(): void {
    if (!this.isEnabled || !this.originalFetch) {
      return; // Not enabled or no original fetch to restore
    }

    // Restore original fetch
    global.fetch = this.originalFetch;
    this.isEnabled = false;
    this.originalFetch = null;
    this.queueManager = null;
    
    if (__DEV__) {
      console.log('[INTERCEPTOR-FETCH] Disabled fetch interception');
    }
  }

  /**
   * Verify interceptor is active (for testing)
   */
  isActive(): boolean {
    return this.isEnabled && global.fetch === this.interceptedFetch.bind(this);
  }

  /**
   * Intercepted fetch implementation
   */
  private async interceptedFetch(
    url: RequestInfo | URL,
    options?: RequestInit
  ): Promise<Response> {
    // Convert URL to string
    let urlString: string;
    let requestOptions: RequestInit | undefined = options;

    if (typeof url === 'string') {
      urlString = url;
    } else if (url instanceof URL) {
      urlString = url.toString();
    } else if (url instanceof Request) {
      // Handle Request object
      urlString = url.url;
      // Merge options from Request if options not provided
      if (!requestOptions) {
        requestOptions = {
          method: url.method,
          headers: url.headers,
          body: url.body,
          mode: url.mode,
          credentials: url.credentials,
          cache: url.cache,
          redirect: url.redirect,
          referrer: url.referrer,
          integrity: url.integrity,
        };
      }
    } else {
      // Fallback for other types
      urlString = String(url);
    }

    // Check URL filter - if filter exists and URL doesn't match, execute normally
    const method = requestOptions?.method || 'GET';
    if (__DEV__) {
      console.log('[INTERCEPTOR-FETCH] Intercepting request:', { method, url: urlString });
    }
    
    if (this.urlFilter && this.urlFilter.length > 0) {
      const matchesFilter = this.urlFilter.some(filter => urlString.startsWith(filter));
      if (__DEV__) {
        console.log('[INTERCEPTOR-FETCH] URL filter check:', { 
          matchesFilter: matchesFilter ? 'MATCH' : 'NO_MATCH',
          url: urlString,
          filters: this.urlFilter 
        });
      }
      if (!matchesFilter) {
        // URL doesn't match filter, execute normally
        return this.originalFetch!(url, requestOptions);
      }
    }

    // Get network status
    if (!this.queueManager) {
      // QueueManager not available, execute normally
      return this.originalFetch!(url, requestOptions);
    }

    const networkMonitor = this.queueManager.getNetworkMonitor();
    if (!networkMonitor) {
      // NetworkMonitor not available, execute normally
      return this.originalFetch!(url, requestOptions);
    }

    const isOnline = networkMonitor.isOnline();
    
    if (__DEV__) {
      console.log('[INTERCEPTOR-FETCH] Network status:', { 
        isOnline: isOnline ? 'ONLINE' : 'OFFLINE' 
      });
    }

    // If offline, queue the request
    if (!isOnline) {
      try {
        // Extract method
        const method = requestOptions?.method || 'GET';

        // Extract headers
        const headers = this.extractHeaders(requestOptions?.headers);

        // Extract body data
        const bodyData = await this.parseBody(requestOptions?.body);

        // Queue the request
        const requestId = await this.queueManager.push({
          method,
          url: urlString,
          data: bodyData,
          headers,
        });

        if (__DEV__) {
          console.log('[INTERCEPTOR-FETCH] Request queued:', { requestId, method, url: urlString });
        }

        // Return a mock response to avoid breaking existing code
        // Status 202 (Accepted) indicates the request was queued
        return new Response(JSON.stringify({ queued: true, message: 'Request queued for offline sync', requestId }), {
          status: 202,
          statusText: 'Accepted (Queued)',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        // If queuing fails, log error but still return a response
        // to avoid breaking the calling code
        if (__DEV__) {
          console.error('[INTERCEPTOR-FETCH] Failed to queue request:', error);
        }
        return new Response(JSON.stringify({ 
          queued: false, 
          error: 'Failed to queue request',
          message: error instanceof Error ? error.message : String(error)
        }), {
          status: 202,
          statusText: 'Accepted (Queue Failed)',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      }
    }

    // Online: execute normally
    if (__DEV__) {
      console.log('[INTERCEPTOR-FETCH] Executing normally (online):', { method, url: urlString });
    }
    return this.originalFetch!(url, requestOptions);
  }

  /**
   * Extract headers from RequestInit headers
   */
  private extractHeaders(headers?: HeadersInit): Record<string, string> {
    if (!headers) {
      return {};
    }

    if (headers instanceof Headers) {
      const result: Record<string, string> = {};
      headers.forEach((value: string, key: string) => {
        result[key] = value;
      });
      return result;
    }

    if (Array.isArray(headers)) {
      const result: Record<string, string> = {};
      headers.forEach(([key, value]) => {
        result[key] = value;
      });
      return result;
    }

    // Plain object
    return headers as Record<string, string>;
  }

  /**
   * Parse request body to extract data
   */
  private async parseBody(body?: BodyInit | null): Promise<any> {
    if (!body) {
      return undefined;
    }

    // If it's already a string, try to parse as JSON
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }

    // If it's FormData, Blob, or ArrayBuffer, we can't easily serialize it
    // For now, return undefined - these will need special handling
    if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) {
      // FormData/Blob/ArrayBuffer can't be easily serialized to JSON
      // We'll skip body for these types
      return undefined;
    }

    // Try to read as text and parse
    try {
      const text = await new Response(body).text();
      if (text) {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
    } catch {
      // If we can't parse it, return undefined
    }

    return undefined;
  }
}

export default ApiInterceptor;

