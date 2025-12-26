# Migration Guide

This guide helps you migrate from other offline solutions or upgrade between versions of react-native-sync-vault.

## Table of Contents

- [Upgrading from Earlier Versions](#upgrading-from-earlier-versions)
- [Migrating from Other Solutions](#migrating-from-other-solutions)
- [Breaking Changes](#breaking-changes)

## Upgrading from Earlier Versions

### Upgrading to v1.1.0

v1.1.0 introduces automatic API interception. Existing code continues to work without changes.

**New Feature (Optional):**
```typescript
// Old way (still works)
const queue = useOfflineQueue('https://api.example.com');
await queue.push({ method: 'POST', url: '/api/users', data: {...} });

// New way (optional - automatic interception)
const queue = useOfflineQueue({
  baseUrl: 'https://api.example.com',
  interceptor: { enabled: true }
});
// Now fetch() calls are automatically intercepted
```

**No breaking changes** - all existing APIs remain compatible.

## Migrating from Other Solutions

### From @react-native-community/netinfo + Custom Queue

**Before:**
```typescript
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Manual network checking
const checkNetwork = async () => {
  const state = await NetInfo.fetch();
  return state.isConnected;
};

// Manual queue management
const queue = [];
const addToQueue = (request) => {
  queue.push(request);
  AsyncStorage.setItem('queue', JSON.stringify(queue));
};
```

**After:**
```typescript
import { useOfflineQueue } from 'react-native-sync-vault';

// Automatic network monitoring and queuing
const queue = useOfflineQueue('https://api.example.com');
await queue.push({ method: 'POST', url: '/api/users', data: {...} });
// Everything is handled automatically!
```

### From react-query with offline support

**Before:**
```typescript
import { useQuery, useMutation, onlineManager } from 'react-query';

// Complex offline setup
onlineManager.setEventListener(setOnline => {
  return NetInfo.addEventListener(state => {
    setOnline(state.isConnected);
  });
});

const { data } = useQuery('users', fetchUsers);
const mutation = useMutation(createUser);
```

**After:**
```typescript
import { useOfflineQueue } from 'react-native-sync-vault';

// Automatic offline handling
const queue = useOfflineQueue('https://api.example.com');
const response = await fetch('https://api.example.com/users');
// Automatically queued if offline, synced when online
```

### From Redux Persist + Custom Sync

**Before:**
```typescript
import { persistStore, persistReducer } from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';

const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
};

const persistedReducer = persistReducer(persistConfig, rootReducer);
// Manual sync logic needed
```

**After:**
```typescript
import { useOfflineQueue } from 'react-native-sync-vault';

// Queue handles persistence automatically
const queue = useOfflineQueue('https://api.example.com');
// Requests are persisted in SQLite, no additional setup needed
```

### From Custom Fetch Wrapper

**Before:**
```typescript
const offlineFetch = async (url, options) => {
  const isOnline = await checkNetwork();
  if (!isOnline) {
    // Store in AsyncStorage
    await storeOfflineRequest(url, options);
    return { status: 202, queued: true };
  }
  return fetch(url, options);
};
```

**After:**
```typescript
import { useOfflineQueue } from 'react-native-sync-vault';

const queue = useOfflineQueue({
  baseUrl: 'https://api.example.com',
  interceptor: { enabled: true }
});

// Just use fetch() - it's automatically intercepted!
const response = await fetch('https://api.example.com/api/users');
```

## Breaking Changes

### Version History

#### v1.1.0
- ✅ No breaking changes
- 🆕 Added automatic API interception
- 🆕 Added URL filtering for interceptors

#### v1.0.0
- Initial release
- No previous versions to migrate from

## Migration Checklist

When migrating from another solution:

- [ ] Remove old offline solution dependencies
- [ ] Install react-native-sync-vault
- [ ] Update imports
- [ ] Replace manual network checking with useOfflineQueue
- [ ] Replace manual queue management with queue.push()
- [ ] Test offline scenarios
- [ ] Test sync behavior
- [ ] Update error handling if needed
- [ ] Remove old persistence code (AsyncStorage, etc.)

## Need Help?

If you encounter issues during migration:

1. Check the [README](../README.md) for usage examples
2. Review the [API documentation](../README.md#api-reference)
3. Open an issue with the `question` label
4. Check existing issues for similar migration experiences

## Future Migration Notes

When the unified platform (react-native-offline-platform) is released:

- Migration scripts will be provided
- Detailed upgrade guides will be available
- Backward compatibility layer will support sync-vault API
- Gradual migration path will be documented


