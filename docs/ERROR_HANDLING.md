# Error Handling Guide

This document describes the error handling patterns used throughout react-native-sync-vault.

## Error Handling Philosophy

1. **Fail Gracefully**: Never crash the app due to queue/sync errors
2. **Log Clearly**: Provide detailed error information for debugging
3. **Recover Automatically**: Retry transient errors automatically
4. **Inform Users**: Surface errors appropriately in the UI

## Error Categories

### Network Errors
- **Type**: `network`
- **Retriable**: Yes (with exponential backoff)
- **Examples**: Connection timeout, DNS failure, no internet
- **Handling**: Automatically retried up to `maxRetries`

```typescript
// Network errors are automatically retried
await queue.push({
  method: 'POST',
  url: '/api/users',
  data: { name: 'John' },
  maxRetries: 3, // Will retry up to 3 times
});
```

### Server Errors (5xx)
- **Type**: `server`
- **Retriable**: Yes
- **Examples**: 500 Internal Server Error, 503 Service Unavailable
- **Handling**: Retried with exponential backoff

### Client Errors (4xx)
- **Type**: `validation` or `unknown`
- **Retriable**: Conditional
- **Examples**: 400 Bad Request, 401 Unauthorized, 404 Not Found
- **Handling**: 
  - Validation errors (400): Not retried (permanent failure)
  - Auth errors (401, 403): Not retried (requires user action)
  - Not found (404): Not retried (permanent failure)
  - Other 4xx: Evaluated case-by-case

### Conflict Errors (409)
- **Type**: `conflict`
- **Retriable**: Yes (with conflict resolution)
- **Examples**: 409 Conflict (version mismatch, concurrent updates)
- **Handling**: Resolved using configured conflict resolution strategy

```typescript
await queue.push({
  method: 'PUT',
  url: '/api/users/1',
  data: { name: 'Updated' },
  conflictResolution: 'client_wins', // or 'server_wins', 'manual_merge', 'custom'
});
```

### Timeout Errors
- **Type**: `timeout`
- **Retriable**: Yes
- **Examples**: Request timeout, connection timeout
- **Handling**: Retried with exponential backoff

## Error Handling Patterns

### Try-Catch in Critical Paths

All critical operations are wrapped in try-catch:

```typescript
try {
  const requestId = await queue.push(options);
  // Success
} catch (error) {
  // Error is logged and re-thrown for caller to handle
  console.error('Failed to queue request:', error);
  throw error;
}
```

### Graceful Degradation

When native modules are unavailable:

```typescript
if (!NativeModule) {
  console.warn('Native module not available');
  // Return safe default or throw descriptive error
  throw new Error('Native module required');
}
```

### Error Logging

Errors are logged with context:

```typescript
console.error('[QueueManager] Failed to queue request:', {
  error: error.message,
  request: { method, url },
  stack: error.stack,
});
```

## Error Recovery

### Automatic Retry

Failed requests are automatically retried:

1. **Exponential Backoff**: Delay increases with each attempt
2. **Max Retries**: Configurable per request (default: 3)
3. **Retry Conditions**: Only retriable errors are retried

```typescript
// Custom retry configuration
await queue.push({
  method: 'POST',
  url: '/api/users',
  data: { name: 'John' },
  maxRetries: 5, // Retry up to 5 times
});
```

### Manual Retry

Failed requests can be manually retried:

```typescript
const { failedRequests, retry } = useFailedRequests();

// Retry a specific failed request
await retry(failedRequests[0].requestId);
```

### Error States

Track error states in your UI:

```typescript
const { status } = useQueueStatus();

if (status?.totalFailed > 0) {
  // Show error indicator
  console.log('Failed requests:', status.totalFailed);
}
```

## Best Practices

### 1. Handle Errors in UI

```typescript
const handleSubmit = async () => {
  try {
    await queue.push({
      method: 'POST',
      url: '/api/users',
      data: formData,
    });
    showSuccess('Request queued successfully');
  } catch (error) {
    showError('Failed to queue request. Please try again.');
    console.error('Queue error:', error);
  }
};
```

### 2. Monitor Failed Requests

```typescript
const { failedRequests } = useFailedRequests();

useEffect(() => {
  if (failedRequests.length > 0) {
    // Notify user or log for monitoring
    console.warn('Failed requests detected:', failedRequests);
  }
}, [failedRequests]);
```

### 3. Provide User Feedback

```typescript
const { status } = useQueueStatus();

// Show sync status
if (status?.syncInProgress) {
  return <Text>Syncing...</Text>;
}

if (status?.totalFailed > 0) {
  return <Text>Some requests failed. Check failed requests.</Text>;
}
```

### 4. Handle Offline Scenarios

```typescript
const { status } = useQueueStatus();

if (status?.networkStatus === 'offline') {
  // Show offline indicator
  return <Text>You're offline. Requests will sync when online.</Text>;
}
```

## Error Types Reference

### QueuedRequest Errors
- **Queue Full**: Database storage limit reached
- **Invalid Request**: Malformed request data
- **Native Module Error**: Native module unavailable or failed

### Sync Errors
- **Network Unavailable**: Cannot sync (expected when offline)
- **Server Error**: Backend returned error
- **Conflict**: Data conflict detected
- **Timeout**: Request timed out

### Network Monitor Errors
- **Permission Denied**: Network permission not granted (Android)
- **Native Module Unavailable**: Network monitoring disabled

## Debugging Errors

### Enable Debug Logging

The library includes extensive debug logging:

```typescript
// Debug logs are automatically enabled in development
// Look for [DEBUG] prefixed logs in console
```

### Check Failed Requests

```typescript
const { failedRequests } = useFailedRequests();

failedRequests.forEach(request => {
  console.log('Failed request:', {
    id: request.requestId,
    error: request.errorMessage,
    type: request.failureType,
    willRetry: request.willRetry,
    nextRetryAt: request.nextRetryAt,
  });
});
```

### Use Debug Screen

```typescript
import { DebugScreen } from 'react-native-sync-vault';

// In development
{__DEV__ && <DebugScreen />}
```

## Common Error Scenarios

### Scenario 1: Native Module Not Found

**Error**: "Native module not available"

**Solution**: 
1. Rebuild the app: `cd ios && pod install && cd .. && npx react-native run-ios`
2. Check autolinking is enabled
3. Verify native modules are properly linked

### Scenario 2: Network Permission Denied (Android)

**Error**: Network status always "unknown"

**Solution**: Add permission to `AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

### Scenario 3: Requests Not Syncing

**Error**: Requests stay in pending state

**Solution**:
1. Check network status: `status.networkStatus`
2. Verify sync is running: `status.syncInProgress`
3. Manually trigger sync: `await queue.sync()`

### Scenario 4: Queuing Fails

**Error**: "Failed to queue request"

**Solution**:
1. Check database is initialized
2. Verify native module is available
3. Check request data is valid JSON
4. Review error logs for details

## Error Reporting

When reporting errors:

1. **Include Error Message**: Full error text
2. **Provide Context**: What operation failed
3. **Share Logs**: Relevant console logs
4. **Describe Environment**: React Native version, platform, device
5. **Reproduction Steps**: How to reproduce the error

## Summary

- ✅ Network errors: Automatically retried
- ✅ Server errors: Automatically retried
- ✅ Validation errors: Not retried (permanent)
- ✅ Conflicts: Resolved using strategy
- ✅ Timeouts: Automatically retried
- ✅ All errors: Logged with context
- ✅ Failed requests: Tracked and retriable

For more information, see:
- [API Reference](../README.md#api-reference)
- [Troubleshooting Guide](./TROUBLESHOOTING.md) (if created)
- [GitHub Issues](https://github.com/126punith/react-native-sync-vault/issues)


