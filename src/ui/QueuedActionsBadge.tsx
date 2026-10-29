import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useOfflineContext } from './OfflineProvider';

interface QueuedActionsBadgeProps {
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  badgeStyle?: StyleProp<ViewStyle>;
  showWhenZero?: boolean;
}

/** Count of requests waiting for delivery. */
export function QueuedActionsBadge({ style, textStyle, badgeStyle, showWhenZero = false }: QueuedActionsBadgeProps) {
  const { pendingCount } = useOfflineContext();

  if (pendingCount === 0 && !showWhenZero) return null;

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.badge, badgeStyle]}>
        <Text style={[styles.text, textStyle]}>{pendingCount}</Text>
      </View>
      <Text style={[styles.label, textStyle]}>pending</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    backgroundColor: '#ff9800',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  label: {
    fontSize: 12,
    color: '#666',
  },
});
