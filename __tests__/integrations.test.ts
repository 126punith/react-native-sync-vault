import { statusStore, resetStatusStore } from '../src/hooks/statusStore';
import { OfflineQueue, pushOptionsToEnqueue } from '../src/compat/OfflineQueue';
import { createSyncVaultMiddleware, SYNC_VAULT_EVENT } from '../src/integrations/redux';
import { syncVaultMutationFn, withSyncVault } from '../src/integrations/react-query';
import SyncMetrics from '../src/metrics/SyncMetrics';
import { QueueLogger } from '../src/debug/QueueLogger';
import { SyncVault } from '../src/core/SyncVault';
import { flush, installVault, uninstallVault, type TestVault } from './helpers/vault';

let t: TestVault;

beforeEach(() => {
  t = installVault();
});

afterEach(() => {
  resetStatusStore();
  uninstallVault();
});

describe('statusStore', () => {
  it('tracks counts, drains, and connectivity from engine events', async () => {
    const notify = jest.fn();
    const off = statusStore.subscribe(notify);
    await SyncVault.enqueue({ method: 'POST', url: 'https://api.test/x' });
    await t.vault.drain();
    await new Promise((r) => setTimeout(r, 80));
    const snapshot = statusStore.getSnapshot();
    expect(snapshot.counts.succeeded).toBe(1);
    expect(snapshot.isDraining).toBe(false);
    expect(snapshot.lastDrainAt).not.toBeNull();
    expect(snapshot.version).toBeGreaterThan(0);

    t.vault.setNetwork({ isConnected: false });
    expect(statusStore.getSnapshot().network.isConnected).toBe(false);
    expect(notify).toHaveBeenCalled();
    off();
  });
});

describe('v1 compatibility', () => {
  it('maps v1 push options onto enqueue options', () => {
    const merge = jest.fn();
    expect(
      pushOptionsToEnqueue({ method: 'POST', url: '/a', data: { a: 1 }, maxRetries: 3, conflictResolution: 'custom', customResolver: merge })
    ).toMatchObject({ method: 'POST', url: '/a', body: { a: 1 }, maxAttempts: 4, conflictStrategy: 'merge', merge: expect.any(Function) });
    expect(pushOptionsToEnqueue({ method: 'PUT', url: '/b', conflictResolution: 'custom' }).conflictStrategy).toBe('manual');
    expect(pushOptionsToEnqueue({ method: 'PUT', url: '/b', conflictResolution: 'server_wins' }).conflictStrategy).toBe('server_wins');
  });

  it('keeps the v1 OfflineQueue object working on top of the engine', async () => {
    await OfflineQueue.initialize({ backgroundIntervalMinutes: 0 });
    t.respond(() => ({ status: 400 }));
    const id = await OfflineQueue.push({ method: 'POST', url: 'https://api.test/a', data: {} });
    await t.vault.drain();
    expect((await OfflineQueue.getFailedRequests()).map((r) => r.id)).toEqual([id]);
    t.respond(() => ({ status: 200 }));
    await OfflineQueue.retryRequest(id);
    await t.vault.drain();
    expect(await OfflineQueue.getPendingRequests()).toEqual([]);
    t.vault.setNetwork({ isConnected: false });
    const other = await OfflineQueue.push({ method: 'POST', url: 'https://api.test/b' });
    await OfflineQueue.removeRequest(other);
    expect(() => OfflineQueue.triggerSync()).not.toThrow();
  });
});

describe('redux middleware', () => {
  it('queues actions with meta.syncVault and dispatches engine events', async () => {
    const dispatched: { type: string; payload?: unknown }[] = [];
    const api = { dispatch: (a: { type: string }) => dispatched.push(a), getState: () => ({}) };
    const next = jest.fn((a) => a);
    const middleware = createSyncVaultMiddleware()(api)(next);
    middleware({ type: 'todos/add', meta: { syncVault: { method: 'POST', url: 'https://api.test/todos', body: { id: 1 } } } });
    expect(next).toHaveBeenCalled();
    await flush();
    expect(dispatched.find((a) => a.type === 'todos/add/queued')).toBeDefined();
    expect(dispatched.find((a) => a.type === SYNC_VAULT_EVENT)).toBeDefined();

    middleware({ type: 'todos/bad', meta: { syncVault: { method: '', url: '' } } });
    await flush();
    expect(dispatched.find((a) => a.type === 'todos/bad/queueFailed')).toBeDefined();
  });
});

describe('react-query', () => {
  it('queues mutations and invalidates queries once delivered', async () => {
    const invalidateQueries = jest.fn();
    const off = withSyncVault({ invalidateQueries }, (r) => [['todos', r.method]]);
    const mutate = syncVaultMutationFn((title: string) => ({ method: 'POST', url: 'https://api.test/todos', body: { title } }));
    const result = await mutate('a');
    expect(result).toMatchObject({ queued: true, requestId: expect.any(String) });
    await t.vault.drain();
    await flush();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['todos', 'POST'] });
    off();
  });
});

describe('observability', () => {
  it('derives delivery metrics from events', async () => {
    const metrics = new SyncMetrics();
    metrics.start();
    t.respond(() => ({ status: 503 }));
    await SyncVault.enqueue({ method: 'POST', url: 'https://api.test/x', maxAttempts: 1 });
    await t.vault.drain();
    t.respond(() => ({ status: 200 }));
    await SyncVault.enqueue({ method: 'POST', url: 'https://api.test/y' });
    await t.vault.drain();
    expect(metrics.getSnapshot()).toMatchObject({ enqueued: 2, succeeded: 1, deadLettered: 1 });
    metrics.stop();
  });

  it('keeps a bounded event log', async () => {
    QueueLogger.start(3);
    for (let i = 0; i < 3; i++) await SyncVault.enqueue({ method: 'POST', url: `https://api.test/${i}` });
    await t.vault.drain();
    expect(QueueLogger.getLogs()).toHaveLength(3);
    expect(QueueLogger.export().split('\n')).toHaveLength(3);
    expect(QueueLogger.export()).toMatch(/^\d{4}-\d{2}-\d{2}T.* \[\w+\] /);
    QueueLogger.clear();
    expect(QueueLogger.getLogs()).toHaveLength(0);
    QueueLogger.stop();
  });
});
