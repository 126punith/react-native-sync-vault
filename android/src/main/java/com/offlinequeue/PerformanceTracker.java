package com.offlinequeue;

import java.util.HashMap;
import java.util.Map;

public class PerformanceTracker {
    private static PerformanceTracker instance;
    private Map<String, Double> metrics;

    private PerformanceTracker() {
        metrics = new HashMap<>();
    }

    public static synchronized PerformanceTracker getInstance() {
        if (instance == null) {
            instance = new PerformanceTracker();
        }
        return instance;
    }

    public void trackInitializationTime(double timeMs) {
        metrics.put("initializationTime", timeMs);
    }

    public void trackEnqueueTime(double timeMs) {
        Double current = metrics.get("averageEnqueueTime");
        if (current != null) {
            double avg = (current + timeMs) / 2.0;
            metrics.put("averageEnqueueTime", avg);
        } else {
            metrics.put("averageEnqueueTime", timeMs);
        }
    }

    public void trackSyncTime(double timeMs) {
        Double current = metrics.get("averageSyncTime");
        if (current != null) {
            double avg = (current + timeMs) / 2.0;
            metrics.put("averageSyncTime", avg);
        } else {
            metrics.put("averageSyncTime", timeMs);
        }
    }

    public Map<String, Double> getMetrics() {
        return new HashMap<>(metrics);
    }

    public void reset() {
        metrics.clear();
    }
}


