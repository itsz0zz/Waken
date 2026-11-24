// A reserve of frames that adapts to the network, as Parsec does: on a steady network (home Wi-Fi) it stays at 0,
// nothing added to the delay; on an uneven one (5G, which delivers in bursts) it grows to a few frames, the picture
// then a little later but smooth. Shared by Mac, iPhone (MLStreamSession.m) and Windows (VideoRenderer.cpp).
// Plain C, no lock: the caller guards it.
//
// How uneven the network is: each frame's transit, its arrival (moonlight-common-c's enqueueTimeUs) minus the
// moment the computer captured it (presentationTimeUs, the computer's clock). The two clocks differ by a constant,
// so the spread of the transits over a second is the network's jitter, whatever the frame rate (Sunshine sends
// fewer frames when the screen barely moves).
#pragma once

#include <math.h>
#include <stdint.h>

/// At most this many frames held back: 3 frames at 60 i/s, 50 ms.
#define WAKEN_SMOOTHING_MAX 3
/// Spread the network may have with no reserve: one frame shown a few ms late is not seen.
#define WAKEN_SMOOTHING_FREE_MS 4.0

typedef struct {
  /// The player chose smoothness ("Fluidité"): otherwise the reserve stays at 0, frames as soon as they come.
  int enabled;
  /// Frames held back now.
  int target;
  /// Enough frames came (or the oldest waited long enough): they go out one per frame interval.
  int primed;
  /// This second's transits, in µs.
  int64_t minTransit, maxTransit;
  int samples;
  /// Seconds in a row that asked for a smaller reserve: it shrinks only after a few, it grows at once.
  int calmer;
} WakenSmoothing;

/// A complete frame arrives.
static inline void WakenSmoothingFrame(WakenSmoothing *s, uint64_t presentationUs, uint64_t arrivedUs) {
  if (presentationUs == 0 || arrivedUs == 0) return;
  const int64_t transit = (int64_t)arrivedUs - (int64_t)presentationUs;
  if (s->samples == 0 || transit < s->minTransit) s->minTransit = transit;
  if (s->samples == 0 || transit > s->maxTransit) s->maxTransit = transit;
  s->samples++;
}

/// Once a second: the reserve for the next one. frameMs, the time between two frames at the stream's rate.
static inline void WakenSmoothingUpdate(WakenSmoothing *s, double frameMs) {
  int want = 0;
  if (s->enabled && s->samples >= 5 && frameMs > 0) {
    const double spreadMs = (double)(s->maxTransit - s->minTransit) / 1000.0;
    want = (int)ceil((spreadMs - WAKEN_SMOOTHING_FREE_MS) / frameMs);
    if (want < 0) want = 0;
    if (want > WAKEN_SMOOTHING_MAX) want = WAKEN_SMOOTHING_MAX;
  } else if (s->enabled && s->samples < 5) {
    want = s->target; // too few frames to tell (a still screen): the reserve stays
  }
  if (!s->enabled) {
    s->target = 0;
    s->calmer = 0;
  } else if (want > s->target) {
    s->target = want;
    s->calmer = 0;
  } else if (want < s->target) {
    if (++s->calmer >= 3) {
      s->target--;
      s->calmer = 0;
    }
  } else {
    s->calmer = 0;
  }
  if (s->target == 0) s->primed = 1;
  s->samples = 0;
}

/// At a screen refresh: how many of the queued frames to take, the last one shown and the others decoded only;
/// 0 keeps the picture on screen. oldestWaitMs, how long the oldest has waited; sinceShownMs, since the last shown.
static inline int WakenSmoothingTake(WakenSmoothing *s, int queued, double oldestWaitMs, double sinceShownMs, double frameMs) {
  if (s->target == 0) {
    // No reserve: the newest frame at once, at most two waiting (a burst spreads over the next refreshes).
    if (queued == 0) return 0;
    return queued > 2 ? queued - 2 + 1 : 1;
  }
  if (queued == 0) {
    // Ran dry: the reserve fills again before the frames go on.
    s->primed = 0;
    return 0;
  }
  if (!s->primed) {
    // Full enough, or a single frame (a still screen, the cursor) waited the reserve's time: it goes.
    if (queued < s->target && oldestWaitMs < s->target * frameMs) return 0;
    s->primed = 1;
  } else if (sinceShownMs < frameMs - 2.0) {
    // One frame per frame interval, even on a screen that refreshes faster (120 Hz).
    return 0;
  }
  // More than the reserve and a margin waiting: the late ones are decoded only, the delay stays bounded.
  const int backlog = s->target + 2;
  return queued > backlog ? queued - backlog + 1 : 1;
}
