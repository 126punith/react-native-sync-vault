# Todo App Example

A simple todo application demonstrating offline-first functionality with react-native-sync-vault.

## Features

- ✅ Create todos offline
- ✅ Update todos offline
- ✅ Delete todos offline
- ✅ Automatic sync when online
- ✅ Queue status monitoring
- ✅ Failed request handling

## Setup

```bash
cd examples/todo-app
npm install
cd ios && pod install && cd ..
```

## Run

```bash
# iOS
npx react-native run-ios

# Android
npx react-native run-android
```

## What It Demonstrates

1. **Basic Queue Usage**: Queue POST, PUT, DELETE requests
2. **Automatic Interception**: Uses fetch() interception for seamless offline support
3. **Status Monitoring**: Shows queue status in real-time
4. **Error Handling**: Displays and retries failed requests
5. **Priority Queuing**: Uses priorities for important operations

## Code Structure

```
todo-app/
├── src/
│   ├── components/
│   │   ├── TodoList.tsx      # Main todo list component
│   │   ├── TodoItem.tsx     # Individual todo item
│   │   └── QueueStatus.tsx  # Queue status display
│   ├── hooks/
│   │   └── useTodos.ts      # Custom hook for todos
│   └── App.tsx              # Main app component
└── README.md
```

## Key Code Snippets

### Queueing a Request

```typescript
const queue = useOfflineQueue({
  baseUrl: 'https://api.example.com',
  interceptor: { enabled: true },
});

// Just use fetch() - automatically queued if offline
await fetch('https://api.example.com/todos', {
  method: 'POST',
  body: JSON.stringify({ text: 'New todo' }),
});
```

### Monitoring Status

```typescript
const { status } = useQueueStatus();

console.log('Network:', status?.networkStatus);
console.log('Pending:', status?.totalPending);
console.log('Failed:', status?.totalFailed);
```

## Learn More

- [API Reference](../../docs/API_REFERENCE.md)
- [Migration Guide](../../docs/MIGRATION.md)
- [Main README](../../README.md)

