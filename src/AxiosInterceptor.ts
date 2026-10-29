import { SyncVault } from './core/SyncVault';
import { findHeader, headersToObject, QUEUED_HEADER, REQUEST_ID_HEADER, shouldIntercept, withoutHeaders } from './ApiInterceptor';
import type { InterceptorConfig } from './types';

type AxiosConfig = {
  url?: string;
  baseURL?: string;
  method?: string;
  headers?: Record<string, unknown> & { set?: (k: string, v: string) => void; toJSON?: () => Record<string, unknown> };
  data?: unknown;
  params?: Record<string, string | number | boolean>;
  adapter?: unknown;
  __syncVaultKey?: string;
  __syncVaultQueued?: boolean;
};

type AxiosLike = {
  interceptors: {
    request: { use: (onFulfilled: (c: AxiosConfig) => unknown, onRejected?: (e: unknown) => unknown) => number; eject: (id: number) => void };
    response: { use: (onFulfilled: (r: unknown) => unknown, onRejected?: (e: unknown) => unknown) => number; eject: (id: number) => void };
  };
};

function fullUrl(config: AxiosConfig): string {
  const url = config.url ?? '';
  if (!config.baseURL || /^https?:\/\//i.test(url)) return url;
  return `${config.baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

function plainHeaders(config: AxiosConfig): Record<string, string> {
  const raw = config.headers?.toJSON ? config.headers.toJSON() : config.headers;
  const flat = headersToObject(raw);
  // Axios nests per-method defaults (common, post, ...) in the headers object.
  return withoutHeaders(flat, ['common', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
}

function setHeader(config: AxiosConfig, name: string, value: string): void {
  if (!config.headers) config.headers = {};
  if (typeof config.headers.set === 'function') config.headers.set(name, value);
  else (config.headers as Record<string, unknown>)[name] = value;
}

function queuedResponse(config: AxiosConfig, requestId: string) {
  return {
    data: { queued: true, requestId },
    status: 202,
    statusText: 'Accepted',
    headers: { [QUEUED_HEADER.toLowerCase()]: 'true', [REQUEST_ID_HEADER.toLowerCase()]: requestId },
    config,
    request: {},
  };
}

/**
 * Axios counterpart of ApiInterceptor: mutations get an Idempotency-Key up front, are queued
 * when offline (resolving with a synthetic 202), and are queued on network failure.
 */
class AxiosInterceptor {
  private axios: AxiosLike | null = null;
  private requestId: number | null = null;
  private responseId: number | null = null;
  private config: InterceptorConfig = {};

  enable(config: InterceptorConfig, axiosInstance?: unknown): void {
    if (this.axios || config.axios?.enabled === false) return;
    let instance = (axiosInstance ?? config.axios?.instance) as AxiosLike | undefined;
    if (!instance) {
      try {
        // axios is an optional peer dependency.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('axios');
        instance = (mod.default ?? mod) as AxiosLike;
      } catch {
        return;
      }
    }
    if (!instance?.interceptors) return;
    this.axios = instance;
    this.config = config;
    this.requestId = instance.interceptors.request.use((c) => this.onRequest(c));
    this.responseId = instance.interceptors.response.use(
      (r) => r,
      (e) => this.onResponseError(e)
    );
  }

  disable(): void {
    if (!this.axios) return;
    if (this.requestId != null) this.axios.interceptors.request.eject(this.requestId);
    if (this.responseId != null) this.axios.interceptors.response.eject(this.responseId);
    this.axios = null;
    this.requestId = null;
    this.responseId = null;
  }

  isActive(): boolean {
    return this.axios != null;
  }

  private async queue(config: AxiosConfig): Promise<string> {
    const headers = plainHeaders(config);
    const id = await SyncVault.enqueue({
      method: (config.method ?? 'GET').toUpperCase(),
      url: fullUrl(config),
      body: config.data,
      contentType: findHeader(headers, 'Content-Type'),
      headers: withoutHeaders(headers, ['Idempotency-Key', 'Content-Type', 'Content-Length']),
      queryParams: config.params,
      idempotencyKey: config.__syncVaultKey,
    });
    config.__syncVaultQueued = true;
    return id;
  }

  private onRequest = async (config: AxiosConfig): Promise<AxiosConfig> => {
    const method = (config.method ?? 'GET').toUpperCase();
    if (!shouldIntercept(this.config, method, fullUrl(config))) return config;
    if (config.data != null && typeof config.data === 'object' && typeof FormData !== 'undefined' && config.data instanceof FormData) {
      return config;
    }
    const key = findHeader(plainHeaders(config), 'Idempotency-Key') ?? SyncVault.generateId();
    setHeader(config, 'Idempotency-Key', key);
    config.__syncVaultKey = key;
    if (!SyncVault.getNetworkState().isConnected) {
      const requestId = await this.queue(config);
      config.adapter = () => Promise.resolve(queuedResponse(config, requestId));
    }
    return config;
  };

  private onResponseError = async (error: unknown): Promise<unknown> => {
    const err = error as { config?: AxiosConfig; response?: unknown; code?: string };
    const config = err?.config;
    const isNetworkError = !!config && !err.response && err.code !== 'ERR_CANCELED';
    if (!isNetworkError || this.config.queueOnNetworkError === false || !config!.__syncVaultKey || config!.__syncVaultQueued) {
      throw error;
    }
    const requestId = await this.queue(config!);
    return queuedResponse(config!, requestId);
  };
}

export default AxiosInterceptor;
