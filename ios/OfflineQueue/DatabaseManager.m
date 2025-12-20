#import "DatabaseManager.h"

@interface DatabaseManager ()
@property (nonatomic, assign) sqlite3 *database;
@property (nonatomic, strong) NSString *databasePath;
@end

@implementation DatabaseManager

- (instancetype)initWithDatabasePath:(NSString *)path {
    self = [super init];
    if (self) {
        _databasePath = path;
        _database = NULL;
    }
    return self;
}

- (BOOL)initializeDatabase {
    if (sqlite3_open([self.databasePath UTF8String], &_database) != SQLITE_OK) {
        NSLog(@"Failed to open database: %s", sqlite3_errmsg(_database));
        return NO;
    }
    
    [self createTables];
    [self createIndexes];
    [self initializeSyncStatus];
    
    return YES;
}

- (sqlite3 *)database {
    return _database;
}

- (void)createTables {
    char *errorMsg = NULL;
    
    // request_queue table
    const char *createRequestQueueTable = 
        "CREATE TABLE IF NOT EXISTS request_queue ("
        "id TEXT PRIMARY KEY, "
        "request_id TEXT UNIQUE, "
        "method TEXT NOT NULL, "
        "url TEXT NOT NULL, "
        "headers TEXT, "
        "body TEXT, "
        "query_params TEXT, "
        "status TEXT NOT NULL, "
        "priority INTEGER DEFAULT 0, "
        "created_at INTEGER NOT NULL, "
        "updated_at INTEGER NOT NULL, "
        "last_attempt_at INTEGER, "
        "synced_at INTEGER, "
        "attempt_count INTEGER DEFAULT 0, "
        "max_retries INTEGER DEFAULT 3, "
        "retry_after INTEGER, "
        "local_data_id TEXT, "
        "server_response TEXT, "
        "conflict_data TEXT, "
        "conflict_resolution TEXT, "
        "metadata TEXT"
        ")";
    
    if (sqlite3_exec(_database, createRequestQueueTable, NULL, NULL, &errorMsg) != SQLITE_OK) {
        NSLog(@"Error creating request_queue table: %s", errorMsg);
        sqlite3_free(errorMsg);
    }
    
    // sync_status table
    const char *createSyncStatusTable = 
        "CREATE TABLE IF NOT EXISTS sync_status ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "last_sync_at INTEGER, "
        "sync_in_progress INTEGER DEFAULT 0, "
        "total_pending INTEGER DEFAULT 0, "
        "total_failed INTEGER DEFAULT 0, "
        "last_error TEXT, "
        "network_status TEXT, "
        "sync_batch_size INTEGER DEFAULT 5, "
        "sync_interval_ms INTEGER DEFAULT 1000, "
        "total_synced INTEGER DEFAULT 0, "
        "total_errors INTEGER DEFAULT 0, "
        "updated_at INTEGER NOT NULL"
        ")";
    
    if (sqlite3_exec(_database, createSyncStatusTable, NULL, NULL, &errorMsg) != SQLITE_OK) {
        NSLog(@"Error creating sync_status table: %s", errorMsg);
        sqlite3_free(errorMsg);
    }
    
    // sync_data table
    const char *createSyncDataTable = 
        "CREATE TABLE IF NOT EXISTS sync_data ("
        "id TEXT PRIMARY KEY, "
        "request_id TEXT NOT NULL, "
        "data_type TEXT NOT NULL, "
        "table_name TEXT, "
        "local_id TEXT, "
        "server_id TEXT, "
        "local_snapshot TEXT NOT NULL, "
        "server_snapshot TEXT, "
        "local_version INTEGER DEFAULT 1, "
        "server_version INTEGER, "
        "data_status TEXT NOT NULL, "
        "created_at INTEGER NOT NULL, "
        "updated_at INTEGER NOT NULL, "
        "FOREIGN KEY(request_id) REFERENCES request_queue(id) ON DELETE CASCADE"
        ")";
    
    if (sqlite3_exec(_database, createSyncDataTable, NULL, NULL, &errorMsg) != SQLITE_OK) {
        NSLog(@"Error creating sync_data table: %s", errorMsg);
        sqlite3_free(errorMsg);
    }
    
    // failed_requests table
    const char *createFailedRequestsTable = 
        "CREATE TABLE IF NOT EXISTS failed_requests ("
        "id TEXT PRIMARY KEY, "
        "request_id TEXT NOT NULL, "
        "error_code TEXT, "
        "error_message TEXT NOT NULL, "
        "error_details TEXT, "
        "will_retry INTEGER DEFAULT 1, "
        "next_retry_at INTEGER, "
        "failure_type TEXT, "
        "is_permanent INTEGER DEFAULT 0, "
        "created_at INTEGER NOT NULL, "
        "updated_at INTEGER NOT NULL, "
        "FOREIGN KEY(request_id) REFERENCES request_queue(id)"
        ")";
    
    if (sqlite3_exec(_database, createFailedRequestsTable, NULL, NULL, &errorMsg) != SQLITE_OK) {
        NSLog(@"Error creating failed_requests table: %s", errorMsg);
        sqlite3_free(errorMsg);
    }
}

- (void)createIndexes {
    char *errorMsg = NULL;
    
    // Performance indexes for request_queue
    const char *indexes[] = {
        "CREATE INDEX IF NOT EXISTS idx_status ON request_queue(status)",
        "CREATE INDEX IF NOT EXISTS idx_priority_status ON request_queue(priority DESC, status)",
        "CREATE INDEX IF NOT EXISTS idx_created_at ON request_queue(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_retry_after ON request_queue(retry_after) WHERE retry_after IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_request_id ON sync_data(request_id)",
        "CREATE INDEX IF NOT EXISTS idx_data_status ON sync_data(data_status)",
        "CREATE INDEX IF NOT EXISTS idx_next_retry ON failed_requests(next_retry_at) WHERE will_retry = 1",
        "CREATE INDEX IF NOT EXISTS idx_failure_type ON failed_requests(failure_type)"
    };
    
    for (int i = 0; i < sizeof(indexes) / sizeof(indexes[0]); i++) {
        if (sqlite3_exec(_database, indexes[i], NULL, NULL, &errorMsg) != SQLITE_OK) {
            NSLog(@"Error creating index: %s", errorMsg);
            sqlite3_free(errorMsg);
        }
    }
}

- (void)initializeSyncStatus {
    char *errorMsg = NULL;
    long long currentTime = (long long)([[NSDate date] timeIntervalSince1970] * 1000);
    
    NSString *insertSyncStatus = [NSString stringWithFormat:
        @"INSERT OR IGNORE INTO sync_status (sync_in_progress, total_pending, total_failed, network_status, sync_batch_size, sync_interval_ms, total_synced, total_errors, updated_at) "
        "VALUES (0, 0, 0, 'unknown', 5, 1000, 0, 0, %lld)", currentTime];
    
    if (sqlite3_exec(_database, [insertSyncStatus UTF8String], NULL, NULL, &errorMsg) != SQLITE_OK) {
        NSLog(@"Error initializing sync_status: %s", errorMsg);
        sqlite3_free(errorMsg);
    }
}

- (void)dealloc {
    if (_database) {
        sqlite3_close(_database);
    }
}

@end


