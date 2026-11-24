#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Everything Sunshine returned when the app was launched over HTTPS (/launch):
/// the RTSP session URL and the remote input AES key/IV. Produced by the pairing / launch layer.
@interface MLLaunchInfo : NSObject
@property (nonatomic, copy) NSString *address;           // host or Tailscale IP
@property (nonatomic, copy) NSString *appVersion;        // serverinfo <appversion>
@property (nonatomic, copy, nullable) NSString *gfeVersion;
@property (nonatomic, copy, nullable) NSString *rtspSessionUrl;
@property (nonatomic) int serverCodecModeSupport;        // serverinfo <ServerCodecModeSupport>
@property (nonatomic, copy) NSData *riKey;               // 16 bytes
@property (nonatomic) int riKeyId;
@end

@interface MLStreamConfig : NSObject
@property (nonatomic) int width, height, fps, bitrateKbps;
@property (nonatomic) BOOL hevc;
@property (nonatomic) BOOL remote;                       // through Tailscale / Internet
@end

@protocol MLStreamSessionDelegate <NSObject>
- (void)streamStageChanged:(NSString *)stage;
- (void)streamStarted;
- (void)streamTerminated:(int)errorCode;
- (void)streamFailedAtStage:(NSString *)stage error:(int)errorCode;
@end

/// Thin Objective-C wrapper around moonlight-common-c (LiStartConnection) with a VideoToolbox
/// renderer feeding an AVSampleBufferDisplayLayer.
@interface MLStreamSession : NSObject
@property (nonatomic, weak, nullable) id<MLStreamSessionDelegate> delegate;
@property (nonatomic, readonly) AVSampleBufferDisplayLayer *displayLayer;
/// The sound off, the picture on (the HUD's menu).
@property (atomic) BOOL muted;

- (instancetype)initWithLaunch:(MLLaunchInfo *)launch config:(MLStreamConfig *)config;
/// Both return at once: connections are started and stopped one after the other on a private queue.
- (void)start;
- (void)stop;

// Stats
- (uint32_t)estimatedRttMs;
- (double)measuredFps;
- (double)measuredBitrateKbps;
- (uint32_t)droppedFrames;
/// Where a frame's time goes, averaged over the last second, in ms (WakenFrameTiming.h): encoding on the computer,
/// receiving the whole frame, waiting for the decoder, until the screen, and how unsteady the frames reach it.
- (double)hostMs;
- (double)receiveMs;
- (double)queueMs;
- (double)displayMs;
- (double)jitterMs;
/// A reserve of frames that adapts to the network (WakenSmoothing.h): YES by default, NO for the least delay.
@property (nonatomic) BOOL smoothing;
/// Frames held back now, for the HUD.
- (int)reserveFrames;

// Input
- (void)sendMouseDeltaX:(short)dx y:(short)dy;
- (void)sendMouseButton:(int)button down:(BOOL)down;
- (void)sendScroll:(short)amount;
/// Absolute position, in a plane of referenceWidth x referenceHeight.
- (void)sendMouseX:(short)x y:(short)y referenceWidth:(short)referenceWidth referenceHeight:(short)referenceHeight;
- (void)sendText:(NSString *)text;
- (void)sendKey:(short)keyCode down:(BOOL)down modifiers:(char)modifiers;
// Controllers are the session's own (MLGamepads): every one connected to this device plays, with its vibrations,
// touchpad, gyroscope and light bar, without the view doing anything.
@end

NS_ASSUME_NONNULL_END
