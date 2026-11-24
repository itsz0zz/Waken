#import "MLStreamSession.h"
#import <VideoToolbox/VideoToolbox.h>
#include <arpa/inet.h>
#import "WakenAudioPlayer.h"
#import "MLGamepads.h"
#include "Limelight.h"
#include "WakenAnnexB.h"
#include "WakenFrameTiming.h"
#include "WakenSmoothing.h"
#import <os/lock.h>
#include <stdatomic.h>

@implementation MLLaunchInfo
@end
@implementation MLStreamConfig
@end

// moonlight-common-c uses plain C callbacks: one active session at a time (like Moonlight).
static __weak MLStreamSession *gSession;

/// moonlight-common-c is a global state machine: a connection must be fully stopped before the next one starts.
static dispatch_queue_t ConnectionQueue(void) {
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ queue = dispatch_queue_create("fr.wakenplay.stream.connection", DISPATCH_QUEUE_SERIAL); });
  return queue;
}

// Frames go to the screen one per refresh (a display link), not each the moment it arrives: the network delivers
// them in bursts, and shown as they came the picture stuttered. How many may wait is WakenSmoothing.h's call.
/// The moment a paced sample was handed to the decoder callback (WakenFrameTiming.h, WakenSmoothing.h).
static CFStringRef const kWakenSubmittedUs = CFSTR("WakenSubmittedUs");
/// The moment the computer captured it (its own clock), for the HUD's steadiness (WakenFrameTiming.h).
static CFStringRef const kWakenPresentationUs = CFSTR("WakenPresentationUs");
#if TARGET_OS_OSX
#import <CoreVideo/CoreVideo.h>
static CVReturn PaceFrame(CVDisplayLinkRef link, const CVTimeStamp *now, const CVTimeStamp *output, CVOptionFlags flags,
                          CVOptionFlags *flagsOut, void *context);
#else
#import <QuartzCore/QuartzCore.h>
/// A CADisplayLink keeps its target: this one keeps the session weakly, so a session never stopped still goes away.
@interface MLDisplayLinkProxy : NSObject
@property (nonatomic, weak) MLStreamSession *session;
- (void)tick:(CADisplayLink *)link;
@end
#endif

@interface MLStreamSession ()
- (int)submitDecodeUnit:(PDECODE_UNIT)du;
- (void)setupVideoFormat:(int)videoFormat;
- (void)setupAudio:(const POPUS_MULTISTREAM_CONFIGURATION)opus;
- (void)startAudio;
- (void)stopAudio;
- (void)playAudio:(const char *)data length:(int)length;
- (void)stageFailed:(NSString *)name error:(int)errorCode;
- (void)presentPacedFrame;
/// This stream's controllers: started once connected, stopped with the stream. Main thread only.
@property (nonatomic, readonly) MLGamepads *gamepads;
@end

@implementation MLStreamSession {
  MLLaunchInfo *_launch;
  MLStreamConfig *_config;
  int _videoFormat;
  CMVideoFormatDescriptionRef _formatDesc;
  NSData *_vps, *_sps, *_pps;
  // stats
  uint64_t _frames, _bytes, _dropped;
  CFAbsoluteTime _windowStart;
  double _fps, _kbps;
  // Where each frame's time goes (WakenFrameTiming.h): filled on the decoder and display threads, read by the HUD.
  os_unfair_lock _timingLock;
  WakenFrameWindow _timing;
  WakenFrameTimes _times;
  WakenAudioPlayer *_audio;
  atomic_bool _cancelled;
  atomic_bool _connected;
  atomic_bool _failureReported;
  // Frames waiting for the screen, and the reserve deciding when they go; all under _pacedLock.
  CFMutableArrayRef _paced;
  os_unfair_lock _pacedLock;
  WakenSmoothing _smoothing;
#if TARGET_OS_OSX
  // A refresh of the Mac's screen: CVDisplayLink, its own high priority thread.
  CVDisplayLinkRef _link;
#else
  // A refresh of the iPhone's screen, on the main thread (where the display layer lives).
  CADisplayLink *_displayLink;
  BOOL _displayLinkAsked;
#endif
}

- (instancetype)initWithLaunch:(MLLaunchInfo *)launch config:(MLStreamConfig *)config {
  if ((self = [super init])) {
    _launch = launch;
    _config = config;
    _gamepads = [MLGamepads new];
    _displayLayer = [AVSampleBufferDisplayLayer new];
    _displayLayer.videoGravity = AVLayerVideoGravityResizeAspect;
    _displayLayer.backgroundColor = CGColorGetConstantColor(kCGColorBlack);
    _paced = CFArrayCreateMutable(NULL, 0, &kCFTypeArrayCallBacks);
    _pacedLock = OS_UNFAIR_LOCK_INIT;
    _smoothing.enabled = 1;
  }
  return self;
}

- (void)dealloc {
#if TARGET_OS_OSX
  [self stopPacing];
#else
  // The display link's proxy ends it at its next refresh, once this session is gone.
  if ([NSThread isMainThread]) [_displayLink invalidate];
#endif
  CFRelease(_paced);
  if (_formatDesc) CFRelease(_formatDesc);
}

#pragma mark - C callbacks

static int DrSetup(int videoFormat, int width, int height, int redrawRate, void *context, int drFlags) {
  [gSession setupVideoFormat:videoFormat];
  return 0;
}
static void DrStart(void) {}
static void DrStop(void) {}
static void DrCleanup(void) {}
static int DrSubmit(PDECODE_UNIT du) {
  @autoreleasepool {
    MLStreamSession *session = gSession;
    return session ? [session submitDecodeUnit:du] : DR_OK;
  }
}

static int ArInit(int audioConfiguration, const POPUS_MULTISTREAM_CONFIGURATION opusConfig, void *context, int arFlags) {
  [gSession setupAudio:opusConfig];
  return 0; // A stream without sound is better than no stream.
}
static void ArStart(void) { [gSession startAudio]; }
static void ArStop(void) { [gSession stopAudio]; }
static void ArCleanup(void) {}
static void ArDecodeAndPlay(char *sampleData, int sampleLength) {
  @autoreleasepool { [gSession playAudio:sampleData length:sampleLength]; }
}

static NSString *StageName(int stage) { return [NSString stringWithUTF8String:LiGetStageName(stage)]; }
static void ClStageStarting(int stage) {
  NSString *name = StageName(stage);
  MLStreamSession *session = gSession;
  dispatch_async(dispatch_get_main_queue(), ^{ [session.delegate streamStageChanged:name]; });
}
static void ClStageComplete(int stage) {}
static void ClStageFailed(int stage, int errorCode) {
  NSString *name = StageName(stage);
  [gSession stageFailed:name error:errorCode];
}
static void ClConnectionStarted(void) {
  MLStreamSession *session = gSession;
  dispatch_async(dispatch_get_main_queue(), ^{ [session.delegate streamStarted]; });
}
static void ClConnectionTerminated(int errorCode) {
  MLStreamSession *session = gSession;
  dispatch_async(dispatch_get_main_queue(), ^{ [session.delegate streamTerminated:errorCode]; });
}
static void ClLogMessage(const char *format, ...) {
  va_list args;
  va_start(args, format);
  NSLogv([NSString stringWithUTF8String:format], args);
  va_end(args);
}
// What the computer asks of the controllers, from moonlight's threads: played on the main thread, where they live.
static void ClRumble(unsigned short controllerNumber, unsigned short lowFreqMotor, unsigned short highFreqMotor) {
  MLGamepads *gamepads = gSession.gamepads;
  dispatch_async(dispatch_get_main_queue(), ^{ [gamepads rumble:controllerNumber low:lowFreqMotor high:highFreqMotor]; });
}
static void ClRumbleTriggers(uint16_t controllerNumber, uint16_t leftTriggerMotor, uint16_t rightTriggerMotor) {
  MLGamepads *gamepads = gSession.gamepads;
  dispatch_async(dispatch_get_main_queue(), ^{ [gamepads rumbleTriggers:controllerNumber left:leftTriggerMotor right:rightTriggerMotor]; });
}
static void ClSetMotionEventState(uint16_t controllerNumber, uint8_t motionType, uint16_t reportRateHz) {
  MLGamepads *gamepads = gSession.gamepads;
  dispatch_async(dispatch_get_main_queue(), ^{ [gamepads motion:controllerNumber type:motionType rate:reportRateHz]; });
}
static void ClSetControllerLED(uint16_t controllerNumber, uint8_t r, uint8_t g, uint8_t b) {
  MLGamepads *gamepads = gSession.gamepads;
  dispatch_async(dispatch_get_main_queue(), ^{ [gamepads light:controllerNumber red:r green:g blue:b]; });
}
static void ClConnectionStatusUpdate(int status) {}

#pragma mark - Lifecycle

- (void)start {
  dispatch_async(ConnectionQueue(), ^{
    @autoreleasepool { [self connect]; }
  });
}

/// On ConnectionQueue. Blocks until connected or failed.
- (void)connect {
  if (atomic_load(&_cancelled)) return;
  if (_launch.riKey.length != sizeof(((STREAM_CONFIGURATION *)NULL)->remoteInputAesKey)) {
    [self stageFailed:@"clé de session" error:-1];
    return;
  }
  gSession = self;

  SERVER_INFORMATION server;
  LiInitializeServerInformation(&server);
  server.address = _launch.address.UTF8String;
  server.serverInfoAppVersion = _launch.appVersion.UTF8String;
  server.serverInfoGfeVersion = _launch.gfeVersion.UTF8String;
  server.rtspSessionUrl = _launch.rtspSessionUrl.UTF8String;
  server.serverCodecModeSupport = _launch.serverCodecModeSupport;

  STREAM_CONFIGURATION cfg;
  LiInitializeStreamConfiguration(&cfg);
  cfg.width = _config.width;
  cfg.height = _config.height;
  cfg.fps = _config.fps;
  cfg.bitrate = _config.bitrateKbps;
  cfg.packetSize = _config.remote ? 1024 : 1392;
  cfg.streamingRemotely = _config.remote ? STREAM_CFG_REMOTE : STREAM_CFG_AUTO;
  cfg.audioConfiguration = AUDIO_CONFIGURATION_STEREO;
  cfg.supportedVideoFormats = _config.hevc ? (VIDEO_FORMAT_H264 | VIDEO_FORMAT_H265) : VIDEO_FORMAT_H264;
  cfg.encryptionFlags = (int)ENCFLG_ALL; // video too, when the host allows it
  memcpy(cfg.remoteInputAesKey, _launch.riKey.bytes, MIN(_launch.riKey.length, sizeof(cfg.remoteInputAesKey)));
  int keyId = htonl(_launch.riKeyId);
  memset(cfg.remoteInputAesIv, 0, sizeof(cfg.remoteInputAesIv));
  memcpy(cfg.remoteInputAesIv, &keyId, sizeof(keyId));

  DECODER_RENDERER_CALLBACKS dr;
  LiInitializeVideoCallbacks(&dr);
  dr.setup = DrSetup;
  dr.start = DrStart;
  dr.stop = DrStop;
  dr.cleanup = DrCleanup;
  dr.submitDecodeUnit = DrSubmit;
  dr.capabilities = CAPABILITY_DIRECT_SUBMIT;

  AUDIO_RENDERER_CALLBACKS ar;
  LiInitializeAudioCallbacks(&ar);
  ar.init = ArInit;
  ar.start = ArStart;
  ar.stop = ArStop;
  ar.cleanup = ArCleanup;
  ar.decodeAndPlaySample = ArDecodeAndPlay;
  ar.capabilities = CAPABILITY_DIRECT_SUBMIT;

  CONNECTION_LISTENER_CALLBACKS cl;
  LiInitializeConnectionCallbacks(&cl);
  cl.stageStarting = ClStageStarting;
  cl.stageComplete = ClStageComplete;
  cl.stageFailed = ClStageFailed;
  cl.connectionStarted = ClConnectionStarted;
  cl.connectionTerminated = ClConnectionTerminated;
  cl.logMessage = ClLogMessage;
  cl.rumble = ClRumble;
  cl.rumbleTriggers = ClRumbleTriggers;
  cl.setMotionEventState = ClSetMotionEventState;
  cl.setControllerLED = ClSetControllerLED;
  cl.connectionStatusUpdate = ClConnectionStatusUpdate;

  _windowStart = CFAbsoluteTimeGetCurrent();
  os_unfair_lock_lock(&_timingLock);
  memset(&_timing, 0, sizeof(_timing));
  memset(&_times, 0, sizeof(_times));
  os_unfair_lock_unlock(&_timingLock);
  int result = LiStartConnection(&server, &cfg, &cl, &dr, &ar, NULL, 0, NULL, 0);
  if (result == 0) {
    atomic_store(&_connected, true);
    // The controllers connected now are announced, the next ones as they come.
    dispatch_async(dispatch_get_main_queue(), ^{
      if (!atomic_load(&self->_cancelled)) [self->_gamepads start];
    });
  } else if (!atomic_load(&_failureReported)) {
    [self stageFailed:@"connexion" error:result];
  }
}

- (void)stop {
  if (atomic_exchange(&_cancelled, true)) return;
  [self stopPacing];
  atomic_store(&_connected, false);
  MLGamepads *gamepads = _gamepads;
  dispatch_async(dispatch_get_main_queue(), ^{ [gamepads stop]; });
  // Unblocks a connection still in progress. Only ours: not the one that may have replaced it.
  if (gSession == self) LiInterruptConnection();
  dispatch_async(ConnectionQueue(), ^{
    if (gSession == self) {
      LiStopConnection();
      gSession = nil;
    }
    [self stopAudio];
    dispatch_async(dispatch_get_main_queue(), ^{ [self->_displayLayer flushAndRemoveImage]; });
  });
}

- (void)stageFailed:(NSString *)name error:(int)errorCode {
  atomic_store(&_failureReported, true);
  if (atomic_load(&_cancelled)) return;
  dispatch_async(dispatch_get_main_queue(), ^{ [self.delegate streamFailedAtStage:name error:errorCode]; });
}

#pragma mark - Audio

- (void)setupAudio:(const POPUS_MULTISTREAM_CONFIGURATION)opus {
  _audio = [[WakenAudioPlayer alloc] initWithSampleRate:opus->sampleRate channels:opus->channelCount samplesPerFrame:opus->samplesPerFrame];
  if (!_audio) NSLog(@"Waken audio: unsupported Opus configuration (%d Hz, %d channels)", opus->sampleRate, opus->channelCount);
}

- (void)startAudio { [_audio start]; }
- (void)stopAudio { [_audio stop]; }
- (void)playAudio:(const char *)data length:(int)length {
  if (!self.muted) [_audio play:data length:length];
}

#pragma mark - Video

- (void)setupVideoFormat:(int)videoFormat {
  _videoFormat = videoFormat;
  _vps = _sps = _pps = nil;
  if (_formatDesc) { CFRelease(_formatDesc); _formatDesc = NULL; }
}

- (void)storeParameterSet:(PLENTRY)entry {
  size_t length;
  const uint8_t *nal = WakenFirstNAL((const uint8_t *)entry->data, (size_t)entry->length, &length);
  if (!nal) return;

  NSData *set = [NSData dataWithBytes:nal length:length];
  if (entry->bufferType == BUFFER_TYPE_VPS) _vps = set;
  else if (entry->bufferType == BUFFER_TYPE_SPS) _sps = set;
  else _pps = set;
  if (_formatDesc) { CFRelease(_formatDesc); _formatDesc = NULL; }
}

- (BOOL)makeFormatDescription {
  if (_formatDesc) return YES;
  OSStatus status;
  if (_videoFormat & VIDEO_FORMAT_MASK_H265) {
    if (!_vps || !_sps || !_pps) return NO;
    const uint8_t *sets[] = { _vps.bytes, _sps.bytes, _pps.bytes };
    const size_t sizes[] = { _vps.length, _sps.length, _pps.length };
    status = CMVideoFormatDescriptionCreateFromHEVCParameterSets(NULL, 3, sets, sizes, 4, NULL, &_formatDesc);
  } else {
    if (!_sps || !_pps) return NO;
    const uint8_t *sets[] = { _sps.bytes, _pps.bytes };
    const size_t sizes[] = { _sps.length, _pps.length };
    status = CMVideoFormatDescriptionCreateFromH264ParameterSets(NULL, 2, sets, sizes, 4, &_formatDesc);
  }
  return status == noErr;
}

- (int)submitDecodeUnit:(PDECODE_UNIT)du {
  const uint64_t submittedUs = LiGetMicroseconds();
  os_unfair_lock_lock(&_timingLock);
  WakenFrameReceived(&_timing, du->frameHostProcessingLatency, du->receiveTimeUs, du->enqueueTimeUs, submittedUs);
  os_unfair_lock_unlock(&_timingLock);
  // The list holds one entry per RTP packet: a NAL, even a start code, can straddle two of them.
  NSMutableData *picture = [NSMutableData dataWithCapacity:(NSUInteger)du->fullLength];
  for (PLENTRY e = du->bufferList; e != NULL; e = e->next) {
    if (e->bufferType == BUFFER_TYPE_PICDATA) [picture appendBytes:e->data length:(NSUInteger)e->length];
    else [self storeParameterSet:e];
  }
  if (![self makeFormatDescription] || picture.length == 0) return DR_NEED_IDR;

  size_t capacity = WakenAVCCCapacity(picture.length);
  uint8_t *bytes = malloc(capacity);
  if (!bytes) return DR_NEED_IDR;
  const size_t size = WakenAnnexBToAVCC(picture.bytes, picture.length, bytes, capacity);
  if (size == 0) {
    free(bytes);
    return DR_NEED_IDR;
  }

  CMBlockBufferRef block = NULL;
  if (CMBlockBufferCreateWithMemoryBlock(NULL, bytes, capacity, kCFAllocatorMalloc, NULL, 0, size, 0, &block) != noErr) {
    free(bytes);
    return DR_NEED_IDR;
  }
  CMSampleBufferRef sample = NULL;
  OSStatus st = CMSampleBufferCreateReady(NULL, block, _formatDesc, 1, 0, NULL, 1, &size, &sample);
  CFRelease(block);
  if (st != noErr) return DR_NEED_IDR;

  CFArrayRef atts = CMSampleBufferGetSampleAttachmentsArray(sample, YES);
  CFMutableDictionaryRef d = (CFMutableDictionaryRef)CFArrayGetValueAtIndex(atts, 0);
  CFDictionarySetValue(d, kCMSampleAttachmentKey_DisplayImmediately, kCFBooleanTrue);
  CFDictionarySetValue(d, kCMSampleAttachmentKey_IsDependedOnByOthers, kCFBooleanTrue);
  if (du->frameType != FRAME_TYPE_IDR) CFDictionarySetValue(d, kCMSampleAttachmentKey_NotSync, kCFBooleanTrue);

  // The pacing queue keeps samples, not decode units: the moment this one was handed over goes with it.
  CFNumberRef submitted = CFNumberCreate(NULL, kCFNumberSInt64Type, &submittedUs);
  CMSetAttachment(sample, kWakenSubmittedUs, submitted, kCMAttachmentMode_ShouldNotPropagate);
  CFRelease(submitted);
  const int64_t presentationUs = (int64_t)du->presentationTimeUs;
  CFNumberRef presentation = CFNumberCreate(NULL, kCFNumberSInt64Type, &presentationUs);
  CMSetAttachment(sample, kWakenPresentationUs, presentation, kCMAttachmentMode_ShouldNotPropagate);
  CFRelease(presentation);
  [self paceFrame:sample presentation:du->presentationTimeUs arrival:du->enqueueTimeUs];
  CFRelease(sample);

  // Stats window (1 s)
  _frames++;
  _bytes += du->fullLength;
  CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
  if (now - _windowStart >= 1.0) {
    double dt = now - _windowStart;
    _fps = _frames / dt;
    _kbps = (_bytes * 8.0 / 1000.0) / dt;
    _frames = 0; _bytes = 0; _windowStart = now;
    os_unfair_lock_lock(&_timingLock);
    _times = WakenFrameClose(&_timing);
    os_unfair_lock_unlock(&_timingLock);
    os_unfair_lock_lock(&_pacedLock);
    WakenSmoothingUpdate(&_smoothing, 1000.0 / MAX(_config.fps, 1));
    os_unfair_lock_unlock(&_pacedLock);
  }
  return DR_OK;
}

#pragma mark - Pacing

static uint64_t AttachedUs(CMSampleBufferRef sample, CFStringRef key) {
  CFNumberRef value = CMGetAttachment(sample, key, NULL);
  int64_t us = 0;
  if (value) CFNumberGetValue(value, kCFNumberSInt64Type, &us);
  return (uint64_t)us;
}
static uint64_t SubmittedUs(CMSampleBufferRef sample) { return AttachedUs(sample, kWakenSubmittedUs); }

/// On the network thread: the frame waits for a refresh. The display link starts with the first one.
- (void)paceFrame:(CMSampleBufferRef)sample presentation:(uint64_t)presentationUs arrival:(uint64_t)arrivalUs {
  os_unfair_lock_lock(&_pacedLock);
  if (atomic_load(&_cancelled)) {
    os_unfair_lock_unlock(&_pacedLock);
    return;
  }
  WakenSmoothingFrame(&_smoothing, presentationUs, arrivalUs);
  CFArrayAppendValue(_paced, sample);
#if TARGET_OS_OSX
  BOOL start = _link == NULL;
  if (start && CVDisplayLinkCreateWithActiveCGDisplays(&_link) == kCVReturnSuccess) {
    CVDisplayLinkSetOutputCallback(_link, PaceFrame, (__bridge void *)self);
  }
  CVDisplayLinkRef link = _link;
  os_unfair_lock_unlock(&_pacedLock);
  if (start && link) CVDisplayLinkStart(link);
#else
  BOOL start = !_displayLinkAsked;
  _displayLinkAsked = YES;
  os_unfair_lock_unlock(&_pacedLock);
  if (start) {
    const int fps = MAX(_config.fps, 1);
    dispatch_async(dispatch_get_main_queue(), ^{
      if (atomic_load(&self->_cancelled) || self->_displayLink) return;
      MLDisplayLinkProxy *proxy = [MLDisplayLinkProxy new];
      proxy.session = self;
      CADisplayLink *link = [CADisplayLink displayLinkWithTarget:proxy selector:@selector(tick:)];
      // The stream's own rate: on a 120 Hz screen, a 60 i/s stream needs no more refreshes.
      if (@available(iOS 15.0, *)) link.preferredFrameRateRange = CAFrameRateRangeMake(fps, MAX(fps, 120), fps);
      [link addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
      self->_displayLink = link;
    });
  }
#endif
}

/// Once per refresh (the display link's thread on the Mac, the main thread on the iPhone): the next frame if the
/// reserve lets it go, and the late ones decoded but not shown.
- (void)presentPacedFrame {
  const uint64_t now = LiGetMicroseconds();
  const double frameMs = 1000.0 / MAX(_config.fps, 1);
  CFMutableArrayRef batch = NULL;
  os_unfair_lock_lock(&_pacedLock);
  CFIndex count = CFArrayGetCount(_paced);
  // The frames whose time came: their capture on the computer plus the reserve's fixed delay.
  int due = 0;
  for (CFIndex i = 0; i < count; i++) {
    CMSampleBufferRef sample = (CMSampleBufferRef)CFArrayGetValueAtIndex(_paced, i);
    if (WakenSmoothingDueUs(&_smoothing, AttachedUs(sample, kWakenPresentationUs), frameMs) > now) break;
    due++;
  }
  const CFIndex take = WakenSmoothingTake(&_smoothing, (int)count, due);
  if (take > 0) {
    batch = CFArrayCreateMutable(NULL, take, &kCFTypeArrayCallBacks);
    CFArrayAppendArray(batch, _paced, CFRangeMake(0, take));
    CFArrayReplaceValues(_paced, CFRangeMake(0, take), NULL, 0);
  }
  os_unfair_lock_unlock(&_pacedLock);
  if (!batch) return;

  if (_displayLayer.status == AVQueuedSampleBufferRenderingStatusFailed) {
    [_displayLayer flush];
    _dropped++;
    LiRequestIdrFrame(); // nothing can be decoded after a flush until the next key frame
  }
  CFIndex total = CFArrayGetCount(batch);
  for (CFIndex i = 0; i < total; i++) {
    CMSampleBufferRef sample = (CMSampleBufferRef)CFArrayGetValueAtIndex(batch, i);
    if (i < total - 1) {
      // Too late to show, still needed: the next frames are built on it.
      CFArrayRef atts = CMSampleBufferGetSampleAttachmentsArray(sample, YES);
      CFDictionarySetValue((CFMutableDictionaryRef)CFArrayGetValueAtIndex(atts, 0), kCMSampleAttachmentKey_DoNotDisplay, kCFBooleanTrue);
      _dropped++;
    }
    [_displayLayer enqueueSampleBuffer:sample];
    if (i == total - 1) [self frameShown:SubmittedUs(sample) presentation:AttachedUs(sample, kWakenPresentationUs)];
  }
  CFRelease(batch);
}

- (void)stopPacing {
  os_unfair_lock_lock(&_pacedLock);
  CFArrayRemoveAllValues(_paced);
#if TARGET_OS_OSX
  CVDisplayLinkRef link = _link;
  _link = NULL;
  os_unfair_lock_unlock(&_pacedLock);
  if (link) {
    CVDisplayLinkStop(link); // returns once a callback in progress is over
    CVDisplayLinkRelease(link);
  }
#else
  _displayLinkAsked = NO;
  os_unfair_lock_unlock(&_pacedLock);
  // The display link is made and ended on the main thread only.
  if ([NSThread isMainThread]) {
    [_displayLink invalidate];
    _displayLink = nil;
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self->_displayLink invalidate];
      self->_displayLink = nil;
    });
  }
#endif
}

- (void)setSmoothing:(BOOL)smoothing {
  os_unfair_lock_lock(&_pacedLock);
  _smoothing.enabled = smoothing ? 1 : 0;
  if (!smoothing) _smoothing.target = 0;
  os_unfair_lock_unlock(&_pacedLock);
}

- (BOOL)smoothing {
  os_unfair_lock_lock(&_pacedLock);
  BOOL on = _smoothing.enabled != 0;
  os_unfair_lock_unlock(&_pacedLock);
  return on;
}

- (int)reserveFrames {
  os_unfair_lock_lock(&_pacedLock);
  int frames = _smoothing.target;
  os_unfair_lock_unlock(&_pacedLock);
  return frames;
}

#pragma mark - Stats

/// A frame handed to the display layer, on the display link (Mac) or the main thread (iPhone).
- (void)frameShown:(uint64_t)submittedUs presentation:(uint64_t)presentationUs {
  const uint64_t now = LiGetMicroseconds();
  os_unfair_lock_lock(&_timingLock);
  WakenFrameShown(&_timing, submittedUs, presentationUs, now);
  os_unfair_lock_unlock(&_timingLock);
}

- (WakenFrameTimes)frameTimes {
  os_unfair_lock_lock(&_timingLock);
  WakenFrameTimes t = _times;
  os_unfair_lock_unlock(&_timingLock);
  return t;
}
- (double)hostMs { return [self frameTimes].hostMs; }
- (double)receiveMs { return [self frameTimes].receiveMs; }
- (double)queueMs { return [self frameTimes].queueMs; }
- (double)displayMs { return [self frameTimes].displayMs; }
- (double)jitterMs { return [self frameTimes].jitterMs; }

- (uint32_t)estimatedRttMs {
  uint32_t rtt = 0, variance = 0;
  if (LiGetEstimatedRttInfo(&rtt, &variance)) return rtt;
  return 0;
}
- (double)measuredFps { return _fps; }
- (double)measuredBitrateKbps { return _kbps; }
- (uint32_t)droppedFrames { return (uint32_t)_dropped; }

#pragma mark - Input

- (BOOL)canSend {
  return atomic_load(&_connected);
}

- (void)sendMouseDeltaX:(short)dx y:(short)dy {
  if (self.canSend) LiSendMouseMoveEvent(dx, dy);
}
- (void)sendMouseX:(short)x y:(short)y referenceWidth:(short)referenceWidth referenceHeight:(short)referenceHeight {
  if (self.canSend) LiSendMousePositionEvent(x, y, referenceWidth, referenceHeight);
}
- (void)sendMouseButton:(int)button down:(BOOL)down {
  if (self.canSend) LiSendMouseButtonEvent(down ? BUTTON_ACTION_PRESS : BUTTON_ACTION_RELEASE, button);
}
- (void)sendScroll:(short)amount {
  if (self.canSend) LiSendHighResScrollEvent(amount);
}
- (void)sendKey:(short)keyCode down:(BOOL)down modifiers:(char)modifiers {
  if (self.canSend) LiSendKeyboardEvent(keyCode, down ? KEY_ACTION_DOWN : KEY_ACTION_UP, modifiers);
}
- (void)sendText:(NSString *)text {
  if (!self.canSend) return;
  // One event per character: the protocol caps the length of a text event.
  [text enumerateSubstringsInRange:NSMakeRange(0, text.length)
                           options:NSStringEnumerationByComposedCharacterSequences
                        usingBlock:^(NSString *character, NSRange range, NSRange enclosing, BOOL *stop) {
                          const char *utf8 = character.UTF8String;
                          if (utf8) LiSendUtf8TextEvent(utf8, (unsigned int)strlen(utf8));
                        }];
}

@end

#if TARGET_OS_OSX
static CVReturn PaceFrame(CVDisplayLinkRef link, const CVTimeStamp *now, const CVTimeStamp *output, CVOptionFlags flags,
                          CVOptionFlags *flagsOut, void *context) {
  @autoreleasepool {
    [(__bridge MLStreamSession *)context presentPacedFrame];
  }
  return kCVReturnSuccess;
}
#else
@implementation MLDisplayLinkProxy
- (void)tick:(CADisplayLink *)link {
  MLStreamSession *session = self.session;
  if (session) [session presentPacedFrame];
  else [link invalidate];
}
@end
#endif
