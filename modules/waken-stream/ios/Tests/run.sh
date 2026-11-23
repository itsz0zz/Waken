#!/bin/sh
# Tests of the module's pure logic, run on the Mac: no simulator, no Sunshine.
set -eu

ios_dir=$(cd "$(dirname "$0")/.." && pwd)
out_dir=$(mktemp -d "${TMPDIR:-/tmp}/waken-stream-tests.XXXXXX")
trap 'rm -f "$out_dir"/annexb "$out_dir"/opus "$out_dir"/input; rmdir "$out_dir" 2>/dev/null || true' EXIT

xcrun --sdk macosx clang -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-sanitize-recover=all \
  -I "$ios_dir/Bridge" "$ios_dir/Bridge/WakenAnnexB.c" "$ios_dir/Tests/AnnexBTests.c" -o "$out_dir/annexb"
"$out_dir/annexb"

xcrun --sdk macosx clang -fobjc-arc -Wall -Werror -Wno-four-char-constants \
  -I "$ios_dir/Bridge" -framework Foundation -framework AVFoundation -framework AudioToolbox \
  "$ios_dir/Bridge/WakenOpusDecoder.m" "$ios_dir/Tests/OpusTests.m" -o "$out_dir/opus"
"$out_dir/opus"

xcrun --sdk macosx swiftc -warnings-as-errors "$ios_dir/StreamInput.swift" "$ios_dir/Tests/main.swift" -o "$out_dir/input"
"$out_dir/input"
