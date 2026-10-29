import ApiInterceptor, { QUEUED_HEADER, REQUEST_ID_HEADER, headersToObject, shouldIntercept } from '../src/ApiInterceptor';
import AxiosInterceptor from '../src/AxiosInterceptor';
import { SyncVault } from '../src/core/SyncVault';
import { installVault, uninstallVault, type TestVault } from './helpers/vault';

describe('fetch interceptor', () => {
  let t: TestVault;
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;
  let interceptor: ApiInterceptor;

  beforeEach(() => {
    t = installVault();
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn(async () => new Response('{"ok":true}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    interceptor = new ApiInterceptor();
    interceptor.enable({ enabled: true });
  });

  afterEach(() => {
    interceptor.disable();
    globalThis.fetch = originalFetch;
    uninstallVault();
  });

  it('passes reads through untouched', async () => {
    await fetch('https://api.test/todos');
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/todos', undefined);
  });

  it('adds an Idempotency-Key to online mutations and keeps a caller-provided one', async () => {
    await fetch('https://api.test/todos', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);

    await fetch('https://api.test/todos', { method: 'POST', body: '{}', headers: { 'idempotency-key': 'mine' } });
    expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBe('mine');
  });

  it('queues offline mutations and answers 202', async () => {
    t.vault.setNetwork({ isConnected: false });
    const response = await fetch('https://api.test/todos', {
      method: 'POST',
      body: '{"title":"a"}',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    expect(response.headers.get(QUEUED_HEADER)).toBe('true');
    const id = response.headers.get(REQUEST_ID_HEADER)!;
    expect(await response.json()).toEqual({ queued: true, requestId: id });
    expect(await SyncVault.getRequest(id)).toMatchObject({
      method: 'POST',
      body: '{"title":"a"}',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer x' },
    });
  });

  it('queues after a network failure with the key that was already sent', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const response = await fetch('https://api.test/todos', { method: 'PUT', body: 'x' });
    expect(response.status).toBe(202);
    const sentKey = fetchMock.mock.calls[0][1].headers['Idempotency-Key'];
    const row = await SyncVault.getRequest(response.headers.get(REQUEST_ID_HEADER)!);
    expect(row!.idempotencyKey).toBe(sentKey);
  });

  it('rethrows aborts and honours queueOnNetworkError: false', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(fetch('https://api.test/x', { method: 'POST', body: '' })).rejects.toThrow('aborted');

    interceptor.disable();
    interceptor.enable({ enabled: true, queueOnNetworkError: false });
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(fetch('https://api.test/x', { method: 'POST', body: '' })).rejects.toThrow('Network request failed');
  });

  it('does not queue bodies it cannot persist', async () => {
    t.vault.setNetwork({ isConnected: false });
    const body = new Blob(['x']);
    await fetch('https://api.test/upload', { method: 'POST', body });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('restores fetch on disable', () => {
    interceptor.disable();
    expect(interceptor.isActive()).toBe(false);
    expect(globalThis.fetch).toBe(fetchMock);
  });
});

describe('interceptor helpers', () => {
  it('filters by method and URL prefix', () => {
    expect(shouldIntercept({}, 'post', 'https://a/x')).toBe(true);
    expect(shouldIntercept({}, 'GET', 'https://a/x')).toBe(false);
    expect(shouldIntercept({ urlFilter: ['https://api'] }, 'POST', 'https://cdn/x')).toBe(false);
    expect(shouldIntercept({ methods: ['GET'] }, 'GET', 'https://a/x')).toBe(true);
  });

  it('normalises header shapes', () => {
    expect(headersToObject(new Headers({ A: '1' }))).toEqual({ a: '1' });
    expect(headersToObject([['B', '2']])).toEqual({ B: '2' });
    expect(headersToObject({ C: 3, D: undefined })).toEqual({ C: '3' });
    expect(headersToObject(undefined)).toEqual({});
  });
});

describe('axios interceptor', () => {
  type Handler = (value: unknown) => unknown;

  function fakeAxios() {
    const request: Handler[] = [];
    const responseError: Handler[] = [];
    return {
      request,
      responseError,
      interceptors: {
        request: { use: (fn: Handler) => request.push(fn) - 1, eject: (i: number) => delete request[i] },
        response: { use: (_ok: Handler, fail: Handler) => responseError.push(fail) - 1, eject: (i: number) => delete responseError[i] },
      },
    };
  }

  let t: TestVault;
  beforeEach(() => {
    t = installVault();
  });
  afterEach(uninstallVault);

  it('keys mutations and short-circuits offline requests with a queued 202', async () => {
    const axios = fakeAxios();
    const interceptor = new AxiosInterceptor();
    interceptor.enable({ enabled: true }, axios);

    const online = (await axios.request[0]!({ method: 'post', url: '/todos', baseURL: 'https://api.test', headers: {}, data: { a: 1 } })) as {
      headers: Record<string, string>;
      adapter?: unknown;
    };
    expect(online.headers['Idempotency-Key']).toBeDefined();
    expect(online.adapter).toBeUndefined();

    t.vault.setNetwork({ isConnected: false });
    const offline = (await axios.request[0]!({
      method: 'patch',
      url: '/todos/1',
      baseURL: 'https://api.test/',
      headers: { 'Content-Type': 'application/json' },
      data: { done: true },
      params: { v: 2 },
    })) as { adapter: () => Promise<{ status: number; data: { requestId: string } }> };
    const response = await offline.adapter();
    expect(response.status).toBe(202);
    expect(await SyncVault.getRequest(response.data.requestId)).toMatchObject({
      method: 'PATCH',
      url: 'https://api.test/todos/1?v=2',
      body: '{"done":true}',
    });

    interceptor.disable();
    expect(interceptor.isActive()).toBe(false);
  });

  it('queues network errors once and rethrows everything else', async () => {
    const axios = fakeAxios();
    const interceptor = new AxiosInterceptor();
    interceptor.enable({ enabled: true }, axios);
    const config = (await axios.request[0]!({ method: 'delete', url: 'https://api.test/todos/1', headers: {} })) as Record<string, unknown>;

    const queued = (await axios.responseError[0]!({ config })) as { status: number };
    expect(queued.status).toBe(202);
    await expect(axios.responseError[0]!({ config })).rejects.toBeDefined();
    await expect(axios.responseError[0]!({ config: { ...config, __syncVaultQueued: false }, response: { status: 500 } })).rejects.toBeDefined();
    await expect(axios.responseError[0]!({ config: { ...config, __syncVaultQueued: false }, code: 'ERR_CANCELED' })).rejects.toBeDefined();
    expect((await SyncVault.getCounts()).pending).toBe(1);
  });
});
