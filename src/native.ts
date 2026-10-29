import type { Spec } from './specs/NativeSyncVault';

let cached: Spec | null = null;
let override: Spec | null = null;

const SETUP_MESSAGE =
  'react-native-sync-vault: the "SyncVault" Turbo Module was not found. ' +
  'v2 requires the New Architecture (React Native >= 0.76 with newArchEnabled=true on Android ' +
  'and RCT_NEW_ARCH_ENABLED=1 on iOS). Rebuild the app after installing (pod install on iOS).';

/**
 * Returns the native Turbo Module. Throws a setup error if the New Architecture
 * module is not registered; there is intentionally no legacy-bridge fallback.
 */
export function getNative(): Spec {
  if (override) {
    return override;
  }
  if (!cached) {
    try {
      // Lazy so a missing Turbo Module surfaces as the setup error below, not at import time.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cached = require('./specs/NativeSyncVault').default as Spec;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${SETUP_MESSAGE}\nCause: ${reason}`);
    }
  }
  return cached;
}

/**
 * Replaces the native module, e.g. with the in-memory reference implementation
 * from `react-native-sync-vault/lib/testing` in Jest. Pass null to restore.
 */
export function setNativeImplementation(impl: Spec | null): void {
  override = impl;
}
