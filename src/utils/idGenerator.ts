/**
 * Generate a UUID v4 compatible ID for React Native
 * Uses Math.random() instead of crypto.getRandomValues() for React Native compatibility
 */
function generateUUID(): string {
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where x is any hexadecimal digit and y is one of 8, 9, A, or B
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a unique ID for requests
 */
export function generateRequestId(): string {
  return generateUUID();
}

/**
 * Generate a unique ID with optional prefix
 */
export function generateId(prefix?: string): string {
  const id = generateUUID();
  return prefix ? `${prefix}_${id}` : id;
}


