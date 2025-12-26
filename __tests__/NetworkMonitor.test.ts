import NetworkMonitor from '../src/NetworkMonitor';
import { NativeModules, NativeEventEmitter } from 'react-native';

// Mock React Native
jest.mock('react-native', () => {
  const mockEventEmitter = {
    addListener: jest.fn(),
    remove: jest.fn(),
  };

  return {
    NativeModules: {
      OfflineQueue: {
        getNetworkStatus: jest.fn(),
        hasNetworkPermission: jest.fn(),
      },
    },
    NativeEventEmitter: jest.fn(() => mockEventEmitter),
    Platform: {
      OS: 'ios',
    },
  };
});

describe('NetworkMonitor', () => {
  let networkMonitor: NetworkMonitor;
  let mockEventEmitter: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter = {
      addListener: jest.fn(),
      remove: jest.fn(),
    };
    (NativeEventEmitter as jest.Mock).mockReturnValue(mockEventEmitter);
  });

  afterEach(() => {
    if (networkMonitor) {
      networkMonitor.destroy();
    }
  });

  describe('initialization', () => {
    it('should initialize with online status', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('online');

      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for async init

      expect(networkMonitor.getStatus()).toBe('online');
      expect(networkMonitor.isOnline()).toBe(true);
      expect(networkMonitor.isOffline()).toBe(false);
    });

    it('should initialize with offline status', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('offline');

      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(networkMonitor.getStatus()).toBe('offline');
      expect(networkMonitor.isOnline()).toBe(false);
      expect(networkMonitor.isOffline()).toBe(true);
    });

    it('should handle missing native module gracefully', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue = null;

      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(networkMonitor.getStatus()).toBe('unknown');
    });

    it('should handle native module errors gracefully', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.getNetworkStatus.mockRejectedValue(
        new Error('Network error')
      );

      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(networkMonitor.getStatus()).toBe('unknown');
    });
  });

  describe('network status', () => {
    beforeEach(async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('online');
      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should return current status', () => {
      expect(networkMonitor.getStatus()).toBe('online');
    });

    it('should check if online', () => {
      expect(networkMonitor.isOnline()).toBe(true);
      expect(networkMonitor.isOffline()).toBe(false);
    });

    it('should check if offline', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('offline');
      await networkMonitor.refreshStatus();

      expect(networkMonitor.isOffline()).toBe(true);
      expect(networkMonitor.isOnline()).toBe(false);
    });
  });

  describe('refreshStatus', () => {
    it('should refresh status from native module', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('online');

      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100));

      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('offline');
      await networkMonitor.refreshStatus();

      expect(networkMonitor.getStatus()).toBe('offline');
    });

    it('should handle refresh errors gracefully', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('online');

      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100));

      NativeModules.OfflineQueue.getNetworkStatus.mockRejectedValue(
        new Error('Refresh failed')
      );
      await networkMonitor.refreshStatus();

      // Should maintain previous status on error
      expect(networkMonitor.getStatus()).toBe('online');
    });
  });

  describe('event listeners', () => {
    it('should subscribe to network status changes', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('online');

      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockEventEmitter.addListener).toHaveBeenCalledWith(
        'networkStatusChanged',
        expect.any(Function)
      );
    });

    it('should emit online event when status changes to online', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('offline');

      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100));

      const onlineHandler = jest.fn();
      networkMonitor.on('online', onlineHandler);

      // Simulate status change
      const listener = mockEventEmitter.addListener.mock.calls[0][1];
      listener({ status: 'online', previousStatus: 'offline' });

      expect(onlineHandler).toHaveBeenCalled();
    });

    it('should emit offline event when status changes to offline', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('online');

      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100));

      const offlineHandler = jest.fn();
      networkMonitor.on('offline', offlineHandler);

      // Simulate status change
      const listener = mockEventEmitter.addListener.mock.calls[0][1];
      listener({ status: 'offline', previousStatus: 'online' });

      expect(offlineHandler).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should cleanup event listeners on destroy', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('online');

      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100));

      networkMonitor.destroy();

      expect(mockEventEmitter.remove).toHaveBeenCalled();
    });
  });

  describe('permission handling', () => {
    it('should handle missing network permission', async () => {
      const { NativeModules } = require('react-native');
      NativeModules.OfflineQueue.hasNetworkPermission.mockResolvedValue(false);
      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('unknown');

      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(networkMonitor.getStatus()).toBe('unknown');
    });

    it('should proceed when permission check is not available', async () => {
      const { NativeModules } = require('react-native');
      delete NativeModules.OfflineQueue.hasNetworkPermission;
      NativeModules.OfflineQueue.getNetworkStatus.mockResolvedValue('online');

      networkMonitor = new NetworkMonitor();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(networkMonitor.getStatus()).toBe('online');
    });
  });
});


