#import "OfflineQueueModule.h"
#import "DatabaseManager.h"
#import <React/RCTLog.h>
#import <sqlite3.h>
#import <SystemConfiguration/SystemConfiguration.h>
#import <netinet/in.h>

// Reachability callback function
static void ReachabilityCallback(SCNetworkReachabilityRef target, SCNetworkReachabilityFlags flags, void* info) {
    OfflineQueueModule *module = (__bridge OfflineQueueModule *)info;
    if (module) {
        [module handleReachabilityChange:flags];
    }
}

@implementation OfflineQueueModule {
    DatabaseManager *_dbManager;
    NSMutableDictionary *_performanceMetrics;
    NSTimeInterval _initializationStartTime;
    
    // Network monitoring
    SCNetworkReachabilityRef _reachabilityRef;
    NSString *_currentNetworkStatus;
}

RCT_EXPORT_MODULE(OfflineQueue);

- (instancetype)init {
    self = [super init];
    if (self) {
        _initializationStartTime = [[NSDate date] timeIntervalSince1970];
        _performanceMetrics = [NSMutableDictionary dictionary];
        _currentNetworkStatus = @"unknown";
        
        // Initialize database
        NSArray *paths = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
        NSString *documentsDirectory = [paths objectAtIndex:0];
        NSString *dbPath = [documentsDirectory stringByAppendingPathComponent:@"offline_queue.db"];
        
        _dbManager = [[DatabaseManager alloc] initWithDatabasePath:dbPath];
        if (![_dbManager initializeDatabase]) {
            RCTLogError(@"Failed to initialize database");
        } else {
            NSTimeInterval initTime = [[NSDate date] timeIntervalSince1970] - _initializationStartTime;
            _performanceMetrics[@"initializationTime"] = @(initTime * 1000); // Convert to milliseconds
        }
        
        // Initialize network monitoring
        [self setupReachability];
        _currentNetworkStatus = [self checkNetworkStatus];
    }
    return self;
}

- (void)dealloc {
    [self cleanupReachability];
}

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

// Database operations
RCT_EXPORT_METHOD(executeSql:(NSString *)query
                  params:(NSArray *)params
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    sqlite3 *db = [_dbManager database];
    if (!db) {
        reject(@"DB_ERROR", @"Database not initialized", nil);
        return;
    }
    
    sqlite3_stmt *stmt;
    if (sqlite3_prepare_v2(db, [query UTF8String], -1, &stmt, NULL) != SQLITE_OK) {
        NSString *errorMsg = [NSString stringWithUTF8String:sqlite3_errmsg(db)];
        reject(@"SQL_ERROR", errorMsg, nil);
        return;
    }
    
    // Bind parameters
    for (int i = 0; i < [params count]; i++) {
        id param = params[i];
        int index = i + 1;
        
        if ([param isKindOfClass:[NSNumber class]]) {
            NSNumber *num = (NSNumber *)param;
            if (CFNumberIsFloatType((CFNumberRef)num)) {
                sqlite3_bind_double(stmt, index, [num doubleValue]);
            } else {
                sqlite3_bind_int64(stmt, index, [num longLongValue]);
            }
        } else if ([param isKindOfClass:[NSString class]]) {
            sqlite3_bind_text(stmt, index, [param UTF8String], -1, SQLITE_TRANSIENT);
        } else if (param == [NSNull null]) {
            sqlite3_bind_null(stmt, index);
        }
    }
    
    // Execute query
    NSMutableArray *results = [NSMutableArray array];
    int stepResult = sqlite3_step(stmt);
    
    if (stepResult == SQLITE_ROW) {
        // SELECT query - return rows
        do {
            NSMutableDictionary *row = [NSMutableDictionary dictionary];
            int columnCount = sqlite3_column_count(stmt);
            
            for (int i = 0; i < columnCount; i++) {
                NSString *columnName = [NSString stringWithUTF8String:sqlite3_column_name(stmt, i)];
                int columnType = sqlite3_column_type(stmt, i);
                
                id value = nil;
                switch (columnType) {
                    case SQLITE_INTEGER:
                        value = @(sqlite3_column_int64(stmt, i));
                        break;
                    case SQLITE_FLOAT:
                        value = @(sqlite3_column_double(stmt, i));
                        break;
                    case SQLITE_TEXT:
                        value = [NSString stringWithUTF8String:(const char *)sqlite3_column_text(stmt, i)];
                        break;
                    case SQLITE_BLOB:
                        // Handle blob if needed
                        break;
                    case SQLITE_NULL:
                        value = [NSNull null];
                        break;
                }
                
                if (value) {
                    row[columnName] = value;
                }
            }
            
            [results addObject:row];
        } while (sqlite3_step(stmt) == SQLITE_ROW);
        
        resolve(results);
    } else if (stepResult == SQLITE_DONE) {
        // INSERT/UPDATE/DELETE - return affected rows
        int changes = sqlite3_changes(db);
        resolve(@{@"changes": @(changes), @"lastInsertRowId": @(sqlite3_last_insert_rowid(db))});
    } else {
        NSString *errorMsg = [NSString stringWithUTF8String:sqlite3_errmsg(db)];
        reject(@"SQL_ERROR", errorMsg, nil);
    }
    
    sqlite3_finalize(stmt);
}

RCT_EXPORT_METHOD(executeBatch:(NSArray *)queries
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    sqlite3 *db = [_dbManager database];
    if (!db) {
        reject(@"DB_ERROR", @"Database not initialized", nil);
        return;
    }
    
    if (sqlite3_exec(db, "BEGIN TRANSACTION", NULL, NULL, NULL) != SQLITE_OK) {
        reject(@"TRANSACTION_ERROR", @"Failed to begin transaction", nil);
        return;
    }
    
    NSMutableArray *results = [NSMutableArray array];
    NSError *batchError = nil;
    
    for (NSDictionary *queryObj in queries) {
        NSString *query = queryObj[@"query"];
        NSArray *params = queryObj[@"params"] ?: @[];
        
        sqlite3_stmt *stmt;
        if (sqlite3_prepare_v2(db, [query UTF8String], -1, &stmt, NULL) != SQLITE_OK) {
            batchError = [NSError errorWithDomain:@"SQL_ERROR" 
                                           code:sqlite3_errcode(db)
                                       userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithUTF8String:sqlite3_errmsg(db)]}];
            break;
        }
        
        // Bind parameters
        for (int i = 0; i < [params count]; i++) {
            id param = params[i];
            int index = i + 1;
            
            if ([param isKindOfClass:[NSNumber class]]) {
                NSNumber *num = (NSNumber *)param;
                if (CFNumberIsFloatType((CFNumberRef)num)) {
                    sqlite3_bind_double(stmt, index, [num doubleValue]);
                } else {
                    sqlite3_bind_int64(stmt, index, [num longLongValue]);
                }
            } else if ([param isKindOfClass:[NSString class]]) {
                sqlite3_bind_text(stmt, index, [param UTF8String], -1, SQLITE_TRANSIENT);
            } else if (param == [NSNull null]) {
                sqlite3_bind_null(stmt, index);
            }
        }
        
        int stepResult = sqlite3_step(stmt);
        if (stepResult != SQLITE_DONE && stepResult != SQLITE_ROW) {
            batchError = [NSError errorWithDomain:@"SQL_ERROR" 
                                           code:sqlite3_errcode(db)
                                       userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithUTF8String:sqlite3_errmsg(db)]}];
            sqlite3_finalize(stmt);
            break;
        }
        
        [results addObject:@{@"changes": @(sqlite3_changes(db))}];
        sqlite3_finalize(stmt);
    }
    
    if (batchError) {
        sqlite3_exec(db, "ROLLBACK", NULL, NULL, NULL);
        reject(@"BATCH_ERROR", batchError.localizedDescription, batchError);
    } else {
        if (sqlite3_exec(db, "COMMIT", NULL, NULL, NULL) != SQLITE_OK) {
            reject(@"COMMIT_ERROR", @"Failed to commit transaction", nil);
        } else {
            resolve(results);
        }
    }
}

// Request operations
RCT_EXPORT_METHOD(insertRequest:(NSDictionary *)request
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSTimeInterval startTime = [[NSDate date] timeIntervalSince1970];
    
    NSString *query = @"INSERT INTO request_queue (id, request_id, method, url, headers, body, query_params, status, priority, created_at, updated_at, attempt_count, max_retries, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    
    NSArray *params = @[
        request[@"id"] ?: [NSUUID UUID].UUIDString,
        request[@"requestId"] ?: [NSNull null],
        request[@"method"],
        request[@"url"],
        request[@"headers"] ? [self jsonStringFromObject:request[@"headers"]] : [NSNull null],
        request[@"body"] ? [self jsonStringFromObject:request[@"body"]] : [NSNull null],
        request[@"queryParams"] ? [self jsonStringFromObject:request[@"queryParams"]] : [NSNull null],
        request[@"status"] ?: @"pending",
        request[@"priority"] ?: @0,
        request[@"createdAt"] ?: @((long long)([[NSDate date] timeIntervalSince1970] * 1000)),
        @((long long)([[NSDate date] timeIntervalSince1970] * 1000)),
        request[@"attemptCount"] ?: @0,
        request[@"maxRetries"] ?: @3,
        request[@"metadata"] ? [self jsonStringFromObject:request[@"metadata"]] : [NSNull null]
    ];
    
    [self executeSql:query params:params resolver:^(id result) {
        NSTimeInterval enqueueTime = ([[NSDate date] timeIntervalSince1970] - startTime) * 1000;
        [self updatePerformanceMetric:@"averageEnqueueTime" withValue:enqueueTime];
        resolve(result[@"lastInsertRowId"]);
    } rejecter:reject];
}

RCT_EXPORT_METHOD(updateRequestStatus:(NSString *)requestId
                  status:(NSString *)status
                  data:(NSDictionary *)data
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSMutableString *query = [NSMutableString stringWithString:@"UPDATE request_queue SET status = ?, updated_at = ?"];
    NSMutableArray *params = [NSMutableArray arrayWithArray:@[status, @((long long)([[NSDate date] timeIntervalSince1970] * 1000))]];
    
    if (data) {
        if (data[@"serverResponse"]) {
            [query appendString:@", server_response = ?"];
            [params addObject:[self jsonStringFromObject:data[@"serverResponse"]]];
        }
        if (data[@"syncedAt"]) {
            [query appendString:@", synced_at = ?"];
            [params addObject:data[@"syncedAt"]];
        }
        if (data[@"attemptCount"]) {
            [query appendString:@", attempt_count = ?"];
            [params addObject:data[@"attemptCount"]];
        }
        if (data[@"lastAttemptAt"]) {
            [query appendString:@", last_attempt_at = ?"];
            [params addObject:data[@"lastAttemptAt"]];
        }
        if (data[@"retryAfter"]) {
            [query appendString:@", retry_after = ?"];
            [params addObject:data[@"retryAfter"]];
        }
    }
    
    [query appendString:@" WHERE id = ?"];
    [params addObject:requestId];
    
    [self executeSql:query params:params resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(getPendingRequests:(NSNumber *)limit
                  offset:(NSNumber *)offset
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSString *query = @"SELECT * FROM request_queue WHERE status = 'pending' OR (status = 'failed' AND retry_after IS NOT NULL AND retry_after <= ?) ORDER BY priority DESC, created_at ASC LIMIT ? OFFSET ?";
    long long currentTime = (long long)([[NSDate date] timeIntervalSince1970] * 1000);
    
    [self executeSql:query params:@[@(currentTime), limit, offset] resolver:^(id result) {
        NSArray *rows = (NSArray *)result;
        NSMutableArray *requests = [NSMutableArray array];
        
        for (NSDictionary *row in rows) {
            NSMutableDictionary *request = [NSMutableDictionary dictionaryWithDictionary:row];
            // Parse JSON fields
            if (row[@"headers"]) {
                request[@"headers"] = [self objectFromJsonString:row[@"headers"]];
            }
            if (row[@"body"]) {
                request[@"body"] = [self objectFromJsonString:row[@"body"]];
            }
            if (row[@"query_params"]) {
                request[@"queryParams"] = [self objectFromJsonString:row[@"query_params"]];
            }
            if (row[@"server_response"]) {
                request[@"serverResponse"] = [self objectFromJsonString:row[@"server_response"]];
            }
            if (row[@"metadata"]) {
                request[@"metadata"] = [self objectFromJsonString:row[@"metadata"]];
            }
            [requests addObject:request];
        }
        
        resolve(requests);
    } rejecter:reject];
}

RCT_EXPORT_METHOD(getFailedRequests:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSString *query = @"SELECT fr.*, rq.method, rq.url FROM failed_requests fr JOIN request_queue rq ON fr.request_id = rq.id ORDER BY fr.created_at DESC";
    
    [self executeSql:query params:@[] resolver:^(id result) {
        NSArray *rows = (NSArray *)result;
        NSMutableArray *failedRequests = [NSMutableArray array];
        
        for (NSDictionary *row in rows) {
            NSMutableDictionary *failed = [NSMutableDictionary dictionaryWithDictionary:row];
            if (row[@"error_details"]) {
                failed[@"errorDetails"] = [self objectFromJsonString:row[@"error_details"]];
            }
            [failedRequests addObject:failed];
        }
        
        resolve(failedRequests);
    } rejecter:reject];
}

// Sync operations
RCT_EXPORT_METHOD(getSyncStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSString *query = @"SELECT * FROM sync_status ORDER BY id DESC LIMIT 1";
    
    [self executeSql:query params:@[] resolver:^(id result) {
        NSArray *rows = (NSArray *)result;
        if ([rows count] > 0) {
            resolve(rows[0]);
        } else {
            resolve(@{});
        }
    } rejecter:reject];
}

RCT_EXPORT_METHOD(updateSyncStatus:(NSDictionary *)updates
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSMutableString *query = [NSMutableString stringWithString:@"UPDATE sync_status SET updated_at = ?"];
    NSMutableArray *params = [NSMutableArray arrayWithArray:@[@((long long)([[NSDate date] timeIntervalSince1970] * 1000))]];
    
    for (NSString *key in updates) {
        [query appendFormat:@", %@ = ?", key];
        [params addObject:updates[key]];
    }
    
    [query appendString:@" WHERE id = (SELECT id FROM sync_status ORDER BY id DESC LIMIT 1)"];
    
    [self executeSql:query params:params resolver:resolve rejecter:reject];
}

// Data point operations
RCT_EXPORT_METHOD(insertDataPoint:(NSDictionary *)dataPoint
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSString *query = @"INSERT INTO sync_data (id, request_id, data_type, table_name, local_id, server_id, local_snapshot, server_snapshot, local_version, server_version, data_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    
    NSArray *params = @[
        dataPoint[@"id"] ?: [NSUUID UUID].UUIDString,
        dataPoint[@"requestId"],
        dataPoint[@"dataType"],
        dataPoint[@"tableName"] ?: [NSNull null],
        dataPoint[@"localId"] ?: [NSNull null],
        dataPoint[@"serverId"] ?: [NSNull null],
        [self jsonStringFromObject:dataPoint[@"localSnapshot"]],
        dataPoint[@"serverSnapshot"] ? [self jsonStringFromObject:dataPoint[@"serverSnapshot"]] : [NSNull null],
        dataPoint[@"localVersion"] ?: @1,
        dataPoint[@"serverVersion"] ?: [NSNull null],
        dataPoint[@"dataStatus"],
        dataPoint[@"createdAt"] ?: @((long long)([[NSDate date] timeIntervalSince1970] * 1000)),
        @((long long)([[NSDate date] timeIntervalSince1970] * 1000))
    ];
    
    [self executeSql:query params:params resolver:^(id result) {
        resolve(result[@"lastInsertRowId"]);
    } rejecter:reject];
}

RCT_EXPORT_METHOD(updateDataPoint:(NSString *)requestId
                  updates:(NSDictionary *)updates
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSMutableString *query = [NSMutableString stringWithString:@"UPDATE sync_data SET updated_at = ?"];
    NSMutableArray *params = [NSMutableArray arrayWithArray:@[@((long long)([[NSDate date] timeIntervalSince1970] * 1000))]];
    
    for (NSString *key in updates) {
        [query appendFormat:@", %@ = ?", key];
        id value = updates[key];
        if ([key isEqualToString:@"serverSnapshot"] || [key isEqualToString:@"localSnapshot"]) {
            value = [self jsonStringFromObject:value];
        }
        [params addObject:value];
    }
    
    [query appendString:@" WHERE request_id = ?"];
    [params addObject:requestId];
    
    [self executeSql:query params:params resolver:resolve rejecter:reject];
}

// Performance metrics
RCT_EXPORT_METHOD(getPerformanceMetrics:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    resolve(_performanceMetrics);
}

RCT_EXPORT_METHOD(resetPerformanceMetrics:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [_performanceMetrics removeAllObjects];
    resolve(@YES);
}

// Helper methods
- (NSString *)jsonStringFromObject:(id)object {
    NSError *error;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:object options:0 error:&error];
    if (error) {
        RCTLogError(@"JSON serialization error: %@", error);
        return @"{}";
    }
    return [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
}

- (id)objectFromJsonString:(NSString *)jsonString {
    NSData *jsonData = [jsonString dataUsingEncoding:NSUTF8StringEncoding];
    NSError *error;
    id object = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&error];
    if (error) {
        RCTLogError(@"JSON deserialization error: %@", error);
        return nil;
    }
    return object;
}

- (void)updatePerformanceMetric:(NSString *)metricName withValue:(NSNumber *)value {
    NSNumber *currentValue = _performanceMetrics[metricName];
    if (currentValue) {
        // Simple moving average
        double avg = ([currentValue doubleValue] + [value doubleValue]) / 2.0;
        _performanceMetrics[metricName] = @(avg);
    } else {
        _performanceMetrics[metricName] = value;
    }
}

// Network status operations
RCT_EXPORT_METHOD(getNetworkStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSString *status = [self checkNetworkStatus];
    resolve(status);
}

/**
 * Check current network status
 */
- (NSString *)checkNetworkStatus {
    @try {
        if (!_reachabilityRef) {
            return @"unknown";
        }
        
        SCNetworkReachabilityFlags flags;
        if (SCNetworkReachabilityGetFlags(_reachabilityRef, &flags)) {
            BOOL isReachable = (flags & kSCNetworkReachabilityFlagsReachable) != 0;
            BOOL needsConnection = (flags & kSCNetworkReachabilityFlagsConnectionRequired) != 0;
            BOOL canConnectAutomatically = (((flags & kSCNetworkReachabilityFlagsConnectionOnDemand) != 0) ||
                                           ((flags & kSCNetworkReachabilityFlagsConnectionOnTraffic) != 0));
            BOOL canConnectWithoutUserInteraction = (canConnectAutomatically &&
                                                     (flags & kSCNetworkReachabilityFlagsInterventionRequired) == 0);
            BOOL isNetworkReachable = (isReachable && (!needsConnection || canConnectWithoutUserInteraction));
            
            return isNetworkReachable ? @"online" : @"offline";
        }
        
        return @"unknown";
    } @catch (NSException *exception) {
        RCTLogError(@"Error checking network status: %@", exception.reason);
        return @"unknown";
    }
}

/**
 * Setup network reachability monitoring
 */
- (void)setupReachability {
    @try {
        struct sockaddr_in zeroAddress;
        bzero(&zeroAddress, sizeof(zeroAddress));
        zeroAddress.sin_len = sizeof(zeroAddress);
        zeroAddress.sin_family = AF_INET;
        
        _reachabilityRef = SCNetworkReachabilityCreateWithAddress(kCFAllocatorDefault, (const struct sockaddr *)&zeroAddress);
        
        if (_reachabilityRef) {
            SCNetworkReachabilityContext context = {0, (__bridge void *)self, NULL, NULL, NULL};
            
            if (SCNetworkReachabilitySetCallback(_reachabilityRef, ReachabilityCallback, &context)) {
                if (!SCNetworkReachabilityScheduleWithRunLoop(_reachabilityRef, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode)) {
                    RCTLogWarn(@"Failed to schedule reachability with run loop");
                }
            } else {
                RCTLogWarn(@"Failed to set reachability callback");
            }
        } else {
            RCTLogWarn(@"Failed to create network reachability reference");
        }
    } @catch (NSException *exception) {
        RCTLogError(@"Error setting up reachability: %@", exception.reason);
        _reachabilityRef = NULL;
    }
}

/**
 * Handle reachability change
 */
- (void)handleReachabilityChange:(SCNetworkReachabilityFlags)flags {
    NSString *newStatus = [self checkNetworkStatus];
    if (![newStatus isEqualToString:_currentNetworkStatus]) {
        NSString *previousStatus = _currentNetworkStatus;
        _currentNetworkStatus = newStatus;
        [self emitNetworkStatusChange:previousStatus currentStatus:newStatus];
    }
}

/**
 * Emit network status change event to JavaScript
 */
- (void)emitNetworkStatusChange:(NSString *)previousStatus currentStatus:(NSString *)currentStatus {
    NSDictionary *params = @{
        @"status": currentStatus,
        @"previousStatus": previousStatus
    };
    [self sendEventWithName:@"networkStatusChanged" body:params];
}

/**
 * Cleanup reachability monitoring
 */
- (void)cleanupReachability {
    if (_reachabilityRef) {
        SCNetworkReachabilityUnscheduleFromRunLoop(_reachabilityRef, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        SCNetworkReachabilitySetCallback(_reachabilityRef, NULL, NULL);
        CFRelease(_reachabilityRef);
        _reachabilityRef = NULL;
    }
}

// Required for RCTEventEmitter
- (NSArray<NSString *> *)supportedEvents {
    return @[@"networkStatusChanged"];
}

@end


