import SyncEngine from '../src/SyncEngine';
import QueueManager from '../src/QueueManager';
import { QueuedRequest } from '../src/types';

// Mock dependencies
jest.mock('../src/QueueManager');
jest.mock('react-native', () => ({
  NativeModules: {
    OfflineQueue: {
      getSyncStatus: jest.fn(),
      updateSyncStatus: jest.fn(),
      updateRequestStatus: jest.fn(),
      updateDataPoint: jest.fn(),
    },
  },
}));

// Mock fetch
global.fetch = jest.fn();

describe('SyncEngine', () => {
  let syncEngine: SyncEngine;
  let mockQueueManager: jest.Mocked<typeof QueueManager>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueueManager = QueueManager as jest.Mocked<typeof QueueManager>;
    mockQueueManager.getNetworkMonitor = jest.fn().mockReturnValue({
      isOnline: jest.fn().mockReturnValue(true),
      on: jest.fn(),
    } as any);
    mockQueueManager.getPendingRequests = jest.fn();
    mockQueueManager.updateRequestStatus = jest.fn();

    syncEngine = new SyncEngine(QueueManager);
  });

  describe('syncRequest', () => {
    it('should handle successful request', async () => {
      const { NativeModules } = require('react-native');
      const mockRequest: QueuedRequest = {
        id: 'req-1',
        method: 'POST',
        url: '/api/users',
        status: 'pending',
        priority: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attemptCount: 0,
        maxRetries: 3,
        body: { name: 'John' },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ id: '123', name: 'John' }),
      });

      NativeModules.OfflineQueue.updateRequestStatus.mockResolvedValue({});
      NativeModules.OfflineQueue.updateSyncStatus.mockResolvedValue({});

      // Access private method via any cast for testing
      await (syncEngine as any).syncRequest(mockRequest);

      expect(global.fetch).toHaveBeenCalled();
      expect(mockQueueManager.updateRequestStatus).toHaveBeenCalledWith(
        'req-1',
        'synced',
        expect.any(Object)
      );
    });

    it('should handle network errors', async () => {
      const { NativeModules } = require('react-native');
      const mockRequest: QueuedRequest = {
        id: 'req-1',
        method: 'POST',
        url: '/api/users',
        status: 'pending',
        priority: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attemptCount: 0,
        maxRetries: 3,
      };

      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));
      NativeModules.OfflineQueue.updateRequestStatus.mockResolvedValue({});

      await (syncEngine as any).syncRequest(mockRequest);

      expect(mockQueueManager.updateRequestStatus).toHaveBeenCalledWith(
        'req-1',
        'failed',
        expect.any(Object)
      );
    });

    it('should handle conflict responses', async () => {
      const { NativeModules } = require('react-native');
      const mockRequest: QueuedRequest = {
        id: 'req-1',
        method: 'PUT',
        url: '/api/users/1',
        status: 'pending',
        priority: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attemptCount: 0,
        maxRetries: 3,
        body: { name: 'John' },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 409,
        json: jest.fn().mockResolvedValue({ conflict: true }),
      });

      NativeModules.OfflineQueue.updateRequestStatus.mockResolvedValue({});

      await (syncEngine as any).syncRequest(mockRequest);

      expect(mockQueueManager.updateRequestStatus).toHaveBeenCalledWith(
        'req-1',
        'conflict',
        expect.any(Object)
      );
    });
  });
});


