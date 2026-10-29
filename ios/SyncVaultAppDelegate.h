#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Plain Objective-C entry points for the app delegate (safe to import from AppDelegate.mm).
@interface SyncVaultAppDelegate : NSObject

/// Forward application:handleEventsForBackgroundURLSession:completionHandler: so large uploads
/// that finished while the app was suspended or killed are recorded in the outbox.
+ (void)handleEventsForBackgroundURLSession:(NSString *)identifier completionHandler:(void (^)(void))completionHandler;

@end

NS_ASSUME_NONNULL_END
