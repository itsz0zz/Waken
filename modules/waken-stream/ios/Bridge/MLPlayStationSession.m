// SPDX-License-Identifier: LicenseRef-AGPL-3.0-only-OpenSSL
// A PS5 or PS4 stream through chiaki (modules/waken-stream/ios/vendor/chiaki-ng): the picture into the same kind of
// display layer as the Sunshine stream, Opus through the same player, this device's controllers as a DualSense.
#import "MLPlayStationSession.h"

#import <CoreMedia/CoreMedia.h>
#import <GameController/GameController.h>
#import <QuartzCore/QuartzCore.h>
#include <stdatomic.h>

#include <chiaki/base64.h>
#include <chiaki/common.h>
#include <chiaki/controller.h>
#include <chiaki/log.h>
#include <chiaki/session.h>

#import "MLGamepads.h"
#import "WakenAnnexB.h"
#import "WakenAudioPlayer.h"

/// The controllers are read this often and sent when they change.
static const NSTimeInterval kInputEvery = 1.0 / 250;

static void LogLine(ChiakiLogLevel level, const char *msg, void *user) {
  if (level & (CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING | CHIAKI_LOG_INFO)) NSLog(@"[chiaki] %s", msg);
}

static BOOL Ready(void) {
  static BOOL ready = NO;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ ready = chiaki_lib_init() == CHIAKI_ERR_SUCCESS; });
  return ready;
}

static NSData *BytesFromHex(NSString *hex) {
  NSMutableData *data = [NSMutableData dataWithCapacity:hex.length / 2];
  for (NSUInteger i = 0; i + 1 < hex.length; i += 2) {
    unsigned int byte = 0;
    [[NSScanner scannerWithString:[hex substringWithRange:NSMakeRange(i, 2)]] scanHexInt:&byte];
    uint8_t b = (uint8_t)byte;
    [data appendBytes:&b length:1];
  }
  return data;
}

@interface MLPlayStationSession ()
- (bool)video:(uint8_t *)buf size:(size_t)size;
- (void)audioHeader:(ChiakiAudioHeader *)header;
- (void)audio:(uint8_t *)buf size:(size_t)size;
- (void)event:(ChiakiEvent *)event;
@end

static bool VideoSample(uint8_t *buf, size_t buf_size, int32_t frames_lost, bool frame_recovered, void *user) {
  @autoreleasepool {
    return [(__bridge MLPlayStationSession *)user video:buf size:buf_size];
  }
}
static void AudioHeader(ChiakiAudioHeader *header, void *user) { [(__bridge MLPlayStationSession *)user audioHeader:header]; }
static void AudioFrame(uint8_t *buf, size_t buf_size, void *user) {
  @autoreleasepool {
    [(__bridge MLPlayStationSession *)user audio:buf size:buf_size];
  }
}
static void Event(ChiakiEvent *event, void *user) {
  @autoreleasepool {
    [(__bridge MLPlayStationSession *)user event:event];
  }
}

@implementation MLPlayStationSession {
  NSString *_host;
  NSData *_registKey, *_rpKey, *_account;
  BOOL _ps5;
  ChiakiConnectVideoProfile _profile;
  ChiakiLog _log;
  ChiakiSession _session;
  BOOL _initialized;
  atomic_bool _stopped;
  BOOL _hevc;
  // Parameter sets of the current stream, and its format.
  NSData *_vps, *_sps, *_pps;
  CMVideoFormatDescriptionRef _format;
  WakenAudioPlayer *_audio;
  // Input.
  NSTimer *_inputTimer;
  ChiakiControllerState _sent;
  // Stats, one second at a time.
  uint64_t _frames, _bytes, _dropped;
  CFAbsoluteTime _windowStart;
  double _fps, _kbps;
}

- (instancetype)initWithHost:(NSString *)host
                   registKey:(NSString *)registKey
                       rpKey:(NSString *)rpKey
                         ps5:(BOOL)ps5
                   accountId:(NSString *)accountId
                      height:(int)height
                         fps:(int)fps
                 bitrateKbps:(int)bitrateKbps
                        hevc:(BOOL)hevc {
  if ((self = [super init])) {
    _host = [host copy];
    _registKey = [registKey dataUsingEncoding:NSASCIIStringEncoding];
    _rpKey = BytesFromHex(rpKey);
    _account = accountId ? [[NSData alloc] initWithBase64EncodedString:accountId options:0] : nil;
    _ps5 = ps5;
    _hevc = hevc && ps5; // a PS4 sends H.264 only
    // The console's own sizes: 1080p (PS5 and PS4 Pro), 720p, 540p; 60 or 30 frames per second.
    ChiakiVideoResolutionPreset resolution = height >= 1080 ? CHIAKI_VIDEO_RESOLUTION_PRESET_1080p
        : height >= 720                                     ? CHIAKI_VIDEO_RESOLUTION_PRESET_720p
                                                            : CHIAKI_VIDEO_RESOLUTION_PRESET_540p;
    chiaki_connect_video_profile_preset(&_profile, resolution, fps >= 60 ? CHIAKI_VIDEO_FPS_PRESET_60 : CHIAKI_VIDEO_FPS_PRESET_30);
    if (bitrateKbps > 0) _profile.bitrate = (unsigned int)bitrateKbps;
    _profile.codec = _hevc ? CHIAKI_CODEC_H265 : CHIAKI_CODEC_H264;
    _displayLayer = [AVSampleBufferDisplayLayer new];
    _displayLayer.videoGravity = AVLayerVideoGravityResizeAspect;
    _displayLayer.backgroundColor = CGColorGetConstantColor(kCGColorBlack);
    chiaki_log_init(&_log, CHIAKI_LOG_ALL & ~CHIAKI_LOG_VERBOSE, LogLine, NULL);
    chiaki_controller_state_set_idle(&_sent);
    _windowStart = CFAbsoluteTimeGetCurrent();
  }
  return self;
}

- (void)dealloc {
  if (_format) CFRelease(_format);
}

#pragma mark - Lifecycle

- (void)start {
  if (!Ready()) return [self report:@"error" message:@"Le protocole PlayStation n'a pas démarré."];
  if (_registKey.length == 0 || _registKey.length > CHIAKI_SESSION_AUTH_SIZE || _rpKey.length != 0x10)
    return [self report:@"error" message:@"Liaison incomplète : relie la console à nouveau."];

  ChiakiConnectInfo info = {0};
  info.ps5 = _ps5;
  info.host = _host.UTF8String;
  memcpy(info.regist_key, _registKey.bytes, _registKey.length); // the rest stays zero, as chiaki wants
  memcpy(info.morning, _rpKey.bytes, sizeof(info.morning));
  info.video_profile = _profile;
  info.video_profile_auto_downgrade = true;
  info.enable_keyboard = false;
  info.enable_dualsense = true;
  info.packet_loss_max = 0.05;
  info.enable_idr_on_fec_failure = true;
  if (_account.length == CHIAKI_PSN_ACCOUNT_ID_SIZE) memcpy(info.psn_account_id, _account.bytes, CHIAKI_PSN_ACCOUNT_ID_SIZE);

  if (chiaki_session_init(&_session, &info, &_log) != CHIAKI_ERR_SUCCESS) return [self report:@"error" message:@"Session PlayStation impossible."];
  _initialized = YES;
  void *user = (__bridge void *)self;
  chiaki_session_set_event_cb(&_session, Event, user);
  chiaki_session_set_video_sample_cb(&_session, VideoSample, user);
  ChiakiAudioSink sink = {.user = user, .header_cb = AudioHeader, .frame_cb = AudioFrame};
  chiaki_session_set_audio_sink(&_session, &sink);
  [self report:@"connecting" message:nil];
  if (chiaki_session_start(&_session) != CHIAKI_ERR_SUCCESS) {
    chiaki_session_fini(&_session);
    _initialized = NO;
    return [self report:@"error" message:@"Connexion à la console impossible."];
  }
  __weak MLPlayStationSession *weak = self;
  _inputTimer = [NSTimer scheduledTimerWithTimeInterval:kInputEvery repeats:YES block:^(NSTimer *timer) { [weak sendInput]; }];
}

- (void)stop {
  if (atomic_exchange(&_stopped, true)) return;
  [_inputTimer invalidate];
  _inputTimer = nil;
  [MLGamepads rumbleAllLow:0 high:0];
  [_audio stop];
  if (!_initialized) return;
  _initialized = NO;
  // chiaki joins its threads: never on the main thread, nor on one of its own.
  MLPlayStationSession *session = self;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    chiaki_session_stop(&session->_session);
    chiaki_session_join(&session->_session);
    chiaki_session_fini(&session->_session);
  });
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_displayLayer flushAndRemoveImage]; });
}

- (void)enterPin:(NSString *)pin {
  if (!_initialized) return;
  NSData *digits = [pin dataUsingEncoding:NSASCIIStringEncoding];
  chiaki_session_set_login_pin(&_session, digits.bytes, digits.length);
}

- (void)report:(NSString *)state message:(nullable NSString *)message {
  dispatch_async(dispatch_get_main_queue(), ^{ [self.delegate playStationStateChanged:state message:message]; });
}

#pragma mark - Events

- (void)event:(ChiakiEvent *)event {
  switch (event->type) {
    case CHIAKI_EVENT_CONNECTED:
      [self report:@"streaming" message:nil];
      break;
    case CHIAKI_EVENT_LOGIN_PIN_REQUEST:
      [self report:@"pin" message:event->login_pin_request.pin_incorrect ? @"Code incorrect, essaie encore." : nil];
      break;
    case CHIAKI_EVENT_RUMBLE: {
      float low = event->rumble.left / 255.0f, high = event->rumble.right / 255.0f;
      dispatch_async(dispatch_get_main_queue(), ^{ [MLGamepads rumbleAllLow:low high:high]; });
      break;
    }
    case CHIAKI_EVENT_QUIT: {
      ChiakiQuitReason reason = event->quit.reason;
      BOOL clean = reason == CHIAKI_QUIT_REASON_STOPPED || chiaki_quit_reason_is_error(reason) == false;
      NSString *why = [NSString stringWithUTF8String:chiaki_quit_reason_string(reason)] ?: @"";
      if (event->quit.reason_str) why = [why stringByAppendingFormat:@" (%s)", event->quit.reason_str];
      [self report:clean ? @"stopped" : @"error" message:clean ? nil : [NSString stringWithFormat:@"La console a coupé : %@", why]];
      break;
    }
    default:
      break;
  }
}

#pragma mark - Video

/// One access unit, Annex B: its parameter sets kept (the format), the rest decoded by the display layer.
- (bool)video:(uint8_t *)buf size:(size_t)size {
  NSMutableData *picture = [NSMutableData dataWithCapacity:size];
  BOOL keyframe = NO;
  BOOL newSets = NO;
  size_t i = 0;
  while (i + 3 < size) {
    // The next start code (3 or 4 bytes), then the NAL up to the following one.
    size_t start = i;
    while (start + 3 < size && !(buf[start] == 0 && buf[start + 1] == 0 && (buf[start + 2] == 1 || (buf[start + 2] == 0 && buf[start + 3] == 1)))) start++;
    if (start + 3 >= size) break;
    size_t nal = start + (buf[start + 2] == 1 ? 3 : 4);
    size_t end = nal;
    while (end + 2 < size && !(buf[end] == 0 && buf[end + 1] == 0 && (buf[end + 2] == 1 || (end + 3 < size && buf[end + 2] == 0 && buf[end + 3] == 1)))) end++;
    if (end + 2 >= size) end = size;
    i = end;
    if (nal >= end) continue;
    NSData *unit = [NSData dataWithBytes:buf + nal length:end - nal];
    if (_hevc) {
      int type = (buf[nal] >> 1) & 0x3F;
      if (type == 32) { newSets |= ![unit isEqualToData:_vps]; _vps = unit; continue; }
      if (type == 33) { newSets |= ![unit isEqualToData:_sps]; _sps = unit; continue; }
      if (type == 34) { newSets |= ![unit isEqualToData:_pps]; _pps = unit; continue; }
      if (type >= 16 && type <= 21) keyframe = YES;
    } else {
      int type = buf[nal] & 0x1F;
      if (type == 7) { newSets |= ![unit isEqualToData:_sps]; _sps = unit; continue; }
      if (type == 8) { newSets |= ![unit isEqualToData:_pps]; _pps = unit; continue; }
      if (type == 5) keyframe = YES;
    }
    static const uint8_t startCode[] = {0, 0, 0, 1};
    [picture appendBytes:startCode length:4];
    [picture appendData:unit];
  }
  if (newSets && _format) {
    CFRelease(_format);
    _format = NULL;
  }
  if (!_format && ![self makeFormat]) return false;
  if (picture.length == 0) return true;

  size_t capacity = WakenAVCCCapacity(picture.length);
  uint8_t *bytes = malloc(capacity);
  if (!bytes) return false;
  size_t length = WakenAnnexBToAVCC(picture.bytes, picture.length, bytes, capacity);
  CMBlockBufferRef block = NULL;
  if (length == 0 || CMBlockBufferCreateWithMemoryBlock(NULL, bytes, capacity, kCFAllocatorMalloc, NULL, 0, length, 0, &block) != noErr) {
    free(bytes);
    return false;
  }
  CMSampleBufferRef sample = NULL;
  OSStatus status = CMSampleBufferCreateReady(NULL, block, _format, 1, 0, NULL, 1, &length, &sample);
  CFRelease(block);
  if (status != noErr) return false;
  CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sample, YES);
  CFMutableDictionaryRef attachment = (CFMutableDictionaryRef)CFArrayGetValueAtIndex(attachments, 0);
  CFDictionarySetValue(attachment, kCMSampleAttachmentKey_DisplayImmediately, kCFBooleanTrue);
  if (!keyframe) CFDictionarySetValue(attachment, kCMSampleAttachmentKey_NotSync, kCFBooleanTrue);

  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_displayLayer.status == AVQueuedSampleBufferRenderingStatusFailed) {
      [self->_displayLayer flush];
      self->_dropped++;
      if (self->_initialized) chiaki_session_request_idr(&self->_session);
    }
    [self->_displayLayer enqueueSampleBuffer:sample];
    CFRelease(sample);
  });

  _frames++;
  _bytes += size;
  CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
  if (now - _windowStart >= 1.0) {
    _fps = _frames / (now - _windowStart);
    _kbps = _bytes * 8.0 / 1000.0 / (now - _windowStart);
    _frames = 0;
    _bytes = 0;
    _windowStart = now;
  }
  return true;
}

- (BOOL)makeFormat {
  OSStatus status;
  if (_hevc) {
    if (!_vps || !_sps || !_pps) return NO;
    const uint8_t *sets[] = {_vps.bytes, _sps.bytes, _pps.bytes};
    const size_t sizes[] = {_vps.length, _sps.length, _pps.length};
    status = CMVideoFormatDescriptionCreateFromHEVCParameterSets(NULL, 3, sets, sizes, 4, NULL, &_format);
  } else {
    if (!_sps || !_pps) return NO;
    const uint8_t *sets[] = {_sps.bytes, _pps.bytes};
    const size_t sizes[] = {_sps.length, _pps.length};
    status = CMVideoFormatDescriptionCreateFromH264ParameterSets(NULL, 2, sets, sizes, 4, &_format);
  }
  return status == noErr;
}

#pragma mark - Audio

- (void)audioHeader:(ChiakiAudioHeader *)header {
  [_audio stop];
  _audio = [[WakenAudioPlayer alloc] initWithSampleRate:header->rate channels:header->channels samplesPerFrame:(int)header->frame_size];
  [_audio start];
}

- (void)audio:(uint8_t *)buf size:(size_t)size {
  if (!self.muted) [_audio play:buf length:(int)size];
}

#pragma mark - Input

/// Every controller of this device merged into the console's one DualSense, plus the keys; sent when it changes.
- (void)sendInput {
  if (!_initialized || atomic_load(&_stopped)) return;
  ChiakiControllerState state;
  chiaki_controller_state_set_idle(&state);
  state.buttons = self.keyboardButtons;
  for (GCController *controller in GCController.controllers) {
    GCExtendedGamepad *pad = controller.extendedGamepad;
    if (!pad) continue;
    uint32_t b = 0;
    if (pad.buttonA.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_CROSS;
    if (pad.buttonB.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_MOON;
    if (pad.buttonX.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_BOX;
    if (pad.buttonY.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_PYRAMID;
    if (pad.dpad.left.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_DPAD_LEFT;
    if (pad.dpad.right.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_DPAD_RIGHT;
    if (pad.dpad.up.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_DPAD_UP;
    if (pad.dpad.down.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_DPAD_DOWN;
    if (pad.leftShoulder.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_L1;
    if (pad.rightShoulder.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_R1;
    if (pad.leftThumbstickButton.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_L3;
    if (pad.rightThumbstickButton.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_R3;
    if (pad.buttonMenu.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_OPTIONS;
    if (pad.buttonOptions.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_SHARE;
    if (pad.buttonHome.isPressed) b |= CHIAKI_CONTROLLER_BUTTON_PS;
    if (controller.physicalInputProfile.buttons[GCInputDualShockTouchpadButton].isPressed) b |= CHIAKI_CONTROLLER_BUTTON_TOUCHPAD;
    state.buttons |= b;
    state.l2_state = MAX(state.l2_state, (uint8_t)(pad.leftTrigger.value * 255));
    state.r2_state = MAX(state.r2_state, (uint8_t)(pad.rightTrigger.value * 255));
    // The strongest stick wins; up is negative for the console.
    int16_t (^axis)(float) = ^int16_t(float v) { return (int16_t)MAX(-32768, MIN(32767, v * 32767)); };
    int16_t lx = axis(pad.leftThumbstick.xAxis.value), ly = axis(-pad.leftThumbstick.yAxis.value);
    int16_t rx = axis(pad.rightThumbstick.xAxis.value), ry = axis(-pad.rightThumbstick.yAxis.value);
    if (abs(lx) > abs(state.left_x)) state.left_x = lx;
    if (abs(ly) > abs(state.left_y)) state.left_y = ly;
    if (abs(rx) > abs(state.right_x)) state.right_x = rx;
    if (abs(ry) > abs(state.right_y)) state.right_y = ry;
  }
  if (chiaki_controller_state_equals(&state, &_sent)) return;
  _sent = state;
  chiaki_session_set_controller_state(&_session, &state);
}

#pragma mark - Stats

- (double)measuredFps { return _fps; }
- (double)measuredBitrateKbps { return _kbps; }
- (uint32_t)droppedFrames { return (uint32_t)_dropped; }
- (uint32_t)rttMs { return _initialized ? (uint32_t)(_session.rtt_us / 1000) : 0; }

@end
