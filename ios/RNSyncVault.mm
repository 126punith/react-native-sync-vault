#import "RNSyncVault.h"
#import "SyncVaultAppDelegate.h"

#if __has_include(<react_native_sync_vault/react_native_sync_vault-Swift.h>)
#import <react_native_sync_vault/react_native_sync_vault-Swift.h>
#else
#import "react_native_sync_vault-Swift.h"
#endif

@interface RNSyncVault () <SyncVaultEventSink>
@end

static void (^Settle(RCTPromiseResolveBlock resolve, RCTPromiseRejectBlock reject))(id _Nullable, NSError *_Nullable)
{
  return ^(id _Nullable value, NSError *_Nullable error) {
    if (error) {
      reject(@"E_SYNC_VAULT", error.localizedDescription, error);
    } else {
      resolve(value ?: [NSNull null]);
    }
  };
}

static id OrNull(id _Nullable value)
{
  return value ?: [NSNull null];
}

// BGTaskScheduler handlers must be registered before the app finishes launching, and the app
// may be launched in the background with no JS runtime at all. RCT_EXPORT_MODULE owns +load.
__attribute__((constructor)) static void RNSyncVaultRegisterBackgroundTasks(void)
{
  [SyncVaultCore registerBackgroundTasks];
}

@implementation RNSyncVault

RCT_EXPORT_MODULE(SyncVault)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

// The core starts draining at launch, so it may emit before JS is attached. The generated
// emitOn* methods throw until React Native installs the emitter callback; attach only then.
- (void)setEventEmitterCallback:(EventEmitterCallbackWrapper *)eventEmitterCallbackWrapper
{
  [super setEventEmitterCallback:eventEmitterCallbackWrapper];
  SyncVaultCore.shared.eventSink = self;
}

- (void)invalidate
{
  if (SyncVaultCore.shared.eventSink == self) {
    SyncVaultCore.shared.eventSink = nil;
  }
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeSyncVaultSpecJSI>(params);
}

#pragma mark - SyncVaultEventSink

- (void)onRequestEvent:(NSDictionary<NSString *, id> *)event
{
  [self emitOnRequestEvent:event];
}

- (void)onNetworkChange:(NSDictionary<NSString *, id> *)state
{
  [self emitOnNetworkChange:state];
}

- (void)onAuthHeadersNeeded:(NSDictionary<NSString *, id> *)event
{
  [self emitOnAuthHeadersNeeded:event];
}

- (void)onConflict:(NSDictionary<NSString *, id> *)event
{
  [self emitOnConflict:event];
}

#pragma mark - Queue

- (void)configure:(JS::NativeSyncVault::NativeConfig &)config
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  NSDictionary *dict = @{
    @"baseUrl" : OrNull(config.baseUrl()),
    @"maxConcurrency" : @(config.maxConcurrency()),
    @"requestTimeoutMs" : @(config.requestTimeoutMs()),
    @"leaseMs" : @(config.leaseMs()),
    @"defaultMaxAttempts" : @(config.defaultMaxAttempts()),
    @"retryBaseDelayMs" : @(config.retryBaseDelayMs()),
    @"retryMaxDelayMs" : @(config.retryMaxDelayMs()),
    @"encryptPayloads" : @(config.encryptPayloads()),
    @"wifiOnly" : @(config.wifiOnly()),
    @"requiresCharging" : @(config.requiresCharging()),
    @"minBatteryLevel" : @(config.minBatteryLevel()),
    @"backgroundIntervalMinutes" : @(config.backgroundIntervalMinutes()),
    @"largePayloadThresholdBytes" : @(config.largePayloadThresholdBytes()),
    @"notificationTitle" : OrNull(config.notificationTitle()),
  };
  [SyncVaultCore.shared configure:dict completion:Settle(resolve, reject)];
}

- (void)enqueue:(JS::NativeSyncVault::EnqueueRequest &)request
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject
{
  id headers = request.headers();
  NSDictionary *dict = @{
    @"method" : OrNull(request.method()),
    @"url" : OrNull(request.url()),
    @"headers" : [headers isKindOfClass:[NSDictionary class]] ? headers : @{},
    @"body" : OrNull(request.body()),
    @"contentType" : OrNull(request.contentType()),
    @"idempotencyKey" : OrNull(request.idempotencyKey()),
    @"queueKey" : OrNull(request.queueKey()),
    @"dedupeKey" : OrNull(request.dedupeKey()),
    @"ifMatch" : OrNull(request.ifMatch()),
    @"priority" : @(request.priority()),
    @"maxAttempts" : @(request.maxAttempts()),
    @"conflictStrategy" : OrNull(request.conflictStrategy()),
    @"metadata" : OrNull(request.metadata()),
  };
  [SyncVaultCore.shared enqueue:dict completion:Settle(resolve, reject)];
}

- (void)getRequests:(JS::NativeSyncVault::RequestFilter &)filter
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  NSMutableArray<NSString *> *statuses = [NSMutableArray new];
  for (NSString *status : filter.statuses()) {
    [statuses addObject:status];
  }
  [SyncVaultCore.shared getRequests:statuses
                           queueKey:filter.queueKey()
                              limit:(NSInteger)filter.limit()
                             offset:(NSInteger)filter.offset()
                         completion:Settle(resolve, reject)];
}

- (void)getCounts:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared counts:Settle(resolve, reject)];
}

- (void)retry:(NSString *)id resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared retry:id completion:Settle(resolve, reject)];
}

- (void)retryAllDeadLetters:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared retryAllDeadLetters:Settle(resolve, reject)];
}

- (void)discard:(NSString *)id resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared discard:id completion:Settle(resolve, reject)];
}

- (void)resolveConflict:(NSString *)id
                payload:(NSString *_Nullable)payload
                version:(NSString *_Nullable)version
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared resolveConflict:id payload:payload version:version completion:Settle(resolve, reject)];
}

- (void)purgeSucceeded:(double)olderThanMs resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared purgeSucceeded:olderThanMs completion:Settle(resolve, reject)];
}

#pragma mark - Scheduling

- (void)drainNow
{
  [SyncVaultCore.shared drainNow];
}

- (void)scheduleBackgroundDrain:(JS::NativeSyncVault::DrainPolicy &)policy
{
  [SyncVaultCore.shared scheduleBackgroundDrain:(NSInteger)policy.intervalMinutes()
                              requiresUnmetered:policy.requiresUnmeteredNetwork()
                               requiresCharging:policy.requiresCharging()];
}

- (void)cancelBackgroundDrain
{
  [SyncVaultCore.shared cancelBackgroundDrain];
}

- (NSDictionary *)getNetworkState
{
  return [SyncVaultCore.shared networkState];
}

- (NSDictionary *)getPowerState
{
  return [SyncVaultCore.shared powerState];
}

- (NSString *)generateId
{
  return [SyncVaultCore.shared generateId];
}

#pragma mark - Auth

- (void)setAuthHeaders:(NSDictionary *)headers
{
  [SyncVaultCore.shared setAuthHeaders:headers];
}

- (void)provideAuthHeaders:(NSString *)requestToken headers:(NSDictionary *)headers
{
  [SyncVaultCore.shared setAuthHeaders:headers];
}

#pragma mark - Cache

- (void)cacheGet:(NSString *)key resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared cacheGet:key completion:Settle(resolve, reject)];
}

- (void)cacheSet:(NSString *)key
           value:(NSString *)value
           ttlMs:(double)ttlMs
            tags:(NSArray *)tags
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared cacheSet:key value:value ttlMs:ttlMs tags:tags completion:Settle(resolve, reject)];
}

- (void)cacheDelete:(NSString *)key resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared cacheDelete:key completion:Settle(resolve, reject)];
}

- (void)cacheInvalidate:(NSString *_Nullable)prefix
                   tags:(NSArray *)tags
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared cacheInvalidate:prefix tags:tags completion:Settle(resolve, reject)];
}

- (void)cacheClear:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared cacheClear:Settle(resolve, reject)];
}

- (void)cacheStats:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared cacheStats:Settle(resolve, reject)];
}

- (void)cacheEvict:(double)maxBytes resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SyncVaultCore.shared cacheEvict:maxBytes completion:Settle(resolve, reject)];
}

@end

@implementation SyncVaultAppDelegate

+ (void)handleEventsForBackgroundURLSession:(NSString *)identifier completionHandler:(void (^)(void))completionHandler
{
  [SyncVaultCore.shared handleEventsForBackgroundURLSession:identifier completionHandler:completionHandler];
}

@end
