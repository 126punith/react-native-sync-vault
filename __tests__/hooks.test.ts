import { renderHook, waitFor } from '@testing-library/react-hooks';
import { useOfflineQueue, useQueueStatus, useFailedRequests, usePendingRequests } from '../src/hooks';

// Mock QueueManager
jest.mock('../src/QueueManager', () => ({
  __esModule: true,
  default: {
    initialize: jest.fn().mockResolvedValue(undefined),
    push: jest.fn(),
    getPendingRequests: jest.fn().mockResolvedValue([]),
    getFailedRequests: jest.fn().mockResolvedValue([]),
    updateRequestStatus: jest.fn(),
    getNetworkMonitor: jest.fn().mockReturnValue({
      getStatus: jest.fn().mockReturnValue('online'),
    }),
  },
}));

// Mock native module
jest.mock('react-native', () => ({
  NativeModules: {
    OfflineQueue: {
      getSyncStatus: jest.fn().mockResolvedValue({
        totalPending: 0,
        totalFailed: 0,
        syncInProgress: false,
      }),
    },
  },
}));

describe('Hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('useOfflineQueue', () => {
    it('should provide push function', () => {
      const { result } = renderHook(() => useOfflineQueue());

      expect(result.current.push).toBeDefined();
      expect(typeof result.current.push).toBe('function');
    });

    it('should initialize queue manager', async () => {
      const QueueManager = require('../src/QueueManager').default;
      renderHook(() => useOfflineQueue());

      await waitFor(() => {
        expect(QueueManager.initialize).toHaveBeenCalled();
      });
    });
  });

  describe('useQueueStatus', () => {
    it('should return queue status', async () => {
      const { result, waitForNextUpdate } = renderHook(() => useQueueStatus());

      await waitForNextUpdate();

      expect(result.current.status).toBeDefined();
      expect(result.current.loading).toBe(false);
    });
  });

  describe('useFailedRequests', () => {
    it('should return failed requests', async () => {
      const QueueManager = require('../src/QueueManager').default;
      QueueManager.getFailedRequests.mockResolvedValue([
        {
          id: '1',
          requestId: 'req-1',
          errorMessage: 'Test error',
        },
      ]);

      const { result, waitForNextUpdate } = renderHook(() => useFailedRequests());

      await waitForNextUpdate();

      expect(result.current.failedRequests).toBeDefined();
      expect(result.current.retry).toBeDefined();
    });
  });

  describe('usePendingRequests', () => {
    it('should return pending requests', async () => {
      const QueueManager = require('../src/QueueManager').default;
      QueueManager.getPendingRequests.mockResolvedValue([
        {
          id: '1',
          method: 'POST',
          url: '/api/test',
          status: 'pending',
        },
      ]);

      const { result, waitForNextUpdate } = renderHook(() => usePendingRequests());

      await waitForNextUpdate();

      expect(result.current.pendingRequests).toBeDefined();
      expect(result.current.pendingRequests.length).toBeGreaterThan(0);
    });
  });
});


