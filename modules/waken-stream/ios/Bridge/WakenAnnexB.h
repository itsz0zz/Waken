#ifndef WAKEN_ANNEX_B_H
#define WAKEN_ANNEX_B_H

#include <stddef.h>
#include <stdint.h>

// Pure conversion helpers, tested on the Mac by ios/Tests/run.sh. Both take one contiguous buffer:
// moonlight-common-c splits a frame by RTP packet, possibly inside a start code, so concatenate it first.

/// Room needed by WakenAnnexBToAVCC: a 3-byte start code becomes a 4-byte length.
size_t WakenAVCCCapacity(size_t annexBLength);

/// Replaces each start code with a 4-byte big-endian length. Returns the bytes written, 0 if there is no NAL.
size_t WakenAnnexBToAVCC(const uint8_t *annexB, size_t length, uint8_t *out, size_t capacity);

/// The first NAL without start code or padding, pointing into `annexB`. NULL if there is none.
const uint8_t *WakenFirstNAL(const uint8_t *annexB, size_t length, size_t *nalLength);

#endif
