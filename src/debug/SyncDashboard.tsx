import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSyncMetrics } from '../hooks/useSyncMetrics';

/**
 * Sync Dashboard
 * Debug component for viewing sync metrics
 */
export function SyncDashboard() {
  const { metrics, loading, error, refetch, recordSyncEvent } = useSyncMetrics();

  const formatTime = (ms: number): string => {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatPercentage = (value: number): string => {
    return `${(value * 100).toFixed(1)}%`;
  };

  if (loading && !metrics) {
    return (
      <View style={styles.container}>
        <Text style={styles.loading}>Loading metrics...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Error: {error.message}</Text>
      </View>
    );
  }

  if (!metrics) {
    return null;
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Sync Dashboard</Text>
        <TouchableOpacity onPress={refetch} style={styles.refreshButton}>
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Queue Status</Text>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Queue Size:</Text>
          <Text style={styles.metricValue}>{metrics.queueSize}</Text>
        </View>
        {metrics.oldestQueuedItem && (
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Oldest Item:</Text>
            <Text style={styles.metricValue}>{metrics.oldestQueuedItem}</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Performance</Text>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Cache Hit Rate:</Text>
          <Text style={styles.metricValue}>
            {formatPercentage(metrics.cacheHitRate)}
          </Text>
        </View>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Sync Success Rate:</Text>
          <Text style={styles.metricValue}>
            {formatPercentage(metrics.syncSuccessRate)}
          </Text>
        </View>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Avg Sync Time:</Text>
          <Text style={styles.metricValue}>
            {formatTime(metrics.averageSyncTime)}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Network</Text>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Status:</Text>
          <Text style={styles.metricValue}>{metrics.networkQuality}</Text>
        </View>
        {metrics.lastSyncAt && (
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Last Sync:</Text>
            <Text style={styles.metricValue}>
              {metrics.lastSyncAt.toLocaleTimeString()}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  refreshButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#2196F3',
    borderRadius: 4,
  },
  refreshText: {
    color: '#fff',
    fontSize: 12,
  },
  section: {
    marginBottom: 24,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metricLabel: {
    fontSize: 14,
    color: '#666',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  loading: {
    textAlign: 'center',
    padding: 20,
    color: '#666',
  },
  error: {
    textAlign: 'center',
    padding: 20,
    color: '#f44336',
  },
});

