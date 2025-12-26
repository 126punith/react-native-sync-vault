import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { useOfflineContext } from './OfflineProvider';

/**
 * Offline Status Bar Props
 */
interface OfflineStatusBarProps {
  position?: 'top' | 'bottom';
  style?: ViewStyle;
  textStyle?: TextStyle;
  showQueueCount?: boolean;
}

/**
 * Offline Status Bar
 * Shows connection status and queued actions count
 */
export function OfflineStatusBar({
  position = 'top',
  style,
  textStyle,
  showQueueCount = true,
}: OfflineStatusBarProps) {
  const { isOnline, queueSize } = useOfflineContext();

  if (isOnline && queueSize === 0) {
    return null; // Don't show when online and nothing queued
  }

  const containerStyle = [
    styles.container,
    position === 'top' ? styles.top : styles.bottom,
    style,
  ] as ViewStyle;

  return (
    <View style={containerStyle}>
      <View style={[styles.indicator, isOnline ? styles.online : styles.offline]} />
      <Text style={[styles.text, textStyle]}>
        {isOnline ? 'Online' : 'Offline'}
        {showQueueCount && queueSize > 0 && ` • ${queueSize} queued`}
      </Text>
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
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  top: {
    borderBottomWidth: 1,
    borderTopWidth: 0,
  },
  bottom: {
    borderTopWidth: 1,
    borderBottomWidth: 0,
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

