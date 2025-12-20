import ConflictResolver from '../src/ConflictResolver';
import { ConflictResolution } from '../src/types';

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;

  beforeEach(() => {
    resolver = new ConflictResolver();
  });

  describe('detectConflict', () => {
    it('should detect HTTP 409 conflict', () => {
      expect(resolver.detectConflict(409)).toBe(true);
    });

    it('should detect conflict in response data', () => {
      expect(resolver.detectConflict(200, { conflict: true })).toBe(true);
    });

    it('should not detect conflict for normal responses', () => {
      expect(resolver.detectConflict(200, { data: 'test' })).toBe(false);
      expect(resolver.detectConflict(404)).toBe(false);
    });
  });

  describe('detectVersionConflict', () => {
    it('should detect version mismatch', () => {
      expect(resolver.detectVersionConflict(1, 2)).toBe(true);
    });

    it('should not detect conflict for matching versions', () => {
      expect(resolver.detectVersionConflict(1, 1)).toBe(false);
    });

    it('should not detect conflict when server version is undefined', () => {
      expect(resolver.detectVersionConflict(1, undefined)).toBe(false);
    });
  });

  describe('resolveConflict', () => {
    it('should resolve with client_wins strategy', async () => {
      const local = { name: 'Local' };
      const server = { name: 'Server' };
      const resolution: ConflictResolution = { strategy: 'client_wins' };

      const result = await resolver.resolveConflict(local, server, resolution);

      expect(result).toEqual(local);
    });

    it('should resolve with server_wins strategy', async () => {
      const local = { name: 'Local' };
      const server = { name: 'Server' };
      const resolution: ConflictResolution = { strategy: 'server_wins' };

      const result = await resolver.resolveConflict(local, server, resolution);

      expect(result).toEqual(server);
    });

    it('should resolve with manual_merge strategy', async () => {
      const local = { name: 'Local' };
      const server = { name: 'Server' };
      const resolution: ConflictResolution = { strategy: 'manual_merge' };

      const result = await resolver.resolveConflict(local, server, resolution);

      expect(result).toHaveProperty('local');
      expect(result).toHaveProperty('server');
      expect(result).toHaveProperty('requiresManualResolution', true);
    });

    it('should resolve with custom strategy', async () => {
      const local = { name: 'Local' };
      const server = { name: 'Server' };
      const customResolver = jest.fn().mockReturnValue({ name: 'Merged' });
      const resolution: ConflictResolution = {
        strategy: 'custom',
        customResolver,
      };

      const result = await resolver.resolveConflict(local, server, resolution);

      expect(customResolver).toHaveBeenCalledWith(local, server);
      expect(result).toEqual({ name: 'Merged' });
    });

    it('should throw error for custom strategy without resolver', async () => {
      const resolution: ConflictResolution = { strategy: 'custom' };

      await expect(
        resolver.resolveConflict({}, {}, resolution)
      ).rejects.toThrow('Custom resolver function not provided');
    });
  });
});


