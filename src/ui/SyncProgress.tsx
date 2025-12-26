import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { useOfflineContext } from './OfflineProvider';

/**
 * Sync Progress Props
 */
interface SyncProgressProps {
  style?: ViewStyle;
  textStyle?: TextStyle;
  showText?: boolean;
  size?: 'small' | 'large';
}

/**
 * Sync Progress
 * Shows sync progress indicator
 */
export function SyncProgress({
  style,
  textStyle,
  showText = true,
  size = 'small',
}: SyncProgressProps) {
  const { isSyncing, queueSize } = useOfflineContext();

  if (!isSyncing && queueSize === 0) {
    return null;
  }

  return (
    <View style={[styles.container, style]}>
      {isSyncing && (
        <>
          <ActivityIndicator size={size} color="#2196F3" style={styles.spinner} />
          {showText && (
            <Text style={[styles.text, textStyle]}>
              Syncing{queueSize > 0 ? ` ${queueSize} items` : ''}...
            </Text>
          )}
        </>
      )}
      {!isSyncing && queueSize > 0 && showText && (
        <Text style={[styles.text, textStyle]}>
          {queueSize} item{queueSize !== 1 ? 's' : ''} queued
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

