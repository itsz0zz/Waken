#import <React/RCTBridgeModule.h>

#import "MLPlayStation.h"

/// The PS5 and PS4 for the Mac app's JavaScript (apps/macos/src): found, linked, woken through chiaki (MLPlayStation).
@interface WakenPlayStationModule : NSObject <RCTBridgeModule>
@end

@implementation WakenPlayStationModule

RCT_EXPORT_MODULE(WakenPlayStation)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_EXPORT_METHOD(discover : (double)seconds resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  [MLPlayStation discoverFor:seconds completion:^(NSArray *consoles) { resolve(consoles); }];
}

RCT_EXPORT_METHOD(registerConsole : (NSString *)host ps5 : (BOOL)ps5 accountId : (NSString *)accountId pin : (NSString *)pin resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  [MLPlayStation registerConsole:host ps5:ps5 accountId:accountId pin:pin completion:^(NSDictionary *console, NSString *error) {
    if (console) resolve(console);
    else reject(@"regist", error ?: @"Liaison impossible", nil);
  }];
}

RCT_EXPORT_METHOD(wake : (NSString *)host registKey : (NSString *)registKey ps5 : (BOOL)ps5 resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  NSString *error = [MLPlayStation wake:host registKey:registKey ps5:ps5];
  if (error) reject(@"wake", error, nil);
  else resolve(nil);
}

@end
