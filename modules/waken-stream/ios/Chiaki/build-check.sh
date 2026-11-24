#!/bin/sh
# Compiles Waken's libchiaki (home network streaming) with the host's clang, to check it before the apps build it.
#   sh modules/waken-stream/chiaki/build-check.sh [target]   (default: arm64-apple-macos14.0)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
v="$here/../vendor"
c="$v/chiaki-ng"
target=${1:-arm64-apple-macos14.0}
out=${OUT:-$(mktemp -d)}
flags="-target $target -O1 -w -DCHIAKI_LIB_ENABLE_MBEDTLS -DPB_C99_STATIC_ASSERT -DCHIAKI_VERSION=\"waken\" -DCHIAKI_VERSION_MAJOR=1 -DCHIAKI_VERSION_MINOR=10 -DCHIAKI_VERSION_PATCH=1
  -I$here/include -I$here/generated -I$c/lib/include -I$c/lib/src -I$c/third-party/nanopb -I$c/third-party/jerasure/include
  -I$c/third-party/gf-complete/include -I$v/mbedtls/include"
for f in $(sh "$here/sources.sh"); do
  clang $flags -c "$f" -o "$out/$(echo "$f" | tr '/' '_').o" || { echo "ÉCHEC : $f"; exit 1; }
done
echo "libchiaki : $(ls "$out" | wc -l | tr -d ' ') fichiers compilés pour $target"
