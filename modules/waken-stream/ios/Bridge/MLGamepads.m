#import "MLGamepads.h"

#import <CoreHaptics/CoreHaptics.h>
#import <GameController/GameController.h>
#import <QuartzCore/QuartzCore.h>

#include "Limelight.h"

/// m/s² in one g: GameController gives accelerations in g, the protocol wants m/s².
static const float kStandardGravity = 9.80665f;
/// The protocol numbers up to 16 controllers (a 16-bit mask).
static const int kMaxControllers = 16;
static const NSTimeInterval kBatteryEvery = 60;

#pragma mark - Motor

/// One motor of a controller: a CoreHaptics continuous event, played at the strength the game asks (as SDL does).
@interface MLMotor : NSObject
+ (nullable instancetype)motorOf:(GCController *)controller locality:(GCHapticsLocality)locality;
- (void)setStrength:(float)strength;
- (void)stop;
@end

@implementation MLMotor {
  CHHapticEngine *_engine;
  id<CHHapticPatternPlayer> _player;
  BOOL _playing;
}

+ (nullable instancetype)motorOf:(GCController *)controller locality:(GCHapticsLocality)locality {
  if (![controller.haptics.supportedLocalities containsObject:locality]) return nil;
  MLMotor *motor = [MLMotor new];
  motor->_engine = [controller.haptics createEngineWithLocality:locality];
  if (!motor->_engine) return nil;
  __weak MLMotor *weak = motor;
  // The engine stops when the app goes to the background or the controller sleeps: started again on next use.
  motor->_engine.stoppedHandler = ^(CHHapticEngineStoppedReason reason) {
    dispatch_async(dispatch_get_main_queue(), ^{
      MLMotor *m = weak;
      if (!m) return;
      m->_player = nil;
      m->_playing = NO;
    });
  };
  motor->_engine.resetHandler = ^{
    dispatch_async(dispatch_get_main_queue(), ^{
      MLMotor *m = weak;
      if (!m) return;
      m->_player = nil;
      m->_playing = NO;
    });
  };
  return [motor prepare] ? motor : nil;
}

- (BOOL)prepare {
  NSError *error = nil;
  if (![_engine startAndReturnError:&error]) return NO;
  CHHapticEventParameter *full = [[CHHapticEventParameter alloc] initWithParameterID:CHHapticEventParameterIDHapticIntensity value:1];
  CHHapticEvent *event = [[CHHapticEvent alloc] initWithEventType:CHHapticEventTypeHapticContinuous parameters:@[ full ] relativeTime:0 duration:GCHapticDurationInfinite];
  CHHapticPattern *pattern = [[CHHapticPattern alloc] initWithEvents:@[ event ] parameters:@[] error:&error];
  if (!pattern) return NO;
  _player = [_engine createPlayerWithPattern:pattern error:&error];
  _playing = NO;
  return _player != nil;
}

- (void)setStrength:(float)strength {
  NSError *error = nil;
  if (strength <= 0) {
    if (_playing) [_player stopAtTime:CHHapticTimeImmediate error:&error];
    _playing = NO;
    return;
  }
  if (!_player && ![self prepare]) return;
  CHHapticDynamicParameter *level = [[CHHapticDynamicParameter alloc] initWithParameterID:CHHapticDynamicParameterIDHapticIntensityControl value:MIN(strength, 1) relativeTime:0];
  [_player sendParameters:@[ level ] atTime:CHHapticTimeImmediate error:&error];
  if (!_playing) _playing = [_player startAtTime:CHHapticTimeImmediate error:&error];
}

- (void)stop {
  NSError *error = nil;
  if (_playing) [_player stopAtTime:CHHapticTimeImmediate error:&error];
  _playing = NO;
  [_engine stopWithCompletionHandler:nil];
}

@end

#pragma mark - Pad

/// A controller of this stream: its number, its kind, its motors and what the computer asked of its sensors.
@interface MLPad : NSObject
@property (nonatomic, strong) GCController *controller;
@property (nonatomic) uint8_t number;
@property (nonatomic) uint8_t type;
// Created at the first vibration: an engine per motor costs, most games never ask.
@property (nonatomic) BOOL motorsTried, triggersTried;
@property (nonatomic, strong, nullable) MLMotor *low, *high, *single, *leftTrigger, *rightTrigger;
@property (nonatomic) uint16_t gyroHz, accelHz;
@property (nonatomic) CFTimeInterval lastGyro, lastAccel;
@property (nonatomic) BOOL touching1, touching2;
@end

@implementation MLPad
@end

#pragma mark - Gamepads

@implementation MLGamepads {
  NSMutableArray<MLPad *> *_pads;
  NSMutableArray<id> *_observers;
  NSTimer *_batteryTimer;
  BOOL _running;
}

- (instancetype)init {
  if ((self = [super init])) {
    _pads = [NSMutableArray array];
    _observers = [NSMutableArray array];
  }
  return self;
}

- (void)start {
  if (_running) return;
  _running = YES;
  __weak MLGamepads *weak = self;
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [_observers addObject:[center addObserverForName:GCControllerDidConnectNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    [weak connect:note.object];
  }]];
  [_observers addObject:[center addObserverForName:GCControllerDidDisconnectNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    [weak disconnect:note.object];
  }]];
  for (GCController *controller in GCController.controllers) [self connect:controller];
  _batteryTimer = [NSTimer scheduledTimerWithTimeInterval:kBatteryEvery repeats:YES block:^(NSTimer *timer) {
    MLGamepads *gamepads = weak;
    for (MLPad *pad in gamepads ? gamepads->_pads : @[]) [MLGamepads sendBattery:pad];
  }];
}

- (void)stop {
  _running = NO;
  for (id observer in _observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
  [_observers removeAllObjects];
  [_batteryTimer invalidate];
  _batteryTimer = nil;
  for (MLPad *pad in _pads) [self forget:pad];
  [_pads removeAllObjects];
}

- (void)dealloc {
  [self stop];
}

#pragma mark Controllers coming and going

- (uint16_t)mask {
  uint16_t mask = 0;
  for (MLPad *pad in _pads) mask |= (uint16_t)(1 << pad.number);
  return mask;
}

- (nullable MLPad *)padFor:(GCController *)controller {
  for (MLPad *pad in _pads) {
    if (pad.controller == controller) return pad;
  }
  return nil;
}

- (nullable MLPad *)padNumber:(uint16_t)number {
  for (MLPad *pad in _pads) {
    if (pad.number == number) return pad;
  }
  return nil;
}

/// The lowest free number: a controller keeps its own for as long as it stays connected.
- (int)freeNumber {
  for (int n = 0; n < kMaxControllers; n++) {
    if (![self padNumber:(uint16_t)n]) return n;
  }
  return -1;
}

/// The kind the computer emulates (Sunshine on Windows: an Xbox 360 or a DualShock 4) and games show the buttons of.
static uint8_t KindOf(GCController *controller) {
  GCExtendedGamepad *gamepad = controller.extendedGamepad;
  if ([gamepad isKindOfClass:GCDualSenseGamepad.class] || [gamepad isKindOfClass:GCDualShockGamepad.class]) return LI_CTYPE_PS;
  if ([gamepad isKindOfClass:GCXboxGamepad.class]) return LI_CTYPE_XBOX;
  NSString *category = controller.productCategory ?: @"";
  if ([category containsString:@"DualSense"] || [category containsString:@"DualShock"]) return LI_CTYPE_PS;
  if ([category containsString:@"Xbox"]) return LI_CTYPE_XBOX;
  if ([category containsString:@"Switch"] || [category containsString:@"Joy-Con"] || [category containsString:@"Nintendo"]) return LI_CTYPE_NINTENDO;
  return LI_CTYPE_UNKNOWN;
}

static BOOL HasTouchpad(GCController *controller) {
  return controller.physicalInputProfile.dpads[GCInputDualShockTouchpadOne] != nil;
}

- (void)connect:(GCController *)controller {
  if (!_running || !controller.extendedGamepad || [self padFor:controller]) return;
  int number = [self freeNumber];
  if (number < 0) return;
  MLPad *pad = [MLPad new];
  pad.controller = controller;
  pad.number = (uint8_t)number;
  pad.type = KindOf(controller);
  [_pads addObject:pad];
  [self announce:pad];
  [self bindButtons:pad];
  [self bindMotion:pad];
  [MLGamepads sendBattery:pad];
}

- (void)disconnect:(GCController *)controller {
  MLPad *pad = [self padFor:controller];
  if (!pad) return;
  [self forget:pad];
  [_pads removeObject:pad];
  // A last state with this controller out of the mask: the computer unplugs its virtual one.
  if (_running) LiSendMultiControllerEvent(pad.number, [self mask], 0, 0, 0, 0, 0, 0, 0);
}

- (void)forget:(MLPad *)pad {
  pad.controller.extendedGamepad.valueChangedHandler = nil;
  pad.controller.motion.valueChangedHandler = nil;
  if (pad.controller.motion.sensorsRequireManualActivation) pad.controller.motion.sensorsActive = NO;
  for (MLMotor *motor in @[ pad.low ?: NSNull.null, pad.high ?: NSNull.null, pad.single ?: NSNull.null, pad.leftTrigger ?: NSNull.null, pad.rightTrigger ?: NSNull.null ]) {
    if ([motor isKindOfClass:MLMotor.class]) [motor stop];
  }
}

/// What the controller is and can do: the computer picks the virtual controller and the features to forward.
- (void)announce:(MLPad *)pad {
  GCController *controller = pad.controller;
  NSSet<GCHapticsLocality> *localities = controller.haptics.supportedLocalities ?: [NSSet set];
  uint16_t capabilities = LI_CCAP_ANALOG_TRIGGERS;
  if (controller.haptics) capabilities |= LI_CCAP_RUMBLE;
  if ([localities containsObject:GCHapticsLocalityLeftTrigger]) capabilities |= LI_CCAP_TRIGGER_RUMBLE;
  if (HasTouchpad(controller)) capabilities |= LI_CCAP_TOUCHPAD;
  if (controller.motion) capabilities |= LI_CCAP_ACCEL | LI_CCAP_GYRO;
  if (controller.light) capabilities |= LI_CCAP_RGB_LED;
  if (controller.battery) capabilities |= LI_CCAP_BATTERY_STATE;

  uint32_t buttons = A_FLAG | B_FLAG | X_FLAG | Y_FLAG | UP_FLAG | DOWN_FLAG | LEFT_FLAG | RIGHT_FLAG | LB_FLAG | RB_FLAG | PLAY_FLAG | BACK_FLAG |
                     LS_CLK_FLAG | RS_CLK_FLAG | SPECIAL_FLAG;
  if (controller.physicalInputProfile.buttons[GCInputDualShockTouchpadButton]) buttons |= TOUCHPAD_FLAG;
  if ([controller.extendedGamepad isKindOfClass:GCXboxGamepad.class]) {
    GCXboxGamepad *xbox = (GCXboxGamepad *)controller.extendedGamepad;
    buttons |= MISC_FLAG;
    if (xbox.paddleButton1) buttons |= PADDLE1_FLAG;
    if (xbox.paddleButton2) buttons |= PADDLE2_FLAG;
    if (xbox.paddleButton3) buttons |= PADDLE3_FLAG;
    if (xbox.paddleButton4) buttons |= PADDLE4_FLAG;
  }
  LiSendControllerArrivalEvent(pad.number, [self mask], pad.type, buttons, capabilities);
}

#pragma mark Input

static short Axis(float value) { return (short)MAX(-32768, MIN(32767, value * 32767)); }

- (void)bindButtons:(MLPad *)pad {
  __weak MLGamepads *weak = self;
  __weak MLPad *weakPad = pad;
  pad.controller.extendedGamepad.valueChangedHandler = ^(GCExtendedGamepad *gp, GCControllerElement *element) {
    MLGamepads *gamepads = weak;
    MLPad *p = weakPad;
    if (!gamepads || !p || !gamepads->_running) return;
    GCController *controller = p.controller;
    int b = 0;
    if (gp.buttonA.isPressed) b |= A_FLAG;
    if (gp.buttonB.isPressed) b |= B_FLAG;
    if (gp.buttonX.isPressed) b |= X_FLAG;
    if (gp.buttonY.isPressed) b |= Y_FLAG;
    if (gp.dpad.up.isPressed) b |= UP_FLAG;
    if (gp.dpad.down.isPressed) b |= DOWN_FLAG;
    if (gp.dpad.left.isPressed) b |= LEFT_FLAG;
    if (gp.dpad.right.isPressed) b |= RIGHT_FLAG;
    if (gp.buttonMenu.isPressed) b |= PLAY_FLAG;
    if (gp.buttonOptions.isPressed) b |= BACK_FLAG;
    if (gp.leftThumbstickButton.isPressed) b |= LS_CLK_FLAG;
    if (gp.rightThumbstickButton.isPressed) b |= RS_CLK_FLAG;
    if (gp.leftShoulder.isPressed) b |= LB_FLAG;
    if (gp.rightShoulder.isPressed) b |= RB_FLAG;
    if (gp.buttonHome.isPressed) b |= SPECIAL_FLAG;
    // Sony's touchpad click; Xbox's share button and the Elite's paddles.
    if (controller.physicalInputProfile.buttons[GCInputDualShockTouchpadButton].isPressed) b |= TOUCHPAD_FLAG;
    if ([gp isKindOfClass:GCXboxGamepad.class]) {
      GCXboxGamepad *xbox = (GCXboxGamepad *)gp;
      if (xbox.buttonShare.isPressed) b |= MISC_FLAG;
      if (xbox.paddleButton1.isPressed) b |= PADDLE1_FLAG;
      if (xbox.paddleButton2.isPressed) b |= PADDLE2_FLAG;
      if (xbox.paddleButton3.isPressed) b |= PADDLE3_FLAG;
      if (xbox.paddleButton4.isPressed) b |= PADDLE4_FLAG;
    }
    LiSendMultiControllerEvent(p.number, [gamepads mask], b, (unsigned char)(gp.leftTrigger.value * 255), (unsigned char)(gp.rightTrigger.value * 255),
                               Axis(gp.leftThumbstick.xAxis.value), Axis(gp.leftThumbstick.yAxis.value), Axis(gp.rightThumbstick.xAxis.value),
                               Axis(gp.rightThumbstick.yAxis.value));
    [gamepads sendTouches:p];
  };
}

/// The touchpad's fingers, as SDL reads them: a surface at (0, 0) is not touched. Coordinates from the top left, 0 to 1.
- (void)sendTouches:(MLPad *)pad {
  GCControllerDirectionPad *one = pad.controller.physicalInputProfile.dpads[GCInputDualShockTouchpadOne];
  GCControllerDirectionPad *two = pad.controller.physicalInputProfile.dpads[GCInputDualShockTouchpadTwo];
  if (one) pad.touching1 = [self sendFinger:0 of:pad surface:one wasTouching:pad.touching1];
  if (two) pad.touching2 = [self sendFinger:1 of:pad surface:two wasTouching:pad.touching2];
}

- (BOOL)sendFinger:(uint32_t)finger of:(MLPad *)pad surface:(GCControllerDirectionPad *)surface wasTouching:(BOOL)was {
  float x = surface.xAxis.value, y = surface.yAxis.value;
  BOOL touching = x != 0 || y != 0;
  if (!touching && !was) return NO;
  uint8_t event = !touching ? LI_TOUCH_EVENT_UP : was ? LI_TOUCH_EVENT_MOVE : LI_TOUCH_EVENT_DOWN;
  LiSendControllerTouchEvent(pad.number, event, finger, (1 + x) / 2, 1 - (1 + y) / 2, touching ? 1 : 0);
  return touching;
}

/// The gyroscope and accelerometer, once the computer asks for them, at its rate. Axes as SDL gives them, which is
/// what Sunshine expects: gyroscope in degrees per second, acceleration in m/s² with gravity.
- (void)bindMotion:(MLPad *)pad {
  GCMotion *motion = pad.controller.motion;
  if (!motion) return;
  __weak MLGamepads *weak = self;
  __weak MLPad *weakPad = pad;
  motion.valueChangedHandler = ^(GCMotion *m) {
    MLGamepads *gamepads = weak;
    MLPad *p = weakPad;
    if (!gamepads || !p || !gamepads->_running) return;
    CFTimeInterval now = CACurrentMediaTime();
    if (p.gyroHz > 0 && m.hasRotationRate && now - p.lastGyro >= 1.0 / p.gyroHz) {
      p.lastGyro = now;
      GCRotationRate rate = m.rotationRate;
      const float degrees = 180.0f / (float)M_PI;
      LiSendControllerMotionEvent(p.number, LI_MOTION_TYPE_GYRO, (float)rate.x * degrees, (float)rate.z * degrees, -(float)rate.y * degrees);
    }
    if (p.accelHz > 0 && m.hasGravityAndUserAcceleration && now - p.lastAccel >= 1.0 / p.accelHz) {
      p.lastAccel = now;
      GCAcceleration a = m.acceleration;
      LiSendControllerMotionEvent(p.number, LI_MOTION_TYPE_ACCEL, -(float)a.x * kStandardGravity, -(float)a.y * kStandardGravity, -(float)a.z * kStandardGravity);
    }
  };
}

+ (void)sendBattery:(MLPad *)pad {
  GCDeviceBattery *battery = pad.controller.battery;
  if (!battery) return;
  uint8_t state = LI_BATTERY_STATE_UNKNOWN;
  switch (battery.batteryState) {
    case GCDeviceBatteryStateDischarging: state = LI_BATTERY_STATE_DISCHARGING; break;
    case GCDeviceBatteryStateCharging: state = LI_BATTERY_STATE_CHARGING; break;
    case GCDeviceBatteryStateFull: state = LI_BATTERY_STATE_FULL; break;
    default: break;
  }
  float level = battery.batteryLevel;
  LiSendControllerBatteryEvent(pad.number, state, level >= 0 && level <= 1 ? (uint8_t)lroundf(level * 100) : LI_BATTERY_PERCENTAGE_UNKNOWN);
}

#pragma mark What the computer asks

- (void)rumble:(uint16_t)number low:(uint16_t)low high:(uint16_t)high {
  MLPad *pad = [self padNumber:number];
  if (!pad) return;
  if (!pad.motorsTried) {
    pad.motorsTried = YES;
    // The heavy motor in the left grip, the light one in the right, as on an Xbox controller; one motor otherwise.
    pad.low = [MLMotor motorOf:pad.controller locality:GCHapticsLocalityLeftHandle];
    pad.high = [MLMotor motorOf:pad.controller locality:GCHapticsLocalityRightHandle];
    if (!pad.low || !pad.high) pad.single = [MLMotor motorOf:pad.controller locality:GCHapticsLocalityDefault];
  }
  if (pad.low && pad.high) {
    [pad.low setStrength:low / 65535.0f];
    [pad.high setStrength:high / 65535.0f];
  } else {
    [pad.single setStrength:MAX(low, high) / 65535.0f];
  }
}

- (void)rumbleTriggers:(uint16_t)number left:(uint16_t)left right:(uint16_t)right {
  MLPad *pad = [self padNumber:number];
  if (!pad) return;
  if (!pad.triggersTried) {
    pad.triggersTried = YES;
    pad.leftTrigger = [MLMotor motorOf:pad.controller locality:GCHapticsLocalityLeftTrigger];
    pad.rightTrigger = [MLMotor motorOf:pad.controller locality:GCHapticsLocalityRightTrigger];
  }
  [pad.leftTrigger setStrength:left / 65535.0f];
  [pad.rightTrigger setStrength:right / 65535.0f];
}

- (void)motion:(uint16_t)number type:(uint8_t)type rate:(uint16_t)reportRateHz {
  MLPad *pad = [self padNumber:number];
  GCMotion *motion = pad.controller.motion;
  if (!motion) return;
  if (type == LI_MOTION_TYPE_GYRO) pad.gyroHz = reportRateHz;
  if (type == LI_MOTION_TYPE_ACCEL) pad.accelHz = reportRateHz;
  // The sensors drain the battery: on only while a game listens.
  if (motion.sensorsRequireManualActivation) motion.sensorsActive = pad.gyroHz > 0 || pad.accelHz > 0;
}

- (void)light:(uint16_t)number red:(uint8_t)red green:(uint8_t)green blue:(uint8_t)blue {
  GCDeviceLight *light = [self padNumber:number].controller.light;
  if (light) light.color = [[GCColor alloc] initWithRed:red / 255.0f green:green / 255.0f blue:blue / 255.0f];
}

@end
