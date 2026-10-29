/**
 * Minimal react-native surface for Node tests. The SyncVault Turbo Module is never registered
 * here; tests install MemorySyncVault via setNativeImplementation().
 */
export const TurboModuleRegistry = {
  get: () => null,
  getEnforcing: (name: string) => {
    throw new Error(`TurboModuleRegistry.getEnforcing(...): '${name}' could not be found.`);
  },
};

export const StyleSheet = {
  create: <T>(styles: T): T => styles,
  hairlineWidth: 1,
};

export const Platform = { OS: 'ios', select: <T>(spec: { ios?: T; default?: T }) => spec.ios ?? spec.default };

const component = (name: string) => {
  const C = () => null;
  C.displayName = name;
  return C;
};

export const View = component('View');
export const Text = component('Text');
export const ScrollView = component('ScrollView');
export const TouchableOpacity = component('TouchableOpacity');
export const ActivityIndicator = component('ActivityIndicator');
export const RefreshControl = component('RefreshControl');
