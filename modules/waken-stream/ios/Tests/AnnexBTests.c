#include "WakenAnnexB.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(condition) do { if (!(condition)) { fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); exit(1); } } while (0)
#define ROUNDS 20000
#define MAX_NALS 8
#define MAX_NAL_BYTES 3000

// Random NALs, random start code sizes and padding, then cut into random "packets" and reassembled like the bridge does.
static void RoundTrips(void) {
  srand(42);
  for (int round = 0; round < ROUNDS; round++) {
    uint8_t stream[MAX_NALS * (MAX_NAL_BYTES + 12)];
    uint8_t expected[MAX_NALS * (MAX_NAL_BYTES + 4)];
    size_t streamLength = 0, expectedLength = 0;

    int count = 1 + rand() % MAX_NALS;
    for (int n = 0; n < count; n++) {
      if (rand() % 2) stream[streamLength++] = 0;
      stream[streamLength++] = 0;
      stream[streamLength++] = 0;
      stream[streamLength++] = 1;

      size_t size = 1 + (size_t)(rand() % (round % 50 == 0 ? MAX_NAL_BYTES : 60));
      expected[expectedLength++] = (uint8_t)(size >> 24);
      expected[expectedLength++] = (uint8_t)(size >> 16);
      expected[expectedLength++] = (uint8_t)(size >> 8);
      expected[expectedLength++] = (uint8_t)size;
      for (size_t i = 0; i < size; i++) {
        uint8_t byte = (uint8_t)(1 + rand() % 255);
        // Single zeros are legal inside a NAL, not at its end.
        if (i + 1 < size && rand() % 8 == 0 && (i == 0 || stream[streamLength - 1] != 0)) byte = 0;
        stream[streamLength++] = byte;
        expected[expectedLength++] = byte;
      }
      for (int pad = rand() % 4; pad > 0; pad--) stream[streamLength++] = 0;
    }

    uint8_t *joined = malloc(streamLength);
    for (size_t offset = 0; offset < streamLength;) {
      size_t packet = 1 + (size_t)(rand() % 1024);
      if (packet > streamLength - offset) packet = streamLength - offset;
      memcpy(joined + offset, stream + offset, packet);
      offset += packet;
    }

    size_t capacity = WakenAVCCCapacity(streamLength);
    uint8_t *out = malloc(capacity);
    CHECK(WakenAnnexBToAVCC(joined, streamLength, out, capacity) == expectedLength);
    CHECK(memcmp(out, expected, expectedLength) == 0);
    free(out);
    free(joined);
  }
}

static void LargeFragmentedFrame(void) {
  enum { SIZE = 60000 };
  uint8_t *in = malloc(SIZE + 4), *out = malloc(WakenAVCCCapacity(SIZE + 4));
  memset(in, 0x55, SIZE + 4);
  memcpy(in, "\0\0\0\1", 4);
  CHECK(WakenAnnexBToAVCC(in, SIZE + 4, out, WakenAVCCCapacity(SIZE + 4)) == SIZE + 4);
  free(in);
  free(out);
}

static void HostileInput(void) {
  for (int round = 0; round < ROUNDS; round++) {
    size_t length = (size_t)(rand() % 64);
    uint8_t *in = malloc(length ? length : 1);
    for (size_t i = 0; i < length; i++) in[i] = (uint8_t)(rand() % 3);
    size_t capacity = WakenAVCCCapacity(length), size;
    uint8_t *out = malloc(capacity);
    CHECK(WakenAnnexBToAVCC(in, length, out, capacity) <= capacity);
    WakenFirstNAL(in, length, &size);
    CHECK(size <= length);
    free(in);
    free(out);
  }
}

static void ParameterSets(void) {
  const uint8_t padded[] = {0, 0, 0, 1, 0x67, 0x42, 0x1F, 0, 0, 0};
  const uint8_t shortCode[] = {0, 0, 1, 0x68, 0xCE};
  const uint8_t none[] = {1, 2, 3};
  size_t size;
  CHECK(WakenFirstNAL(padded, sizeof padded, &size) == padded + 4 && size == 3);
  CHECK(WakenFirstNAL(shortCode, sizeof shortCode, &size) == shortCode + 3 && size == 2);
  CHECK(WakenFirstNAL(none, sizeof none, &size) == NULL && size == 0);
}

static void TooSmallBuffer(void) {
  const uint8_t in[] = {0, 0, 1, 9, 9, 9};
  uint8_t out[6];
  CHECK(WakenAnnexBToAVCC(in, sizeof in, out, sizeof out) == 0);
}

int main(void) {
  RoundTrips();
  LargeFragmentedFrame();
  HostileInput();
  ParameterSets();
  TooSmallBuffer();
  puts("AnnexB: ok");
  return 0;
}
