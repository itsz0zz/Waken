// Where a frame's time goes, for the stream HUD: the same figures on Mac, iPhone (MLStreamSession.m) and Windows
// (apps/windows/windows/Waken/Stream/VideoRenderer.cpp). Every time is in moonlight-common-c's clock
// (LiGetMicroseconds), the one of the decode unit's receiveTimeUs and enqueueTimeUs. Plain C, no lock: the
// caller keeps one window per session and guards it.
#pragma once

#include <math.h>
#include <stdint.h>
#include <string.h>

/// Averages over the last window (about a second), in milliseconds. 0 when nothing was measured.
typedef struct {
  /// Capture and encoding on the computer played on (Sunshine says it, for each frame).
  double hostMs;
  /// From the frame's first packet to its last: its size against the network's pace.
  double receiveMs;
  /// Complete, waiting for moonlight-common-c to hand it to the decoder.
  double queueMs;
  /// Handed to the decoder until it is given to the screen: decoding on Windows, the wait for a refresh on Apple.
  double displayMs;
  /// How unsteady the frames reach the screen: the standard deviation of the gap between two of them.
  double jitterMs;
} WakenFrameTimes;

typedef struct {
  double host, receive, queue, display, gaps, gapsSquared;
  uint32_t frames, hostFrames, shown, gapCount;
  uint64_t lastShownUs;
} WakenFrameWindow;

/// A complete frame reaches the decoder callback (nowUs).
static inline void WakenFrameReceived(WakenFrameWindow *w, uint16_t hostLatencyTenthMs, uint64_t receiveUs, uint64_t enqueueUs,
                                      uint64_t nowUs) {
  if (hostLatencyTenthMs > 0) {
    w->host += hostLatencyTenthMs / 10.0;
    w->hostFrames++;
  }
  if (enqueueUs >= receiveUs && receiveUs > 0) w->receive += (double)(enqueueUs - receiveUs) / 1000.0;
  if (nowUs >= enqueueUs && enqueueUs > 0) w->queue += (double)(nowUs - enqueueUs) / 1000.0;
  w->frames++;
}

/// The frame handed to the decoder at submittedUs is given to the screen (nowUs).
static inline void WakenFrameShown(WakenFrameWindow *w, uint64_t submittedUs, uint64_t nowUs) {
  if (submittedUs > 0 && nowUs >= submittedUs) {
    w->display += (double)(nowUs - submittedUs) / 1000.0;
    w->shown++;
  }
  if (w->lastShownUs > 0 && nowUs > w->lastShownUs) {
    const double gap = (double)(nowUs - w->lastShownUs) / 1000.0;
    // A pause (menu open, stream held) is not unsteadiness.
    if (gap < 250.0) {
      w->gaps += gap;
      w->gapsSquared += gap * gap;
      w->gapCount++;
    }
  }
  w->lastShownUs = nowUs;
}

/// The averages of the window, which starts again.
static inline WakenFrameTimes WakenFrameClose(WakenFrameWindow *w) {
  WakenFrameTimes t;
  memset(&t, 0, sizeof(t));
  if (w->hostFrames) t.hostMs = w->host / w->hostFrames;
  if (w->frames) {
    t.receiveMs = w->receive / w->frames;
    t.queueMs = w->queue / w->frames;
  }
  if (w->shown) t.displayMs = w->display / w->shown;
  if (w->gapCount > 1) {
    const double mean = w->gaps / w->gapCount;
    const double variance = w->gapsSquared / w->gapCount - mean * mean;
    t.jitterMs = variance > 0 ? sqrt(variance) : 0;
  }
  const uint64_t last = w->lastShownUs;
  memset(w, 0, sizeof(*w));
  w->lastShownUs = last;
  return t;
}
