#import "WakenPlayStationView.h"

#import <IOKit/pwr_mgt/IOPMLib.h>

#import "MLPlayStationSession.h"

#include <chiaki/controller.h>

@interface WakenPlayStationView () <MLPlayStationSessionDelegate>
@end

@implementation WakenPlayStationView {
  MLPlayStationSession *_session;
  NSTimer *_statsTimer;
  BOOL _started;
  IOPMAssertionID _awake;
  uint32_t _keys;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    self.layer.backgroundColor = NSColor.blackColor.CGColor;
  }
  return self;
}

- (BOOL)isFlipped {
  return YES;
}

- (void)setLink:(NSDictionary *)link {
  _link = [link copy];
  dispatch_async(dispatch_get_main_queue(), ^{ [self startIfReady]; });
}

- (void)setMuted:(BOOL)muted {
  _muted = muted;
  _session.muted = muted;
}

- (void)layout {
  [super layout];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _session.displayLayer.frame = self.bounds;
  [CATransaction commit];
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

- (void)startIfReady {
  NSString *host = _link[@"host"], *registKey = _link[@"registKey"], *rpKey = _link[@"rpKey"];
  if (_started || !self.window || ![host isKindOfClass:NSString.class] || ![registKey isKindOfClass:NSString.class] || ![rpKey isKindOfClass:NSString.class]) return;
  _started = YES;
  NSString *account = [_link[@"accountId"] isKindOfClass:NSString.class] ? _link[@"accountId"] : nil;
  _session = [[MLPlayStationSession alloc] initWithHost:host
                                              registKey:registKey
                                                  rpKey:rpKey
                                                    ps5:[_link[@"ps5"] boolValue]
                                              accountId:account
                                                 height:(int)(_videoHeight ?: 1080)
                                                    fps:(int)(_fps ?: 60)
                                            bitrateKbps:(int)_bitrateKbps
                                                   hevc:_hevc];
  _session.delegate = self;
  _session.muted = _muted;
  _session.displayLayer.frame = self.bounds;
  [self.layer addSublayer:_session.displayLayer];
  [_session start];
  IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep, kIOPMAssertionLevelOn, CFSTR("Waken : stream PlayStation"), &_awake);
  __weak WakenPlayStationView *weak = self;
  _statsTimer = [NSTimer scheduledTimerWithTimeInterval:1 repeats:YES block:^(NSTimer *timer) {
    WakenPlayStationView *view = weak;
    MLPlayStationSession *s = view ? view->_session : nil;
    if (!s || !view.onStats) return;
    view.onStats(@{ @"rttMs" : @(s.rttMs), @"fps" : @(s.measuredFps), @"bitrateKbps" : @(s.measuredBitrateKbps), @"droppedFrames" : @(s.droppedFrames) });
  }];
}

- (void)stopStream {
  [_statsTimer invalidate];
  _statsTimer = nil;
  [_session stop];
  [_session.displayLayer removeFromSuperlayer];
  _session = nil;
  if (_awake) {
    IOPMAssertionRelease(_awake);
    _awake = 0;
  }
}

- (void)dealloc {
  [self stopStream];
}

#pragma mark - MLPlayStationSessionDelegate

- (void)playStationStateChanged:(NSString *)state message:(NSString *)message {
  if (!self.onStateChange) return;
  NSMutableDictionary *event = [@{ @"state" : state } mutableCopy];
  if (message) event[@"message"] = message;
  self.onStateChange(event);
}

#pragma mark - Keys

- (BOOL)acceptsFirstResponder {
  return YES;
}

static uint32_t ButtonFor(NSEvent *event) {
  switch (event.keyCode) {
    case 123: return CHIAKI_CONTROLLER_BUTTON_DPAD_LEFT;
    case 124: return CHIAKI_CONTROLLER_BUTTON_DPAD_RIGHT;
    case 125: return CHIAKI_CONTROLLER_BUTTON_DPAD_DOWN;
    case 126: return CHIAKI_CONTROLLER_BUTTON_DPAD_UP;
    case 36:
    case 76: return CHIAKI_CONTROLLER_BUTTON_CROSS; // Return, Enter
    case 53:
    case 51: return CHIAKI_CONTROLLER_BUTTON_MOON; // Escape, Delete
    case 49: return CHIAKI_CONTROLLER_BUTTON_BOX; // Space
    case 48: return CHIAKI_CONTROLLER_BUTTON_PYRAMID; // Tab
    case 31: return CHIAKI_CONTROLLER_BUTTON_OPTIONS; // O
    case 35: return CHIAKI_CONTROLLER_BUTTON_PS; // P
    default: return 0;
  }
}

- (void)keyDown:(NSEvent *)event {
  if (event.modifierFlags & NSEventModifierFlagCommand) return [super keyDown:event];
  uint32_t button = ButtonFor(event);
  if (!button) return;
  _keys |= button;
  _session.keyboardButtons = _keys;
}

- (void)keyUp:(NSEvent *)event {
  uint32_t button = ButtonFor(event);
  if (!button) return;
  _keys &= ~button;
  _session.keyboardButtons = _keys;
}

@end
