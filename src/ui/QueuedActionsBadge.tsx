import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { useOfflineContext } from './OfflineProvider';

/**
 * Queued Actions Badge Props
 */
interface QueuedActionsBadgeProps {
  style?: ViewStyle;
  textStyle?: TextStyle;
  badgeStyle?: ViewStyle;
  showWhenZero?: boolean;
}

/**
 * Queued Actions Badge
 * Shows count of pending queued actions
 */
export function QueuedActionsBadge({
  style,
  textStyle,
  badgeStyle,
  showWhenZero = false,
}: QueuedActionsBadgeProps) {
  const { queueSize } = useOfflineContext();

  if (queueSize === 0 && !showWhenZero) {
    return null;
  }

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.badge, badgeStyle]}>
        <Text style={[styles.text, textStyle]}>{queueSize}</Text>
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

