import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useQueueStatus } from '../hooks/useQueueStatus';
import { usePendingRequests } from '../hooks/usePendingRequests';
import { useFailedRequests } from '../hooks/useFailedRequests';
import { performanceTracker } from '../utils/performance';
import { QueueLogger } from './QueueLogger';

/**
 * Debug screen component for visualizing queue status
 */
export function DebugScreen() {
  // Disable polling in DebugScreen to avoid duplicate calls (App.tsx already polls)
  // Use refetch manually via refresh control instead
  const { status, refetch: refetchStatus } = useQueueStatus(0);
  const { pendingRequests, refetch: refetchPending } = usePendingRequests(20, 0);
  const { failedRequests, refetch: refetchFailed, retry } = useFailedRequests(0);
  const [metrics, setMetrics] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadMetrics();
    loadLogs();
  }, []);

  const loadMetrics = async () => {
    try {
      const perfMetrics = await performanceTracker.getMetrics();
      setMetrics(perfMetrics);
    } catch (error) {
      console.error('Failed to load metrics:', error);
    }
  };

  const loadLogs = () => {
    const recentLogs = QueueLogger.getLogs().slice(-50);
    setLogs(recentLogs);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refetchStatus(),
      refetchPending(),
      refetchFailed(),
      loadMetrics(),
      loadLogs(),
    ]);
    setRefreshing(false);
  };

  const handleRetry = async (requestId: string) => {
    await retry(requestId);
    await refetchFailed();
    await refetchPending();
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.section}>
        <Text style={styles.title}>Queue Status</Text>
        {status && (
          <View style={styles.statusGrid}>
            <View style={styles.statusItem}>
              <Text style={styles.statusLabel}>Network</Text>
              <Text
                style={[
                  styles.statusValue,
                  status.networkStatus === 'online'
                    ? styles.online
                    : styles.offline,
                ]}
              >
                {status.networkStatus}
              </Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusLabel}>Pending</Text>
              <Text style={styles.statusValue}>{status.totalPending}</Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusLabel}>Failed</Text>
              <Text style={styles.statusValue}>{status.totalFailed}</Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusLabel}>Syncing</Text>
              <Text style={styles.statusValue}>
                {status.syncInProgress ? 'Yes' : 'No'}
              </Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusLabel}>Total Synced</Text>
              <Text style={styles.statusValue}>{status.totalSynced || 0}</Text>
            </View>
          </View>
        )}
      </View>

      {metrics && (
        <View style={styles.section}>
          <Text style={styles.title}>Performance Metrics</Text>
          <View style={styles.metricsList}>
            <Text style={styles.metricItem}>
              Init Time: {metrics.initializationTime?.toFixed(2)}ms
            </Text>
            <Text style={styles.metricItem}>
              Avg Enqueue: {metrics.averageEnqueueTime?.toFixed(2)}ms
            </Text>
            <Text style={styles.metricItem}>
              Avg Sync: {metrics.averageSyncTime?.toFixed(2)}ms
            </Text>
            <Text style={styles.metricItem}>
              Memory: {metrics.memoryOverhead?.toFixed(2)}KB
            </Text>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.title}>Pending Requests ({pendingRequests.length})</Text>
        {pendingRequests.map((request) => (
          <View key={request.id} style={styles.requestItem}>
            <Text style={styles.requestMethod}>{request.method}</Text>
            <Text style={styles.requestUrl}>{request.url}</Text>
            <Text style={styles.requestStatus}>Status: {request.status}</Text>
            <Text style={styles.requestPriority}>Priority: {request.priority}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Failed Requests ({failedRequests.length})</Text>
        {failedRequests.map((request: any) => (
          <View key={request.id} style={styles.requestItem}>
            <Text style={styles.requestMethod}>{request.method}</Text>
            <Text style={styles.requestUrl}>{request.url}</Text>
            <Text style={styles.errorMessage}>
              Error: {request.errorMessage}
            </Text>
            <Text style={styles.failureType}>
              Type: {request.failureType}
            </Text>
            {request.willRetry && (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => handleRetry(request.requestId)}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Recent Logs ({logs.length})</Text>
        {logs.slice(-20).map((log, index) => (
          <View key={index} style={styles.logItem}>
            <Text style={styles.logLevel}>{log.level}</Text>
            <Text style={styles.logMessage}>{log.message}</Text>
            <Text style={styles.logTime}>
              {new Date(log.timestamp).toLocaleTimeString()}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  section: {
    backgroundColor: '#fff',
    margin: 10,
    padding: 15,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statusItem: {
    width: '48%',
    marginBottom: 10,
  },
  statusLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  online: {
    color: '#4CAF50',
  },
  offline: {
    color: '#F44336',
  },
  metricsList: {
    marginTop: 10,
  },
  metricItem: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  requestItem: {
    borderLeftWidth: 3,
    borderLeftColor: '#2196F3',
    paddingLeft: 10,
    marginBottom: 15,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  requestMethod: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2196F3',
    marginBottom: 4,
  },
  requestUrl: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  requestStatus: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  requestPriority: {
    fontSize: 12,
    color: '#666',
  },
  errorMessage: {
    fontSize: 12,
    color: '#F44336',
    marginTop: 4,
    marginBottom: 2,
  },
  failureType: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  retryButton: {
    backgroundColor: '#4CAF50',
    padding: 8,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 5,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  logItem: {
    flexDirection: 'row',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  logLevel: {
    fontSize: 10,
    fontWeight: 'bold',
    width: 50,
    textTransform: 'uppercase',
  },
  logMessage: {
    flex: 1,
    fontSize: 12,
    color: '#666',
    marginLeft: 10,
  },
  logTime: {
    fontSize: 10,
    color: '#999',
    marginLeft: 10,
  },
});


