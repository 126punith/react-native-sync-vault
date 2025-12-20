#import <Foundation/Foundation.h>
#import <sqlite3.h>

NS_ASSUME_NONNULL_BEGIN

@interface DatabaseManager : NSObject

- (instancetype)initWithDatabasePath:(NSString *)path;
- (BOOL)initializeDatabase;
- (sqlite3 *)database;

@end

NS_ASSUME_NONNULL_END


