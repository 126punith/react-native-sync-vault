import { NativeModules } from 'react-native';

/**
 * Get the OfflineQueue native module safely
 * Returns null if the module is not available
 */
export function getNativeModule(): any {
  try {
    return NativeModules.OfflineQueue;
  } catch {
    return null;
  }
}

