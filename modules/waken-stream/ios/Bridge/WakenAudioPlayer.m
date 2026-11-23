#import "WakenAudioPlayer.h"
#import "WakenOpusDecoder.h"
#include <stdatomic.h>

/// Beyond this, sound would drift behind the picture: drop packets instead of queueing them.
static const double kMaxBacklogSeconds = 0.1;
static const double kPreferredIOBufferSeconds = 0.005;

@implementation WakenAudioPlayer {
  WakenOpusDecoder *_decoder;
  AVAudioEngine *_engine;
  AVAudioPlayerNode *_node;
  NSMutableArray<id<NSObject>> *_observers;
  dispatch_queue_t _queue;
  atomic_bool _playing;
  atomic_long _backlog; // samples scheduled and not played yet
  long _maxBacklog;
}

- (nullable instancetype)initWithSampleRate:(double)sampleRate channels:(int)channels samplesPerFrame:(int)samplesPerFrame {
  if (!(self = [super init])) return nil;
  _decoder = [[WakenOpusDecoder alloc] initWithSampleRate:sampleRate channels:channels samplesPerFrame:samplesPerFrame];
  if (!_decoder) return nil;

  _maxBacklog = (long)(sampleRate * kMaxBacklogSeconds);
  _queue = dispatch_queue_create("fr.hdmsoft.waken.audio", DISPATCH_QUEUE_SERIAL);
  _observers = [NSMutableArray array];
  _engine = [AVAudioEngine new];
  _node = [AVAudioPlayerNode new];
  [_engine attachNode:_node];
  return self;
}

- (void)start {
  dispatch_sync(_queue, ^{
    NSError *error;
    AVAudioSession *session = AVAudioSession.sharedInstance;
    if (![session setCategory:AVAudioSessionCategoryPlayback error:&error]) NSLog(@"Waken audio category: %@", error);
    if (![session setPreferredIOBufferDuration:kPreferredIOBufferSeconds error:&error]) NSLog(@"Waken audio buffer: %@", error);
    [self resume];
  });

  // Headphones plugged or unplugged, phone call, Siri: the engine stops and has to be started again.
  __weak WakenAudioPlayer *weakSelf = self;
  void (^restart)(NSNotification *) = ^(NSNotification *note) {
    WakenAudioPlayer *player = weakSelf;
    if (!player) return;
    NSNumber *interruption = note.userInfo[AVAudioSessionInterruptionTypeKey];
    BOOL began = interruption && interruption.unsignedIntegerValue == AVAudioSessionInterruptionTypeBegan;
    dispatch_async(player->_queue, ^{
      if (began) atomic_store(&player->_playing, false);
      else if (player->_engine) [player resume];
    });
  };
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [_observers addObject:[center addObserverForName:AVAudioEngineConfigurationChangeNotification object:_engine queue:nil usingBlock:restart]];
  [_observers addObject:[center addObserverForName:AVAudioSessionInterruptionNotification object:nil queue:nil usingBlock:restart]];
}

/// On _queue.
- (void)resume {
  atomic_store(&_playing, false);
  NSError *error;
  if (![AVAudioSession.sharedInstance setActive:YES error:&error]) {
    NSLog(@"Waken audio session: %@", error);
    return;
  }
  [_engine connect:_node to:_engine.mainMixerNode format:_decoder.format];
  if (![_engine startAndReturnError:&error]) {
    NSLog(@"Waken audio engine: %@", error);
    return;
  }
  atomic_store(&_backlog, 0);
  [_node play];
  atomic_store(&_playing, true);
}

- (void)stop {
  for (id<NSObject> observer in _observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
  [_observers removeAllObjects];
  atomic_store(&_playing, false);
  dispatch_sync(_queue, ^{
    if (!self->_engine) return;
    [self->_node stop];
    [self->_engine stop];
    self->_engine = nil;
    NSError *error;
    if (![AVAudioSession.sharedInstance setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:&error]) {
      NSLog(@"Waken audio deactivation: %@", error);
    }
  });
}

- (void)play:(nullable const void *)packet length:(int)length {
  // Always decode: skipping a packet would break the codec's prediction for the next one.
  AVAudioPCMBuffer *pcm = [_decoder decode:packet length:length];
  if (!pcm || !atomic_load(&_playing) || atomic_load(&_backlog) > _maxBacklog) return;

  long frames = pcm.frameLength;
  atomic_fetch_add(&_backlog, frames);
  __weak WakenAudioPlayer *weakSelf = self;
  [_node scheduleBuffer:pcm completionHandler:^{
    WakenAudioPlayer *player = weakSelf;
    if (player) atomic_fetch_sub(&player->_backlog, frames);
  }];
}

@end
