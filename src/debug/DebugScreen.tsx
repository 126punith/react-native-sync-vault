import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { SyncRequest } from '../core/types';
import { useConflicts, useFailedRequests, usePendingRequests } from '../hooks/useRequests';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { QueueLogger, type LogEntry } from './QueueLogger';

function RequestRow({ request, actions }: { request: SyncRequest; actions?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>
        {request.method} {request.url}
      </Text>
      <Text style={styles.rowMeta}>
        {request.status} · attempt {request.attempt}/{request.maxAttempts}
        {request.queueKey ? ` · ${request.queueKey}` : ''}
        {request.authBlocked ? ' · waiting for auth' : ''}
      </Text>
      {request.lastError ? <Text style={styles.rowError}>{request.lastError}</Text> : null}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress} accessibilityRole="button">
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Development screen: queue state, outbox contents, dead letters, conflicts, and event log. */
export function DebugScreen() {
  const status = useSyncStatus();
  const pending = usePendingRequests(50);
  const failed = useFailedRequests(50);
  const conflicts = useConflicts(50);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    QueueLogger.start();
    setLogs(QueueLogger.getLogs().slice(-50));
  }, [status.version]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([pending.refresh(), failed.refresh(), conflicts.refresh()]);
    setRefreshing(false);
  };

  const { counts } = status;
  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.section}>
        <Text style={styles.title}>Status</Text>
        <Text style={styles.line}>
          Network: {status.isOnline ? 'online' : 'offline'} ({status.network.type})
          {status.network.isExpensive ? ', metered' : ''}
        </Text>
        <Text style={styles.line}>Draining: {status.isDraining ? 'yes' : 'no'}</Text>
        <Text style={styles.line}>
          Pending {counts.pending} · In flight {counts.inflight} · Conflicts {counts.conflict} · Dead letters {counts.deadLetter} ·
          Auth blocked {counts.authBlocked}
        </Text>
        <View style={styles.actions}>
          <Button label="Drain now" onPress={status.drainNow} />
          <Button label="Retry all failed" onPress={() => void status.retryAllDeadLetters()} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Pending ({pending.requests.length})</Text>
        {pending.requests.map((r) => (
          <RequestRow key={r.id} request={r} />
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Dead letters ({failed.requests.length})</Text>
        {failed.requests.map((r) => (
          <RequestRow
            key={r.id}
            request={r}
            actions={
              <>
                <Button label="Retry" onPress={() => void failed.retry(r.id)} />
                <Button label="Discard" onPress={() => void failed.discard(r.id)} />
              </>
            }
          />
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Conflicts ({conflicts.requests.length})</Text>
        {conflicts.requests.map((r) => (
          <RequestRow
            key={r.id}
            request={r}
            actions={
              <>
                <Button label="Keep local" onPress={() => void conflicts.resolve(r.id, { action: 'keep_local' })} />
                <Button label="Keep server" onPress={() => void conflicts.resolve(r.id, { action: 'keep_server' })} />
              </>
            }
          />
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Events</Text>
        {logs
          .slice()
          .reverse()
          .map((log, i) => (
            <Text key={`${log.timestamp}-${i}`} style={[styles.log, log.level === 'error' && styles.rowError]}>
              {new Date(log.timestamp).toLocaleTimeString()} {log.message}
            </Text>
          ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fafafa' },
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  title: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  line: { fontSize: 13, color: '#333', marginBottom: 4 },
  row: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd' },
  rowTitle: { fontSize: 13, fontWeight: '500' },
  rowMeta: { fontSize: 12, color: '#666' },
  rowError: { fontSize: 12, color: '#c62828' },
  actions: { flexDirection: 'row', marginTop: 6 },
  button: { backgroundColor: '#1976d2', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, marginRight: 8 },
  buttonText: { color: '#fff', fontSize: 12 },
  log: { fontSize: 11, fontFamily: 'Courier', color: '#444' },
});
