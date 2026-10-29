import { SyncVault, serializeBody } from '../src/core/SyncVault';
import { getNative } from '../src/native';
import { isUuidV7 } from '../src/core/uuid';
import type { SyncEvent } from '../src/core/types';
import { flush, installVault, uninstallVault, type TestVault } from './helpers/vault';

describe('SyncVault facade', () => {
  let t: TestVault;

  beforeEach(() => {
    t = installVault();
  });

  afterEach(uninstallVault);

  it('explains the New Architecture requirement when the Turbo Module is missing', () => {
    uninstallVault();
    expect(() => getNative()).toThrow(/New Architecture/);
  });

  describe('configure', () => {
    it('persists the native config and schedules the background drain', async () => {
      await SyncVault.configure({ baseUrl: 'https://api.test', maxAttempts: 4, wifiOnly: true, backgroundIntervalMinutes: 30 });
      const stored = JSON.parse(t.vault.store.kv.get('config')!);
      expect(stored).toMatchObject({ baseUrl: 'https://api.test', defaultMaxAttempts: 4, wifiOnly: true, backgroundIntervalMinutes: 30 });
      expect(t.vault.scheduledBackgroundDrain).toEqual({ intervalMinutes: 30, requiresUnmeteredNetwork: true, requiresCharging: false });
      expect(SyncVault.isConfigured).toBe(true);
    });

    it('cancels the background drain when the interval is 0', async () => {
      t.vault.scheduleBackgroundDrain({ intervalMinutes: 15, requiresCharging: false, requiresUnmeteredNetwork: false });
      await SyncVault.configure({ backgroundIntervalMinutes: 0 });
      expect(t.vault.scheduledBackgroundDrain).toBeNull();
    });

    it('fetches auth headers once at startup', async () => {
      const getAuthHeaders = jest.fn(async () => ({ Authorization: 'Bearer a' }));
      await SyncVault.configure({ baseUrl: 'https://api.test', getAuthHeaders, backgroundIntervalMinutes: 0 });
      expect(getAuthHeaders).toHaveBeenCalledWith({ reason: 'configure' });
      await SyncVault.enqueue({ method: 'POST', url: '/x' });
      await t.vault.drain();
      expect(t.sent[0]!.headers.Authorization).toBe('Bearer a');
    });

    it('resolves conflicts left behind by background drains', async () => {
      t.respond(() => ({ status: 409, body: '{"v":"server"}' }));
      const id = await SyncVault.enqueue({ method: 'PUT', url: 'https://api.test/x', body: { v: 'local' } });
      await t.vault.drain();
      expect((await SyncVault.getRequest(id))!.status).toBe('conflict');

      t.respond(() => ({ status: 200 }));
      const conflictResolver = jest.fn(async () => ({ action: 'keep_server' as const }));
      await SyncVault.configure({ conflictResolver, backgroundIntervalMinutes: 0 });
      await flush();
      expect(conflictResolver).toHaveBeenCalledWith(expect.objectContaining({ id, local: { v: 'local' }, server: { v: 'server' } }));
      expect(await SyncVault.getRequest(id)).toBeNull();
    });
  });

  describe('enqueue', () => {
    it('serialises bodies, query params, and metadata', async () => {
      const id = await SyncVault.enqueue({
        method: 'post',
        url: 'https://api.test/todos?x=1',
        body: { title: 'a' },
        queryParams: { page: 2, q: 'a b' },
        metadata: { screen: 'home' },
        queueKey: 'todo:1',
        priority: 3,
      });
      const row = (await SyncVault.getRequest(id))!;
      expect(row).toMatchObject({
        method: 'POST',
        url: 'https://api.test/todos?x=1&page=2&q=a%20b',
        body: '{"title":"a"}',
        contentType: 'application/json',
        queueKey: 'todo:1',
        priority: 3,
        metadata: { screen: 'home' },
        conflictStrategy: 'manual',
      });
    });

    it('stores merge-strategy requests as manual natively', async () => {
      const id = await SyncVault.enqueue({ method: 'PATCH', url: '/x', body: {}, merge: (l) => l });
      expect((await SyncVault.getRequest(id))!.conflictStrategy).toBe('manual');
    });

    it('rejects missing fields and unserialisable bodies', async () => {
      await expect(SyncVault.enqueue({ method: '', url: '/x' })).rejects.toThrow(/method and url/);
      await expect(SyncVault.enqueue({ method: 'POST', url: '/x', body: new ArrayBuffer(2) })).rejects.toThrow(/binary/);
    });

    it('serializeBody keeps strings and explicit content types', () => {
      expect(serializeBody('a=b', 'application/x-www-form-urlencoded')).toEqual({ body: 'a=b', contentType: 'application/x-www-form-urlencoded' });
      expect(serializeBody(undefined)).toEqual({ body: null, contentType: null });
      expect(serializeBody([1])).toEqual({ body: '[1]', contentType: 'application/json' });
    });
  });

  describe('queries and management', () => {
    it('lists by state and manages dead letters', async () => {
      t.respond(() => ({ status: 400 }));
      const a = await SyncVault.enqueue({ method: 'POST', url: '/a' });
      await t.vault.drain();
      t.vault.setNetwork({ isConnected: false });
      await SyncVault.enqueue({ method: 'POST', url: '/b' });

      expect((await SyncVault.getDeadLetters()).map((r) => r.id)).toEqual([a]);
      expect((await SyncVault.getPending()).length).toBe(1);
      expect(await SyncVault.getCounts()).toMatchObject({ pending: 1, deadLetter: 1 });

      t.respond(() => ({ status: 200 }));
      t.vault.setNetwork({ isConnected: true });
      expect(await SyncVault.retryAllDeadLetters()).toBe(1);
      await t.vault.drain();
      expect((await SyncVault.getCounts()).succeeded).toBe(2);
      expect(await SyncVault.purgeSucceeded()).toBe(0);
    });

    it('discards a request', async () => {
      t.vault.setNetwork({ isConnected: false });
      const id = await SyncVault.enqueue({ method: 'POST', url: '/a' });
      await SyncVault.discard(id);
      expect(await SyncVault.getRequest(id)).toBeNull();
    });
  });

  describe('events', () => {
    it('forwards native events to listeners and onEvent, isolating listener errors', async () => {
      const onError = jest.fn();
      const onEvent = jest.fn();
      await SyncVault.configure({ onEvent, onError, backgroundIntervalMinutes: 0 });
      const seen: SyncEvent[] = [];
      const off = SyncVault.addEventListener((e) => seen.push(e));
      SyncVault.addEventListener(() => {
        throw new Error('listener bug');
      });
      const id = await SyncVault.enqueue({ method: 'POST', url: 'https://api.test/x' });
      await t.vault.drain();
      expect(seen.filter((e) => e.id === id).map((e) => e.type)).toEqual(['enqueued', 'attempt', 'succeeded']);
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'succeeded', id }));
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'event listener');
      off();
    });

    it('forwards network changes', () => {
      const states: boolean[] = [];
      SyncVault.addNetworkListener((s) => states.push(s.isConnected));
      t.vault.setNetwork({ isConnected: false });
      t.vault.setNetwork({ isConnected: true });
      expect(states).toEqual([false, true]);
      expect(SyncVault.getNetworkState().isConnected).toBe(true);
      expect(SyncVault.getPowerState().batteryLevel).toBe(1);
    });
  });

  describe('auth', () => {
    it('collapses concurrent refreshes into one provider call', async () => {
      let resolve!: (h: Record<string, string>) => void;
      const getAuthHeaders = jest.fn(() => new Promise<Record<string, string>>((r) => (resolve = r)));
      const configuring = SyncVault.configure({ getAuthHeaders, backgroundIntervalMinutes: 0 });
      await flush();
      const again = SyncVault.refreshAuth();
      resolve({ Authorization: 'Bearer 1' });
      await Promise.all([configuring, again]);
      expect(getAuthHeaders).toHaveBeenCalledTimes(1);
    });

    it('reports provider failures and leaves requests parked', async () => {
      const onError = jest.fn();
      await SyncVault.configure({
        onError,
        backgroundIntervalMinutes: 0,
        getAuthHeaders: async (ctx) => {
          if (ctx.reason === 'unauthorized') throw new Error('refresh failed');
          return { Authorization: 'Bearer stale' };
        },
      });
      t.respond(() => ({ status: 401 }));
      const id = await SyncVault.enqueue({ method: 'POST', url: 'https://api.test/x' });
      await t.vault.drain();
      await flush();
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'getAuthHeaders');
      expect(await SyncVault.getRequest(id)).toMatchObject({ status: 'pending', authBlocked: true, attempt: 0 });

      t.respond(() => ({ status: 200 }));
      SyncVault.setAuthHeaders({ Authorization: 'Bearer fresh' });
      await t.vault.drain();
      expect(await SyncVault.getRequest(id)).toMatchObject({ status: 'succeeded' });
    });
  });

  describe('conflicts', () => {
    const conflictOnce = () => {
      let first = true;
      t.respond(() => {
        if (first) {
          first = false;
          return { status: 412, headers: { ETag: '"2"' }, body: '{"title":"server","n":1}' };
        }
        return { status: 200 };
      });
    };

    it('keep_local resends the local body with the server version', async () => {
      conflictOnce();
      await SyncVault.configure({ conflictResolver: () => ({ action: 'keep_local' }), backgroundIntervalMinutes: 0 });
      await SyncVault.enqueue({ method: 'PUT', url: 'https://api.test/x', body: { title: 'local' } });
      await t.vault.drain();
      await flush();
      await t.vault.drain();
      expect(t.sent[1]).toMatchObject({ body: '{"title":"local"}' });
      expect(t.sent[1]!.headers['If-Match']).toBe('"2"');
    });

    it('per-request merge functions win over the global resolver', async () => {
      conflictOnce();
      const conflictResolver = jest.fn();
      await SyncVault.configure({ conflictResolver, backgroundIntervalMinutes: 0 });
      await SyncVault.enqueue({
        method: 'PATCH',
        url: 'https://api.test/x',
        body: { title: 'local' },
        merge: (local, server) => ({ ...(server as object), ...(local as object) }),
      });
      await t.vault.drain();
      await flush();
      await t.vault.drain();
      expect(conflictResolver).not.toHaveBeenCalled();
      expect(JSON.parse(t.sent[1]!.body!)).toEqual({ title: 'local', n: 1 });
    });

    it('manual leaves the request parked for the UI', async () => {
      conflictOnce();
      const conflicts: string[] = [];
      SyncVault.addConflictListener((c) => conflicts.push(c.id));
      await SyncVault.configure({ conflictResolver: () => ({ action: 'manual' }), backgroundIntervalMinutes: 0 });
      const id = await SyncVault.enqueue({ method: 'PUT', url: 'https://api.test/x', body: {} });
      await t.vault.drain();
      await flush();
      expect(conflicts).toEqual([id]);
      expect((await SyncVault.getConflicts()).map((r) => r.id)).toEqual([id]);

      await SyncVault.resolveConflict(id, { action: 'merge', payload: { resolved: true } });
      await t.vault.drain();
      expect(t.sent[1]!.body).toBe('{"resolved":true}');
      await expect(SyncVault.resolveConflict(id, { action: 'keep_local' })).rejects.toThrow(/not in conflict/);
    });
  });

  describe('misc', () => {
    it('generates UUIDv7 ids', () => {
      expect(isUuidV7(SyncVault.generateId())).toBe(true);
    });

    it('round-trips JSON through the native cache', async () => {
      await SyncVault.cache.set('k', { a: [1, 2] }, { ttlMs: 1000, tags: ['t'] });
      expect(await SyncVault.cache.get('k')).toMatchObject({ value: { a: [1, 2] }, tags: ['t'] });
      expect(await SyncVault.cache.invalidate({ tags: ['t'] })).toBe(1);
      expect(await SyncVault.cache.get('k')).toBeNull();
      expect((await SyncVault.cache.stats()).entries).toBe(0);
    });

    it('delegates scheduling calls', () => {
      SyncVault.scheduleBackgroundDrain({ intervalMinutes: 60, requiresCharging: true });
      expect(t.vault.scheduledBackgroundDrain).toEqual({ intervalMinutes: 60, requiresCharging: true, requiresUnmeteredNetwork: false });
      SyncVault.cancelBackgroundDrain();
      expect(t.vault.scheduledBackgroundDrain).toBeNull();
      expect(() => SyncVault.drainNow()).not.toThrow();
    });
  });
});
