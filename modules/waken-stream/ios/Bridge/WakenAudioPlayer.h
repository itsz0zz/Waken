#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Plays the stream's Opus packets with as little delay as possible.
@interface WakenAudioPlayer : NSObject
- (nullable instancetype)initWithSampleRate:(double)sampleRate channels:(int)channels samplesPerFrame:(int)samplesPerFrame;
- (void)start;
- (void)stop;
/// Called from moonlight-common-c's audio thread. A NULL packet is a lost one.
- (void)play:(nullable const void *)packet length:(int)length;
@end

NS_ASSUME_NONNULL_END
