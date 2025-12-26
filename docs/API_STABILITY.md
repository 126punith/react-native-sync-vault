# API Stability Policy

This document outlines the API stability guarantees for react-native-sync-vault.

## Versioning Strategy

We follow [Semantic Versioning](https://semver.org/):
- **MAJOR** (x.0.0): Breaking changes
- **MINOR** (x.y.0): New features, backward compatible
- **PATCH** (x.y.z): Bug fixes, backward compatible

## Stability Levels

### Stable APIs (v1.0.0+)

These APIs are considered stable and will maintain backward compatibility within the same major version:

#### Core Hooks
- `useOfflineQueue(baseUrlOrConfig?)` - Main hook for queue management
- `useQueueStatus()` - Hook for queue status
- `usePendingRequests(limit?)` - Hook for pending requests
- `useFailedRequests()` - Hook for failed requests

#### Queue Methods
- `queue.push(options)` - Queue a request
- `queue.getPendingRequests(limit?, offset?)` - Get pending requests
- `queue.getFailedRequests()` - Get failed requests
- `queue.sync()` - Manually trigger sync

#### Types
- `QueuePushOptions` - Options for queuing requests
- `QueuedRequest` - Queued request structure
- `FailedRequest` - Failed request structure
- `SyncStatus` - Sync status structure
- `NetworkStatus` - Network status type
- `ConflictResolutionStrategy` - Conflict resolution strategies

### Experimental APIs

These APIs may change in future versions:

- `ApiInterceptor` - Direct interceptor access (use via `useOfflineQueue` config instead)
- `NetworkMonitor` - Direct network monitor access (use hooks instead)
- `SyncEngine` - Direct sync engine access (use hooks instead)
- `ConflictResolver` - Direct conflict resolver access (use via `queue.push` options)

### Deprecated APIs

When APIs are deprecated:
1. They will be marked with `@deprecated` JSDoc tags
2. Deprecation warnings will be logged in development
3. Deprecated APIs will be removed in the next major version
4. Migration guides will be provided

## Breaking Changes Policy

### What Constitutes a Breaking Change

- Removing public APIs
- Changing function signatures (parameters, return types)
- Changing behavior in ways that break existing code
- Removing or changing TypeScript types
- Changing default values that affect behavior

### What Does NOT Constitute a Breaking Change

- Adding new optional parameters
- Adding new methods/properties
- Performance improvements
- Bug fixes that correct unintended behavior
- Internal implementation changes
- Adding new types (as long as existing types remain)

## Migration Path

### Major Version Upgrades

When upgrading to a new major version:

1. **Check the CHANGELOG.md** for breaking changes
2. **Review migration guide** (if provided)
3. **Update your code** according to the migration guide
4. **Test thoroughly** before deploying

### Minor/Patch Upgrades

Minor and patch versions are backward compatible. You can upgrade safely, but:

1. **Review CHANGELOG.md** for new features and bug fixes
2. **Test your application** to ensure compatibility
3. **Take advantage of new features** as needed

## API Lifecycle

```
Experimental → Stable → Deprecated → Removed
     ↓            ↓          ↓           ↓
   v0.x.x      v1.0.0+    v2.0.0+     v3.0.0+
```

### Experimental Phase
- APIs may change without notice
- Not recommended for production
- Feedback welcome

### Stable Phase
- APIs maintain backward compatibility
- Changes only in major versions
- Recommended for production

### Deprecated Phase
- APIs still work but will be removed
- Migration path provided
- Deprecation warnings in development

### Removed Phase
- APIs no longer available
- Must migrate to new APIs

## TypeScript Support

- TypeScript types are considered part of the public API
- Type changes follow the same stability guarantees
- Breaking type changes only in major versions

## Native Module APIs

Native module methods are considered internal implementation details:
- Direct access to native modules is not part of the public API
- Native module changes don't constitute breaking changes
- Use the JavaScript/TypeScript APIs instead

## Examples

### ✅ Safe to Use (Stable)

```typescript
import { useOfflineQueue } from 'react-native-sync-vault';

const queue = useOfflineQueue('https://api.example.com');
await queue.push({
  method: 'POST',
  url: '/api/users',
  data: { name: 'John' }
});
```

### ⚠️ Use with Caution (Experimental)

```typescript
import { ApiInterceptor } from 'react-native-sync-vault';

// Direct access - may change in future versions
const interceptor = new ApiInterceptor();
```

### ❌ Avoid (Deprecated/Removed)

```typescript
// Old API - no longer available
const queue = useOfflineQueue({ baseUrl: '...', legacyMode: true });
```

## Feedback

If you have concerns about API stability or suggestions for improvements:

1. Open an issue with the `api-stability` label
2. Discuss in GitHub Discussions
3. Propose changes via Pull Request

## Current Version: v1.1.0

All APIs introduced in v1.0.0 and v1.1.0 are considered stable, except where marked as experimental.

