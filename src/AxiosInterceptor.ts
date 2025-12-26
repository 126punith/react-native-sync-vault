import { InterceptorConfig } from './types';

/**
 * Axios Interceptor - Automatically intercepts axios requests and queues them when offline
 */
class AxiosInterceptor {
  private originalRequestInterceptor: number | null = null;
  private originalResponseInterceptor: number | null = null;
  private isEnabled: boolean = false;
  private urlFilter?: string[];
  private queueManager: any = null;
  private axiosInstance: any = null;
  private isDefaultAxios: boolean = false;

  /**
   * Enable automatic axios interception
   */
  enable(config: InterceptorConfig, queueManager: any, axiosInstance?: any): void {
    if (this.isEnabled) {
      return; // Already enabled, idempotent
    }

    if (!config.axios?.enabled) {
      return; // Not enabled in config
    }

    // Determine which axios instance to use
    let axios: any = null;
    if (axiosInstance) {
      // Use provided custom instance
      axios = axiosInstance;
      this.isDefaultAxios = false;
    } else {
      // Try to use default axios instance
      try {
        axios = require('axios');
        if (!axios || typeof axios.create !== 'function') {
          if (__DEV__) {
            console.error('AxiosInterceptor: axios is not available or invalid');
          }
          return;
        }
        // Use default instance
        axios = axios.default || axios;
        this.isDefaultAxios = true;
      } catch (error) {
        if (__DEV__) {
          console.error('AxiosInterceptor: Failed to load axios:', error);
        }
        return;
      }
    }

    this.isEnabled = true;
    this.urlFilter = config.urlFilter;
    this.queueManager = queueManager;
    this.axiosInstance = axios;

    if (__DEV__) {
      console.log('[INTERCEPTOR-AXIOS] Enabled axios interception:', { 
        instance: this.isDefaultAxios ? 'default' : 'custom',
        urlFilter: config.urlFilter || [] 
      });
    }

    // Add request interceptor
    this.originalRequestInterceptor = axios.interceptors.request.use(
      async (config: any) => {
        return await this.interceptRequest(config);
      },
      (error: any) => {
        return Promise.reject(error);
      }
    );

    // Add response interceptor to handle errors
    this.originalResponseInterceptor = axios.interceptors.response.use(
      (response: any) => {
        return response;
      },
      async (error: any) => {
        // If it's a network error and we're offline, queue the request
        if (this.isNetworkError(error) && !this.queueManager.getNetworkMonitor().isOnline()) {
          return await this.handleOfflineError(error);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Disable automatic axios interception
   */
  disable(): void {
    if (!this.isEnabled || !this.axiosInstance) {
      return; // Not enabled or no axios instance
    }

    // Remove interceptors
    if (this.originalRequestInterceptor !== null) {
      this.axiosInstance.interceptors.request.eject(this.originalRequestInterceptor);
      this.originalRequestInterceptor = null;
    }

    if (this.originalResponseInterceptor !== null) {
      this.axiosInstance.interceptors.response.eject(this.originalResponseInterceptor);
      this.originalResponseInterceptor = null;
    }

    this.isEnabled = false;
    this.queueManager = null;
    this.axiosInstance = null;
    
    if (__DEV__) {
      console.log('[INTERCEPTOR-AXIOS] Disabled axios interception');
    }
  }

  /**
   * Verify interceptor is active (for testing)
   */
  isActive(): boolean {
    return this.isEnabled && this.originalRequestInterceptor !== null;
  }

  /**
   * Intercept axios request
   */
  private async interceptRequest(config: any): Promise<any> {
    const url = this.getRequestUrl(config);
    const method = (config.method || 'GET').toUpperCase();

    if (__DEV__) {
      console.log('[INTERCEPTOR-AXIOS] Intercepting request:', { method, url });
    }

    // Check URL filter - if filter exists and URL doesn't match, execute normally
    if (this.urlFilter && this.urlFilter.length > 0) {
      const matchesFilter = this.urlFilter.some(filter => url.startsWith(filter));
      if (__DEV__) {
        console.log('[INTERCEPTOR-AXIOS] URL filter check:', { 
          matchesFilter: matchesFilter ? 'MATCH' : 'NO_MATCH',
          url,
          filters: this.urlFilter 
        });
      }
      if (!matchesFilter) {
        // URL doesn't match filter, execute normally
        return config;
      }
    }

    // Get network status
    if (!this.queueManager) {
      // QueueManager not available, execute normally
      return config;
    }

    const networkMonitor = this.queueManager.getNetworkMonitor();
    if (!networkMonitor) {
      // NetworkMonitor not available, execute normally
      return config;
    }

    const isOnline = networkMonitor.isOnline();
    
    if (__DEV__) {
      console.log('[INTERCEPTOR-AXIOS] Network status:', { 
        isOnline: isOnline ? 'ONLINE' : 'OFFLINE' 
      });
    }

    // If offline, queue the request
    if (!isOnline) {
      try {
        // Extract method
        const method = (config.method || 'GET').toUpperCase();

        // Extract headers
        const headers = config.headers || {};

        // Extract body data
        const bodyData = config.data;

        // Queue the request
        const requestId = await this.queueManager.push({
          method,
          url,
          data: bodyData,
          headers: this.normalizeHeaders(headers),
          queryParams: config.params,
        });

        if (__DEV__) {
          console.log('[INTERCEPTOR-AXIOS] Request queued:', { requestId, method, url });
        }

        // Reject the promise with a special error that indicates the request was queued
        // This allows the calling code to handle it appropriately
        const queuedError: any = new Error('Request queued for offline sync');
        queuedError.isQueued = true;
        queuedError.requestId = requestId;
        queuedError.status = 202;
        queuedError.data = { queued: true, message: 'Request queued for offline sync', requestId };
        return Promise.reject(queuedError);
      } catch (error) {
        // If queuing fails, log error but allow request to proceed
        // This prevents breaking existing code
        if (__DEV__) {
          console.error('[INTERCEPTOR-AXIOS] Failed to queue request:', error);
        }
        return config;
      }
    }

    // Online: execute normally
    if (__DEV__) {
      console.log('[INTERCEPTOR-AXIOS] Executing normally (online):', { method, url });
    }
    return config;
  }

  /**
   * Handle offline error (when response interceptor catches network error)
   */
  private async handleOfflineError(error: any): Promise<any> {
    const config = error.config;
    if (!config) {
      return Promise.reject(error);
    }

    const url = this.getRequestUrl(config);

    // Check URL filter
    if (this.urlFilter && this.urlFilter.length > 0) {
      const matchesFilter = this.urlFilter.some(filter => url.startsWith(filter));
      if (!matchesFilter) {
        return Promise.reject(error);
      }
    }

    try {
      const method = (config.method || 'GET').toUpperCase();
      const headers = config.headers || {};
      const bodyData = config.data;

      const requestId = await this.queueManager.push({
        method,
        url,
        data: bodyData,
        headers: this.normalizeHeaders(headers),
        queryParams: config.params,
      });

      if (__DEV__) {
        console.log('[INTERCEPTOR-AXIOS] Network error detected, queuing request:', { 
          requestId, 
          method, 
          url 
        });
      }

      // Return a mock response indicating the request was queued
      return {
        status: 202,
        statusText: 'Accepted (Queued)',
        data: { queued: true, message: 'Request queued for offline sync', requestId },
        headers: {},
        config,
      };
    } catch (queueError) {
      if (__DEV__) {
        console.error('[INTERCEPTOR-AXIOS] Failed to queue request:', queueError);
      }
      return Promise.reject(error);
    }
  }

  /**
   * Get request URL from axios config
   */
  private getRequestUrl(config: any): string {
    if (config.url) {
      // If baseURL is set, combine it with url
      if (config.baseURL) {
        return config.baseURL.replace(/\/$/, '') + '/' + config.url.replace(/^\//, '');
      }
      return config.url;
    }
    return '';
  }

  /**
   * Normalize headers to plain object
   */
  private normalizeHeaders(headers: any): Record<string, string> {
    if (!headers) {
      return {};
    }

    // If headers is already a plain object
    if (typeof headers === 'object' && !headers.get && !headers.forEach) {
      const result: Record<string, string> = {};
      for (const key in headers) {
        if (headers.hasOwnProperty(key)) {
          const value = headers[key];
          if (value !== undefined && value !== null) {
            result[key] = String(value);
          }
        }
      }
      return result;
    }

    // If headers is an Axios Headers object or similar
    if (headers.get) {
      const result: Record<string, string> = {};
      const keys = Object.keys(headers);
      keys.forEach(key => {
        const value = headers.get ? headers.get(key) : headers[key];
        if (value !== undefined && value !== null) {
          result[key] = String(value);
        }
      });
      return result;
    }

    return {};
  }

  /**
   * Check if error is a network error
   */
  private isNetworkError(error: any): boolean {
    if (!error) {
      return false;
    }

    // Axios network errors
    if (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return true;
    }

    // Check if error message indicates network issue
    if (error.message) {
      const message = error.message.toLowerCase();
      if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
        return true;
      }
    }

    // Check if request was made (no response means network error)
    if (!error.response && error.request) {
      return true;
    }

    return false;
  }
}

export default AxiosInterceptor;

