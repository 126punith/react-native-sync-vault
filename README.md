# react-native-sync-vault

A reliable offline-first sync vault for persistent network operations in React Native. Queue API requests offline, persist them in SQLite, and progressively sync when online. Failed requests are never lost.

**NEW in v1.1.0**: Automatic API interception - automatically intercepts `fetch()` calls and queues them when offline! No code changes needed.

📹 **Demo Video**: [Watch on YouTube](https://www.youtube.com/watch?v=Gs1bcV6Zw3k)

## Changelog

### v1.1.0 (Latest)
- ✨ **NEW**: Automatic API interception - intercepts `fetch()` calls automatically
- ✨ **NEW**: URL filtering for selective interception
- 🐛 Fixed dependency array issue in `useOfflineQueue` hook
- 📝 Enhanced debug logging for troubleshooting

### v1.0.0
- Initial release with manual queuing support
- Native network monitoring
- Progressive sync engine

## What it is NOT

- ❌ A full-featured database with relationships (like WatermelonDB)
- ❌ A general-purpose cache (like React Query cache)
- ❌ An ORM or database abstraction layer

## What it IS

- ✅ A reliable network operation queue
- ✅ Offline-first request persistence
- ✅ Progressive sync engine
- ✅ Failure persistence and retry logic
- ✅ Custom native network monitoring (no external dependencies)
- ✅ **Automatic API interception** - Automatically intercepts `fetch()` calls and queues them when offline

## Installation

```bash
npm install react-native-sync-vault
# or
yarn add react-native-sync-vault
```

### Dependencies

The package requires the following peer dependencies (usually already installed in React Native projects):

```bash
# React and React Native (peer dependencies)
# These should already be in your project, but if not:
npm install react react-native

# The package uses react-native-nitro-sqlite for SQLite operations
# This is automatically installed as a dependency
```

**Note:** Make sure you have React Native 0.60+ for autolinking to work properly.

### iOS Setup

```bash
cd ios && pod install
```

### Android Setup

The library uses autolinking, so no additional Gradle configuration is needed. However, you must add the `ACCESS_NETWORK_STATE` permission to your `AndroidManifest.xml` for network monitoring to work:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <!-- ... other permissions ... -->
</manifest>
```

**Note:** The library gracefully handles cases where the permission is not granted, but network status will be reported as "unknown" in such cases.

## Native Network Monitoring

This library uses **custom native network monitoring** instead of third-party dependencies like `@react-native-community/netinfo`. This provides several benefits:

- ✅ **More reliable**: Direct access to native network APIs
- ✅ **No external dependencies**: Reduces bundle size and potential conflicts
- ✅ **Better performance**: Native implementations are faster and more efficient
- ✅ **Automatic detection**: Network status changes are automatically detected and synced

### How It Works

- **Android**: Uses `ConnectivityManager` to monitor network connectivity and capabilities
- **iOS**: Uses `SCNetworkReachability` / `Network.framework` to detect network reachability
- **Events**: Network status changes are emitted as events from native modules, triggering automatic sync when the device comes online

The library automatically detects when your device goes offline or comes back online and handles request queuing and syncing accordingly. No manual network status checking is required.

## Automatic API Interception (NEW!)

**The package now automatically intercepts `fetch()` calls!** When enabled, all `fetch()` calls are automatically intercepted and queued when the device is offline. No need to manually call `queue.push()` for every API call!

### Features

- ✅ **Zero-configuration**: Just enable it and all `fetch()` calls are automatically handled
- ✅ **URL filtering**: Only intercept requests to specific URLs (optional)
- ✅ **Automatic queuing**: Requests are queued when offline, executed when online
- ✅ **Seamless integration**: Works with existing code - no changes needed to your API calls

### How It Works

1. Enable automatic interception in your `useOfflineQueue` config
2. All `fetch()` calls are automatically intercepted
3. When offline: Requests are queued and return status 202 (Queued)
4. When online: Requests execute normally
5. Queued requests sync automatically when network is restored

## Quick Start

### Basic Usage (Manual Queuing)

```typescript
import { useOfflineQueue } from 'react-native-sync-vault';

function MyComponent() {
  const queue = useOfflineQueue('https://api.example.com');

  const handleSubmit = async () => {
    try {
      const requestId = await queue.push({
        method: 'POST',
        url: '/api/users',
        data: { name: 'John Doe', email: 'john@example.com' },
        priority: 1,
      });
      console.log('Request queued:', requestId);
    } catch (error) {
      console.error('Failed to queue request:', error);
    }
  };

  return (
    <Button onPress={handleSubmit} title="Submit" />
  );
}
```

### Automatic Interception (Recommended)

**NEW!** Enable automatic `fetch()` interception - no need to manually queue requests:

```typescript
import { useOfflineQueue } from 'react-native-sync-vault';

function MyComponent() {
  // Enable automatic interception
  const queue = useOfflineQueue({
    baseUrl: 'https://api.example.com',
    interceptor: {
      enabled: true,
      urlFilter: ['https://api.example.com'], // Optional: only intercept these URLs
    },
  });

  const handleSubmit = async () => {
    // Just use fetch() normally - it's automatically intercepted!
    try {
      const response = await fetch('https://api.example.com/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          name: 'John Doe', 
          email: 'john@example.com' 
        }),
      });

      if (response.status === 202) {
        // Request was queued (device is offline)
        console.log('Request queued for offline sync');
      } else {
        // Request executed normally (device is online)
        const data = await response.json();
        console.log('Request successful:', data);
      }
    } catch (error) {
      console.error('Request failed:', error);
    }
  };

  return (
    <Button onPress={handleSubmit} title="Submit" />
  );
}
```

**Benefits:**
- ✅ No code changes needed - use `fetch()` as usual
- ✅ Automatic offline handling
- ✅ Works with existing API code
- ✅ Optional URL filtering for selective interception

### Using Custom API Call Handler

By default, the library uses `fetch()` to make API calls. You can provide your own API call handler to use axios, custom fetch wrappers, or any other HTTP client:

```typescript
import { useOfflineQueue, ApiCallHandler, ApiCallResponse } from 'react-native-sync-vault';
import axios from 'axios';

function MyComponent() {
  // Define custom API call handler using axios
  const apiCallHandler: ApiCallHandler = async (request) => {
    try {
      const response = await axios({
        method: request.method as any,
        url: request.url,
        data: request.body,
        headers: request.headers,
        params: request.queryParams,
      });

      // Return response in standard format
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText || 'OK',
        json: async () => response.data,
        text: async () => JSON.stringify(response.data),
        headers: response.headers as Record<string, string>,
      };
    } catch (error: any) {
      // Handle axios errors
      if (error.response) {
        return {
          ok: false,
          status: error.response.status,
          statusText: error.response.statusText || 'Error',
          json: async () => error.response.data,
          text: async () => JSON.stringify(error.response.data),
          headers: error.response.headers as Record<string, string>,
        };
      }
      throw error;
    }
  };

  // Use custom handler
  const queue = useOfflineQueue({
    baseUrl: 'https://api.example.com',
    apiCallHandler,
  });

  const handleSubmit = async () => {
    try {
      const requestId = await queue.push({
        method: 'POST',
        url: '/api/users',
        data: { name: 'John Doe', email: 'john@example.com' },
      });
      console.log('Request queued:', requestId);
    } catch (error) {
      console.error('Failed to queue request:', error);
    }
  };

  return (
    <Button onPress={handleSubmit} title="Submit" />
  );
}
```

### Using Custom Fetch Wrapper

```typescript
import { useOfflineQueue, ApiCallHandler } from 'react-native-sync-vault';

// Your custom fetch wrapper
async function customFetch(url: string, options: RequestInit) {
  // Add authentication, logging, etc.
  const token = await getAuthToken();
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
  };
  
  return fetch(url, { ...options, headers });
}

function MyComponent() {
  const apiCallHandler: ApiCallHandler = async (request) => {
    const response = await customFetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body ? JSON.stringify(request.body) : undefined,
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      json: () => response.json(),
      text: () => response.text(),
      headers: Object.fromEntries(response.headers.entries()),
    };
  };

  const queue = useOfflineQueue({
    baseUrl: 'https://api.example.com',
    apiCallHandler,
  });

  // ... rest of component
}
```

### Using Hooks

```typescript
import {
  useOfflineQueue,
  useQueueStatus,
  usePendingRequests,
  useFailedRequests,
} from 'react-native-sync-vault';

function QueueStatus() {
  const { status, loading } = useQueueStatus();
  const { pendingRequests } = usePendingRequests();
  const { failedRequests, retry } = useFailedRequests();

  return (
    <View>
      <Text>Network: {status?.networkStatus}</Text>
      <Text>Pending: {status?.totalPending}</Text>
      <Text>Failed: {status?.totalFailed}</Text>
      
      {failedRequests.map((request) => (
        <View key={request.id}>
          <Text>{request.errorMessage}</Text>
          <Button onPress={() => retry(request.requestId)} title="Retry" />
        </View>
      ))}
    </View>
  );
}
```

## API Reference

### useOfflineQueue(baseUrlOrConfig?)

**Parameters:**
- `baseUrlOrConfig` (optional): Either a string (base URL) or an `OfflineQueueConfig` object:
  ```typescript
  interface OfflineQueueConfig {
    baseUrl?: string;
    apiCallHandler?: ApiCallHandler;
    interceptor?: InterceptorConfig;  // NEW: Automatic API interception
  }

  interface InterceptorConfig {
    enabled?: boolean;      // Enable automatic fetch() interception
    urlFilter?: string[];   // Optional: Only intercept URLs starting with these strings
  }
  ```

**Returns:**
```typescript
{
  push: (options: QueuePushOptions) => Promise<string>;
  getPendingRequests: (limit?: number, offset?: number) => Promise<QueuedRequest[]>;
  getFailedRequests: () => Promise<FailedRequest[]>;
  sync: () => Promise<void>;
}
```

**Examples:**

```typescript
// Simple usage with base URL string (backward compatible)
const queue = useOfflineQueue('https://api.example.com');

// Advanced usage with config object
const queue = useOfflineQueue({
  baseUrl: 'https://api.example.com',
  apiCallHandler: myCustomHandler,
});

// With automatic interception enabled
const queue = useOfflineQueue({
  baseUrl: 'https://api.example.com',
  interceptor: {
    enabled: true,
    urlFilter: ['https://api.example.com'], // Optional
  },
});
```

### ApiCallHandler

Custom function type for handling API calls. Allows you to use your own HTTP client instead of the default `fetch()`.

**Signature:**
```typescript
type ApiCallHandler = (request: ApiCallRequest) => Promise<ApiCallResponse>;

interface ApiCallRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any;
  queryParams?: Record<string, string>;
}

interface ApiCallResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<any>;
  text: () => Promise<string>;
  headers?: Record<string, string>;
}
```

**Example with axios:**
```typescript
const apiCallHandler: ApiCallHandler = async (request) => {
  const response = await axios({
    method: request.method as any,
    url: request.url,
    data: request.body,
    headers: request.headers,
    params: request.queryParams,
  });

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.statusText || 'OK',
    json: async () => response.data,
    text: async () => JSON.stringify(response.data),
    headers: response.headers as Record<string, string>,
  };
};
```

Main hook for queuing requests.

**Parameters:**
- `baseUrl` (optional): Base URL for API requests

**Returns:**
- `push(options)`: Queue a request
- `getPendingRequests(limit, offset)`: Get pending requests
- `getFailedRequests()`: Get failed requests
- `sync()`: Manually trigger sync

### queue.push(options)

Queue a request for offline/online processing.

**Options:**
```typescript
interface QueuePushOptions {
  method: string;                    // HTTP method (GET, POST, PUT, DELETE, etc.)
  url: string;                       // API endpoint
  data?: any;                        // Request body
  headers?: Record<string, string>;  // Custom headers
  queryParams?: Record<string, string>; // Query parameters
  priority?: number;                 // Priority (higher = processed first)
  maxRetries?: number;               // Maximum retry attempts (default: 3)
  conflictResolution?: 'client_wins' | 'server_wins' | 'manual_merge' | 'custom';
  customResolver?: (local: any, server: any) => any; // Custom conflict resolver
  metadata?: Record<string, any>;    // Custom metadata
}
```

**Returns:** Promise<string> - Request ID

### useQueueStatus()

Hook for real-time queue status.

**Returns:**
```typescript
{
  status: SyncStatus | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}
```

### usePendingRequests(limit?)

Hook for pending requests.

**Returns:**
```typescript
{
  pendingRequests: QueuedRequest[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}
```

### useFailedRequests()

Hook for failed requests with retry capability.

**Returns:**
```typescript
{
  failedRequests: FailedRequest[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  retry: (requestId: string) => Promise<void>;
}
```

## Conflict Resolution

The library supports multiple conflict resolution strategies:

### client_wins
Use local data, overwrite server.

```typescript
queue.push({
  method: 'PUT',
  url: '/api/users/1',
  data: { name: 'Updated Name' },
  conflictResolution: 'client_wins',
});
```

### server_wins
Use server data, discard local changes.

```typescript
queue.push({
  method: 'PUT',
  url: '/api/users/1',
  data: { name: 'Updated Name' },
  conflictResolution: 'server_wins',
});
```

### manual_merge
Store conflict for manual resolution.

```typescript
queue.push({
  method: 'PUT',
  url: '/api/users/1',
  data: { name: 'Updated Name' },
  conflictResolution: 'manual_merge',
});
```

### custom
Provide your own resolution function.

```typescript
queue.push({
  method: 'PUT',
  url: '/api/users/1',
  data: { name: 'Updated Name' },
  conflictResolution: 'custom',
  customResolver: (local, server) => {
    // Merge logic
    return { ...local, ...server, merged: true };
  },
});
```

## Performance Characteristics

The library is designed for minimal overhead:

- **Initialization time**: < 50ms
- **Memory overhead per request**: < 1KB
- **Enqueue time**: < 5ms
- **Batch sync time**: < 100ms per batch of 5 requests

See [benchmarks/performance.md](benchmarks/performance.md) for detailed metrics.

## Debug Tools

### Debug Screen

Visual debugger for queue status:

```typescript
import { DebugScreen } from 'react-native-sync-vault';

function App() {
  return (
    <View>
      <YourApp />
      {__DEV__ && <DebugScreen />}
    </View>
  );
}
```

### Queue Logger

Structured logging for development:

```typescript
import { QueueLogger } from 'react-native-sync-vault';

QueueLogger.info('Request queued', { requestId: '123' });
QueueLogger.error('Sync failed', { error: 'Network error' });

// Get logs
const logs = QueueLogger.getLogs();
const errors = QueueLogger.getLogsByLevel('error');
```

## Advanced Usage

### Automatic API Interception

The automatic interception feature allows you to use `fetch()` normally while the library handles offline queuing automatically.

#### Basic Setup

```typescript
const queue = useOfflineQueue({
  baseUrl: 'https://api.example.com',
  interceptor: {
    enabled: true,
  },
});

// Now all fetch() calls are automatically intercepted
await fetch('https://api.example.com/users');
```

#### URL Filtering

Only intercept specific URLs:

```typescript
const queue = useOfflineQueue({
  baseUrl: 'https://api.example.com',
  interceptor: {
    enabled: true,
    urlFilter: [
      'https://api.example.com',
      'https://cdn.example.com',
    ],
  },
});

// This will be intercepted
await fetch('https://api.example.com/users');

// This will NOT be intercepted (not in filter)
await fetch('https://other-api.com/data');
```

#### Behavior

- **When Online**: `fetch()` executes normally, returns actual response
- **When Offline**: `fetch()` is queued, returns status 202 with `{ queued: true }` response
- **When Back Online**: Queued requests sync automatically

#### Response Handling

```typescript
const response = await fetch('https://api.example.com/users');

if (response.status === 202) {
  // Request was queued (offline)
  const data = await response.json();
  console.log('Queued:', data.queued); // true
  console.log('Request ID:', data.requestId);
} else {
  // Request executed normally (online)
  const data = await response.json();
  console.log('Data:', data);
}
```

### Network Status Monitoring

The library automatically monitors network status using native implementations. Network status changes are detected in real-time and trigger automatic sync when the device comes online.

- **Online**: Requests are synced automatically when queued (if online) or when network becomes available
- **Offline**: Requests are queued locally and will sync when network is restored
- **Status Events**: Network status changes are emitted from native modules and handled internally

You don't need to manually check network status - the library handles everything automatically. However, you can access the current network status through the `useQueueStatus()` hook:

```typescript
const { status } = useQueueStatus();
console.log('Network status:', status?.networkStatus); // 'online' | 'offline' | 'unknown'
```

### Manual Sync Control

```typescript
const queue = useOfflineQueue('https://api.example.com');

// Manually trigger sync
await queue.sync();
```

### Performance Metrics

```typescript
import { performanceTracker } from 'react-native-sync-vault';

const metrics = await performanceTracker.getMetrics();
console.log('Initialization time:', metrics.initializationTime);
console.log('Average enqueue time:', metrics.averageEnqueueTime);
console.log('Average sync time:', metrics.averageSyncTime);
```

## Error Handling

The library categorizes errors automatically:

- **Network errors**: Retirable with exponential backoff
- **Server errors (5xx)**: Retirable
- **Client errors (4xx)**: Conditional retry (validation errors are permanent)
- **Conflicts (409)**: Special handling based on resolution strategy
- **Timeouts**: Retirable

## Turbo Module Migration

The library is designed to be Turbo Module compatible. Future migration will provide:

- Reduced bridge overhead
- Direct JSI bindings
- Improved performance

Migration guide will be provided when Turbo Modules are fully supported.

## Contributing

Contributions are welcome! Please read our contributing guidelines first.

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.


