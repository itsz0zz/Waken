#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// The controllers of this iPhone, iPad or Mac, for one stream (GameController framework): sticks, buttons,
/// touchpad, gyroscope and battery sent to the computer, its vibrations, trigger vibrations and light bar
/// played on them. Each controller keeps its number for as long as it stays connected.
/// Every method runs on the main thread; the session hops there from moonlight's threads.
@interface MLGamepads : NSObject

/// The stream takes input: the controllers already connected are announced, new ones as they come.
- (void)start;
/// The stream is over: motors stopped, sensors off, handlers removed.
- (void)stop;

// What the computer asks (moonlight-common-c's callbacks), values as the protocol gives them.
- (void)rumble:(uint16_t)number low:(uint16_t)low high:(uint16_t)high;
- (void)rumbleTriggers:(uint16_t)number left:(uint16_t)left right:(uint16_t)right;
- (void)motion:(uint16_t)number type:(uint8_t)type rate:(uint16_t)reportRateHz;
- (void)light:(uint16_t)number red:(uint8_t)red green:(uint8_t)green blue:(uint8_t)blue;

// The Manettes page, outside any stream.

/// The controllers connected now: id, name, kind (xbox, playstation, nintendo, other), battery (0 to 1, or absent),
/// charging, and what each can do (rumble, motion, touchpad, light).
+ (NSArray<NSDictionary<NSString *, id> *> *)connected;
/// A short vibration on that controller, to tell which one it is.
+ (void)test:(NSString *)identifier;
/// For every stream from now on: vibration strength (0 to 1), motion sensors on or off, the kind announced
/// (auto, xbox, playstation).
+ (void)setRumble:(float)rumble motion:(BOOL)motion kind:(NSString *)kind;

@end

NS_ASSUME_NONNULL_END
