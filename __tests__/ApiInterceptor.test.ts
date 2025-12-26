import ApiInterceptor from '../src/ApiInterceptor';

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// Mock Response
global.Response = class Response {
  constructor(public body: any, public init?: any) {}
  ok = true;
  status = 200;
  statusText = 'OK';
  headers = new Map();
  json() { return Promise.resolve(JSON.parse(this.body)); }
  text() { return Promise.resolve(this.body); }
} as any;

describe('ApiInterceptor', () => {
  let interceptor: ApiInterceptor;
  let mockQueueManager: any;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    originalFetch = global.fetch;
    mockFetch.mockClear();
    
    interceptor = new ApiInterceptor();
    mockQueueManager = {
      push: jest.fn().mockResolvedValue('request-id-123'),
      getNetworkMonitor: jest.fn().mockReturnValue({
        isOnline: jest.fn().mockReturnValue(true),
        getStatus: jest.fn().mockReturnValue('online'),
      }),
    };
  });

  afterEach(() => {
    interceptor.disable();
    global.fetch = originalFetch;
  });

  describe('enable', () => {
    it('should enable interceptor when config.enabled is true', () => {
      interceptor.enable({ enabled: true }, mockQueueManager);
      
      expect(interceptor.isActive()).toBe(true);
      expect(global.fetch).not.toBe(originalFetch);
    });

    it('should not enable when config.enabled is false', () => {
      interceptor.enable({ enabled: false }, mockQueueManager);
      
      expect(interceptor.isActive()).toBe(false);
      expect(global.fetch).toBe(originalFetch);
    });

    it('should be idempotent - multiple calls should not cause issues', () => {
      interceptor.enable({ enabled: true }, mockQueueManager);
      interceptor.enable({ enabled: true }, mockQueueManager);
      
      expect(interceptor.isActive()).toBe(true);
    });

    it('should handle missing global.fetch gracefully', () => {
      const originalGlobalFetch = (global as any).fetch;
      delete (global as any).fetch;
      
      interceptor.enable({ enabled: true }, mockQueueManager);
      
      expect(interceptor.isActive()).toBe(false);
      
      (global as any).fetch = originalGlobalFetch;
    });
  });

  describe('disable', () => {
    it('should disable interceptor and restore original fetch', () => {
      interceptor.enable({ enabled: true }, mockQueueManager);
      expect(interceptor.isActive()).toBe(true);
      
      interceptor.disable();
      
      expect(interceptor.isActive()).toBe(false);
      expect(global.fetch).toBe(originalFetch);
    });

    it('should be safe to call when not enabled', () => {
      expect(() => interceptor.disable()).not.toThrow();
    });
  });

  describe('interceptedFetch - online behavior', () => {
    beforeEach(() => {
      interceptor.enable({ enabled: true }, mockQueueManager);
      mockQueueManager.getNetworkMonitor().isOnline.mockReturnValue(true);
    });

    it('should execute fetch normally when online', async () => {
      const mockResponse = new Response('{"data": "test"}', { status: 200 });
      mockFetch.mockResolvedValue(mockResponse);
      
      const response = await fetch('https://api.example.com/users');
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        undefined
      );
      expect(mockQueueManager.push).not.toHaveBeenCalled();
    });

    it('should pass through options when online', async () => {
      const mockResponse = new Response('{"data": "test"}', { status: 200 });
      mockFetch.mockResolvedValue(mockResponse);
      
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John' }),
      };
      
      await fetch('https://api.example.com/users', options);
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        options
      );
    });
  });

  describe('interceptedFetch - offline behavior', () => {
    beforeEach(() => {
      interceptor.enable({ enabled: true }, mockQueueManager);
      mockQueueManager.getNetworkMonitor().isOnline.mockReturnValue(false);
    });

    it('should queue request when offline', async () => {
      const response = await fetch('https://api.example.com/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John' }),
      });
      
      expect(mockQueueManager.push).toHaveBeenCalledWith({
        method: 'POST',
        url: 'https://api.example.com/users',
        data: { name: 'John' },
        headers: { 'Content-Type': 'application/json' },
      });
      
      expect(response.status).toBe(202);
      const data = await response.json();
      expect(data.queued).toBe(true);
    });

    it('should return 202 status when request is queued', async () => {
      const response = await fetch('https://api.example.com/users');
      
      expect(response.status).toBe(202);
      expect(response.statusText).toBe('Accepted (Queued)');
    });

    it('should handle queuing errors gracefully', async () => {
      mockQueueManager.push.mockRejectedValue(new Error('Queue failed'));
      
      const response = await fetch('https://api.example.com/users');
      
      expect(response.status).toBe(202);
      const data = await response.json();
      expect(data.queued).toBe(false);
      expect(data.error).toBe('Failed to queue request');
    });
  });

  describe('URL filtering', () => {
    beforeEach(() => {
      interceptor.enable(
        {
          enabled: true,
          urlFilter: ['https://api.example.com', 'https://cdn.example.com'],
        },
        mockQueueManager
      );
    });

    it('should intercept URLs matching filter', async () => {
      mockQueueManager.getNetworkMonitor().isOnline.mockReturnValue(false);
      
      await fetch('https://api.example.com/users');
      
      expect(mockQueueManager.push).toHaveBeenCalled();
    });

    it('should not intercept URLs not matching filter', async () => {
      mockQueueManager.getNetworkMonitor().isOnline.mockReturnValue(false);
      const mockResponse = new Response('{"data": "test"}', { status: 200 });
      mockFetch.mockResolvedValue(mockResponse);
      
      await fetch('https://other-api.com/data');
      
      expect(mockQueueManager.push).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle empty filter array', () => {
      interceptor.disable();
      interceptor.enable({ enabled: true, urlFilter: [] }, mockQueueManager);
      
      expect(interceptor.isActive()).toBe(true);
    });
  });

  describe('Request object handling', () => {
    beforeEach(() => {
      interceptor.enable({ enabled: true }, mockQueueManager);
      mockQueueManager.getNetworkMonitor().isOnline.mockReturnValue(false);
    });

    it('should handle URL string', async () => {
      await fetch('https://api.example.com/users');
      
      expect(mockQueueManager.push).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://api.example.com/users',
        })
      );
    });

    it('should handle URL object', async () => {
      const url = new URL('https://api.example.com/users');
      await fetch(url);
      
      expect(mockQueueManager.push).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://api.example.com/users',
        })
      );
    });

    it('should handle Request object', async () => {
      const request = new Request('https://api.example.com/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John' }),
      });
      
      await fetch(request);
      
      expect(mockQueueManager.push).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: 'https://api.example.com/users',
        })
      );
    });
  });

  describe('body parsing', () => {
    beforeEach(() => {
      interceptor.enable({ enabled: true }, mockQueueManager);
      mockQueueManager.getNetworkMonitor().isOnline.mockReturnValue(false);
    });

    it('should parse JSON body', async () => {
      await fetch('https://api.example.com/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'John' }),
      });
      
      expect(mockQueueManager.push).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'John' },
        })
      );
    });

    it('should handle string body', async () => {
      await fetch('https://api.example.com/users', {
        method: 'POST',
        body: 'plain text',
      });
      
      expect(mockQueueManager.push).toHaveBeenCalledWith(
        expect.objectContaining({
          data: 'plain text',
        })
      );
    });

    it('should skip FormData body', async () => {
      const formData = new FormData();
      formData.append('name', 'John');
      
      await fetch('https://api.example.com/users', {
        method: 'POST',
        body: formData,
      });
      
      expect(mockQueueManager.push).toHaveBeenCalledWith(
        expect.objectContaining({
          data: undefined,
        })
      );
    });
  });

  describe('headers extraction', () => {
    beforeEach(() => {
      interceptor.enable({ enabled: true }, mockQueueManager);
      mockQueueManager.getNetworkMonitor().isOnline.mockReturnValue(false);
    });

    it('should extract headers from Headers object', async () => {
      const headers = new Headers();
      headers.set('Authorization', 'Bearer token');
      headers.set('Content-Type', 'application/json');
      
      await fetch('https://api.example.com/users', {
        method: 'POST',
        headers,
      });
      
      expect(mockQueueManager.push).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer token',
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should extract headers from array', async () => {
      await fetch('https://api.example.com/users', {
        method: 'POST',
        headers: [
          ['Authorization', 'Bearer token'],
          ['Content-Type', 'application/json'],
        ],
      });
      
      expect(mockQueueManager.push).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer token',
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should extract headers from plain object', async () => {
      await fetch('https://api.example.com/users', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        },
      });
      
      expect(mockQueueManager.push).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer token',
            'Content-Type': 'application/json',
          },
        })
      );
    });
  });
});


