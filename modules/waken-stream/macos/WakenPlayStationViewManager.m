#import <React/RCTViewManager.h>
#import "WakenPlayStationView.h"

/// <WakenPlayStationView> in the Mac app's JavaScript (apps/macos/src/playstation.tsx).
@interface WakenPlayStationViewManager : RCTViewManager
@end

@implementation WakenPlayStationViewManager

RCT_EXPORT_MODULE(WakenPlayStationView)

- (NSView *)view {
  return [WakenPlayStationView new];
}

RCT_EXPORT_VIEW_PROPERTY(link, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(videoHeight, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(fps, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(bitrateKbps, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(hevc, BOOL)
RCT_EXPORT_VIEW_PROPERTY(muted, BOOL)
RCT_EXPORT_VIEW_PROPERTY(onStateChange, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onStats, RCTDirectEventBlock)

@end
