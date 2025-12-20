# Performance Benchmarks

This document tracks performance metrics for react-native-offline-queue.

## Target Metrics

- **Initialization time**: < 50ms
- **Memory overhead per queued request**: < 1KB
- **Enqueue time**: < 5ms
- **Batch sync time**: < 100ms per batch of 5 requests

## Baseline Metrics

### Initialization

- **Target**: < 50ms
- **Current**: TBD (measured during first initialization)
- **Notes**: Includes database initialization and schema setup

### Memory Overhead

- **Target**: < 1KB per queued request
- **Current**: TBD
- **Notes**: Includes request metadata, headers, body, and status information

### Enqueue Operation

- **Target**: < 5ms
- **Current**: TBD
- **Notes**: Time to queue a request and persist to SQLite

### Sync Operation

- **Target**: < 100ms per batch of 5 requests
- **Current**: TBD
- **Notes**: Time to process a batch of requests (network time excluded)

## Performance Tracking

Performance metrics are tracked automatically and can be accessed via:

```typescript
import { performanceTracker } from 'react-native-offline-queue';

const metrics = await performanceTracker.getMetrics();
console.log('Initialization time:', metrics.initializationTime);
console.log('Average enqueue time:', metrics.averageEnqueueTime);
console.log('Average sync time:', metrics.averageSyncTime);
```

## Optimization Strategies

1. **Database Indexes**: All frequently queried columns are indexed
2. **Batch Operations**: Multiple database operations are batched when possible
3. **Efficient Serialization**: JSON serialization is optimized
4. **Progressive Sync**: Requests are processed in batches to avoid blocking

## Future Optimizations

- Turbo Module migration for reduced bridge overhead
- JSI bindings for direct native access
- Connection pooling for database operations
- Request deduplication optimization

## Testing

Run performance benchmarks:

```bash
npm run test:performance
```

## CI Integration

Performance regression tests are run in CI to catch performance degradation.


