import type { Request, RequestHandler, Response, Router } from 'express';

export interface IdempotencyRecord {
  state: 'in_progress' | 'completed';
  fingerprint: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string | null;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  setIfAbsent(key: string, record: IdempotencyRecord, ttlMs: number): Promise<boolean>;
  set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryStore implements IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  setIfAbsent(key: string, record: IdempotencyRecord, ttlMs: number): Promise<boolean>;
  set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  readonly size: number;
}

export class RedisStore implements IdempotencyStore {
  constructor(client: unknown, options?: { prefix?: string });
  get(key: string): Promise<IdempotencyRecord | null>;
  setIfAbsent(key: string, record: IdempotencyRecord, ttlMs: number): Promise<boolean>;
  set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface IdempotencyOptions {
  store?: IdempotencyStore;
  /** How long completed responses are replayable. Default 24h. */
  ttlMs?: number;
  /** How long an in-progress lock lives if the handler never responds. Default 60s. */
  lockTtlMs?: number;
  methods?: string[];
  /** Reject mutations without the header (400). Default false. */
  required?: boolean;
  /** Namespace keys per user. Default: req.user.id, else a hash of Authorization. */
  getScope?: (req: Request) => string;
  header?: string;
}

export function idempotency(options?: IdempotencyOptions): RequestHandler;
export function fingerprint(req: Request): string;
/** JSON with sorted object keys, used for request fingerprints. */
export function stableStringify(value: unknown): string;
/** 4xx statuses that are deterministic and therefore replayed for a repeated key. */
export const REPLAYABLE_4XX: ReadonlySet<number>;

export interface IfMatchOptions {
  getVersion: (req: Request) => unknown | Promise<unknown>;
  getCurrent?: (req: Request) => unknown | Promise<unknown>;
  required?: boolean;
  methods?: string[];
  status?: 409 | 412;
}

export function ifMatch(options: IfMatchOptions): RequestHandler;
export function setETag(res: Response, version: unknown): void;
export function normalizeETag(value: unknown): string | null;
export function formatETag(version: unknown): string;

export function retryAfter(options?: { defaultSeconds?: number; statuses?: number[] }): RequestHandler;
export function rateLimit(options?: { windowMs?: number; max?: number; key?: (req: Request) => string }): RequestHandler;

export function batchRouter(options?: {
  path?: string;
  maxOperations?: number;
  stopOnError?: boolean;
  allowedPaths?: string[] | null;
  limit?: string;
}): Router;
