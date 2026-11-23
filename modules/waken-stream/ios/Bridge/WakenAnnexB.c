#include "WakenAnnexB.h"

#include <string.h>

#define START_CODE_LENGTH 3
#define LENGTH_PREFIX 4

/// Index of the next 00 00 01, or `length`.
static size_t FindStartCode(const uint8_t *bytes, size_t length, size_t from) {
  for (size_t i = from; i + START_CODE_LENGTH <= length; i++) {
    if (bytes[i] == 0 && bytes[i + 1] == 0 && bytes[i + 2] == 1) return i;
  }
  return length;
}

/// A NAL always ends on a non-zero byte: what follows is padding or the first zero of a 4-byte start code.
static size_t WithoutTrailingZeros(const uint8_t *bytes, size_t start, size_t end) {
  while (end > start && bytes[end - 1] == 0) end--;
  return end;
}

size_t WakenAVCCCapacity(size_t annexBLength) {
  return annexBLength + annexBLength / START_CODE_LENGTH + LENGTH_PREFIX;
}

size_t WakenAnnexBToAVCC(const uint8_t *annexB, size_t length, uint8_t *out, size_t capacity) {
  size_t written = 0;
  size_t code = FindStartCode(annexB, length, 0);

  while (code < length) {
    size_t start = code + START_CODE_LENGTH;
    size_t next = FindStartCode(annexB, length, start);
    size_t size = WithoutTrailingZeros(annexB, start, next) - start;

    if (size > 0) {
      if (size > UINT32_MAX || capacity - written < LENGTH_PREFIX || capacity - written - LENGTH_PREFIX < size) return 0;
      out[written++] = (uint8_t)(size >> 24);
      out[written++] = (uint8_t)(size >> 16);
      out[written++] = (uint8_t)(size >> 8);
      out[written++] = (uint8_t)size;
      memcpy(out + written, annexB + start, size);
      written += size;
    }
    code = next;
  }
  return written;
}

const uint8_t *WakenFirstNAL(const uint8_t *annexB, size_t length, size_t *nalLength) {
  *nalLength = 0;
  size_t code = FindStartCode(annexB, length, 0);
  if (code == length) return NULL;

  size_t start = code + START_CODE_LENGTH;
  size_t end = WithoutTrailingZeros(annexB, start, FindStartCode(annexB, length, start));
  if (end == start) return NULL;

  *nalLength = end - start;
  return annexB + start;
}
