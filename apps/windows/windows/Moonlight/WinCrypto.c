// OpenSSL's EVP functions as moonlight-common-c uses them (src/PlatformCrypto.c), on Windows' BCrypt.
//
// AES itself comes from BCrypt. GCM is built here on top of it: moonlight also uses 16-byte GCM IVs (input
// stream, older control streams), which BCrypt's GCM refuses (it only takes 12 bytes). The GHASH below is the
// usual 4-bit table method (as in mbed TLS), fast enough for every video packet.
//
// What PlatformCrypto.c expects, and what this file keeps:
//  - GCM encryption: EncryptUpdate returns the whole ciphertext, EncryptFinal nothing, GET_TAG the tag.
//  - GCM decryption: DecryptUpdate returns the whole plaintext, SET_TAG then DecryptFinal checks the tag.
//  - CBC encryption: the chain continues from one message to the next (input stream, padded by the caller).
//  - CBC decryption: one message per IV, PKCS#7 padding removed by DecryptFinal (audio).

#include <windows.h>
#include <bcrypt.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "openssl/evp.h"
#include "openssl/rand.h"

#pragma comment(lib, "bcrypt.lib")

enum Mode { MODE_NONE, MODE_GCM, MODE_CBC };

struct evp_cipher_st {
  enum Mode mode;
};

static const EVP_CIPHER kGcm = {MODE_GCM};
static const EVP_CIPHER kCbc = {MODE_CBC};

const EVP_CIPHER *EVP_aes_128_gcm(void) { return &kGcm; }
const EVP_CIPHER *EVP_aes_128_cbc(void) { return &kCbc; }

struct evp_cipher_ctx_st {
  enum Mode mode;
  BCRYPT_KEY_HANDLE ecb; // GCM: AES on single blocks
  BCRYPT_KEY_HANDLE cbc;
  unsigned char key[16];
  int hasKey;
  // GCM
  uint64_t hl[16], hh[16]; // GHASH tables for H = AES(0)
  unsigned char iv[16];
  int ivLen;
  unsigned char computedTag[16];
  unsigned char expectedTag[16];
  int expectedTagLen;
  // CBC
  unsigned char chain[16];
  unsigned char *pending; // decryption: the whole message, decrypted by Final
  int pendingLen;
  int pendingCap;
};

/* ---------- BCrypt providers, opened once ---------- */

static BCRYPT_ALG_HANDLE g_ecb, g_cbc;
static INIT_ONCE g_once = INIT_ONCE_STATIC_INIT;

static BOOL CALLBACK OpenProviders(PINIT_ONCE once, PVOID param, PVOID *context) {
  (void)once;
  (void)param;
  (void)context;
  if (!BCRYPT_SUCCESS(BCryptOpenAlgorithmProvider(&g_ecb, BCRYPT_AES_ALGORITHM, NULL, 0))) return FALSE;
  if (!BCRYPT_SUCCESS(BCryptSetProperty(g_ecb, BCRYPT_CHAINING_MODE, (PUCHAR)BCRYPT_CHAIN_MODE_ECB, sizeof(BCRYPT_CHAIN_MODE_ECB), 0))) return FALSE;
  if (!BCRYPT_SUCCESS(BCryptOpenAlgorithmProvider(&g_cbc, BCRYPT_AES_ALGORITHM, NULL, 0))) return FALSE;
  if (!BCRYPT_SUCCESS(BCryptSetProperty(g_cbc, BCRYPT_CHAINING_MODE, (PUCHAR)BCRYPT_CHAIN_MODE_CBC, sizeof(BCRYPT_CHAIN_MODE_CBC), 0))) return FALSE;
  return TRUE;
}

static int Providers(void) { return InitOnceExecuteOnce(&g_once, OpenProviders, NULL, NULL) ? 1 : 0; }

/* ---------- GHASH ---------- */

static uint64_t Load64(const unsigned char *p) {
  return ((uint64_t)p[0] << 56) | ((uint64_t)p[1] << 48) | ((uint64_t)p[2] << 40) | ((uint64_t)p[3] << 32) | ((uint64_t)p[4] << 24) |
      ((uint64_t)p[5] << 16) | ((uint64_t)p[6] << 8) | (uint64_t)p[7];
}

static void Store64(unsigned char *p, uint64_t v) {
  for (int i = 7; i >= 0; i--) {
    p[i] = (unsigned char)v;
    v >>= 8;
  }
}

static void GhashTable(struct evp_cipher_ctx_st *c, const unsigned char h[16]) {
  uint64_t vh = Load64(h), vl = Load64(h + 8);
  c->hl[8] = vl;
  c->hh[8] = vh;
  c->hl[0] = 0;
  c->hh[0] = 0;
  for (int i = 4; i > 0; i >>= 1) {
    uint32_t t = (uint32_t)(vl & 1) * 0xe1000000U;
    vl = (vh << 63) | (vl >> 1);
    vh = (vh >> 1) ^ ((uint64_t)t << 32);
    c->hl[i] = vl;
    c->hh[i] = vh;
  }
  for (int i = 2; i <= 8; i *= 2) {
    uint64_t *hil = c->hl + i, *hih = c->hh + i;
    vh = *hih;
    vl = *hil;
    for (int j = 1; j < i; j++) {
      hih[j] = vh ^ c->hh[j];
      hil[j] = vl ^ c->hl[j];
    }
  }
}

static const uint64_t kLast4[16] = {0x0000, 0x1c20, 0x3840, 0x2460, 0x7080, 0x6ca0, 0x48c0, 0x54e0,
                                    0xe100, 0xfd20, 0xd940, 0xc560, 0x9180, 0x8da0, 0xa9c0, 0xb5e0};

/// x = x * H in GF(2^128).
static void GhashMultiply(const struct evp_cipher_ctx_st *c, unsigned char x[16]) {
  unsigned char lo = x[15] & 0xf, hi, rem;
  uint64_t zh = c->hh[lo], zl = c->hl[lo];
  for (int i = 15; i >= 0; i--) {
    lo = x[i] & 0xf;
    hi = (x[i] >> 4) & 0xf;
    if (i != 15) {
      rem = (unsigned char)(zl & 0xf);
      zl = (zh << 60) | (zl >> 4);
      zh = (zh >> 4) ^ (kLast4[rem] << 48);
      zh ^= c->hh[lo];
      zl ^= c->hl[lo];
    }
    rem = (unsigned char)(zl & 0xf);
    zl = (zh << 60) | (zl >> 4);
    zh = (zh >> 4) ^ (kLast4[rem] << 48);
    zh ^= c->hh[hi];
    zl ^= c->hl[hi];
  }
  Store64(x, zh);
  Store64(x + 8, zl);
}

/// y = GHASH(y, data), the data padded with zeros to whole blocks.
static void GhashUpdate(const struct evp_cipher_ctx_st *c, unsigned char y[16], const unsigned char *data, size_t length) {
  while (length > 0) {
    size_t n = length < 16 ? length : 16;
    for (size_t i = 0; i < n; i++) y[i] ^= data[i];
    GhashMultiply(c, y);
    data += n;
    length -= n;
  }
}

/* ---------- AES blocks ---------- */

static int AesBlocks(BCRYPT_KEY_HANDLE key, const unsigned char *in, unsigned char *out, ULONG length) {
  ULONG done = 0;
  return BCRYPT_SUCCESS(BCryptEncrypt(key, (PUCHAR)in, length, NULL, NULL, 0, out, length, &done, 0)) && done == length;
}

static void Increment32(unsigned char block[16]) {
  for (int i = 15; i >= 12; i--) {
    if (++block[i] != 0) break;
  }
}

/// J0, the first counter block, from the IV (12 bytes: IV || 1, else GHASH of the IV and its length).
static void FirstCounter(const struct evp_cipher_ctx_st *c, unsigned char j0[16]) {
  memset(j0, 0, 16);
  if (c->ivLen == 12) {
    memcpy(j0, c->iv, 12);
    j0[15] = 1;
    return;
  }
  GhashUpdate(c, j0, c->iv, (size_t)c->ivLen);
  unsigned char lengths[16] = {0};
  Store64(lengths + 8, (uint64_t)c->ivLen * 8);
  GhashUpdate(c, j0, lengths, 16);
}

/// GCM over one message: out = in XOR keystream, and the tag over the ciphertext (in when decrypting, out when
/// encrypting). No additional data: moonlight never sends any.
static int GcmCrypt(struct evp_cipher_ctx_st *c, const unsigned char *in, unsigned char *out, int length, int encrypt) {
  unsigned char j0[16], counter[16], ghash[16] = {0};
  FirstCounter(c, j0);
  memcpy(counter, j0, 16);

  // The keystream, 64 blocks per BCrypt call.
  unsigned char blocks[64 * 16], stream[64 * 16];
  int offset = 0;
  while (offset < length) {
    int chunk = length - offset < (int)sizeof(blocks) ? length - offset : (int)sizeof(blocks);
    int count = (chunk + 15) / 16;
    for (int b = 0; b < count; b++) {
      Increment32(counter);
      memcpy(blocks + b * 16, counter, 16);
    }
    if (!AesBlocks(c->ecb, blocks, stream, (ULONG)(count * 16))) return 0;
    if (!encrypt) GhashUpdate(c, ghash, in + offset, (size_t)chunk);
    for (int i = 0; i < chunk; i++) out[offset + i] = in[offset + i] ^ stream[i];
    if (encrypt) GhashUpdate(c, ghash, out + offset, (size_t)chunk);
    offset += chunk;
  }

  unsigned char lengths[16] = {0};
  Store64(lengths + 8, (uint64_t)length * 8);
  GhashUpdate(c, ghash, lengths, 16);
  unsigned char ekj0[16];
  if (!AesBlocks(c->ecb, j0, ekj0, 16)) return 0;
  for (int i = 0; i < 16; i++) c->computedTag[i] = ghash[i] ^ ekj0[i];
  return 1;
}

/* ---------- EVP ---------- */

EVP_CIPHER_CTX *EVP_CIPHER_CTX_new(void) {
  if (!Providers()) return NULL;
  return (EVP_CIPHER_CTX *)calloc(1, sizeof(struct evp_cipher_ctx_st));
}

void EVP_CIPHER_CTX_free(EVP_CIPHER_CTX *c) {
  if (!c) return;
  if (c->ecb) BCryptDestroyKey(c->ecb);
  if (c->cbc) BCryptDestroyKey(c->cbc);
  SecureZeroMemory(c->key, sizeof(c->key));
  free(c->pending);
  free(c);
}

static int SetKey(struct evp_cipher_ctx_st *c, const unsigned char *key) {
  if (c->hasKey && memcmp(c->key, key, 16) == 0) return 1;
  if (c->ecb) BCryptDestroyKey(c->ecb);
  if (c->cbc) BCryptDestroyKey(c->cbc);
  c->ecb = c->cbc = NULL;
  if (!BCRYPT_SUCCESS(BCryptGenerateSymmetricKey(g_ecb, &c->ecb, NULL, 0, (PUCHAR)key, 16, 0))) return 0;
  if (!BCRYPT_SUCCESS(BCryptGenerateSymmetricKey(g_cbc, &c->cbc, NULL, 0, (PUCHAR)key, 16, 0))) return 0;
  memcpy(c->key, key, 16);
  c->hasKey = 1;
  unsigned char zero[16] = {0}, h[16];
  if (!AesBlocks(c->ecb, zero, h, 16)) return 0;
  GhashTable(c, h);
  return 1;
}

static int Init(EVP_CIPHER_CTX *c, const EVP_CIPHER *cipher, const unsigned char *key, const unsigned char *iv) {
  if (!c) return 0;
  if (cipher) {
    c->mode = cipher->mode;
    if (c->mode == MODE_GCM && c->ivLen == 0) c->ivLen = 12;
  }
  if (key && !SetKey(c, key)) return 0;
  if (iv) {
    if (c->mode == MODE_GCM) memcpy(c->iv, iv, (size_t)c->ivLen);
    else memcpy(c->chain, iv, 16);
  }
  c->pendingLen = 0;
  return 1;
}

int EVP_EncryptInit_ex(EVP_CIPHER_CTX *c, const EVP_CIPHER *cipher, ENGINE *impl, const unsigned char *key, const unsigned char *iv) {
  (void)impl;
  return Init(c, cipher, key, iv);
}

int EVP_DecryptInit_ex(EVP_CIPHER_CTX *c, const EVP_CIPHER *cipher, ENGINE *impl, const unsigned char *key, const unsigned char *iv) {
  (void)impl;
  return Init(c, cipher, key, iv);
}

int EVP_CIPHER_CTX_ctrl(EVP_CIPHER_CTX *c, int type, int arg, void *ptr) {
  switch (type) {
    case EVP_CTRL_GCM_SET_IVLEN:
      if (arg <= 0 || arg > 16) return 0;
      c->ivLen = arg;
      return 1;
    case EVP_CTRL_GCM_GET_TAG:
      if (arg <= 0 || arg > 16) return 0;
      memcpy(ptr, c->computedTag, (size_t)arg);
      return 1;
    case EVP_CTRL_GCM_SET_TAG:
      if (arg <= 0 || arg > 16) return 0;
      memcpy(c->expectedTag, ptr, (size_t)arg);
      c->expectedTagLen = arg;
      return 1;
    default:
      return 0;
  }
}

int EVP_EncryptUpdate(EVP_CIPHER_CTX *c, unsigned char *out, int *outl, const unsigned char *in, int inl) {
  *outl = 0;
  if (!c->hasKey || inl < 0) return 0;
  if (c->mode == MODE_GCM) {
    if (!GcmCrypt(c, in, out, inl, 1)) return 0;
    *outl = inl;
    return 1;
  }
  // CBC: whole blocks only (moonlight pads them itself), the chain carried to the next message.
  if (c->mode != MODE_CBC || inl % 16 != 0) return 0;
  ULONG done = 0;
  if (!BCRYPT_SUCCESS(BCryptEncrypt(c->cbc, (PUCHAR)in, (ULONG)inl, NULL, c->chain, 16, out, (ULONG)inl, &done, 0))) return 0;
  *outl = (int)done;
  return 1;
}

int EVP_EncryptFinal_ex(EVP_CIPHER_CTX *c, unsigned char *out, int *outl) {
  (void)c;
  (void)out;
  *outl = 0;
  return 1;
}

int EVP_DecryptUpdate(EVP_CIPHER_CTX *c, unsigned char *out, int *outl, const unsigned char *in, int inl) {
  *outl = 0;
  if (!c->hasKey || inl < 0) return 0;
  if (c->mode == MODE_GCM) {
    if (!GcmCrypt(c, in, out, inl, 0)) return 0;
    *outl = inl;
    return 1;
  }
  if (c->mode != MODE_CBC) return 0;
  // CBC with padding: kept until Final, which removes the padding (as OpenSSL holds back the last block).
  if (c->pendingLen + inl > c->pendingCap) {
    int cap = c->pendingLen + inl + 64;
    unsigned char *grown = (unsigned char *)realloc(c->pending, (size_t)cap);
    if (!grown) return 0;
    c->pending = grown;
    c->pendingCap = cap;
  }
  memcpy(c->pending + c->pendingLen, in, (size_t)inl);
  c->pendingLen += inl;
  return 1;
}

int EVP_DecryptFinal_ex(EVP_CIPHER_CTX *c, unsigned char *out, int *outl) {
  *outl = 0;
  if (c->mode == MODE_GCM) {
    // Constant time: a wrong tag must not say where it differs.
    unsigned char diff = 0;
    if (c->expectedTagLen <= 0) return 0;
    for (int i = 0; i < c->expectedTagLen; i++) diff |= (unsigned char)(c->computedTag[i] ^ c->expectedTag[i]);
    return diff == 0;
  }
  if (c->mode != MODE_CBC || c->pendingLen == 0 || c->pendingLen % 16 != 0) return 0;
  ULONG done = 0;
  if (!BCRYPT_SUCCESS(BCryptDecrypt(c->cbc, c->pending, (ULONG)c->pendingLen, NULL, c->chain, 16, c->pending, (ULONG)c->pendingLen, &done, 0))) return 0;
  unsigned char pad = c->pending[c->pendingLen - 1];
  if (pad == 0 || pad > 16) return 0;
  for (int i = 0; i < pad; i++) {
    if (c->pending[c->pendingLen - 1 - i] != pad) return 0;
  }
  int length = c->pendingLen - pad;
  memcpy(out, c->pending, (size_t)length);
  *outl = length;
  c->pendingLen = 0;
  return 1;
}

int RAND_bytes(unsigned char *buf, int num) {
  return num >= 0 && BCRYPT_SUCCESS(BCryptGenRandom(NULL, buf, (ULONG)num, BCRYPT_USE_SYSTEM_PREFERRED_RNG)) ? 1 : 0;
}
