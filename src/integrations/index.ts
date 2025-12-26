/**
 * Integration Layer
 * Adapters for popular state management libraries
 */

// React Query integration
export { withSyncVault as withSyncVaultReactQuery, useReactQueryWithSyncVault } from './react-query';

// Zustand integration
export { withSyncVault as withSyncVaultZustand, useZustandWithSyncVault } from './zustand';

// Redux integration
export { withSyncVault as withSyncVaultRedux, createSyncVaultMiddleware } from './redux';

