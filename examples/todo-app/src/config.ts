import {Platform} from 'react-native';

/** The reference server (`npm run server`). The Android emulator reaches the host via 10.0.2.2. */
export const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';

/**
 * Stand-in for a real token store. The contract runner rotates it to exercise the 401 flow;
 * SyncVault asks for it through getAuthHeaders whenever native needs fresh credentials.
 */
export const auth = {token: 'demo-token'};
