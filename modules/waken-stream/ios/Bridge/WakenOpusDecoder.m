#import "WakenOpusDecoder.h"
#import <AudioToolbox/AudioToolbox.h>

static const int kMaxChannels = 2;
/// Returned by the input callback once the packet is consumed. Returning noErr would end the stream for good.
static const OSStatus kPacketConsumed = 'wait';

typedef struct {
  const void *data;
  UInt32 length;
  UInt32 channels;
  BOOL consumed;
  AudioStreamPacketDescription description;
} WakenPacketInput;

static OSStatus ProvidePacket(AudioConverterRef converter, UInt32 *packetCount, AudioBufferList *buffers,
                              AudioStreamPacketDescription **descriptions, void *context) {
  WakenPacketInput *input = context;
  if (input->consumed) {
    *packetCount = 0;
    return kPacketConsumed;
  }
  input->consumed = YES;
  *packetCount = 1;
  buffers->mBuffers[0].mData = (void *)input->data;
  buffers->mBuffers[0].mDataByteSize = input->length;
  buffers->mBuffers[0].mNumberChannels = input->channels;
  if (descriptions) {
    input->description = (AudioStreamPacketDescription){.mStartOffset = 0, .mVariableFramesInPacket = 0, .mDataByteSize = input->length};
    *descriptions = &input->description;
  }
  return noErr;
}

@implementation WakenOpusDecoder {
  AudioConverterRef _converter;
  UInt32 _samplesPerFrame;
}

- (nullable instancetype)initWithSampleRate:(double)sampleRate channels:(int)channels samplesPerFrame:(int)samplesPerFrame {
  if (!(self = [super init])) return nil;
  if (channels < 1 || channels > kMaxChannels || samplesPerFrame <= 0) return nil;

  _samplesPerFrame = (UInt32)samplesPerFrame;
  _format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:sampleRate channels:(AVAudioChannelCount)channels];
  if (!_format) return nil;

  AudioStreamBasicDescription opus = {
    .mSampleRate = sampleRate,
    .mFormatID = kAudioFormatOpus,
    .mFramesPerPacket = _samplesPerFrame,
    .mChannelsPerFrame = (UInt32)channels,
  };
  if (AudioConverterNew(&opus, _format.streamDescription, &_converter) != noErr) return nil;
  return self;
}

- (void)dealloc {
  if (_converter) AudioConverterDispose(_converter);
}

- (nullable AVAudioPCMBuffer *)decode:(nullable const void *)packet length:(int)length {
  if (!packet || length <= 0) return nil;

  AVAudioPCMBuffer *pcm = [[AVAudioPCMBuffer alloc] initWithPCMFormat:_format frameCapacity:_samplesPerFrame];
  if (!pcm) return nil;
  pcm.frameLength = _samplesPerFrame; // sets the byte sizes the converter reads

  WakenPacketInput input = {.data = packet, .length = (UInt32)length, .channels = _format.channelCount, .consumed = NO};
  UInt32 frames = _samplesPerFrame;
  OSStatus status = AudioConverterFillComplexBuffer(_converter, ProvidePacket, &input, &frames, pcm.mutableAudioBufferList, NULL);
  if (status != noErr && status != kPacketConsumed) {
    AudioConverterReset(_converter);
    return nil;
  }
  if (frames == 0) return nil;
  pcm.frameLength = frames;
  return pcm;
}

@end
