#import <AppKit/AppKit.h>
#import <React/RCTComponent.h>

NS_ASSUME_NONNULL_BEGIN

/// The Mac's PS5 / PS4 stream view: the console's picture (MLPlayStationSession, chiaki), the Mac's controllers as its
/// DualSense, and a few keys for the menus (arrows, Return ✕, Escape ○, Space □, Tab △, O Options, P PS).
@interface WakenPlayStationView : NSView

/// host, registKey, rpKey, ps5, accountId: the link (see PlayStationLink in packages/core).
@property (nonatomic, copy) NSDictionary *link;
@property (nonatomic) NSInteger videoHeight;
@property (nonatomic) NSInteger fps;
@property (nonatomic) NSInteger bitrateKbps;
@property (nonatomic) BOOL hevc;
@property (nonatomic) BOOL muted;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onStateChange;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onStats;

@end

NS_ASSUME_NONNULL_END
