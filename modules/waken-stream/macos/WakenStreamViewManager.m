#import <React/RCTViewManager.h>
#import "WakenMacStreamView.h"

/// <WakenStreamView> in the Mac app's JavaScript (apps/macos/src/stream.tsx).
@interface WakenStreamViewManager : RCTViewManager
@end

@implementation WakenStreamViewManager

RCT_EXPORT_MODULE(WakenStreamView)

- (NSView *)view {
  return [WakenMacStreamView new];
}

RCT_EXPORT_VIEW_PROPERTY(launch, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(videoWidth, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(videoHeight, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(fps, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(bitrateKbps, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(hevc, BOOL)
RCT_EXPORT_VIEW_PROPERTY(remote, BOOL)
RCT_EXPORT_VIEW_PROPERTY(onStateChange, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onStats, RCTDirectEventBlock)

@end
