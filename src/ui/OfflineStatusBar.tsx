import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useOfflineContext } from './OfflineProvider';

interface OfflineStatusBarProps {
  position?: 'top' | 'bottom';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  showQueueCount?: boolean;
}

/** Connection status plus queued and failed counts. Hidden when online with nothing queued. */
export function OfflineStatusBar({ position = 'top', style, textStyle, showQueueCount = true }: OfflineStatusBarProps) {
  const { isOnline, pendingCount, counts } = useOfflineContext();

  if (isOnline && pendingCount === 0 && counts.deadLetter === 0) return null;

  const parts = [isOnline ? 'Online' : 'Offline'];
  if (showQueueCount && pendingCount > 0) parts.push(`${pendingCount} queued`);
  if (showQueueCount && counts.deadLetter > 0) parts.push(`${counts.deadLetter} failed`);

  return (
    <View style={[styles.container, position === 'top' ? styles.top : styles.bottom, style]} accessibilityRole="summary">
      <View style={[styles.indicator, isOnline ? styles.online : styles.offline]} />
      <Text style={[styles.text, textStyle]}>{parts.join(' • ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f0f0f0',
  },
  top: {
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  bottom: {
    borderTopWidth: 1,
    borderTopColor: '#ddd',
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  online: {
    backgroundColor: '#4CAF50',
  },
  offline: {
    backgroundColor: '#f44336',
  },
  text: {
    fontSize: 12,
    color: '#333',
  },
});
