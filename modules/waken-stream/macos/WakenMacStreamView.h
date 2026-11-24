#import <AppKit/AppKit.h>
#import <React/RCTComponent.h>

NS_ASSUME_NONNULL_BEGIN

/// The Mac's stream view: the picture of the computer played on (MLStreamSession, as on the iPhone), and the
/// Mac's keyboard, mouse and controllers sent to it. React Native sets the props, then the stream starts.
@interface WakenMacStreamView : NSView

@property (nonatomic, copy) NSDictionary *launch;
@property (nonatomic) NSInteger videoWidth;
@property (nonatomic) NSInteger videoHeight;
@property (nonatomic) NSInteger fps;
@property (nonatomic) NSInteger bitrateKbps;
@property (nonatomic) BOOL hevc;
@property (nonatomic) BOOL remote;
@property (nonatomic) BOOL muted;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onStateChange;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onStats;

- (void)stopStream;

@end

NS_ASSUME_NONNULL_END
