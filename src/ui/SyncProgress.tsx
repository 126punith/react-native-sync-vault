import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useOfflineContext } from './OfflineProvider';

interface SyncProgressProps {
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  showText?: boolean;
  size?: 'small' | 'large';
}

/** Spinner while the engine is draining, otherwise the queued count. */
export function SyncProgress({ style, textStyle, showText = true, size = 'small' }: SyncProgressProps) {
  const { isDraining, pendingCount } = useOfflineContext();

  if (!isDraining && pendingCount === 0) return null;

  return (
    <View style={[styles.container, style]}>
      {isDraining && <ActivityIndicator size={size} color="#2196F3" style={styles.spinner} />}
      {showText && (
        <Text style={[styles.text, textStyle]}>
          {isDraining
            ? `Syncing${pendingCount > 0 ? ` ${pendingCount} items` : ''}...`
            : `${pendingCount} item${pendingCount !== 1 ? 's' : ''} queued`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  spinner: {
    marginRight: 8,
  },
  text: {
    fontSize: 12,
    color: '#666',
  },
});
