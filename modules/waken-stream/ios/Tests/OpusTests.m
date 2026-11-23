#import "WakenOpusDecoder.h"
#import <AudioToolbox/AudioToolbox.h>

#define CHECK(condition) do { if (!(condition)) { fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); exit(1); } } while (0)

static const int kPackets = 200;
static const double kRate = 48000;

typedef struct { float *pcm; UInt32 frames; BOOL used; } Source;

static OSStatus ProvidePCM(AudioConverterRef converter, UInt32 *count, AudioBufferList *buffers, AudioStreamPacketDescription **d, void *context) {
  Source *source = context;
  if (source->used) { *count = 0; return 'wait'; }
  source->used = YES;
  *count = source->frames;
  buffers->mBuffers[0] = (AudioBuffer){.mNumberChannels = 2, .mDataByteSize = source->frames * 2 * sizeof(float), .mData = source->pcm};
  return noErr;
}

/// Encodes a 440 Hz tone with the system encoder, then decodes it packet by packet like a stream.
static void RoundTrip(int samplesPerFrame) {
  AudioStreamBasicDescription pcm = {
    .mSampleRate = kRate, .mFormatID = kAudioFormatLinearPCM, .mFormatFlags = kAudioFormatFlagsNativeFloatPacked,
    .mBytesPerPacket = 8, .mFramesPerPacket = 1, .mBytesPerFrame = 8, .mChannelsPerFrame = 2, .mBitsPerChannel = 32,
  };
  AudioStreamBasicDescription opus = {.mSampleRate = kRate, .mFormatID = kAudioFormatOpus, .mFramesPerPacket = samplesPerFrame, .mChannelsPerFrame = 2};
  AudioConverterRef encoder;
  CHECK(AudioConverterNew(&pcm, &opus, &encoder) == noErr);

  WakenOpusDecoder *decoder = [[WakenOpusDecoder alloc] initWithSampleRate:kRate channels:2 samplesPerFrame:samplesPerFrame];
  CHECK(decoder != nil);

  float *tone = malloc(samplesPerFrame * 2 * sizeof(float));
  long position = 0, sent = 0, received = 0, loudFrames = 0;
  for (int n = 0; n < kPackets; n++) {
    for (int i = 0; i < samplesPerFrame; i++, position++) tone[2 * i] = tone[2 * i + 1] = 0.5f * sinf(2 * M_PI * 440 * position / kRate);

    Source source = {.pcm = tone, .frames = samplesPerFrame, .used = NO};
    uint8_t packet[4000];
    AudioBufferList out = {.mNumberBuffers = 1, .mBuffers = {{.mNumberChannels = 2, .mDataByteSize = sizeof packet, .mData = packet}}};
    AudioStreamPacketDescription description;
    UInt32 count = 1;
    OSStatus status = AudioConverterFillComplexBuffer(encoder, ProvidePCM, &source, &count, &out, &description);
    CHECK(status == noErr || status == 'wait');
    if (count == 0) continue;

    sent++;
    // A lost packet, as moonlight-common-c reports it.
    if (n == kPackets / 3) CHECK([decoder decode:NULL length:0] == nil);

    AVAudioPCMBuffer *decoded = [decoder decode:packet length:out.mBuffers[0].mDataByteSize];
    if (!decoded) continue;
    received += decoded.frameLength;
    float peak = 0;
    for (AVAudioFrameCount i = 0; i < decoded.frameLength; i++) peak = MAX(peak, fabsf(decoded.floatChannelData[1][i]));
    if (peak > 0.2f) loudFrames++;
  }
  printf("Opus %d: %ld packets, %ld of %ld samples, %ld loud\n", samplesPerFrame, sent, received, sent * samplesPerFrame, loudFrames);
  CHECK(sent > kPackets * 0.9);
  CHECK(received >= (sent - 4) * samplesPerFrame);
  CHECK(loudFrames > sent * 0.8);
  AudioConverterDispose(encoder);
  free(tone);
}

int main(void) {
  @autoreleasepool {
    RoundTrip(240); // 5 ms, the default
    RoundTrip(480); // 10 ms, slow links
  }
  puts("Opus: ok");
  return 0;
}
