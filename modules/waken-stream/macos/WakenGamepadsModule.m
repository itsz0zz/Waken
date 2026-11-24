#import <React/RCTBridgeModule.h>

#import "MLGamepads.h"

/// The Mac's controllers for the Manettes page (apps/macos/src): MLGamepads, outside any stream.
@interface WakenGamepadsModule : NSObject <RCTBridgeModule>
@end

@implementation WakenGamepadsModule

RCT_EXPORT_MODULE(WakenGamepads)

// GameController lives on the main thread.
- (dispatch_queue_t)methodQueue {
  return dispatch_get_main_queue();
}

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_EXPORT_METHOD(list : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  resolve(MLGamepads.connected);
}

RCT_EXPORT_METHOD(test : (NSString *)identifier resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  [MLGamepads test:identifier];
  resolve(nil);
}

RCT_EXPORT_METHOD(setOptions : (double)rumble motion : (BOOL)motion kind : (NSString *)kind) {
  [MLGamepads setRumble:(float)rumble motion:motion kind:kind];
}

@end
