#import "PerformanceTracker.h"

@interface PerformanceTracker ()
@property (nonatomic, strong) NSMutableDictionary *metrics;
@end

@implementation PerformanceTracker

+ (instancetype)sharedInstance {
    static PerformanceTracker *sharedInstance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sharedInstance = [[self alloc] init];
    });
    return sharedInstance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _metrics = [NSMutableDictionary dictionary];
    }
    return self;
}

- (void)trackInitializationTime:(NSTimeInterval)time {
    _metrics[@"initializationTime"] = @(time * 1000); // Convert to milliseconds
}

- (void)trackEnqueueTime:(NSTimeInterval)time {
    NSNumber *current = _metrics[@"averageEnqueueTime"];
    if (current) {
        double avg = ([current doubleValue] + (time * 1000)) / 2.0;
        _metrics[@"averageEnqueueTime"] = @(avg);
    } else {
        _metrics[@"averageEnqueueTime"] = @(time * 1000);
    }
}

- (void)trackSyncTime:(NSTimeInterval)time {
    NSNumber *current = _metrics[@"averageSyncTime"];
    if (current) {
        double avg = ([current doubleValue] + (time * 1000)) / 2.0;
        _metrics[@"averageSyncTime"] = @(avg);
    } else {
        _metrics[@"averageSyncTime"] = @(time * 1000);
    }
}

- (NSDictionary *)getMetrics {
    return [_metrics copy];
}

- (void)reset {
    [_metrics removeAllObjects];
}

@end


