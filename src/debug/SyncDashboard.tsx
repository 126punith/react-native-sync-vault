import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSyncMetrics } from '../hooks/useSyncMetrics';

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

/** Compact session metrics panel. */
export function SyncDashboard({ style }: { style?: StyleProp<ViewStyle> }) {
  const m = useSyncMetrics();
  return (
    <View style={[styles.container, style]}>
      <Metric label="Queued" value={m.queueSize} />
      <Metric label="Delivered" value={m.succeeded} />
      <Metric label="Failed" value={m.deadLetterCount} />
      <Metric label="Conflicts" value={m.conflictCount} />
      <Metric label="Retries" value={m.retries} />
      <Metric label="Success" value={`${Math.round(m.successRate * 100)}%`} />
      <Metric label="Avg delivery" value={`${Math.round(m.averageDeliveryMs)}ms`} />
      <Metric label="Last sync" value={m.lastDrainAt ? new Date(m.lastDrainAt).toLocaleTimeString() : '—'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', flexWrap: 'wrap', padding: 8 },
  metric: { width: '25%', padding: 8, alignItems: 'center' },
  value: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 11, color: '#666' },
});
