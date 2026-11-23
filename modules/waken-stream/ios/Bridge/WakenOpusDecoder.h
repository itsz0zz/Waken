#import <AVFoundation/AVFoundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Decodes the raw Opus packets of moonlight-common-c with the system codec (no libopus to ship).
/// Mono or stereo only: that is all the app negotiates.
@interface WakenOpusDecoder : NSObject
@property (nonatomic, readonly) AVAudioFormat *format;

- (nullable instancetype)initWithSampleRate:(double)sampleRate channels:(int)channels samplesPerFrame:(int)samplesPerFrame;
/// One packet in, at most one frame of PCM out. nil when the codec had nothing to give back.
- (nullable AVAudioPCMBuffer *)decode:(nullable const void *)packet length:(int)length;
@end

NS_ASSUME_NONNULL_END
