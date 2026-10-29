import type { NativeConfig } from '../specs/NativeSyncVault';

export const DEFAULT_NATIVE_CONFIG: NativeConfig = {
  baseUrl: '',
  maxConcurrency: 4,
  requestTimeoutMs: 30_000,
  leaseMs: 120_000,
  defaultMaxAttempts: 8,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 5 * 60_000,
  encryptPayloads: false,
  wifiOnly: false,
  requiresCharging: false,
  minBatteryLevel: 0,
  backgroundIntervalMinutes: 15,
  largePayloadThresholdBytes: 256 * 1024,
  notificationTitle: 'Syncing',
};

/** Succeeded rows are kept this long for inspection, then purged on configure. */
export const SUCCEEDED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
