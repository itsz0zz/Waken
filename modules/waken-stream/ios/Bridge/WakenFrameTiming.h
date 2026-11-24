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
  /// How unsteady the frames reach the screen: the standard deviation of each frame's delay from its capture on
  /// the computer to this screen. Steady (near 0), the motion is smooth whatever the frame rate: Sunshine sends
  /// fewer frames when the screen barely moves, so the gaps between frames say nothing on their own.
  double jitterMs;
} WakenFrameTimes;

typedef struct {
  double host, receive, queue, display, delays, delaysSquared;
  uint32_t frames, hostFrames, shown, delayCount;
  /// The computer's clock and this one's differ by a constant: delays are kept from the window's first one.
  int64_t delayBaseUs;
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

/// The frame captured at presentationUs (the computer's clock, moonlight-common-c's presentationTimeUs) and handed
/// to the decoder at submittedUs is given to the screen (nowUs).
static inline void WakenFrameShown(WakenFrameWindow *w, uint64_t submittedUs, uint64_t presentationUs, uint64_t nowUs) {
  if (submittedUs > 0 && nowUs >= submittedUs) {
    w->display += (double)(nowUs - submittedUs) / 1000.0;
    w->shown++;
  }
  if (presentationUs > 0) {
    const int64_t delayUs = (int64_t)nowUs - (int64_t)presentationUs;
    if (w->delayCount == 0) w->delayBaseUs = delayUs;
    const double delay = (double)(delayUs - w->delayBaseUs) / 1000.0;
    w->delays += delay;
    w->delaysSquared += delay * delay;
    w->delayCount++;
  }
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
  if (w->delayCount > 1) {
    const double mean = w->delays / w->delayCount;
    const double variance = w->delaysSquared / w->delayCount - mean * mean;
    t.jitterMs = variance > 0 ? sqrt(variance) : 0;
  }
  memset(w, 0, sizeof(*w));
  return t;
}
