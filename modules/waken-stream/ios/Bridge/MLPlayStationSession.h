#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@protocol MLPlayStationSessionDelegate <NSObject>
/// connecting, streaming, stopped, error or pin (the console asks its sign-in code); a message for the last ones.
- (void)playStationStateChanged:(NSString *)state message:(nullable NSString *)message;
@end

/// Streaming a linked PS5 or PS4 through chiaki: its picture in displayLayer, its sound played, this device's
/// controllers (and keys) sent as its DualSense, its vibrations played back on them.
@interface MLPlayStationSession : NSObject

@property (nonatomic, weak, nullable) id<MLPlayStationSessionDelegate> delegate;
@property (nonatomic, readonly) AVSampleBufferDisplayLayer *displayLayer;
@property (atomic) BOOL muted;
/// Buttons from the keyboard (chiaki's CHIAKI_CONTROLLER_BUTTON_ bits), added to the controllers'.
@property (atomic) uint32_t keyboardButtons;

/// registKey: the link's key (hex text); rpKey: hex, 16 bytes; accountId: the PSN account id in base64.
- (instancetype)initWithHost:(NSString *)host
                   registKey:(NSString *)registKey
                       rpKey:(NSString *)rpKey
                         ps5:(BOOL)ps5
                   accountId:(nullable NSString *)accountId
                      height:(int)height
                         fps:(int)fps
                 bitrateKbps:(int)bitrateKbps
                        hevc:(BOOL)hevc;

- (void)start;
- (void)stop;
/// The console's sign-in code, when it asks for one.
- (void)enterPin:(NSString *)pin;

- (double)measuredFps;
- (double)measuredBitrateKbps;
- (uint32_t)droppedFrames;
- (uint32_t)rttMs;

@end

NS_ASSUME_NONNULL_END
