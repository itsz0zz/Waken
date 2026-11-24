// A reserve of frames that adapts to the network, as Parsec does: on a steady network (home Wi-Fi) it stays at 0,
// nothing added to the delay; on an uneven one (5G, which delivers in bursts) it grows to a few frames, the picture
// then a little later but smooth. Shared by Mac, iPhone (MLStreamSession.m) and Windows (VideoRenderer.cpp).
// Plain C, no lock: the caller guards it.
//
// Each frame's transit is its arrival (moonlight-common-c's enqueueTimeUs, this device's clock) minus the moment
// the computer captured it (presentationTimeUs, the computer's clock). The two clocks differ by a constant, so:
// - the spread of the transits over a second is the network's jitter, whatever the frame rate (Sunshine sends
//   fewer frames when the screen barely moves);
// - with a reserve, each frame is shown at its capture plus a fixed delay (the shortest transit, plus the reserve):
//   the delay from the computer to this screen stays the same for every frame, which is what the eye calls smooth.
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
  /// This second's transits, in µs.
  int64_t minTransit, maxTransit;
  int samples;
  /// The shortest transit of the last second with frames: the fixed delay starts from it.
  int64_t baseTransit;
  int hasBase;
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
  // The first frames: a base at once, refined every second.
  if (!s->hasBase || transit < s->baseTransit) {
    s->baseTransit = transit;
    s->hasBase = 1;
  }
}

/// Once a second: the reserve for the next one. frameMs, the time between two frames at the stream's rate.
static inline void WakenSmoothingUpdate(WakenSmoothing *s, double frameMs) {
  int want = s->target; // too few frames to tell (a still screen): the reserve stays
  if (s->samples >= 5 && frameMs > 0) {
    const double spreadMs = (double)(s->maxTransit - s->minTransit) / 1000.0;
    want = (int)ceil((spreadMs - WAKEN_SMOOTHING_FREE_MS) / frameMs);
    if (want < 0) want = 0;
    if (want > WAKEN_SMOOTHING_MAX) want = WAKEN_SMOOTHING_MAX;
  }
  if (s->samples > 0) {
    // Follows the network, and the two clocks' slow drift.
    s->baseTransit = s->minTransit;
    s->hasBase = 1;
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
  s->samples = 0;
}

/// When the frame captured at presentationUs is due on screen (this device's clock, µs); 0: at once (no reserve,
/// or nothing known yet).
static inline uint64_t WakenSmoothingDueUs(const WakenSmoothing *s, uint64_t presentationUs, double frameMs) {
  if (s->target == 0 || !s->hasBase || presentationUs == 0) return 0;
  const int64_t due = (int64_t)presentationUs + s->baseTransit + (int64_t)(s->target * frameMs * 1000.0);
  return due > 0 ? (uint64_t)due : 0;
}

/// At a screen refresh: how many of the queued frames to take, the last one shown and the others decoded only;
/// 0 keeps the picture on screen. dueCount, how many from the oldest are due (WakenSmoothingDueUs <= now).
static inline int WakenSmoothingTake(const WakenSmoothing *s, int queued, int dueCount) {
  if (queued == 0) return 0;
  // No reserve: one frame per refresh, and past two waiting the older ones are decoded only (a burst spreads over
  // the next refreshes, the delay never grows beyond about two frames).
  if (s->target == 0) return queued <= 2 ? 1 : queued - 1;
  // With a reserve, the frames whose time came; far behind (a stall of the network), the late ones are decoded
  // only, the delay stays bounded.
  const int backlog = s->target + 3;
  int take = dueCount;
  if (queued - take > backlog) take = queued - backlog;
  return take;
}
