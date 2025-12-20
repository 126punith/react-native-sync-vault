package com.offlinequeue;

import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.Manifest;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableMapKeySetIterator;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class OfflineQueueModule extends ReactContextBaseJavaModule {
    private static final String TAG = "OfflineQueueModule";
    private DatabaseManager dbManager;
    private PerformanceTracker performanceTracker;
    private long initializationStartTime;
    
    // Network monitoring
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private String currentNetworkStatus = "unknown";

    public OfflineQueueModule(ReactApplicationContext reactContext) {
        super(reactContext);
        initializationStartTime = System.currentTimeMillis();
        dbManager = new DatabaseManager(reactContext);
        performanceTracker = PerformanceTracker.getInstance();
        
        // Initialize network monitoring
        try {
            connectivityManager = (ConnectivityManager) reactContext.getSystemService(Context.CONNECTIVITY_SERVICE);
            
            // Check permission before initializing network monitoring
            if (hasNetworkPermission()) {
                setupNetworkCallback();
                // Get initial network status
                currentNetworkStatus = checkNetworkConnectivity();
            } else {
                Log.w(TAG, "ACCESS_NETWORK_STATE permission not granted. Network monitoring will be disabled.");
                currentNetworkStatus = "unknown";
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize network monitoring", e);
            currentNetworkStatus = "unknown";
        }
        
        long initTime = System.currentTimeMillis() - initializationStartTime;
        performanceTracker.trackInitializationTime(initTime);
    }

    @Override
    public String getName() {
        return "OfflineQueue";
    }

    // Database operations
    @ReactMethod
    public void executeSql(String query, ReadableArray params, Promise promise) {
        try {
            SQLiteDatabase db = dbManager.getWritableDatabase();
            Cursor cursor = null;
            
            try {
                String[] paramArray = null;
                if (params != null && params.size() > 0) {
                    paramArray = new String[params.size()];
                    for (int i = 0; i < params.size(); i++) {
                        com.facebook.react.bridge.ReadableType paramType = params.getType(i);
                        if (paramType == com.facebook.react.bridge.ReadableType.Null) {
                            paramArray[i] = null;
                        } else if (paramType == com.facebook.react.bridge.ReadableType.String) {
                            paramArray[i] = params.getString(i);
                        } else if (paramType == com.facebook.react.bridge.ReadableType.Number) {
                            paramArray[i] = String.valueOf(params.getDouble(i));
                        } else if (paramType == com.facebook.react.bridge.ReadableType.Boolean) {
                            paramArray[i] = params.getBoolean(i) ? "1" : "0";
                        } else {
                            // Fallback for other types
                            paramArray[i] = String.valueOf(params.getDynamic(i).asString());
                        }
                    }
                }
                
                if (query.trim().toUpperCase().startsWith("SELECT")) {
                    cursor = db.rawQuery(query, paramArray);
                    WritableArray results = Arguments.createArray();
                    
                    if (cursor != null && cursor.moveToFirst()) {
                        do {
                            WritableMap row = Arguments.createMap();
                            for (int i = 0; i < cursor.getColumnCount(); i++) {
                                String columnName = cursor.getColumnName(i);
                                int columnType = cursor.getType(i);
                                
                                switch (columnType) {
                                    case Cursor.FIELD_TYPE_INTEGER:
                                        row.putDouble(columnName, cursor.getLong(i));
                                        break;
                                    case Cursor.FIELD_TYPE_FLOAT:
                                        row.putDouble(columnName, cursor.getDouble(i));
                                        break;
                                    case Cursor.FIELD_TYPE_STRING:
                                        row.putString(columnName, cursor.getString(i));
                                        break;
                                    case Cursor.FIELD_TYPE_BLOB:
                                        row.putString(columnName, new String(cursor.getBlob(i)));
                                        break;
                                    case Cursor.FIELD_TYPE_NULL:
                                        row.putNull(columnName);
                                        break;
                                }
                            }
                            results.pushMap(row);
                        } while (cursor.moveToNext());
                    }
                    
                    promise.resolve(results);
                } else {
                    // INSERT/UPDATE/DELETE
                    db.execSQL(query, paramArray);
                    long lastInsertRowId = -1;
                    if (query.trim().toUpperCase().startsWith("INSERT")) {
                        Cursor idCursor = db.rawQuery("SELECT last_insert_rowid()", null);
                        if (idCursor != null && idCursor.moveToFirst()) {
                            lastInsertRowId = idCursor.getLong(0);
                            idCursor.close();
                        }
                    }
                    
                    WritableMap result = Arguments.createMap();
                    result.putInt("changes", 1);
                    result.putDouble("lastInsertRowId", lastInsertRowId);
                    promise.resolve(result);
                }
            } finally {
                if (cursor != null) {
                    cursor.close();
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "SQL execution error", e);
            promise.reject("SQL_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void executeBatch(ReadableArray queries, Promise promise) {
        SQLiteDatabase db = dbManager.getWritableDatabase();
        db.beginTransaction();
        
        try {
            WritableArray results = Arguments.createArray();
            
            for (int i = 0; i < queries.size(); i++) {
                ReadableMap queryObj = queries.getMap(i);
                String query = queryObj.getString("query");
                ReadableArray params = queryObj.getArray("params");
                
                String[] paramArray = null;
                if (params != null && params.size() > 0) {
                    paramArray = new String[params.size()];
                    for (int j = 0; j < params.size(); j++) {
                        Object param = params.getDynamic(j);
                        if (param == null) {
                            paramArray[j] = null;
                        } else {
                            paramArray[j] = String.valueOf(param);
                        }
                    }
                }
                
                db.execSQL(query, paramArray);
                
                WritableMap result = Arguments.createMap();
                result.putInt("changes", 1);
                results.pushMap(result);
            }
            
            db.setTransactionSuccessful();
            promise.resolve(results);
        } catch (Exception e) {
            Log.e(TAG, "Batch execution error", e);
            promise.reject("BATCH_ERROR", e.getMessage(), e);
        } finally {
            db.endTransaction();
        }
    }

    // Request operations
    @ReactMethod
    public void insertRequest(ReadableMap request, Promise promise) {
        long startTime = System.currentTimeMillis();
        Log.d(TAG, "[DEBUG] insertRequest() entry");
        
        try {
            String id = request.hasKey("id") ? request.getString("id") : UUID.randomUUID().toString();
            String requestId = request.hasKey("requestId") ? request.getString("requestId") : null;
            String method = request.getString("method");
            String url = request.getString("url");
            Log.d(TAG, "[DEBUG] insertRequest() params: method=" + method + ", url=" + url + ", id=" + id);
            String headers = request.hasKey("headers") ? jsonToString(request.getMap("headers")) : null;
            String body = request.hasKey("body") ? jsonToString(request.getMap("body")) : null;
            String queryParams = request.hasKey("queryParams") ? jsonToString(request.getMap("queryParams")) : null;
            String status = request.hasKey("status") ? request.getString("status") : "pending";
            int priority = request.hasKey("priority") ? request.getInt("priority") : 0;
            long createdAt = request.hasKey("createdAt") ? (long) request.getDouble("createdAt") : System.currentTimeMillis();
            long updatedAt = System.currentTimeMillis();
            int attemptCount = request.hasKey("attemptCount") ? request.getInt("attemptCount") : 0;
            int maxRetries = request.hasKey("maxRetries") ? request.getInt("maxRetries") : 3;
            String metadata = request.hasKey("metadata") ? jsonToString(request.getMap("metadata")) : null;
            
            String query = "INSERT INTO request_queue (id, request_id, method, url, headers, body, query_params, status, priority, created_at, updated_at, attempt_count, max_retries, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
            
            WritableArray params = Arguments.createArray();
            params.pushString(id);
            params.pushString(requestId);
            params.pushString(method);
            params.pushString(url);
            params.pushString(headers);
            params.pushString(body);
            params.pushString(queryParams);
            params.pushString(status);
            params.pushInt(priority);
            params.pushDouble(createdAt);
            params.pushDouble(updatedAt);
            params.pushInt(attemptCount);
            params.pushInt(maxRetries);
            params.pushString(metadata);
            
            final String finalId = id;
            executeSql(query, params, new Promise() {
                @Override
                public void resolve(Object value) {
                    long enqueueTime = System.currentTimeMillis() - startTime;
                    performanceTracker.trackEnqueueTime(enqueueTime);
                    Log.d(TAG, "[DEBUG] insertRequest() success: id=" + finalId + ", time=" + enqueueTime + "ms");
                    promise.resolve(finalId);
                }
                
                @Override
                public void reject(String code) {
                    promise.reject(code, "Unknown error");
                }
                
                @Override
                public void reject(String code, WritableMap userInfo) {
                    promise.reject(code, userInfo);
                }
                
                @Override
                public void reject(String code, String message) {
                    promise.reject(code, message);
                }
                
                @Override
                public void reject(String code, String message, WritableMap userInfo) {
                    promise.reject(code, message, userInfo);
                }
                
                @Override
                public void reject(String code, Throwable throwable) {
                    promise.reject(code, throwable);
                }
                
                @Override
                public void reject(String code, Throwable throwable, WritableMap userInfo) {
                    promise.reject(code, throwable, userInfo);
                }
                
                @Override
                public void reject(String code, String message, Throwable throwable) {
                    promise.reject(code, message, throwable);
                }
                
                @Override
                public void reject(String code, String message, Throwable throwable, WritableMap userInfo) {
                    promise.reject(code, message, throwable, userInfo);
                }
                
                @Override
                public void reject(Throwable throwable) {
                    promise.reject(throwable);
                }
                
                @Override
                public void reject(Throwable throwable, WritableMap userInfo) {
                    promise.reject(throwable, userInfo);
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "[DEBUG] insertRequest() error: " + e.getMessage(), e);
            promise.reject("INSERT_ERROR", e.getMessage(), e);
            return;
        }
    }

    @ReactMethod
    public void updateRequestStatus(String requestId, String status, ReadableMap data, Promise promise) {
        try {
            StringBuilder query = new StringBuilder("UPDATE request_queue SET status = ?, updated_at = ?");
            WritableArray params = Arguments.createArray();
            params.pushString(status);
            params.pushDouble(System.currentTimeMillis());
            
            if (data != null) {
                if (data.hasKey("serverResponse")) {
                    query.append(", server_response = ?");
                    params.pushString(jsonToString(data.getMap("serverResponse")));
                }
                if (data.hasKey("syncedAt")) {
                    query.append(", synced_at = ?");
                    params.pushDouble(data.getDouble("syncedAt"));
                }
                if (data.hasKey("attemptCount")) {
                    query.append(", attempt_count = ?");
                    params.pushInt(data.getInt("attemptCount"));
                }
                if (data.hasKey("lastAttemptAt")) {
                    query.append(", last_attempt_at = ?");
                    params.pushDouble(data.getDouble("lastAttemptAt"));
                }
                if (data.hasKey("retryAfter")) {
                    query.append(", retry_after = ?");
                    params.pushDouble(data.getDouble("retryAfter"));
                }
            }
            
            query.append(" WHERE id = ?");
            params.pushString(requestId);
            
            executeSql(query.toString(), params, promise);
        } catch (Exception e) {
            Log.e(TAG, "Update request status error", e);
            promise.reject("UPDATE_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void getPendingRequests(int limit, int offset, Promise promise) {
        Log.e(TAG, "[DEBUG] getPendingRequests() ENTRY: limit=" + limit + ", offset=" + offset);
        try {
            long currentTime = System.currentTimeMillis();
            SQLiteDatabase db = dbManager.getWritableDatabase();
            
            // Run the actual pending query and parse JSON fields
            String query = "SELECT * FROM request_queue WHERE status = 'pending' OR (status = 'failed' AND retry_after IS NOT NULL AND retry_after <= ?) ORDER BY priority DESC, created_at ASC LIMIT " + limit + " OFFSET " + offset;
            
            android.database.Cursor cursor = null;
            try {
                cursor = db.rawQuery(query, new String[]{String.valueOf(currentTime)});
                WritableArray results = Arguments.createArray();
                
                if (cursor != null && cursor.moveToFirst()) {
                    do {
                        WritableMap row = Arguments.createMap();
                        for (int i = 0; i < cursor.getColumnCount(); i++) {
                            String columnName = cursor.getColumnName(i);
                            int columnType = cursor.getType(i);
                            
                            // Convert snake_case to camelCase for JavaScript
                            String jsKey = columnName.equals("query_params") ? "queryParams" :
                                         columnName.equals("request_id") ? "requestId" :
                                         columnName.equals("created_at") ? "createdAt" :
                                         columnName.equals("updated_at") ? "updatedAt" :
                                         columnName.equals("last_attempt_at") ? "lastAttemptAt" :
                                         columnName.equals("synced_at") ? "syncedAt" :
                                         columnName.equals("attempt_count") ? "attemptCount" :
                                         columnName.equals("max_retries") ? "maxRetries" :
                                         columnName.equals("retry_after") ? "retryAfter" :
                                         columnName.equals("local_data_id") ? "localDataId" :
                                         columnName.equals("server_response") ? "serverResponse" :
                                         columnName.equals("conflict_data") ? "conflictData" :
                                         columnName.equals("conflict_resolution") ? "conflictResolution" :
                                         columnName;
                            
                            // Parse JSON fields (body, headers, queryParams, etc.) back into objects
                            if (columnName.equals("headers") || columnName.equals("body") || 
                                columnName.equals("query_params") || columnName.equals("server_response") || 
                                columnName.equals("metadata") || columnName.equals("conflict_data")) {
                                if (cursor.isNull(i)) {
                                    row.putNull(jsKey);
                                } else {
                                    String jsonString = cursor.getString(i);
                                    Object parsed = jsonStringToObject(jsonString);
                                    if (parsed instanceof ReadableMap) {
                                        row.putMap(jsKey, (ReadableMap) parsed);
                                    } else if (parsed instanceof ReadableArray) {
                                        row.putArray(jsKey, (ReadableArray) parsed);
                                    } else {
                                        row.putString(jsKey, jsonString);
                                    }
                                }
                            } else {
                                // Regular fields
                                switch (columnType) {
                                    case Cursor.FIELD_TYPE_INTEGER:
                                        row.putDouble(jsKey, cursor.getLong(i));
                                        break;
                                    case Cursor.FIELD_TYPE_FLOAT:
                                        row.putDouble(jsKey, cursor.getDouble(i));
                                        break;
                                    case Cursor.FIELD_TYPE_STRING:
                                        row.putString(jsKey, cursor.getString(i));
                                        break;
                                    case Cursor.FIELD_TYPE_BLOB:
                                        row.putString(jsKey, new String(cursor.getBlob(i)));
                                        break;
                                    case Cursor.FIELD_TYPE_NULL:
                                        row.putNull(jsKey);
                                        break;
                                }
                            }
                        }
                        results.pushMap(row);
                    } while (cursor.moveToNext());
                }
                
                if (cursor != null) {
                    cursor.close();
                }
                promise.resolve(results);
            } catch (Exception e) {
                Log.e(TAG, "[DEBUG] getPendingRequests() error: " + e.getMessage(), e);
                if (cursor != null) {
                    cursor.close();
                }
                promise.reject("QUERY_ERROR", e.getMessage(), e);
            }
        } catch (Exception e) {
            Log.e(TAG, "[DEBUG] getPendingRequests() error: " + e.getMessage(), e);
            e.printStackTrace();
            promise.reject("QUERY_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void getFailedRequests(Promise promise) {
        try {
            String query = "SELECT fr.*, rq.method, rq.url FROM failed_requests fr JOIN request_queue rq ON fr.request_id = rq.id ORDER BY fr.created_at DESC";
            executeSql(query, Arguments.createArray(), promise);
        } catch (Exception e) {
            Log.e(TAG, "Get failed requests error", e);
            promise.reject("QUERY_ERROR", e.getMessage(), e);
        }
    }

    // Sync operations
    @ReactMethod
    public void getSyncStatus(Promise promise) {
        Log.d(TAG, "[DEBUG] getSyncStatus() entry");
        try {
            String query = "SELECT * FROM sync_status ORDER BY id DESC LIMIT 1";
            executeSql(query, Arguments.createArray(), promise);
        } catch (Exception e) {
            Log.e(TAG, "[DEBUG] getSyncStatus() error: " + e.getMessage(), e);
            promise.reject("QUERY_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void updateSyncStatus(ReadableMap updates, Promise promise) {
        Log.d(TAG, "[DEBUG] updateSyncStatus() entry");
        try {
            StringBuilder query = new StringBuilder("UPDATE sync_status SET updated_at = ?");
            WritableArray params = Arguments.createArray();
            params.pushDouble(System.currentTimeMillis());
            
            // Convert ReadableMap to HashMap for iteration
            HashMap<String, Object> updatesMap = readableMapToHashMap(updates);
            Log.d(TAG, "[DEBUG] updateSyncStatus() updates: " + updatesMap.toString());
            for (Map.Entry<String, Object> entry : updatesMap.entrySet()) {
                String key = entry.getKey();
                if (!key.equals("updated_at") && !key.equals("updatedAt")) {
                    // Convert camelCase to snake_case for database column names
                    String dbColumn = camelToSnakeCase(key);
                    query.append(", ").append(dbColumn).append(" = ?");
                    Object value = entry.getValue();
                    if (value instanceof String) {
                        params.pushString((String) value);
                    } else if (value instanceof Integer) {
                        params.pushInt((Integer) value);
                    } else if (value instanceof Double) {
                        params.pushDouble((Double) value);
                    } else if (value instanceof Long) {
                        params.pushDouble(((Long) value).doubleValue());
                    } else if (value instanceof Boolean) {
                        params.pushInt((Boolean) value ? 1 : 0);
                    } else {
                        params.pushString(String.valueOf(value));
                    }
                }
            }
            
            query.append(" WHERE id = (SELECT id FROM sync_status ORDER BY id DESC LIMIT 1)");
            executeSql(query.toString(), params, promise);
        } catch (Exception e) {
            Log.e(TAG, "Update sync status error", e);
            promise.reject("UPDATE_ERROR", e.getMessage(), e);
        }
    }
    
    // Network status operations
    @ReactMethod
    public void getNetworkStatus(Promise promise) {
        Log.d(TAG, "[DEBUG] getNetworkStatus() called from JavaScript");
        try {
            String status = checkNetworkConnectivity();
            Log.d(TAG, "[DEBUG] getNetworkStatus() returning: " + status);
            promise.resolve(status);
        } catch (Exception e) {
            Log.e(TAG, "[DEBUG] getNetworkStatus() error", e);
            promise.reject("NETWORK_ERROR", e.getMessage(), e);
        }
    }
    
    @ReactMethod
    public void hasNetworkPermission(Promise promise) {
        try {
            boolean hasPermission = hasNetworkPermission();
            promise.resolve(hasPermission);
        } catch (Exception e) {
            Log.e(TAG, "Error checking network permission", e);
            promise.reject("PERMISSION_CHECK_ERROR", e.getMessage(), e);
        }
    }
    
    /**
     * Check if ACCESS_NETWORK_STATE permission is granted
     */
    private boolean hasNetworkPermission() {
        return ContextCompat.checkSelfPermission(
            getReactApplicationContext(),
            Manifest.permission.ACCESS_NETWORK_STATE
        ) == PackageManager.PERMISSION_GRANTED;
    }
    
    /**
     * Check current network connectivity
     */
    private String checkNetworkConnectivity() {
        Log.d(TAG, "[DEBUG] checkNetworkConnectivity() entry");
        
        // Check permission first
        if (!hasNetworkPermission()) {
            Log.w(TAG, "[DEBUG] checkNetworkConnectivity() ACCESS_NETWORK_STATE permission not granted");
            return "unknown";
        }
        
        if (connectivityManager == null) {
            Log.d(TAG, "[DEBUG] checkNetworkConnectivity() connectivityManager is null");
            return "unknown";
        }
        
        try {
            Network activeNetwork = connectivityManager.getActiveNetwork();
            Log.d(TAG, "[DEBUG] checkNetworkConnectivity() activeNetwork: " + (activeNetwork != null ? "exists" : "null"));
            if (activeNetwork == null) {
                return "offline";
            }
            
            NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(activeNetwork);
            Log.d(TAG, "[DEBUG] checkNetworkConnectivity() capabilities: " + (capabilities != null ? "exists" : "null"));
            if (capabilities == null) {
                return "offline";
            }
            
            boolean hasInternet = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                                 capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
            Log.d(TAG, "[DEBUG] checkNetworkConnectivity() hasInternet: " + hasInternet);
            
            String status = hasInternet ? "online" : "offline";
            Log.d(TAG, "[DEBUG] checkNetworkConnectivity() returning: " + status);
            return status;
        } catch (SecurityException e) {
            Log.e(TAG, "[DEBUG] checkNetworkConnectivity() SecurityException - permission denied", e);
            return "unknown";
        } catch (Exception e) {
            Log.e(TAG, "[DEBUG] checkNetworkConnectivity() error", e);
            return "unknown";
        }
    }
    
    /**
     * Setup network change callback
     */
    private void setupNetworkCallback() {
        if (connectivityManager == null) {
            return;
        }
        
        // Check permission before setting up callback
        if (!hasNetworkPermission()) {
            Log.w(TAG, "ACCESS_NETWORK_STATE permission not granted. Network callback will not be registered.");
            return;
        }
        
        try {
            NetworkRequest networkRequest = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
            
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    String newStatus = checkNetworkConnectivity();
                    if (!newStatus.equals(currentNetworkStatus)) {
                        String previousStatus = currentNetworkStatus;
                        currentNetworkStatus = newStatus;
                        emitNetworkStatusChange(previousStatus, newStatus);
                    }
                }
                
                @Override
                public void onLost(Network network) {
                    String newStatus = "offline";
                    if (!newStatus.equals(currentNetworkStatus)) {
                        String previousStatus = currentNetworkStatus;
                        currentNetworkStatus = newStatus;
                        emitNetworkStatusChange(previousStatus, newStatus);
                    }
                }
                
                @Override
                public void onCapabilitiesChanged(Network network, NetworkCapabilities networkCapabilities) {
                    String newStatus = checkNetworkConnectivity();
                    if (!newStatus.equals(currentNetworkStatus)) {
                        String previousStatus = currentNetworkStatus;
                        currentNetworkStatus = newStatus;
                        emitNetworkStatusChange(previousStatus, newStatus);
                    }
                }
            };
            
            connectivityManager.registerNetworkCallback(networkRequest, networkCallback);
        } catch (SecurityException e) {
            Log.e(TAG, "Failed to setup network callback - permission denied", e);
        } catch (Exception e) {
            Log.e(TAG, "Failed to setup network callback", e);
        }
    }
    
    /**
     * Emit network status change event to JavaScript
     */
    private void emitNetworkStatusChange(String previousStatus, String currentStatus) {
        Log.d(TAG, "[DEBUG] emitNetworkStatusChange() previous: " + previousStatus + ", current: " + currentStatus);
        try {
            WritableMap params = Arguments.createMap();
            params.putString("status", currentStatus);
            params.putString("previousStatus", previousStatus);
            
            ReactApplicationContext reactContext = getReactApplicationContext();
            if (reactContext != null) {
                Log.d(TAG, "[DEBUG] emitNetworkStatusChange() emitting event to JavaScript");
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("networkStatusChanged", params);
            } else {
                Log.e(TAG, "[DEBUG] emitNetworkStatusChange() reactContext is null");
            }
        } catch (Exception e) {
            Log.e(TAG, "[DEBUG] emitNetworkStatusChange() failed", e);
        }
    }
    
    /**
     * Cleanup network callback
     */
    private void cleanupNetworkCallback() {
        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
                networkCallback = null;
            } catch (Exception e) {
                Log.e(TAG, "Failed to cleanup network callback", e);
            }
        }
    }
    
    @Override
    public void onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy();
        cleanupNetworkCallback();
    }
    
    // Helper method to convert camelCase to snake_case
    private String camelToSnakeCase(String camelCase) {
        // Map common camelCase to snake_case for sync_status table
        switch (camelCase) {
            case "totalPending":
                return "total_pending";
            case "totalFailed":
                return "total_failed";
            case "networkStatus":
                return "network_status";
            case "lastSyncAt":
                return "last_sync_at";
            case "syncInProgress":
                return "sync_in_progress";
            case "lastError":
                return "last_error";
            case "syncBatchSize":
                return "sync_batch_size";
            case "syncIntervalMs":
                return "sync_interval_ms";
            case "totalSynced":
                return "total_synced";
            case "totalErrors":
                return "total_errors";
            default:
                // For other fields, try to convert camelCase to snake_case
                return camelCase.replaceAll("([a-z])([A-Z])", "$1_$2").toLowerCase();
        }
    }

    // Data point operations
    @ReactMethod
    public void insertDataPoint(ReadableMap dataPoint, Promise promise) {
        try {
            String id = dataPoint.hasKey("id") ? dataPoint.getString("id") : UUID.randomUUID().toString();
            String requestId = dataPoint.getString("requestId");
            String dataType = dataPoint.getString("dataType");
            String tableName = dataPoint.hasKey("tableName") ? dataPoint.getString("tableName") : null;
            String localId = dataPoint.hasKey("localId") ? dataPoint.getString("localId") : null;
            String serverId = dataPoint.hasKey("serverId") ? dataPoint.getString("serverId") : null;
            String localSnapshot = jsonToString(dataPoint.getMap("localSnapshot"));
            String serverSnapshot = dataPoint.hasKey("serverSnapshot") ? jsonToString(dataPoint.getMap("serverSnapshot")) : null;
            int localVersion = dataPoint.hasKey("localVersion") ? dataPoint.getInt("localVersion") : 1;
            int serverVersion = dataPoint.hasKey("serverVersion") ? dataPoint.getInt("serverVersion") : 0;
            String dataStatus = dataPoint.getString("dataStatus");
            long createdAt = dataPoint.hasKey("createdAt") ? (long) dataPoint.getDouble("createdAt") : System.currentTimeMillis();
            long updatedAt = System.currentTimeMillis();
            
            String query = "INSERT INTO sync_data (id, request_id, data_type, table_name, local_id, server_id, local_snapshot, server_snapshot, local_version, server_version, data_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
            
            WritableArray params = Arguments.createArray();
            params.pushString(id);
            params.pushString(requestId);
            params.pushString(dataType);
            params.pushString(tableName);
            params.pushString(localId);
            params.pushString(serverId);
            params.pushString(localSnapshot);
            params.pushString(serverSnapshot);
            params.pushInt(localVersion);
            params.pushInt(serverVersion);
            params.pushString(dataStatus);
            params.pushDouble(createdAt);
            params.pushDouble(updatedAt);
            
            executeSql(query, params, promise);
        } catch (Exception e) {
            Log.e(TAG, "Insert data point error", e);
            promise.reject("INSERT_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void updateDataPoint(String requestId, ReadableMap updates, Promise promise) {
        try {
            StringBuilder query = new StringBuilder("UPDATE sync_data SET updated_at = ?");
            WritableArray params = Arguments.createArray();
            params.pushDouble(System.currentTimeMillis());
            
            // Convert ReadableMap to HashMap for iteration
            HashMap<String, Object> updatesMap = readableMapToHashMap(updates);
            for (Map.Entry<String, Object> entry : updatesMap.entrySet()) {
                String key = entry.getKey();
                if (!key.equals("updated_at")) {
                    query.append(", ").append(key).append(" = ?");
                    Object value = entry.getValue();
                    if (key.equals("serverSnapshot") || key.equals("localSnapshot")) {
                        if (value instanceof ReadableMap) {
                            params.pushString(jsonToString((ReadableMap) value));
                        } else {
                            params.pushString(String.valueOf(value));
                        }
                    } else if (value instanceof String) {
                        params.pushString((String) value);
                    } else if (value instanceof Integer) {
                        params.pushInt((Integer) value);
                    } else if (value instanceof Double) {
                        params.pushDouble((Double) value);
                    } else if (value instanceof Long) {
                        params.pushDouble(((Long) value).doubleValue());
                    } else {
                        params.pushString(String.valueOf(value));
                    }
                }
            }
            
            query.append(" WHERE request_id = ?");
            params.pushString(requestId);
            
            executeSql(query.toString(), params, promise);
        } catch (Exception e) {
            Log.e(TAG, "Update data point error", e);
            promise.reject("UPDATE_ERROR", e.getMessage(), e);
        }
    }

    // Performance metrics
    @ReactMethod
    public void getPerformanceMetrics(Promise promise) {
        try {
            Map<String, Double> metrics = performanceTracker.getMetrics();
            WritableMap result = Arguments.createMap();
            for (Map.Entry<String, Double> entry : metrics.entrySet()) {
                result.putDouble(entry.getKey(), entry.getValue());
            }
            promise.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Get performance metrics error", e);
            promise.reject("METRICS_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void resetPerformanceMetrics(Promise promise) {
        try {
            performanceTracker.reset();
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Reset performance metrics error", e);
            promise.reject("RESET_ERROR", e.getMessage(), e);
        }
    }

    // Helper methods
    private HashMap<String, Object> readableMapToHashMap(ReadableMap map) {
        HashMap<String, Object> hashMap = new HashMap<>();
        if (map == null) {
            return hashMap;
        }
        try {
            // Use keySetIterator to iterate over ReadableMap
            ReadableMapKeySetIterator iterator = map.keySetIterator();
            while (iterator.hasNextKey()) {
                String key = iterator.nextKey();
                hashMap.put(key, map.getDynamic(key));
            }
        } catch (Exception e) {
            // Fallback: convert via JSON
            try {
                JSONObject json = readableMapToJson(map);
                java.util.Iterator<String> keys = json.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    hashMap.put(key, json.get(key));
                }
            } catch (Exception e2) {
                Log.e(TAG, "Error converting ReadableMap to HashMap", e2);
            }
        }
        return hashMap;
    }

    private String jsonToString(ReadableMap map) {
        if (map == null) {
            return null;
        }
        try {
            return readableMapToJson(map).toString();
        } catch (JSONException e) {
            Log.e(TAG, "JSON conversion error", e);
            return "{}";
        }
    }

    private JSONObject readableMapToJson(ReadableMap map) throws JSONException {
        JSONObject json = new JSONObject();
        if (map == null) {
            return json;
        }
        try {
            ReadableMapKeySetIterator iterator = map.keySetIterator();
            while (iterator.hasNextKey()) {
                String key = iterator.nextKey();
                com.facebook.react.bridge.ReadableType valueType = map.getType(key);
                if (valueType == com.facebook.react.bridge.ReadableType.Null) {
                    json.put(key, JSONObject.NULL);
                } else if (valueType == com.facebook.react.bridge.ReadableType.Boolean) {
                    json.put(key, map.getBoolean(key));
                } else if (valueType == com.facebook.react.bridge.ReadableType.Number) {
                    json.put(key, map.getDouble(key));
                } else if (valueType == com.facebook.react.bridge.ReadableType.String) {
                    json.put(key, map.getString(key));
                } else if (valueType == com.facebook.react.bridge.ReadableType.Map) {
                    json.put(key, readableMapToJson(map.getMap(key)));
                } else if (valueType == com.facebook.react.bridge.ReadableType.Array) {
                    json.put(key, readableArrayToJson(map.getArray(key)));
                } else {
                    // Fallback: try to get as string
                    json.put(key, map.getString(key));
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error iterating ReadableMap", e);
        }
        return json;
    }

    private JSONArray readableArrayToJson(ReadableArray array) throws JSONException {
        JSONArray json = new JSONArray();
        for (int i = 0; i < array.size(); i++) {
            com.facebook.react.bridge.ReadableType valueType = array.getType(i);
            if (valueType == com.facebook.react.bridge.ReadableType.Null) {
                json.put(JSONObject.NULL);
            } else if (valueType == com.facebook.react.bridge.ReadableType.Boolean) {
                json.put(array.getBoolean(i));
            } else if (valueType == com.facebook.react.bridge.ReadableType.Number) {
                json.put(array.getDouble(i));
            } else if (valueType == com.facebook.react.bridge.ReadableType.String) {
                json.put(array.getString(i));
            } else if (valueType == com.facebook.react.bridge.ReadableType.Map) {
                json.put(readableMapToJson(array.getMap(i)));
            } else if (valueType == com.facebook.react.bridge.ReadableType.Array) {
                json.put(readableArrayToJson(array.getArray(i)));
            } else {
                // Fallback: try to get as string
                json.put(array.getString(i));
            }
        }
        return json;
    }

    /**
     * Parse a JSON string into a ReadableMap or ReadableArray
     */
    private Object jsonStringToObject(String jsonString) {
        if (jsonString == null || jsonString.trim().isEmpty()) {
            return null;
        }
        try {
            org.json.JSONObject jsonObject = new org.json.JSONObject(jsonString);
            return jsonObjectToReadableMap(jsonObject);
        } catch (org.json.JSONException e) {
            try {
                org.json.JSONArray jsonArray = new org.json.JSONArray(jsonString);
                return jsonArrayToReadableArray(jsonArray);
            } catch (org.json.JSONException e2) {
                Log.e(TAG, "Failed to parse JSON string: " + jsonString, e2);
                return null;
            }
        }
    }

    /**
     * Convert JSONObject to ReadableMap
     */
    private ReadableMap jsonObjectToReadableMap(org.json.JSONObject jsonObject) {
        WritableMap map = Arguments.createMap();
        try {
            org.json.JSONArray names = jsonObject.names();
            if (names != null) {
                for (int i = 0; i < names.length(); i++) {
                    String key = names.getString(i);
                    Object value = jsonObject.get(key);
                    if (value == org.json.JSONObject.NULL) {
                        map.putNull(key);
                    } else if (value instanceof String) {
                        map.putString(key, (String) value);
                    } else if (value instanceof Number) {
                        if (value instanceof Integer || value instanceof Long) {
                            map.putDouble(key, ((Number) value).doubleValue());
                        } else {
                            map.putDouble(key, ((Number) value).doubleValue());
                        }
                    } else if (value instanceof Boolean) {
                        map.putBoolean(key, (Boolean) value);
                    } else if (value instanceof org.json.JSONObject) {
                        map.putMap(key, jsonObjectToReadableMap((org.json.JSONObject) value));
                    } else if (value instanceof org.json.JSONArray) {
                        map.putArray(key, jsonArrayToReadableArray((org.json.JSONArray) value));
                    }
                }
            }
        } catch (org.json.JSONException e) {
            Log.e(TAG, "Error converting JSONObject to ReadableMap", e);
        }
        return map;
    }

    /**
     * Convert JSONArray to ReadableArray
     */
    private ReadableArray jsonArrayToReadableArray(org.json.JSONArray jsonArray) {
        WritableArray array = Arguments.createArray();
        try {
            for (int i = 0; i < jsonArray.length(); i++) {
                Object value = jsonArray.get(i);
                if (value == org.json.JSONObject.NULL) {
                    array.pushNull();
                } else if (value instanceof String) {
                    array.pushString((String) value);
                } else if (value instanceof Number) {
                    array.pushDouble(((Number) value).doubleValue());
                } else if (value instanceof Boolean) {
                    array.pushBoolean((Boolean) value);
                } else if (value instanceof org.json.JSONObject) {
                    array.pushMap(jsonObjectToReadableMap((org.json.JSONObject) value));
                } else if (value instanceof org.json.JSONArray) {
                    array.pushArray(jsonArrayToReadableArray((org.json.JSONArray) value));
                }
            }
        } catch (org.json.JSONException e) {
            Log.e(TAG, "Error converting JSONArray to ReadableArray", e);
        }
        return array;
    }
}


