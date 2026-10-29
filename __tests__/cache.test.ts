import CacheManager, { pathTag, patternToRegExp } from '../src/cache/CacheManager';
import { installVault, uninstallVault } from './helpers/vault';

describe('CacheManager', () => {
  let now: number;
  let spy: jest.SpyInstance;

  beforeEach(() => {
    installVault();
    now = 1_000_000;
    spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    spy.mockRestore();
    uninstallVault();
  });

  it('matches endpoint patterns', () => {
    expect(patternToRegExp('/api/todos/:id').test('/api/todos/42')).toBe(true);
    expect(patternToRegExp('/api/todos/*').test('/api/todos/42?x=1')).toBe(true);
    expect(patternToRegExp('/api/*').test('/api/todos/42')).toBe(false);
    expect(patternToRegExp('/api/**').test('/api/todos/42')).toBe(true);
    expect(pathTag('https://h.test/api/todos?page=2')).toBe('path:/api/todos');
  });

  it('expires entries after their TTL', async () => {
    const cache = new CacheManager();
    await cache.set('/todos', [1], { ttl: 10 });
    expect(await cache.get('/todos')).toMatchObject({ hit: true, data: [1], stale: false });
    now += 11_000;
    expect(await cache.get('/todos')).toEqual({ hit: false });
  });

  it('serves stale data and revalidates with stale-while-revalidate', async () => {
    const cache = new CacheManager({ strategy: 'stale-while-revalidate' });
    await cache.set('/todos', ['old'], { ttl: 1 });
    now += 5_000;
    const fetcher = jest.fn(async () => ['new']);
    expect(await cache.fetch('/todos', fetcher)).toEqual({ data: ['old'], fromCache: true, stale: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await cache.get('/todos')).toMatchObject({ data: ['new'], stale: false });
  });

  it('cache-first avoids the network while fresh', async () => {
    const cache = new CacheManager({ strategy: 'cache-first' });
    const fetcher = jest.fn(async () => 'net');
    expect(await cache.fetch('/a', fetcher)).toEqual({ data: 'net', fromCache: false, stale: false });
    expect(await cache.fetch('/a', fetcher)).toEqual({ data: 'net', fromCache: true, stale: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('network-first falls back to the cached copy when offline', async () => {
    const cache = new CacheManager();
    await cache.set('/a', 'cached', { ttl: 1 });
    now += 2_000;
    const result = await cache.fetch('/a', async () => {
      throw new Error('offline');
    }, { strategy: 'network-first' });
    expect(result).toEqual({ data: 'cached', fromCache: true, stale: true });
    await expect(cache.fetch('/missing', async () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
  });

  it('invalidates by exact path, wildcard, tag, and mutation rules', async () => {
    const cache = new CacheManager({ invalidateOnMutate: { 'POST /api/todos': ['/api/todos'], 'PATCH /api/todos/:id': ['/api/todos/*'] } });
    await cache.set('/api/todos', 1);
    await cache.set('/api/todos?page=2', 2);
    await cache.set('/api/todos/1', 3, { tags: ['todo:1'] });
    await cache.set('/api/users', 4);

    await cache.invalidateOnMutate('POST', 'https://h.test/api/todos');
    expect((await cache.get('/api/todos')).hit).toBe(false);
    expect((await cache.get('/api/todos?page=2')).hit).toBe(false);
    expect((await cache.get('/api/todos/1')).hit).toBe(true);

    expect(await cache.invalidateByTags(['todo:1'])).toBe(1);
    await cache.set('/api/todos/2', 5);
    await cache.invalidateOnMutate('PATCH', '/api/todos/2');
    expect((await cache.get('/api/todos/2')).hit).toBe(false);
    expect((await cache.get('/api/users')).hit).toBe(true);
  });

  it('enforces the size limit through native LRU eviction', async () => {
    const cache = new CacheManager({ maxSize: 200 });
    for (let i = 0; i < 10; i++) {
      now += 1;
      await cache.set(`/k${i}`, 'x'.repeat(40));
    }
    expect(await cache.getSize()).toBeLessThanOrEqual(200);
    expect((await cache.get('/k9')).hit).toBe(true);
    expect((await cache.get('/k0')).hit).toBe(false);
  });

  it('per-endpoint strategies override the default', async () => {
    const cache = new CacheManager({ defaultTtl: 100, strategies: { '/api/feed': { ttl: 1, strategy: 'cache-first' } } });
    expect(cache.getEndpointStrategy('/api/feed')).toMatchObject({ ttl: 1 });
    await cache.set('/api/feed', 'f');
    now += 1500;
    expect((await cache.get('/api/feed')).hit).toBe(false);
  });

  it('does nothing when disabled', async () => {
    const cache = new CacheManager({ enabled: false });
    await cache.set('/a', 1);
    expect(await cache.get('/a')).toEqual({ hit: false });
  });
});
