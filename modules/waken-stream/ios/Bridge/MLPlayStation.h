#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// A PlayStation 4 or 5 through chiaki (libchiaki): found on the home network, linked once with its code, woken.
/// Callbacks come back on the main thread.
@interface MLPlayStation : NSObject

/// The consoles answering on this network for a few seconds: host (address), name, id, ps5 (bool), state (ready,
/// standby, unknown), system version, the app running.
+ (void)discoverFor:(NSTimeInterval)seconds completion:(void (^)(NSArray<NSDictionary<NSString *, id> *> *consoles))completion;

/// Links this device with the console (Settings, System, Remote Play, Link device: an 8-digit code).
/// accountId: the PSN account id, 8 bytes in base64. On success: registKey (hex), rpKey (hex), rpKeyType, mac
/// (hex), nickname, ps5.
+ (void)registerConsole:(NSString *)host
                    ps5:(BOOL)ps5
              accountId:(NSString *)accountId
                    pin:(NSString *)pin
             completion:(void (^)(NSDictionary<NSString *, id> *_Nullable console, NSString *_Nullable error))completion;

/// Wakes a linked console from rest mode, on this network. Nil, or what went wrong.
+ (nullable NSString *)wake:(NSString *)host registKey:(NSString *)registKey ps5:(BOOL)ps5;

@end

NS_ASSUME_NONNULL_END
