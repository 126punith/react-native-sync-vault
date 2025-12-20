#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface PerformanceTracker : NSObject

+ (instancetype)sharedInstance;
- (void)trackInitializationTime:(NSTimeInterval)time;
- (void)trackEnqueueTime:(NSTimeInterval)time;
- (void)trackSyncTime:(NSTimeInterval)time;
- (NSDictionary *)getMetrics;
- (void)reset;

@end

NS_ASSUME_NONNULL_END


