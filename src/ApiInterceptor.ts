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
    console.log('[DEBUG] ApiInterceptor.enable() called', {
      isEnabled: this.isEnabled,
      configEnabled: config.enabled,
      urlFilter: config.urlFilter,
      hasQueueManager: !!queueManager,
    });

    if (this.isEnabled) {
      console.log('[DEBUG] ApiInterceptor.enable() already enabled, skipping');
      return; // Already enabled, idempotent
    }

    if (!config.enabled) {
      console.log('[DEBUG] ApiInterceptor.enable() config.enabled is false, skipping');
      return; // Not enabled in config
    }

    // Store original fetch before overriding
    this.originalFetch = global.fetch;
    this.isEnabled = true;
    this.urlFilter = config.urlFilter;
    this.queueManager = queueManager;

    // Override global fetch
    global.fetch = this.interceptedFetch.bind(this);
    console.log('[DEBUG] ApiInterceptor.enable() fetch() overridden successfully');
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
  }

  /**
   * Intercepted fetch implementation
   */
  private async interceptedFetch(
    url: RequestInfo | URL,
    options?: RequestInit
  ): Promise<Response> {
    console.log('[DEBUG] ApiInterceptor.interceptedFetch() called', {
      url: typeof url === 'string' ? url : url instanceof URL ? url.toString() : 'Request object',
      method: options?.method || 'GET',
      isEnabled: this.isEnabled,
      hasQueueManager: !!this.queueManager,
    });

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
    if (this.urlFilter && this.urlFilter.length > 0) {
      const matchesFilter = this.urlFilter.some(filter => urlString.startsWith(filter));
      console.log('[DEBUG] ApiInterceptor URL filter check', {
        urlString,
        urlFilter: this.urlFilter,
        matchesFilter,
      });
      if (!matchesFilter) {
        // URL doesn't match filter, execute normally
        console.log('[DEBUG] ApiInterceptor URL does not match filter, executing normally');
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
    console.log('[DEBUG] ApiInterceptor network status', {
      isOnline,
      networkStatus: networkMonitor.getStatus(),
    });

    // If offline, queue the request
    if (!isOnline) {
      console.log('[DEBUG] ApiInterceptor device is offline, queuing request');
      try {
        // Extract method
        const method = requestOptions?.method || 'GET';

        // Extract headers
        const headers = this.extractHeaders(requestOptions?.headers);

        // Extract body data
        const bodyData = await this.parseBody(requestOptions?.body);

        // Queue the request
        console.log('[DEBUG] ApiInterceptor queuing request', {
          method,
          url: urlString,
          hasBody: !!bodyData,
          headersCount: Object.keys(headers).length,
        });
        const requestId = await this.queueManager.push({
          method,
          url: urlString,
          data: bodyData,
          headers,
        });
        console.log('[DEBUG] ApiInterceptor request queued successfully', { requestId });

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
        console.error('[ApiInterceptor] Failed to queue request:', error);
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
    console.log('[DEBUG] ApiInterceptor device is online, executing fetch normally');
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
      headers.forEach((value, key) => {
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

