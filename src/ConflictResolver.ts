import { ConflictResolution, ConflictResolutionStrategy, QueuedRequest, SyncDataPoint } from './types';

/**
 * Conflict resolution strategies and utilities
 */
class ConflictResolver {
  /**
   * Detect if a conflict exists based on HTTP response
   */
  detectConflict(statusCode: number, responseData?: any): boolean {
    // HTTP 409 Conflict
    if (statusCode === 409) {
      return true;
    }

    // Check for version mismatches in response
    if (responseData && responseData.conflict) {
      return true;
    }

    return false;
  }

  /**
   * Detect conflict from version mismatch in sync data
   */
  detectVersionConflict(localVersion: number, serverVersion?: number): boolean {
    if (serverVersion === undefined) {
      return false;
    }
    return localVersion !== serverVersion;
  }

  /**
   * Resolve conflict using the specified strategy
   */
  async resolveConflict(
    localData: any,
    serverData: any,
    resolution: ConflictResolution
  ): Promise<any> {
    switch (resolution.strategy) {
      case 'client_wins':
        return this.resolveClientWins(localData, serverData);
      
      case 'server_wins':
        return this.resolveServerWins(localData, serverData);
      
      case 'manual_merge':
        return this.resolveManualMerge(localData, serverData);
      
      case 'custom':
        if (resolution.customResolver) {
          return resolution.customResolver(localData, serverData);
        }
        throw new Error('Custom resolver function not provided');
      
      default:
        throw new Error(`Unknown conflict resolution strategy: ${resolution.strategy}`);
    }
  }

  /**
   * Client wins strategy - use local data
   */
  private resolveClientWins(localData: any, serverData: any): any {
    return localData;
  }

  /**
   * Server wins strategy - use server data
   */
  private resolveServerWins(localData: any, serverData: any): any {
    return serverData;
  }

  /**
   * Manual merge strategy - return both for manual handling
   */
  private resolveManualMerge(localData: any, serverData: any): any {
    return {
      local: localData,
      server: serverData,
      requiresManualResolution: true,
    };
  }

  /**
   * Store conflict data in request
   */
  storeConflictData(
    request: QueuedRequest,
    localSnapshot: any,
    serverSnapshot: any
  ): QueuedRequest {
    return {
      ...request,
      status: 'conflict',
      conflictData: {
        local: localSnapshot,
        server: serverSnapshot,
        detectedAt: Date.now(),
      },
    };
  }

  /**
   * Get conflict resolution strategy from request
   */
  getResolutionStrategy(request: QueuedRequest): ConflictResolutionStrategy {
    return request.conflictResolution || 'manual_merge';
  }
}

export default ConflictResolver;


