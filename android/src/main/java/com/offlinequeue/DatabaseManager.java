package com.offlinequeue;

import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.content.Context;
import android.util.Log;
import java.util.ArrayList;
import java.util.List;

public class DatabaseManager extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "offline_queue.db";
    private static final int DATABASE_VERSION = 1;
    private static final String TAG = "DatabaseManager";

    public DatabaseManager(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        createTables(db);
        createIndexes(db);
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Migration logic will be added here
        Log.w(TAG, "Upgrading database from version " + oldVersion + " to " + newVersion);
    }

    private void createTables(SQLiteDatabase db) {
        // request_queue table
        db.execSQL("CREATE TABLE request_queue (" +
            "id TEXT PRIMARY KEY, " +
            "request_id TEXT UNIQUE, " +
            "method TEXT NOT NULL, " +
            "url TEXT NOT NULL, " +
            "headers TEXT, " +
            "body TEXT, " +
            "query_params TEXT, " +
            "status TEXT NOT NULL, " +
            "priority INTEGER DEFAULT 0, " +
            "created_at INTEGER NOT NULL, " +
            "updated_at INTEGER NOT NULL, " +
            "last_attempt_at INTEGER, " +
            "synced_at INTEGER, " +
            "attempt_count INTEGER DEFAULT 0, " +
            "max_retries INTEGER DEFAULT 3, " +
            "retry_after INTEGER, " +
            "local_data_id TEXT, " +
            "server_response TEXT, " +
            "conflict_data TEXT, " +
            "conflict_resolution TEXT, " +
            "metadata TEXT" +
            ")");

        // sync_status table
        db.execSQL("CREATE TABLE sync_status (" +
            "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
            "last_sync_at INTEGER, " +
            "sync_in_progress INTEGER DEFAULT 0, " +
            "total_pending INTEGER DEFAULT 0, " +
            "total_failed INTEGER DEFAULT 0, " +
            "last_error TEXT, " +
            "network_status TEXT, " +
            "sync_batch_size INTEGER DEFAULT 5, " +
            "sync_interval_ms INTEGER DEFAULT 1000, " +
            "total_synced INTEGER DEFAULT 0, " +
            "total_errors INTEGER DEFAULT 0, " +
            "updated_at INTEGER NOT NULL" +
            ")");

        // sync_data table
        db.execSQL("CREATE TABLE sync_data (" +
            "id TEXT PRIMARY KEY, " +
            "request_id TEXT NOT NULL, " +
            "data_type TEXT NOT NULL, " +
            "table_name TEXT, " +
            "local_id TEXT, " +
            "server_id TEXT, " +
            "local_snapshot TEXT NOT NULL, " +
            "server_snapshot TEXT, " +
            "local_version INTEGER DEFAULT 1, " +
            "server_version INTEGER, " +
            "data_status TEXT NOT NULL, " +
            "created_at INTEGER NOT NULL, " +
            "updated_at INTEGER NOT NULL, " +
            "FOREIGN KEY(request_id) REFERENCES request_queue(id) ON DELETE CASCADE" +
            ")");

        // failed_requests table
        db.execSQL("CREATE TABLE failed_requests (" +
            "id TEXT PRIMARY KEY, " +
            "request_id TEXT NOT NULL, " +
            "error_code TEXT, " +
            "error_message TEXT NOT NULL, " +
            "error_details TEXT, " +
            "will_retry INTEGER DEFAULT 1, " +
            "next_retry_at INTEGER, " +
            "failure_type TEXT, " +
            "is_permanent INTEGER DEFAULT 0, " +
            "created_at INTEGER NOT NULL, " +
            "updated_at INTEGER NOT NULL, " +
            "FOREIGN KEY(request_id) REFERENCES request_queue(id)" +
            ")");

        // Initialize sync_status with default values
        db.execSQL("INSERT INTO sync_status (sync_in_progress, total_pending, total_failed, network_status, sync_batch_size, sync_interval_ms, total_synced, total_errors, updated_at) " +
            "VALUES (0, 0, 0, 'unknown', 5, 1000, 0, 0, ?)", new Object[]{System.currentTimeMillis()});
    }

    private void createIndexes(SQLiteDatabase db) {
        // Performance indexes for request_queue
        db.execSQL("CREATE INDEX idx_status ON request_queue(status)");
        db.execSQL("CREATE INDEX idx_priority_status ON request_queue(priority DESC, status)");
        db.execSQL("CREATE INDEX idx_created_at ON request_queue(created_at)");
        db.execSQL("CREATE INDEX idx_retry_after ON request_queue(retry_after) WHERE retry_after IS NOT NULL");

        // Performance indexes for sync_data
        db.execSQL("CREATE INDEX idx_request_id ON sync_data(request_id)");
        db.execSQL("CREATE INDEX idx_data_status ON sync_data(data_status)");

        // Performance indexes for failed_requests
        db.execSQL("CREATE INDEX idx_next_retry ON failed_requests(next_retry_at) WHERE will_retry = 1");
        db.execSQL("CREATE INDEX idx_failure_type ON failed_requests(failure_type)");
    }

    public SQLiteDatabase getWritableDatabase() {
        return super.getWritableDatabase();
    }

    public SQLiteDatabase getReadableDatabase() {
        return super.getReadableDatabase();
    }
}


