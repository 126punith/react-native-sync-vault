import { SyncVault } from '../core/SyncVault';
import type { EnqueueOptions, SyncEvent } from '../core/types';

type QueryKey = readonly unknown[];
type QueryClientLike = { invalidateQueries: (filters: { queryKey: QueryKey }) => unknown };

export interface QueuedMutationResult {
  queued: true;
  requestId: string;
}

/**
 * Builds a TanStack Query `mutationFn` that durably queues the request instead of sending it.
 *
 *   useMutation({ mutationFn: syncVaultMutationFn((todo) => ({ method: 'POST', url: '/todos', body: todo })) })
 */
export function syncVaultMutationFn<TVariables>(toRequest: (variables: TVariables) => EnqueueOptions) {
  return async (variables: TVariables): Promise<QueuedMutationResult> => {
    const requestId = await SyncVault.enqueue(toRequest(variables));
    return { queued: true, requestId };
  };
}

/**
 * Invalidates queries when queued requests are delivered. `queryKeysFor` receives the delivered
 * request's method and URL and returns the query keys it affects.
 */
export function withSyncVault<T extends QueryClientLike>(
  queryClient: T,
  queryKeysFor: (request: { method: string; url: string }) => QueryKey[]
): () => void {
  const pending = new Map<string, { method: string; url: string }>();
  return SyncVault.addEventListener(async (event: SyncEvent) => {
    if (!event.id) return;
    if (event.type === 'enqueued' || event.type === 'coalesced' || event.type === 'attempt') {
      if (!pending.has(event.id)) {
        const request = await SyncVault.getRequest(event.id);
        if (request) pending.set(event.id, { method: request.method, url: request.url });
      }
      return;
    }
    if (event.type === 'succeeded' || event.type === 'discarded' || event.type === 'dead_lettered') {
      let request = pending.get(event.id);
      pending.delete(event.id);
      if (event.type === 'succeeded' && !request) {
        // Delivered before the lookup above finished; succeeded rows stay readable until purged.
        const row = await SyncVault.getRequest(event.id);
        if (row) request = { method: row.method, url: row.url };
      }
      if (event.type === 'succeeded' && request) {
        for (const queryKey of queryKeysFor(request)) queryClient.invalidateQueries({ queryKey });
      }
    }
  });
}
