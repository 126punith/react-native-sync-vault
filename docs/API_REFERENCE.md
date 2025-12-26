# API Reference

Complete API documentation for react-native-sync-vault.

## Table of Contents

- [Hooks](#hooks)
- [Types](#types)
- [Classes](#classes)
- [Utilities](#utilities)
- [Debug Tools](#debug-tools)

## Hooks

### `useOfflineQueue(baseUrlOrConfig?)`

Main hook for managing the offline queue.

**Parameters:**

```typescript
baseUrlOrConfig?: string | OfflineQueueConfig
```

- `string` (legacy): Base URL for API requests
- `OfflineQueueConfig` (recommended): Configuration object

**Configuration Object:**

```typescript
interface OfflineQueueConfig {
  baseUrl?: string;                    // Base URL for API requests
  apiCallHandler?: ApiCallHandler;     // Custom API call handler (axios, etc.)
  interceptor?: InterceptorConfig;     // Automatic fetch() interception
}

interface InterceptorConfig {
  enabled?: boolean;                   // Enable automatic interception
  urlFilter?: string[];                // URLs to intercept (allow list)
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
// Simple usage with base URL
const queue = useOfflineQueue('https://api.example.com');

// Advanced usage with configuration
const queue = useOfflineQueue({
  baseUrl: 'https://api.example.com',
  interceptor: {
    enabled: true,
    urlFilter: ['https://api.example.com'],
  },
});

// With custom API handler (axios)
const queue = useOfflineQueue({
  baseUrl: 'https://api.example.com',
  apiCallHandler: async (request) => {
    const response = await axios({
      method: request.method as any,
      url: request.url,
      data: request.body,
      headers: request.headers,
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.statusText || 'OK',
      json: async () => response.data,
      text: async () => JSON.stringify(response.data),
      headers: response.headers as Record<string, string>,
    };
  },
});
```

---

### `useQueueStatus(pollInterval?)`

Hook for monitoring queue status in real-time.

**Parameters:**

```typescript
pollInterval?: number  // Polling interval in milliseconds (default: 5000)
```

**Returns:**

```typescript
{
  status: SyncStatus | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}
```

**Status Object:**

```typescript
interface SyncStatus {
  id: number;
  lastSyncAt?: number;
  syncInProgress: boolean;
  totalPending: number;
  totalFailed: number;
  lastError?: string;
  networkStatus: NetworkStatus;
  syncBatchSize: number;
  syncIntervalMs: number;
  totalSynced: number;
  totalErrors: number;
  updatedAt: number;
}
```

**Example:**

```typescript
function QueueStatusDisplay() {
  const { status, loading } = useQueueStatus();

  if (loading) return <Text>Loading...</Text>;

  return (
    <View>
      <Text>Network: {status?.networkStatus}</Text>
      <Text>Pending: {status?.totalPending}</Text>
      <Text>Failed: {status?.totalFailed}</Text>
      <Text>Syncing: {status?.syncInProgress ? 'Yes' : 'No'}</Text>
    </View>
  );
}
```

---

### `usePendingRequests(limit?, pollInterval?)`

Hook for accessing pending requests.

**Parameters:**

```typescript
limit?: number         // Maximum number of requests to fetch (default: 10)
pollInterval?: number  // Polling interval in milliseconds (default: 5000)
```

**Returns:**

```typescript
{
  pendingRequests: QueuedRequest[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}
```

**Example:**

```typescript
function PendingRequestsList() {
  const { pendingRequests, loading } = usePendingRequests(20);

  if (loading) return <Text>Loading...</Text>;

  return (
    <FlatList
      data={pendingRequests}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <View>
          <Text>{item.method} {item.url}</Text>
          <Text>Priority: {item.priority}</Text>
          <Text>Created: {new Date(item.createdAt).toLocaleString()}</Text>
        </View>
      )}
    />
  );
}
```

---

### `useFailedRequests(pollInterval?)`

Hook for accessing failed requests with retry capability.

**Parameters:**

```typescript
pollInterval?: number  // Polling interval in milliseconds (default: 5000)
```

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

**Example:**

```typescript
function FailedRequestsList() {
  const { failedRequests, retry } = useFailedRequests();

  return (
    <View>
      {failedRequests.map((request) => (
        <View key={request.id}>
          <Text>Error: {request.errorMessage}</Text>
          <Text>Type: {request.failureType}</Text>
          <Text>Will Retry: {request.willRetry ? 'Yes' : 'No'}</Text>
          {request.nextRetryAt && (
            <Text>
              Next Retry: {new Date(request.nextRetryAt).toLocaleString()}
            </Text>
          )}
          <Button
            title="Retry"
            onPress={() => retry(request.requestId)}
          />
        </View>
      ))}
    </View>
  );
}
```

---

## Queue Methods

### `queue.push(options)`

Queue a request for offline/online processing.

**Parameters:**

```typescript
interface QueuePushOptions {
  method: string;                    // HTTP method (GET, POST, PUT, DELETE, PATCH, etc.)
  url: string;                       // API endpoint (relative or absolute)
  data?: any;                        // Request body (will be JSON stringified)
  headers?: Record<string, string>;  // Custom headers
  queryParams?: Record<string, string>; // Query parameters
  priority?: number;                 // Priority (higher = processed first, default: 0)
  maxRetries?: number;               // Maximum retry attempts (default: 3)
  conflictResolution?: ConflictResolutionStrategy;
  customResolver?: (local: any, server: any) => any;
  metadata?: Record<string, any>;    // Custom metadata
}
```

**Returns:** `Promise<string>` - Request ID

**Example:**

```typescript
const queue = useOfflineQueue('https://api.example.com');

// Simple POST request
const requestId = await queue.push({
  method: 'POST',
  url: '/api/users',
  data: { name: 'John Doe', email: 'john@example.com' },
});

// Request with priority and custom retry
const highPriorityId = await queue.push({
  method: 'PUT',
  url: '/api/users/123',
  data: { name: 'Updated Name' },
  priority: 10,        // High priority
  maxRetries: 5,       // Retry up to 5 times
  headers: {
    'Authorization': 'Bearer token',
    'Content-Type': 'application/json',
  },
});

// Request with conflict resolution
const conflictAwareId = await queue.push({
  method: 'PUT',
  url: '/api/users/123',
  data: { name: 'Updated' },
  conflictResolution: 'client_wins',  // Use local data
});

// Request with custom conflict resolver
const customResolverId = await queue.push({
  method: 'PUT',
  url: '/api/users/123',
  data: { name: 'Updated' },
  conflictResolution: 'custom',
  customResolver: (local, server) => {
    // Merge local and server data
    return { ...local, ...server, merged: true };
  },
});
```

---

### `queue.getPendingRequests(limit?, offset?)`

Get pending requests from the queue.

**Parameters:**

```typescript
limit?: number   // Maximum number of requests (default: 10)
offset?: number  // Offset for pagination (default: 0)
```

**Returns:** `Promise<QueuedRequest[]>`

**Example:**

```typescript
const queue = useOfflineQueue('https://api.example.com');

// Get first 10 pending requests
const requests = await queue.getPendingRequests(10, 0);

// Get next 10 (pagination)
const nextPage = await queue.getPendingRequests(10, 10);
```

---

### `queue.getFailedRequests()`

Get all failed requests.

**Returns:** `Promise<FailedRequest[]>`

**Example:**

```typescript
const queue = useOfflineQueue('https://api.example.com');
const failed = await queue.getFailedRequests();

failed.forEach((request) => {
  console.log('Failed:', request.errorMessage);
  console.log('Type:', request.failureType);
  console.log('Will Retry:', request.willRetry);
});
```

---

### `queue.sync()`

Manually trigger synchronization of pending requests.

**Returns:** `Promise<void>`

**Example:**

```typescript
const queue = useOfflineQueue('https://api.example.com');

// Manually trigger sync
await queue.sync();
```

---

## Types

### `QueuePushOptions`

Options for queuing a request.

```typescript
interface QueuePushOptions {
  method: string;
  url: string;
  data?: any;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  priority?: number;
  maxRetries?: number;
  conflictResolution?: ConflictResolutionStrategy;
  customResolver?: (local: any, server: any) => any;
  metadata?: Record<string, any>;
}
```

### `QueuedRequest`

Structure of a queued request.

```typescript
interface QueuedRequest {
  id: string;
  requestId?: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
  queryParams?: Record<string, string>;
  status: RequestStatus;
  priority: number;
  createdAt: number;
  updatedAt: number;
  lastAttemptAt?: number;
  syncedAt?: number;
  attemptCount: number;
  maxRetries: number;
  retryAfter?: number;
  localDataId?: string;
  serverResponse?: any;
  conflictData?: any;
  conflictResolution?: ConflictResolutionStrategy;
  metadata?: Record<string, any>;
}
```

### `FailedRequest`

Structure of a failed request.

```typescript
interface FailedRequest {
  id: string;
  requestId: string;
  errorCode?: string;
  errorMessage: string;
  errorDetails?: any;
  willRetry: boolean;
  nextRetryAt?: number;
  failureType: FailureType;
  isPermanent: boolean;
  createdAt: number;
  updatedAt: number;
}
```

### `SyncStatus`

Current sync status.

```typescript
interface SyncStatus {
  id: number;
  lastSyncAt?: number;
  syncInProgress: boolean;
  totalPending: number;
  totalFailed: number;
  lastError?: string;
  networkStatus: NetworkStatus;
  syncBatchSize: number;
  syncIntervalMs: number;
  totalSynced: number;
  totalErrors: number;
  updatedAt: number;
}
```

### `RequestStatus`

Status of a request.

```typescript
type RequestStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';
```

### `NetworkStatus`

Network connectivity status.

```typescript
type NetworkStatus = 'online' | 'offline' | 'unknown';
```

### `FailureType`

Type of failure.

```typescript
type FailureType = 'network' | 'server' | 'timeout' | 'validation' | 'conflict' | 'unknown';
```

### `ConflictResolutionStrategy`

Strategy for resolving conflicts.

```typescript
type ConflictResolutionStrategy = 
  | 'client_wins'    // Use local data, overwrite server
  | 'server_wins'    // Use server data, discard local changes
  | 'manual_merge'   // Store conflict for manual resolution
  | 'custom';        // Use custom resolver function
```

### `ApiCallHandler`

Custom function for making API calls.

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

---

## Classes

### `OfflineQueue` (QueueManager)

Main queue manager class. Usually accessed via `useOfflineQueue` hook.

**Note:** Direct instantiation is not recommended. Use the hook instead.

### `SyncEngine`

Sync engine for processing queued requests. Handled internally.

**Note:** Not part of public API. Use hooks for queue management.

### `NetworkMonitor`

Network status monitor. Handled internally.

**Note:** Not part of public API. Use `useQueueStatus` hook to access network status.

### `ConflictResolver`

Conflict resolution handler. Used internally.

**Note:** Configure conflict resolution via `queue.push()` options.

### `ApiInterceptor`

Automatic fetch() interceptor. Configured via `useOfflineQueue` config.

**Note:** Use via `useOfflineQueue` config, not directly.

---

## Utilities

### `performanceTracker`

Performance metrics tracker.

**Methods:**

```typescript
interface PerformanceTracker {
  trackInitialization(startTime: number): void;
  trackEnqueue(startTime: number): void;
  trackSync(startTime: number): void;
  getMetrics(): Promise<PerformanceMetrics>;
  resetMetrics(): Promise<void>;
}
```

**Example:**

```typescript
import { performanceTracker } from 'react-native-sync-vault';

const metrics = await performanceTracker.getMetrics();
console.log('Initialization time:', metrics.initializationTime);
console.log('Average enqueue time:', metrics.averageEnqueueTime);
console.log('Average sync time:', metrics.averageSyncTime);
```

---

## Debug Tools

### `DebugScreen`

Visual debugger component for queue status.

**Example:**

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

### `QueueLogger`

Structured logging for development.

**Methods:**

```typescript
QueueLogger.info(message: string, data?: any): void;
QueueLogger.warn(message: string, data?: any): void;
QueueLogger.error(message: string, data?: any): void;
QueueLogger.getLogs(): LogEntry[];
QueueLogger.getLogsByLevel(level: 'info' | 'warn' | 'error'): LogEntry[];
QueueLogger.clearLogs(): void;
```

**Example:**

```typescript
import { QueueLogger } from 'react-native-sync-vault';

QueueLogger.info('Request queued', { requestId: '123' });
QueueLogger.error('Sync failed', { error: 'Network error' });

// Get logs
const logs = QueueLogger.getLogs();
const errors = QueueLogger.getLogsByLevel('error');
```

---

## Error Handling

All methods that return Promises may throw errors. Always use try-catch:

```typescript
try {
  const requestId = await queue.push({
    method: 'POST',
    url: '/api/users',
    data: { name: 'John' },
  });
} catch (error) {
  console.error('Failed to queue request:', error);
  // Handle error appropriately
}
```

See [Error Handling Guide](./ERROR_HANDLING.md) for detailed error handling patterns.

---

## Best Practices

1. **Use Hooks**: Prefer hooks over direct class instantiation
2. **Handle Errors**: Always wrap async operations in try-catch
3. **Monitor Status**: Use `useQueueStatus` to monitor queue health
4. **Handle Failures**: Use `useFailedRequests` to show and retry failed requests
5. **Set Priorities**: Use priority for important requests
6. **Configure Retries**: Set appropriate `maxRetries` for your use case
7. **Use Interceptor**: Enable automatic interception for seamless offline support

---

## See Also

- [Migration Guide](./MIGRATION.md)
- [Error Handling Guide](./ERROR_HANDLING.md)
- [API Stability Policy](./API_STABILITY.md)
- [README](../README.md)


