// RAND_bytes for moonlight-common-c, on Windows' system random generator (see WinCrypto.c).
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

int RAND_bytes(unsigned char *buf, int num);

#ifdef __cplusplus
}
#endif
