import { generateRequestId } from '../src/utils/idGenerator';

describe('idGenerator', () => {
  describe('generateRequestId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      const id3 = generateRequestId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should generate string IDs', () => {
      const id = generateRequestId();
      expect(typeof id).toBe('string');
    });

    it('should generate non-empty IDs', () => {
      const id = generateRequestId();
      expect(id.length).toBeGreaterThan(0);
    });

    it('should generate IDs with consistent format', () => {
      const ids = Array.from({ length: 100 }, () => generateRequestId());
      
      // All IDs should have similar structure (not necessarily same length due to timestamp)
      ids.forEach(id => {
        expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
      });
    });

    it('should generate many unique IDs without collisions', () => {
      const ids = new Set(Array.from({ length: 1000 }, () => generateRequestId()));
      
      // Should have 1000 unique IDs
      expect(ids.size).toBe(1000);
    });
  });
});


