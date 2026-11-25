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
/// A reserve of frames that adapts to the network (WakenSmoothing.h), changed while streaming. YES by default.
@property (nonatomic) BOOL smooth;
/// The computer is a Mac: Cmd goes as Cmd. Otherwise (Windows) Cmd+C, Cmd+V... go as Ctrl+C, Ctrl+V. Cmd+Q and
/// Cmd+Tab stay this Mac's either way.
@property (nonatomic) BOOL hostMac;
/// The characters typed go as text (LiSendUtf8TextEvent), whatever the computer's layout; the other keys (Entrée,
/// arrows, Echap) stay keys. NO: every key as a physical key, as games want them.
@property (nonatomic) BOOL textInput;
/// The HUD's menu is open: the cursor shows and the input stays on the Mac.
@property (nonatomic) BOOL paused;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onStateChange;
@property (nonatomic, copy, nullable) RCTDirectEventBlock onStats;

- (void)stopStream;

@end

NS_ASSUME_NONNULL_END
