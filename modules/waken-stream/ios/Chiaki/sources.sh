#!/bin/sh
# The C files of Waken's libchiaki, relative to the repository: chiaki's core for the home network, its protocol
# messages (nanopb), its error correction (jerasure, gf-complete), mbedtls for the crypto, and the stubs.
here=$(cd "$(dirname "$0")" && pwd)
v="$here/../vendor"
c="$v/chiaki-ng"
for f in "$c"/lib/src/*.c; do
  case "$(basename "$f")" in
    aia.c|aia_openssl.c|ffmpegdecoder.c|pidecoder.c|opusdecoder.c|opusencoder.c) ;;
    *) echo "$f" ;;
  esac
done
echo "$c/lib/src/remote/rudpsendbuffer.c"
echo "$here/remote_stubs.c"
echo "$here/generated/takion.pb.c"
for f in pb_common.c pb_encode.c pb_decode.c; do echo "$c/third-party/nanopb/$f"; done
for f in galois.c jerasure.c reed_sol.c cauchy.c liberation.c; do echo "$c/third-party/jerasure/src/$f"; done
for f in gf.c gf_wgen.c gf_w4.c gf_w8.c gf_w16.c gf_w32.c gf_w64.c gf_w128.c gf_rand.c gf_general.c gf_cpu.c; do echo "$c/third-party/gf-complete/src/$f"; done
for f in "$v"/mbedtls/library/*.c; do echo "$f"; done
