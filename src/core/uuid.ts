/**
 * RFC 9562 UUIDv7 (48-bit ms timestamp, 12-bit monotonic counter). Time-ordered IDs let
 * offline creates use client-generated primary keys without remapping after sync.
 */

type RandomSource = (bytes: Uint8Array) => void;

let lastMs = 0;
let counter = 0;
let randomSource: RandomSource | null = null;

function resolveRandom(): RandomSource {
  if (randomSource) return randomSource;
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoObj?.getRandomValues) {
    randomSource = (bytes) => {
      cryptoObj.getRandomValues!(bytes);
    };
  } else {
    // Hermes has no crypto.getRandomValues; the native generateId() is preferred there.
    randomSource = (bytes) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    };
  }
  return randomSource;
}

export function hasSecureRandom(): boolean {
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: unknown } }).crypto;
  return typeof cryptoObj?.getRandomValues === 'function';
}

export function uuidv7(nowMs: number = Date.now()): string {
  let ms = nowMs;
  const bytes = new Uint8Array(16);
  resolveRandom()(bytes);
  if (ms <= lastMs) {
    counter++;
    if (counter > 0xfff) {
      lastMs++;
      counter = 0;
    }
    ms = lastMs;
  } else {
    lastMs = ms;
    counter = ((bytes[6]! << 8) | bytes[7]!) & 0x7ff;
  }
  // 48-bit timestamp; avoid 32-bit bitwise truncation.
  const high = Math.floor(ms / 0x100000000);
  const low = ms >>> 0;
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;
  bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  let hex = '';
  for (let i = 0; i < 16; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuidV7(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

/** Milliseconds encoded in a UUIDv7. */
export function uuidv7Timestamp(value: string): number {
  const hex = value.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16);
}
