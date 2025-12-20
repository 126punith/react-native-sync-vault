import QueueManager from '../src/QueueManager';
import { QueuePushOptions } from '../src/types';

// Mock native module
jest.mock('react-native', () => ({
  NativeModules: {
    OfflineQueue: {
      insertRequest: jest.fn(),
      getPendingRequests: jest.fn(),
      getFailedRequests: jest.fn(),
      updateRequestStatus: jest.fn(),
      getSyncStatus: jest.fn(),
      updateSyncStatus: jest.fn(),
      insertDataPoint: jest.fn(),
      getPerformanceMetrics: jest.fn(),
      resetPerformanceMetrics: jest.fn(),
    },
  },
}));

describe('QueueManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('push', () => {
    it('should queue a request successfully', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.insertRequest.mockResolvedValue('request-id-123');
      NativeModules.OfflineQueue.insertDataPoint.mockResolvedValue('data-point-id');
      NativeModules.OfflineQueue.getPendingRequests.mockResolvedValue([]);
      NativeModules.OfflineQueue.getFailedRequests.mockResolvedValue([]);
      NativeModules.OfflineQueue.getSyncStatus.mockResolvedValue({});
      NativeModules.OfflineQueue.updateSyncStatus.mockResolvedValue({});

      const options: QueuePushOptions = {
        method: 'POST',
        url: '/api/users',
        data: { name: 'John' },
        priority: 1,
      };

      const requestId = await QueueManager.push(options);

      expect(requestId).toBe('request-id-123');
      expect(NativeModules.OfflineQueue.insertRequest).toHaveBeenCalled();
    });

    it('should handle request without data', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.insertRequest.mockResolvedValue('request-id-456');
      NativeModules.OfflineQueue.getPendingRequests.mockResolvedValue([]);
      NativeModules.OfflineQueue.getFailedRequests.mockResolvedValue([]);
      NativeModules.OfflineQueue.getSyncStatus.mockResolvedValue({});
      NativeModules.OfflineQueue.updateSyncStatus.mockResolvedValue({});

      const options: QueuePushOptions = {
        method: 'GET',
        url: '/api/users',
      };

      const requestId = await QueueManager.push(options);

      expect(requestId).toBe('request-id-456');
      expect(NativeModules.OfflineQueue.insertDataPoint).not.toHaveBeenCalled();
    });
  });

  describe('getPendingRequests', () => {
    it('should return pending requests', async () => {
      const { NativeModules } = require('react-native');
      const mockRequests = [
        {
          id: '1',
          method: 'POST',
          url: '/api/users',
          status: 'pending',
        },
      ];
      NativeModules.OfflineQueue.getPendingRequests.mockResolvedValue(mockRequests);

      const requests = await QueueManager.getPendingRequests(10, 0);

      expect(requests).toEqual(mockRequests);
      expect(NativeModules.OfflineQueue.getPendingRequests).toHaveBeenCalledWith(10, 0);
    });
  });

  describe('getFailedRequests', () => {
    it('should return failed requests', async () => {
      const { NativeModules } = require('react-native');
      const mockFailed = [
        {
          id: '1',
          requestId: 'req-1',
          errorMessage: 'Network error',
          failureType: 'network',
        },
      ];
      NativeModules.OfflineQueue.getFailedRequests.mockResolvedValue(mockFailed);

      const failed = await QueueManager.getFailedRequests();

      expect(failed).toEqual(mockFailed);
    });
  });
});


