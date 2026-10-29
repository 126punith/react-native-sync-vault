import { hasSecureRandom, isUuidV7, uuidv7, uuidv7Timestamp } from '../src/core/uuid';

describe('uuidv7', () => {
  it('produces RFC 9562 version 7 / variant 10 identifiers', () => {
    for (let i = 0; i < 100; i++) expect(isUuidV7(uuidv7())).toBe(true);
    expect(isUuidV7('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('encodes the full 48-bit millisecond timestamp', () => {
    const later = Date.parse('2200-06-01T00:00:00Z');
    expect(uuidv7Timestamp(uuidv7(later))).toBe(later);
    expect(later).toBeGreaterThan(2 ** 32);
  });

  it('is strictly increasing within the same millisecond and when the clock goes backwards', () => {
    const t = Date.parse('2300-01-01T00:00:00Z');
    const ids = [uuidv7(t)];
    for (let i = 0; i < 5000; i++) ids.push(uuidv7(t));
    ids.push(uuidv7(t - 10_000));
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('detects a secure random source', () => {
    expect(hasSecureRandom()).toBe(true);
  });
});
