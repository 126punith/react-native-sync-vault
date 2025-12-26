# react-native-sync-vault

[![npm version](https://img.shields.io/npm/v/react-native-sync-vault?style=for-the-badge&logo=npm&color=cb3837)](https://www.npmjs.com/package/react-native-sync-vault)
[![total downloads](https://img.shields.io/npm/dt/react-native-sync-vault?style=for-the-badge&logo=npm&color=cb3837)](https://www.npmjs.com/package/react-native-sync-vault)
[![weekly downloads](https://img.shields.io/npm/dw/react-native-sync-vault?style=for-the-badge&logo=npm&color=cb3837)](https://www.npmjs.com/package/react-native-sync-vault)

A reliable offline-first sync vault for persistent network operations in React Native. Queue API requests offline, persist them in SQLite, and progressively sync when online. Failed requests are never lost.

**NEW in v1.2.0+**: 
- ✨ Automatic API interception - intercepts `fetch()` and `axios()` calls automatically
- ⚡ Event-based reactive updates - hooks use event listeners instead of polling
- 🧠 Smart caching with intelligent invalidation
- 🔋 Resource-aware sync (battery & network quality)
- 🔄 Background sync guarantees
- 🎨 Pre-built UI components
- 📊 Sync metrics & dashboard
- 🔌 Basic integrations (React Query, Zustand, Redux) - *Note: Basic adapters, manual integration required*

📹 **Demo Video**: [Watch on YouTube](https://www.youtube.com/watch?v=Gs1bcV6Zw3k)

## Quick Start

```bash
# Install
npm install react-native-sync-vault

# Setup (optional - automated setup tool)
npx sync-vault-init
```

```typescript
import { useOfflineQueue } from 'react-native-sync-vault';

function MyComponent() {
  const queue = useOfflineQueue({
    baseUrl: 'https://api.example.com',
    interceptor: { enabled: true }, // Automatically intercept fetch()
  });

  const handleSubmit = async () => {
    // Just use fetch() - automatically queued if offline!
    const response = await fetch('https://api.example.com/api/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'John' }),
    });
  };
}
```

## What it is NOT

- ❌ A full-featured database with relationships (like WatermelonDB)
- ❌ A general-purpose cache (like React Query cache)
- ❌ An ORM or database abstraction layer
- ❌ A state management library (like Redux or Zustand)
- ❌ A polling-based system - uses event-driven architecture

## What it IS

- ✅ A reliable network operation queue
- ✅ Offline-first request persistence
- ✅ Progressive sync engine
- ✅ Failure persistence and retry logic
- ✅ Custom native network monitoring (no external dependencies)
- ✅ **Automatic API interception** - Automatically intercepts `fetch()` and `axios()` calls and queues them when offline
- ✅ **Event-based reactive updates** - Hooks use event listeners for instant UI updates without polling
- ✅ Smart caching with intelligent invalidation
- ✅ Resource-aware sync (battery & network quality detection)

## Features

### Core Features
- ✅ **Offline Request Queue** - Queue API requests when offline
- ✅ **Automatic API Interception** - Intercepts `fetch()` calls automatically
- ✅ **SQLite Persistence** - Requests persisted in native SQLite
- ✅ **Progressive Sync** - Automatic sync when network is restored
- ✅ **Conflict Resolution** - Built-in conflict resolution strategies
- ✅ **Retry Logic** - Automatic retry with exponential backoff
- ✅ **Native Network Monitoring** - No external dependencies

### Smart Caching
- ✅ **Intelligent Cache** - Per-endpoint TTL strategies
- ✅ **Pattern-Based Invalidation** - Automatic cache invalidation on mutations
- ✅ **Stale-While-Revalidate** - Return cached data while fetching fresh
- ✅ **Multiple Cache Strategies** - Cache-first, network-first, stale-while-revalidate

### Resource-Aware Sync
- ✅ **Battery Monitoring** - Reduces sync when battery is low
- ✅ **Network Quality Detection** - Defers large uploads on cellular
- ✅ **Priority-Based Queue** - Critical items sync first
- ✅ **Dynamic Batch Sizing** - Adjusts based on available resources

### Background Sync
- ✅ **Background Guarantees** - Sync survives app kill
- ✅ **Task Scheduling** - Platform-specific background tasks (iOS/Android)
- ✅ **Retry Policies** - Configurable retry with exponential backoff

### Developer Experience
- ✅ **React Hooks** - Easy-to-use React hooks
- ✅ **UI Components** - Pre-built offline status indicators
- ✅ **Offline-Ready Hooks** - React Query-like API (`useOfflineQuery`, `useOfflineMutation`)
- ✅ **Sync Metrics** - Track cache hit rates, sync success, and performance
- ✅ **Debug Tools** - Built-in debug screen, logger, and dashboard
- ✅ **TypeScript** - Full TypeScript support

### Integrations
- ⚠️ **React Query** - Basic adapter hook (manual integration required)
- ⚠️ **Zustand** - Basic hook to add sync vault to store (manual usage)
- ✅ **Redux** - Middleware for queuing Redux actions with API metadata

## Documentation

- 📚 [API Reference](docs/API_REFERENCE.md) - Complete API documentation
- 🔄 [Migration Guide](docs/MIGRATION.md) - Migrate from other solutions
- ⚡ [Performance Benchmarks](docs/PERFORMANCE_BENCHMARKS.md) - Performance metrics
- 🛠️ [Error Handling](docs/ERROR_HANDLING.md) - Error handling guide
- 📋 [API Stability](docs/API_STABILITY.md) - API stability policy
- 🚀 [Examples](examples/) - Example applications

## Installation

```bash
npm install react-native-sync-vault
# or
yarn add react-native-sync-vault
```

### iOS Setup

```bash
cd ios && pod install
```

### Android Setup

Add network permission to `AndroidManifest.xml`:

```xml
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

**Note:** The library uses autolinking, so no additional Gradle configuration is needed.

## Usage

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

  return <Button onPress={handleSubmit} title="Submit" />;
}
```

### Automatic Interception (Recommended)

Enable automatic `fetch()` and `axios()` interception - no need to manually queue requests. Queued requests automatically trigger events for reactive UI updates.

```typescript
import { useOfflineQueue } from 'react-native-sync-vault';
import axios from 'axios';

function MyComponent() {
  // Enable automatic interception for both fetch() and axios()
  const queue = useOfflineQueue({
    baseUrl: 'https://api.example.com',
    interceptor: {
      enabled: true, // Enable fetch() interception
      urlFilter: ['https://api.example.com'], // Optional: only intercept these URLs
      axios: {
        enabled: true, // Enable axios() interception
        // instance: axios, // Optional: use custom axios instance
      },
    },
  });

  const handleSubmitWithFetch = async () => {
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
        // Events are automatically emitted: queue:request:added
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

  const handleSubmitWithAxios = async () => {
    // Just use axios() normally - it's automatically intercepted!
    try {
      const response = await axios.post('https://api.example.com/api/users', {
        name: 'John Doe',
        email: 'john@example.com'
      });

      if (response.status === 202) {
        // Request was queued (device is offline)
        // Events are automatically emitted: queue:request:added
        console.log('Request queued for offline sync');
      } else {
        // Request executed normally (device is online)
        console.log('Request successful:', response.data);
      }
    } catch (error: any) {
      // Check if it's a queued error
      if (error.isQueued && error.status === 202) {
        console.log('Request queued for offline sync', error.requestId);
      } else {
        console.error('Request failed:', error);
      }
    }
  };

  return (
    <View>
      <Button onPress={handleSubmitWithFetch} title="Submit with Fetch" />
      <Button onPress={handleSubmitWithAxios} title="Submit with Axios" />
    </View>
  );
}
```

**Note:** All hooks (`useQueueStatus`, `usePendingRequests`, `useFailedRequests`) use event listeners for reactive updates. When requests are queued via interception, events are automatically emitted and your UI updates immediately - no polling required!

### Monitor Queue Status

All status hooks use **event-based reactive updates** instead of polling. When requests are queued (via `fetch()`, `axios()`, or manual `queue.push()`), events are automatically emitted and your UI updates immediately.

```typescript
import { useQueueStatus, usePendingRequests, useFailedRequests } from 'react-native-sync-vault';
import axios from 'axios';

function QueueStatus() {
  const { status, loading } = useQueueStatus();
  const { pendingRequests } = usePendingRequests();
  const { failedRequests, retry } = useFailedRequests();

  // Example: When axios request is queued offline, events trigger automatically:
  // - queue:request:added event is emitted
  // - usePendingRequests hook updates reactively
  // - useQueueStatus hook updates reactively
  // No polling or manual refresh needed!

  const handleAxiosRequest = async () => {
    try {
      await axios.post('https://api.example.com/api/data', { name: 'Test' });
    } catch (error: any) {
      if (error.isQueued) {
        // Request was queued - UI will update automatically via events
        console.log('Request queued, UI will update automatically');
      }
    }
  };

  return (
    <View>
      <Text>Network: {status?.networkStatus}</Text>
      <Text>Pending: {status?.totalPending}</Text>
      <Text>Failed: {status?.totalFailed}</Text>
      
      {/* These lists update automatically when events are emitted */}
      {pendingRequests.map((request) => (
        <View key={request.id}>
          <Text>{request.method} {request.url}</Text>
        </View>
      ))}
      
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

**Event-Based Updates:** Hooks subscribe to events like `queue:request:added`, `queue:request:synced`, `queue:pending:changed`, and `sync:started` for instant, reactive updates without polling.

### Event System

The sync vault uses an event-based architecture for reactive updates. When requests are queued (via `fetch()`, `axios()`, or `queue.push()`), events are automatically emitted. All hooks subscribe to these events for instant UI updates.

**Available Events:**

- `queue:request:added` - Emitted when a request is added to the queue
- `queue:request:synced` - Emitted when a request is successfully synced
- `queue:request:failed` - Emitted when a request fails to sync
- `queue:status:changed` - Emitted when request status changes
- `queue:pending:changed` - Emitted when pending requests list changes
- `queue:failed:changed` - Emitted when failed requests list changes
- `sync:started` - Emitted when sync process starts
- `sync:completed` - Emitted when sync process completes
- `sync:failed` - Emitted when sync process fails
- `sync:batch:completed` - Emitted when a sync batch completes

**Listening to Events Directly:**

```typescript
import QueueManager from 'react-native-sync-vault';

// Listen to events
QueueManager.on('queue:request:added', ({ requestId, request }) => {
  console.log('Request queued:', requestId, request.method, request.url);
});

QueueManager.on('queue:request:synced', ({ requestId }) => {
  console.log('Request synced:', requestId);
});

QueueManager.on('sync:started', () => {
  console.log('Sync started');
});

QueueManager.on('sync:completed', () => {
  console.log('Sync completed');
});

// Clean up listeners
QueueManager.off('queue:request:added', handler);
```

**Note:** Hooks automatically subscribe to these events, so you typically don't need to listen directly unless you're building custom integrations.

### Smart Caching

Enable intelligent caching with per-endpoint strategies:

```typescript
import { useOfflineQueue } from 'react-native-sync-vault';

function MyComponent() {
  const queue = useOfflineQueue({
    baseUrl: 'https://api.example.com',
    cache: {
      enabled: true,
      defaultTtl: 8 * 60 * 60, // 8 hours
      strategies: {
        '/api/assignments': { 
          ttl: 24 * 60 * 60, // 24h for critical data
          staleWhileRevalidate: true 
        },
      },
      invalidateOnMutate: {
        'POST /api/assignments': ['/api/assignments', '/api/assignments/*'],
      }
    }
  });

  // GET requests are automatically cached
  const response = await fetch('https://api.example.com/api/assignments');
}
```

### Resource-Aware Sync

Optimize sync based on device resources:

```typescript
import { useOfflineQueue } from 'react-native-sync-vault';

function MyComponent() {
  const queue = useOfflineQueue({
    baseUrl: 'https://api.example.com',
    resourceAware: {
      battery: { 
        lowThreshold: 20,
        action: 'defer_non_critical',
        criticalOnly: true
      },
      network: { 
        qualityAware: true,
        deferLargeUploadsOnCellular: true,
        maxPayloadSizeOnCellular: 100 * 1024 // 100KB
      }
    }
  });
}
```

### Background Sync Guarantees

Ensure critical operations complete even after app kill:

```typescript
import { useBackgroundSync } from 'react-native-sync-vault';

function MyComponent() {
  const { guarantee } = useBackgroundSync();

  const handleCriticalSubmit = async () => {
    await guarantee({
      taskId: 'submit-inspection-123',
      operation: () => queue.sync(),
      requiredNetwork: true,
      priority: 'high',
      retryPolicy: {
        maxAttempts: 3,
        backoff: 'exponential'
      }
    });
  };
}
```

### Offline-Ready Hooks (React Query-like API)

Use familiar React Query patterns:

```typescript
import { useOfflineQuery, useOfflineMutation } from 'react-native-sync-vault';

function MyComponent() {
  const { data, isLoading, isStale } = useOfflineQuery('/api/assignments', {
    ttl: 8 * 60 * 60 * 1000,
    staleWhileRevalidate: true
  });

  const { mutate, isPending } = useOfflineMutation({
    fn: (data) => fetch('/api/assignments', { 
      method: 'POST', 
      body: JSON.stringify(data) 
    }),
    invalidateOnSuccess: ['/api/assignments']
  });

  return (
    <View>
      {isLoading && <Text>Loading...</Text>}
      {data && <Text>{JSON.stringify(data)}</Text>}
      <Button onPress={() => mutate({ title: 'New Assignment' })} title="Create" />
    </View>
  );
}
```

### UI Components

Add pre-built UI components for offline status:

```typescript
import { 
  OfflineProvider, 
  OfflineStatusBar, 
  QueuedActionsBadge,
  SyncProgress 
} from 'react-native-sync-vault';

function App() {
  return (
    <OfflineProvider config={{ baseUrl: 'https://api.example.com' }}>
      <OfflineStatusBar position="top" />
      <YourAppContent />
      <QueuedActionsBadge />
      <SyncProgress />
    </OfflineProvider>
  );
}
```

### Sync Metrics

Track sync performance and health:

```typescript
import { useSyncMetrics } from 'react-native-sync-vault';

function MetricsDashboard() {
  const { metrics } = useSyncMetrics();

  return (
    <View>
      <Text>Queue Size: {metrics.queueSize}</Text>
      <Text>Cache Hit Rate: {metrics.cacheHitRate}%</Text>
      <Text>Sync Success Rate: {metrics.syncSuccessRate}%</Text>
      <Text>Average Sync Time: {metrics.averageSyncTime}ms</Text>
    </View>
  );
}
```

### Integrations

**⚠️ Important:** These integrations are basic adapters with limited functionality. They provide a starting point but require manual integration work for production use. Automatic mutation queuing, cache integration, and error handling are not included.

#### React Query Integration

**Status:** Basic adapter - returns separate `queryClient` and `queue` objects. Manual integration required.

The `useReactQueryWithSyncVault` hook returns both a QueryClient and queue instance, but they are not automatically connected. You'll need to manually integrate them:

```typescript
import { ReactQueryIntegration } from 'react-native-sync-vault/integrations';
import { useMutation, useQuery } from '@tanstack/react-query';

function MyComponent() {
  const { queryClient, queue } = ReactQueryIntegration.useReactQueryWithSyncVault({
    baseUrl: 'https://api.example.com'
  });

  // Manual integration example:
  // You need to wrap your mutations to use the queue
  const mutation = useMutation({
    mutationFn: async (data) => {
      // Check if offline and queue if needed
      if (!queue.networkMonitor?.isOnline()) {
        await queue.push({
          method: 'POST',
          url: '/api/todos',
          data
        });
        return { queued: true };
      }
      // Otherwise make normal API call
      return fetch('https://api.example.com/api/todos', {
        method: 'POST',
        body: JSON.stringify(data)
      }).then(r => r.json());
    }
  });

  // Note: Requires @tanstack/react-query to be installed
  // Note: The withSyncVault function is non-functional (only stores config)
}
```

**Limitations:**
- No automatic mutation queuing
- No cache integration between React Query and sync vault
- Manual error handling required

#### Zustand Integration

**Status:** Basic hook - adds sync vault to store state. Manual usage required.

**⚠️ Note:** The `withSyncVault` function is broken (violates React hooks rules) and should not be used. Only use `useZustandWithSyncVault`.

```typescript
import { create } from 'zustand';
import { ZustandIntegration } from 'react-native-sync-vault/integrations';

// Create your Zustand store
const useStore = create((set) => ({
  todos: [],
  addTodo: (todo) => set((state) => ({ todos: [...state.todos, todo] }))
}));

function MyComponent() {
  // Use the integration hook to get store state + syncVault
  const store = ZustandIntegration.useZustandWithSyncVault(useStore, {
    baseUrl: 'https://api.example.com'
  });

  // Access your store state plus syncVault
  // You'll need to manually use queue.push() for API calls
  const handleAddTodo = async (todo) => {
    store.addTodo(todo);
    
    // Manually queue API call
    await store.syncVault.queue.push({
      method: 'POST',
      url: '/api/todos',
      data: todo
    });
  };

  return (
    <View>
      {store.todos.map(todo => <Text key={todo.id}>{todo.text}</Text>)}
      <Button onPress={() => handleAddTodo({ id: 1, text: 'New' })} title="Add" />
      <Button onPress={() => store.syncVault.sync()} title="Sync" />
    </View>
  );
}
```

**Limitations:**
- No automatic API call queuing from store actions
- Manual queue management required
- The `withSyncVault` wrapper function is broken and should not be used

#### Redux Integration

**Status:** Functional - Basic middleware for queuing actions with API metadata.

This is the most functional integration. It automatically queues Redux actions that include API call metadata:

```typescript
import { createStore, applyMiddleware } from 'redux';
import { ReduxIntegration } from 'react-native-sync-vault/integrations';

const middleware = [
  ReduxIntegration.createSyncVaultMiddleware({ 
    baseUrl: 'https://api.example.com' 
  })
];

const store = createStore(reducer, applyMiddleware(...middleware));

// Actions with API call metadata will be queued when offline:
dispatch({
  type: 'CREATE_TODO',
  payload: { text: 'New todo' },
  meta: {
    apiCall: {
      method: 'POST',
      url: '/api/todos',
      data: { text: 'New todo' }
    },
    queueIfOffline: true
  }
});
```

**What it does:**
- Automatically queues actions with `meta.apiCall` and `meta.queueIfOffline: true`
- Works when device is offline

**Limitations:**
- Basic implementation - no automatic sync retry integration
- No automatic success/failure action dispatching
- Requires manual action metadata structure

## API Reference

See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for complete API documentation.

### Main Hooks

**Queue Management:**
- `useOfflineQueue(config?)` - Main hook for queue management
- `useQueueStatus()` - Monitor queue status (event-based reactive updates)
- `usePendingRequests(limit?)` - Get pending requests (event-based reactive updates)
- `useFailedRequests()` - Get failed requests with retry (event-based reactive updates)

**Caching:**
- `useCache(cacheManager?)` - Access cache operations
- `useSmartCache(config?)` - Smart cache with invalidation

**Offline-Ready:**
- `useOfflineQuery(key, options?)` - React Query-like query hook
- `useOfflineMutation(options?)` - React Query-like mutation hook

**Resource & Background:**
- `useResourceAwareSync(config?)` - Resource-aware sync configuration
- `useBackgroundSync()` - Background sync guarantees

**Metrics:**
- `useSyncMetrics()` - Sync performance metrics

### Queue Methods

- `queue.push(options)` - Queue a request
- `queue.getPendingRequests(limit?, offset?)` - Get pending requests
- `queue.getFailedRequests()` - Get failed requests
- `queue.sync()` - Manually trigger sync
- `queue.getCacheManager()` - Get cache manager instance

### UI Components

- `OfflineProvider` - Context provider for offline state
- `OfflineStatusBar` - Connection status indicator
- `QueuedActionsBadge` - Pending actions counter
- `SyncProgress` - Sync progress indicator

### Debug Tools

- `DebugScreen` - Built-in debug screen
- `QueueLogger` - Queue logging utility
- `SyncDashboard` - Sync metrics dashboard

### Integrations

**⚠️ Note:** All integrations are basic adapters with limited functionality. They require manual integration work for production use.

- `ReactQueryIntegration.useReactQueryWithSyncVault(config)` - Returns `{ queryClient, queue }` (manual integration required)
- `ZustandIntegration.useZustandWithSyncVault(store, config)` - Adds sync vault to Zustand store state (manual usage required)
- `ReduxIntegration.createSyncVaultMiddleware(config)` - Middleware for queuing Redux actions (functional, basic implementation)
- `ReduxIntegration.withSyncVault(reducer, config)` - Helper to set up Redux with sync vault middleware

**Note:** `ZustandIntegration.withSyncVault` is broken and should not be used. `ReactQueryIntegration.withSyncVault` is non-functional (only stores config).

## Examples

Check out the [examples directory](examples/) for complete example applications:

- **Todo App** - Complete offline-first todo management with automatic interception, caching, and error handling

## Performance

- **Initialization**: < 50ms
- **Enqueue time**: < 5ms
- **Memory overhead**: < 1KB per request
- **Batch sync**: < 100ms per batch of 5 requests
- **Cache lookup**: < 2ms
- **Cache hit rate**: 60-80% in typical usage

See [Performance Benchmarks](docs/PERFORMANCE_BENCHMARKS.md) for detailed metrics and comparisons.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT

## Support

- 📖 [Documentation](docs/)
- 🐛 [Report Issues](https://github.com/126punith/react-native-sync-vault/issues)
- 💬 [Discussions](https://github.com/126punith/react-native-sync-vault/discussions)
- 📧 Email: punithm300@gmail.com

---

**Made with ❤️ for the React Native community**
