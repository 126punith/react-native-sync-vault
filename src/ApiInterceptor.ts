import { SyncVault } from './core/SyncVault';
import type { InterceptorConfig } from './types';

export const DEFAULT_QUEUED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
export const QUEUED_HEADER = 'X-Sync-Vault-Queued';
export const REQUEST_ID_HEADER = 'X-Sync-Vault-Request-Id';

export function headersToObject(headers: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  if (typeof (headers as Headers).forEach === 'function' && !Array.isArray(headers)) {
    (headers as Headers).forEach((value: string, key: string) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers as [string, string][]) result[key] = String(value);
    return result;
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (value !== undefined && value !== null) result[key] = String(value);
  }
  return result;
}

export function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

export function withoutHeaders(headers: Record<string, string>, names: string[]): Record<string, string> {
  const drop = new Set(names.map((n) => n.toLowerCase()));
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!drop.has(key.toLowerCase())) result[key] = value;
  }
  return result;
}

export function shouldIntercept(config: InterceptorConfig, method: string, url: string): boolean {
  const methods = (config.methods ?? DEFAULT_QUEUED_METHODS).map((m) => m.toUpperCase());
  if (!methods.includes(method.toUpperCase())) return false;
  const filter = config.urlFilter ?? [];
  return filter.length === 0 || filter.some((prefix) => url.startsWith(prefix));
}

function queuedResponse(requestId: string): Response {
  return new Response(JSON.stringify({ queued: true, requestId }), {
    status: 202,
    statusText: 'Accepted',
    headers: { 'Content-Type': 'application/json', [QUEUED_HEADER]: 'true', [REQUEST_ID_HEADER]: requestId },
  });
}

/**
 * Intercepts global fetch for mutations. Every intercepted mutation gets an Idempotency-Key
 * before the first attempt, so a request that fails online and is then queued cannot be
 * applied twice. Offline (or on network failure) the request is queued and a 202 is returned.
 */
class ApiInterceptor {
  private originalFetch: typeof fetch | null = null;
  private config: InterceptorConfig = {};

  enable(config: InterceptorConfig = { enabled: true }): void {
    if (this.originalFetch || config.enabled === false) return;
    if (typeof globalThis.fetch !== 'function') return;
    this.config = config;
    this.originalFetch = globalThis.fetch;
    globalThis.fetch = this.interceptedFetch as typeof fetch;
  }

  disable(): void {
    if (!this.originalFetch) return;
    globalThis.fetch = this.originalFetch;
    this.originalFetch = null;
  }

  isActive(): boolean {
    return this.originalFetch != null;
  }

  private interceptedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const original = this.originalFetch!;
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = typeof input === 'string' ? input : isRequest ? (input as Request).url : String(input);
    const method = (init?.method ?? (isRequest ? (input as Request).method : 'GET')).toUpperCase();

    if (!shouldIntercept(this.config, method, url)) return original(input, init);

    let rawBody: unknown = init?.body;
    if (rawBody === undefined && isRequest) rawBody = await (input as Request).clone().text();
    if (rawBody != null && typeof rawBody !== 'string') {
      // FormData, Blob, and streams cannot be persisted; send them without offline support.
      return original(input, init);
    }
    const body = (rawBody as string | null | undefined) ?? null;

    const headers = headersToObject(init?.headers ?? (isRequest ? (input as Request).headers : undefined));
    const idempotencyKey = findHeader(headers, 'Idempotency-Key') ?? SyncVault.generateId();
    const sendHeaders = { ...withoutHeaders(headers, ['Idempotency-Key']), 'Idempotency-Key': idempotencyKey };

    const queue = async (): Promise<Response> => {
      const requestId = await SyncVault.enqueue({
        method,
        url,
        body,
        contentType: findHeader(headers, 'Content-Type'),
        headers: withoutHeaders(headers, ['Idempotency-Key', 'Content-Type', 'Content-Length']),
        idempotencyKey,
      });
      return queuedResponse(requestId);
    };

    if (!SyncVault.getNetworkState().isConnected) return queue();

    try {
      return await original(url, { ...init, method, headers: sendHeaders, body: body ?? undefined });
    } catch (error) {
      const aborted = (error as { name?: string })?.name === 'AbortError';
      if (aborted || this.config.queueOnNetworkError === false) throw error;
      return queue();
    }
  };
}

export default ApiInterceptor;
