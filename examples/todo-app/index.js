import {AppRegistry} from 'react-native';
import {SyncVault} from 'react-native-sync-vault';
import App from './App';
import {name as appName} from './app.json';
import {API_URL, auth} from './src/config';

// Configure once, outside React: native keeps delivering even when no screen is mounted.
SyncVault.configure({
  baseUrl: API_URL,
  maxAttempts: 10,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 10_000,
  backgroundIntervalMinutes: 15,
  getAuthHeaders: async () => ({Authorization: `Bearer ${auth.token}`}),
  onError: (error, context) => console.warn(`[SyncVault] ${context}`, error),
});

AppRegistry.registerComponent(appName, () => App);
