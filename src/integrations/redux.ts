import { SyncVault } from '../core/SyncVault';
import type { EnqueueOptions, SyncEvent } from '../core/types';

type Action = { type: string; meta?: { syncVault?: EnqueueOptions } & Record<string, unknown> } & Record<string, unknown>;
type Dispatch = (action: Action) => unknown;
type MiddlewareApi = { dispatch: Dispatch; getState: () => unknown };

export const SYNC_VAULT_EVENT = 'syncVault/event';

export interface SyncVaultMiddlewareOptions {
  /** Dispatch `{ type: 'syncVault/event', payload }` for engine events. Default true. */
  dispatchEvents?: boolean;
}

/**
 * Actions carrying `meta.syncVault` (EnqueueOptions) are passed to reducers (optimistic update)
 * and their request is queued; `${type}/queued` is dispatched with the request id.
 */
export function createSyncVaultMiddleware(options: SyncVaultMiddlewareOptions = {}) {
  return (api: MiddlewareApi) => {
    if (options.dispatchEvents !== false) {
      SyncVault.addEventListener((event: SyncEvent) => api.dispatch({ type: SYNC_VAULT_EVENT, payload: event }));
    }
    return (next: Dispatch) => (action: Action) => {
      const result = next(action);
      const request = action?.meta?.syncVault;
      if (request) {
        SyncVault.enqueue(request).then(
          (requestId) => api.dispatch({ type: `${action.type}/queued`, payload: { requestId } }),
          (error: unknown) =>
            api.dispatch({ type: `${action.type}/queueFailed`, payload: { error: error instanceof Error ? error.message : String(error) } })
        );
      }
      return result;
    };
  };
}

/** @deprecated Use createSyncVaultMiddleware(). */
export function withSyncVault<R>(reducer: R, options?: SyncVaultMiddlewareOptions) {
  return { reducer, middleware: [createSyncVaultMiddleware(options)] };
}
