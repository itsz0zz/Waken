#import "WakenMacStreamView.h"
#import "MLStreamSession.h"
#import <Carbon/Carbon.h>
#import <GameController/GameController.h>
#import <IOKit/pwr_mgt/IOPMLib.h>

// Device-dependent modifier bits of NSEvent.modifierFlags (IOKit's NX_DEVICE*KEYMASK): left and right apart.
static const NSUInteger kLeftControl = 0x0001, kLeftShift = 0x0002, kRightShift = 0x0004, kLeftOption = 0x0020,
                        kRightOption = 0x0040, kRightControl = 0x2000;

/// Mac key code (kVK_*, a key position) to the Windows virtual key at the same place on a US keyboard:
/// Sunshine turns it back into a position, so the PC's own layout (AZERTY) applies. 0: not sent.
static uint16_t WindowsKey(unsigned short code) {
  static uint16_t table[128];
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    const uint16_t pairs[][2] = {
      {kVK_ANSI_A, 0x41}, {kVK_ANSI_B, 0x42}, {kVK_ANSI_C, 0x43}, {kVK_ANSI_D, 0x44}, {kVK_ANSI_E, 0x45},
      {kVK_ANSI_F, 0x46}, {kVK_ANSI_G, 0x47}, {kVK_ANSI_H, 0x48}, {kVK_ANSI_I, 0x49}, {kVK_ANSI_J, 0x4A},
      {kVK_ANSI_K, 0x4B}, {kVK_ANSI_L, 0x4C}, {kVK_ANSI_M, 0x4D}, {kVK_ANSI_N, 0x4E}, {kVK_ANSI_O, 0x4F},
      {kVK_ANSI_P, 0x50}, {kVK_ANSI_Q, 0x51}, {kVK_ANSI_R, 0x52}, {kVK_ANSI_S, 0x53}, {kVK_ANSI_T, 0x54},
      {kVK_ANSI_U, 0x55}, {kVK_ANSI_V, 0x56}, {kVK_ANSI_W, 0x57}, {kVK_ANSI_X, 0x58}, {kVK_ANSI_Y, 0x59},
      {kVK_ANSI_Z, 0x5A},
      {kVK_ANSI_0, 0x30}, {kVK_ANSI_1, 0x31}, {kVK_ANSI_2, 0x32}, {kVK_ANSI_3, 0x33}, {kVK_ANSI_4, 0x34},
      {kVK_ANSI_5, 0x35}, {kVK_ANSI_6, 0x36}, {kVK_ANSI_7, 0x37}, {kVK_ANSI_8, 0x38}, {kVK_ANSI_9, 0x39},
      {kVK_ANSI_Minus, 0xBD}, {kVK_ANSI_Equal, 0xBB}, {kVK_ANSI_LeftBracket, 0xDB}, {kVK_ANSI_RightBracket, 0xDD},
      {kVK_ANSI_Backslash, 0xDC}, {kVK_ANSI_Semicolon, 0xBA}, {kVK_ANSI_Quote, 0xDE}, {kVK_ANSI_Comma, 0xBC},
      {kVK_ANSI_Period, 0xBE}, {kVK_ANSI_Slash, 0xBF}, {kVK_ANSI_Grave, 0xC0}, {kVK_ISO_Section, 0xC0},
      {kVK_Return, 0x0D}, {kVK_Tab, 0x09}, {kVK_Space, 0x20}, {kVK_Delete, 0x08}, {kVK_Escape, 0x1B},
      {kVK_ForwardDelete, 0x2E}, {kVK_Help, 0x2D}, {kVK_Home, 0x24}, {kVK_End, 0x23}, {kVK_PageUp, 0x21},
      {kVK_PageDown, 0x22}, {kVK_LeftArrow, 0x25}, {kVK_RightArrow, 0x27}, {kVK_UpArrow, 0x26}, {kVK_DownArrow, 0x28},
      {kVK_CapsLock, 0x14}, {kVK_Shift, 0xA0}, {kVK_RightShift, 0xA1}, {kVK_Control, 0xA2}, {kVK_RightControl, 0xA3},
      {kVK_Option, 0xA4}, {kVK_RightOption, 0xA5},
      {kVK_F1, 0x70}, {kVK_F2, 0x71}, {kVK_F3, 0x72}, {kVK_F4, 0x73}, {kVK_F5, 0x74}, {kVK_F6, 0x75},
      {kVK_F7, 0x76}, {kVK_F8, 0x77}, {kVK_F9, 0x78}, {kVK_F10, 0x79}, {kVK_F11, 0x7A}, {kVK_F12, 0x7B},
      {kVK_F13, 0x7C}, {kVK_F14, 0x7D}, {kVK_F15, 0x7E}, {kVK_F16, 0x7F}, {kVK_F17, 0x80}, {kVK_F18, 0x81},
      {kVK_F19, 0x82}, {kVK_F20, 0x83},
      {kVK_ANSI_Keypad0, 0x60}, {kVK_ANSI_Keypad1, 0x61}, {kVK_ANSI_Keypad2, 0x62}, {kVK_ANSI_Keypad3, 0x63},
      {kVK_ANSI_Keypad4, 0x64}, {kVK_ANSI_Keypad5, 0x65}, {kVK_ANSI_Keypad6, 0x66}, {kVK_ANSI_Keypad7, 0x67},
      {kVK_ANSI_Keypad8, 0x68}, {kVK_ANSI_Keypad9, 0x69}, {kVK_ANSI_KeypadDecimal, 0x6E},
      {kVK_ANSI_KeypadMultiply, 0x6A}, {kVK_ANSI_KeypadPlus, 0x6B}, {kVK_ANSI_KeypadMinus, 0x6D},
      {kVK_ANSI_KeypadDivide, 0x6F}, {kVK_ANSI_KeypadEnter, 0x0D}, {kVK_ANSI_KeypadClear, 0x90},
      {kVK_ANSI_KeypadEquals, 0xBB},
    };
    for (size_t i = 0; i < sizeof(pairs) / sizeof(pairs[0]); i++) table[pairs[i][0]] = pairs[i][1];
  });
  if (code >= 128) return 0;
  // ISO keyboards swap two keys: the one left of 1 reports kVK_ISO_Section, the one right of left Shift
  // (< > on AZERTY) reports kVK_ANSI_Grave. That one is Windows' extra ISO key.
  if (code == kVK_ANSI_Grave && KBGetLayoutType(LMGetKbdType()) == kKeyboardISO) return 0xE2;
  return table[code];
}

/// moonlight-common-c wants the high bit set on virtual keys.
static short KeyCode(uint16_t vk) { return (short)(vk | 0x8000); }

static short Clamp(CGFloat value) {
  if (!isfinite(value)) return 0;
  return (short)MAX(SHRT_MIN, MIN(SHRT_MAX, value));
}

@interface WakenMacStreamView () <MLStreamSessionDelegate>
@end

@implementation WakenMacStreamView {
  MLStreamSession *_session;
  MLStreamConfig *_config;
  BOOL _started;
  BOOL _startScheduled;
  NSTimer *_statsTimer;
  NSMutableSet<NSNumber *> *_pressedKeys;
  NSTrackingArea *_tracking;
  BOOL _cursorHidden;
  IOPMAssertionID _awake;
  NSMutableArray<id<NSObject>> *_observers;
  CGFloat _scrollRest;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    self.layer.backgroundColor = CGColorGetConstantColor(kCGColorBlack);
    _config = [MLStreamConfig new];
    _pressedKeys = [NSMutableSet set];
    _observers = [NSMutableArray array];
    [self watchControllers];
  }
  return self;
}

- (void)dealloc {
  for (id<NSObject> observer in _observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
  [self stopStream];
}

- (BOOL)isFlipped {
  return YES;
}

// MARK: Props

- (void)setLaunch:(NSDictionary *)launch {
  _launch = [launch copy];
  [self scheduleStart];
}
- (void)setVideoWidth:(NSInteger)v {
  _videoWidth = v;
  _config.width = (int)v;
  [self scheduleStart];
}
- (void)setVideoHeight:(NSInteger)v {
  _videoHeight = v;
  _config.height = (int)v;
  [self scheduleStart];
}
- (void)setFps:(NSInteger)v {
  _fps = v;
  _config.fps = (int)v;
}
- (void)setBitrateKbps:(NSInteger)v {
  _bitrateKbps = v;
  _config.bitrateKbps = (int)v;
}
- (void)setHevc:(BOOL)v {
  _hevc = v;
  _config.hevc = v;
}
- (void)setRemote:(BOOL)v {
  _remote = v;
  _config.remote = v;
}

/// Once every prop of this update is set: React sets them one by one.
- (void)scheduleStart {
  if (_startScheduled || _started) return;
  _startScheduled = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_startScheduled = NO;
    [self startIfReady];
  });
}

// MARK: Lifecycle

- (void)startIfReady {
  NSString *address = _launch[@"address"];
  NSString *rtsp = _launch[@"rtspSessionUrl"];
  if (_started || self.window == nil || _config.width <= 0 || ![address isKindOfClass:NSString.class] || ![rtsp isKindOfClass:NSString.class]) return;
  _started = YES;

  MLLaunchInfo *info = [MLLaunchInfo new];
  info.address = address;
  info.appVersion = [_launch[@"appVersion"] isKindOfClass:NSString.class] ? _launch[@"appVersion"] : @"7.1.431.-1";
  info.gfeVersion = [_launch[@"gfeVersion"] isKindOfClass:NSString.class] ? _launch[@"gfeVersion"] : nil;
  info.rtspSessionUrl = rtsp;
  info.serverCodecModeSupport = [_launch[@"serverCodecModeSupport"] intValue];
  info.riKey = [self dataFromHex:_launch[@"riKey"]];
  info.riKeyId = [_launch[@"riKeyId"] intValue];
  if (_config.fps <= 0) _config.fps = 60;
  if (_config.bitrateKbps <= 0) _config.bitrateKbps = 20000;

  _session = [[MLStreamSession alloc] initWithLaunch:info config:_config];
  _session.delegate = self;
  _session.displayLayer.frame = self.bounds;
  [self.layer addSublayer:_session.displayLayer];

  [self emitState:@{@"state" : @"connecting"}];
  [_session start];
  [self keepAwake:YES];
  [self.window makeFirstResponder:self];

  __weak WakenMacStreamView *weakSelf = self;
  _statsTimer = [NSTimer scheduledTimerWithTimeInterval:1 repeats:YES block:^(NSTimer *timer) {
    WakenMacStreamView *view = weakSelf;
    MLStreamSession *s = view ? view->_session : nil;
    if (!s || !view.onStats) return;
    view.onStats(@{
      @"rttMs" : @(s.estimatedRttMs),
      @"fps" : @(s.measuredFps),
      @"bitrateKbps" : @(s.measuredBitrateKbps),
      @"droppedFrames" : @(s.droppedFrames),
    });
  }];
}

- (void)stopStream {
  [_statsTimer invalidate];
  _statsTimer = nil;
  [self releaseKeys];
  [self showCursor];
  [self keepAwake:NO];
  [_session stop];
  [_session.displayLayer removeFromSuperlayer];
  _session = nil;
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (self.window) {
    [self startIfReady];
    [self.window makeFirstResponder:self];
  } else {
    [self stopStream];
  }
}

- (void)layout {
  [super layout];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _session.displayLayer.frame = self.bounds;
  [CATransaction commit];
}

- (NSData *)dataFromHex:(id)hex {
  NSMutableData *data = [NSMutableData data];
  if (![hex isKindOfClass:NSString.class]) return data;
  NSString *text = hex;
  for (NSUInteger i = 0; i + 1 < text.length; i += 2) {
    unsigned int byte = 0;
    if ([[NSScanner scannerWithString:[text substringWithRange:NSMakeRange(i, 2)]] scanHexInt:&byte]) {
      uint8_t b = (uint8_t)byte;
      [data appendBytes:&b length:1];
    }
  }
  return data;
}

/// The Mac's display stays on while playing: there is no keyboard activity during a controller game.
- (void)keepAwake:(BOOL)on {
  if (on && !_awake) {
    IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep, kIOPMAssertionLevelOn, CFSTR("Waken : partie en cours"), &_awake);
  } else if (!on && _awake) {
    IOPMAssertionRelease(_awake);
    _awake = 0;
  }
}

- (void)emitState:(NSDictionary *)state {
  RCTDirectEventBlock block = self.onStateChange;
  if (!block) return;
  dispatch_async(dispatch_get_main_queue(), ^{ block(state); });
}

// MARK: MLStreamSessionDelegate

- (void)streamStageChanged:(NSString *)stage {
  [self emitState:@{@"state" : @"connecting", @"stage" : stage}];
}
- (void)streamStarted {
  [self emitState:@{@"state" : @"streaming"}];
}
- (void)streamTerminated:(int)errorCode {
  [self emitState:@{@"state" : errorCode == 0 ? @"stopped" : @"error", @"message" : [NSString stringWithFormat:@"Connexion terminée (%d)", errorCode]}];
}
- (void)streamFailedAtStage:(NSString *)stage error:(int)errorCode {
  [self emitState:@{@"state" : @"error", @"stage" : stage, @"message" : [NSString stringWithFormat:@"Échec à l'étape %@ (%d)", stage, errorCode]}];
}

// MARK: Mouse

- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (_tracking) [self removeTrackingArea:_tracking];
  _tracking = [[NSTrackingArea alloc] initWithRect:self.bounds
                                           options:NSTrackingMouseMoved | NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect
                                             owner:self
                                          userInfo:nil];
  [self addTrackingArea:_tracking];
}

/// The computer draws its own cursor in the picture: the Mac's one hides over it.
- (void)mouseEntered:(NSEvent *)event {
  if (_session && !_cursorHidden) {
    [NSCursor hide];
    _cursorHidden = YES;
  }
}
- (void)mouseExited:(NSEvent *)event {
  [self showCursor];
}
- (void)showCursor {
  if (_cursorHidden) {
    [NSCursor unhide];
    _cursorHidden = NO;
  }
}

/// Where the pointer is, in the picture shown aspect-fit in the view. The black bars clamp to the edges.
- (void)movePointer:(NSEvent *)event {
  if (!_session || _config.width <= 0 || _config.height <= 0) return;
  NSPoint p = [self convertPoint:event.locationInWindow fromView:nil];
  CGSize video = CGSizeMake(_config.width, _config.height);
  NSRect box = self.bounds;
  if (box.size.width <= 0 || box.size.height <= 0) return;
  CGFloat scale = MIN(box.size.width / video.width, box.size.height / video.height);
  CGFloat left = NSMidX(box) - video.width * scale / 2;
  CGFloat top = NSMidY(box) - video.height * scale / 2;
  CGFloat x = MIN(MAX((p.x - left) / scale, 0), video.width - 1);
  CGFloat y = MIN(MAX((p.y - top) / scale, 0), video.height - 1);
  [_session sendMouseX:Clamp(x) y:Clamp(y) referenceWidth:Clamp(video.width) referenceHeight:Clamp(video.height)];
}

- (void)mouseMoved:(NSEvent *)event {
  [self movePointer:event];
}
- (void)mouseDragged:(NSEvent *)event {
  [self movePointer:event];
}
- (void)rightMouseDragged:(NSEvent *)event {
  [self movePointer:event];
}
- (void)otherMouseDragged:(NSEvent *)event {
  [self movePointer:event];
}

// Buttons as moonlight-common-c numbers them: 1 left, 2 middle, 3 right, 4 and 5 the side ones.
- (void)mouseDown:(NSEvent *)event {
  [self.window makeFirstResponder:self];
  [self movePointer:event];
  [_session sendMouseButton:1 down:YES];
}
- (void)mouseUp:(NSEvent *)event {
  [_session sendMouseButton:1 down:NO];
}
- (void)rightMouseDown:(NSEvent *)event {
  [_session sendMouseButton:3 down:YES];
}
- (void)rightMouseUp:(NSEvent *)event {
  [_session sendMouseButton:3 down:NO];
}
- (int)otherButton:(NSEvent *)event {
  return event.buttonNumber == 2 ? 2 : event.buttonNumber == 3 ? 4 : 5;
}
- (void)otherMouseDown:(NSEvent *)event {
  [_session sendMouseButton:[self otherButton:event] down:YES];
}
- (void)otherMouseUp:(NSEvent *)event {
  [_session sendMouseButton:[self otherButton:event] down:NO];
}

/// 120 is one notch of a wheel. A trackpad scrolls in points: about ten of them make a notch.
- (void)scrollWheel:(NSEvent *)event {
  CGFloat amount = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY * 12 : event.scrollingDeltaY * 120;
  _scrollRest += amount;
  CGFloat whole = trunc(_scrollRest);
  _scrollRest -= whole;
  if (whole != 0) [_session sendScroll:Clamp(whole)];
}

// MARK: Keyboard

- (BOOL)acceptsFirstResponder {
  return YES;
}

- (char)modifiers:(NSEventModifierFlags)flags {
  char m = 0;
  if (flags & NSEventModifierFlagShift) m |= 0x01;
  if (flags & NSEventModifierFlagControl) m |= 0x02;
  if (flags & NSEventModifierFlagOption) m |= 0x04;
  return m;
}

/// Command stays the Mac's (Cmd+Q, Cmd+Tab): with it, the keys go to the app, not to the game.
- (void)keyDown:(NSEvent *)event {
  if (event.modifierFlags & NSEventModifierFlagCommand) return [super keyDown:event];
  uint16_t vk = WindowsKey(event.keyCode);
  if (!vk) return;
  [_pressedKeys addObject:@(vk)];
  [_session sendKey:KeyCode(vk) down:YES modifiers:[self modifiers:event.modifierFlags]];
}

- (void)keyUp:(NSEvent *)event {
  uint16_t vk = WindowsKey(event.keyCode);
  if (!vk || ![_pressedKeys containsObject:@(vk)]) return;
  [_pressedKeys removeObject:@(vk)];
  [_session sendKey:KeyCode(vk) down:NO modifiers:[self modifiers:event.modifierFlags]];
}

/// Shift, Control, Option and Caps Lock come as flag changes: the key's own bit says pressed or released.
- (void)flagsChanged:(NSEvent *)event {
  uint16_t vk = WindowsKey(event.keyCode);
  if (!vk) return;
  NSUInteger flags = event.modifierFlags;
  if (event.keyCode == kVK_CapsLock) {
    // Caps Lock reports its lock state, not the key: each change is one press.
    [_session sendKey:KeyCode(vk) down:YES modifiers:0];
    [_session sendKey:KeyCode(vk) down:NO modifiers:0];
    return;
  }
  NSUInteger bit = 0;
  switch (event.keyCode) {
    case kVK_Shift: bit = kLeftShift; break;
    case kVK_RightShift: bit = kRightShift; break;
    case kVK_Control: bit = kLeftControl; break;
    case kVK_RightControl: bit = kRightControl; break;
    case kVK_Option: bit = kLeftOption; break;
    case kVK_RightOption: bit = kRightOption; break;
    default: return;
  }
  BOOL down = (flags & bit) != 0;
  if (down) [_pressedKeys addObject:@(vk)];
  else [_pressedKeys removeObject:@(vk)];
  [_session sendKey:KeyCode(vk) down:down modifiers:[self modifiers:flags]];
}

- (BOOL)resignFirstResponder {
  [self releaseKeys];
  return [super resignFirstResponder];
}

/// Nothing stays pressed on the computer when Waken loses the keyboard (Cmd+Tab, the end of the stream).
- (void)releaseKeys {
  for (NSNumber *vk in _pressedKeys) [_session sendKey:KeyCode(vk.unsignedShortValue) down:NO modifiers:0];
  [_pressedKeys removeAllObjects];
}

// MARK: Controllers

- (void)watchControllers {
  __weak WakenMacStreamView *weakSelf = self;
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [_observers addObject:[center addObserverForName:GCControllerDidConnectNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    [weakSelf bindController:note.object];
  }]];
  [_observers addObject:[center addObserverForName:NSApplicationDidResignActiveNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    [weakSelf releaseKeys];
  }]];
  for (GCController *controller in GCController.controllers) [self bindController:controller];
}

/// Gamepad to LiSendMultiControllerEvent. Button bits follow moonlight-common-c (Limelight.h).
- (void)bindController:(GCController *)controller {
  GCExtendedGamepad *pad = controller.extendedGamepad;
  if (!pad) return;
  short index = (short)MAX(0, (NSInteger)[GCController.controllers indexOfObject:controller]);
  __weak WakenMacStreamView *weakSelf = self;
  pad.valueChangedHandler = ^(GCExtendedGamepad *gp, GCControllerElement *element) {
    int b = 0;
    if (gp.buttonA.isPressed) b |= 0x1000;
    if (gp.buttonB.isPressed) b |= 0x2000;
    if (gp.buttonX.isPressed) b |= 0x4000;
    if (gp.buttonY.isPressed) b |= 0x8000;
    if (gp.dpad.up.isPressed) b |= 0x0001;
    if (gp.dpad.down.isPressed) b |= 0x0002;
    if (gp.dpad.left.isPressed) b |= 0x0004;
    if (gp.dpad.right.isPressed) b |= 0x0008;
    if (gp.buttonMenu.isPressed) b |= 0x0010;
    if (gp.buttonOptions.isPressed) b |= 0x0020;
    if (gp.leftThumbstickButton.isPressed) b |= 0x0040;
    if (gp.rightThumbstickButton.isPressed) b |= 0x0080;
    if (gp.leftShoulder.isPressed) b |= 0x0100;
    if (gp.rightShoulder.isPressed) b |= 0x0200;
    if (gp.buttonHome.isPressed) b |= 0x0400;
    short (^axis)(float) = ^short(float v) { return (short)MAX(-32768, MIN(32767, v * 32767)); };
    WakenMacStreamView *view = weakSelf;
    if (!view) return;
    [view->_session sendController:index
                           buttons:b
                                lt:(unsigned char)(gp.leftTrigger.value * 255)
                                rt:(unsigned char)(gp.rightTrigger.value * 255)
                                lx:axis(gp.leftThumbstick.xAxis.value)
                                ly:axis(gp.leftThumbstick.yAxis.value)
                                rx:axis(gp.rightThumbstick.xAxis.value)
                                ry:axis(gp.rightThumbstick.yAxis.value)
                        activeMask:(short)(1 << index)];
  };
}

@end
