#!/bin/sh
# Builds the Waken tunnel:
#   build/waken-tunnel            helper for the desktop apps (macOS arm64)
#   build/WakenTunnel.xcframework static library for iOS (device and simulator)
# Uses `go` from PATH when it is the pinned version, else the copy in .cache/go.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
version=go1.27.4
if command -v go >/dev/null 2>&1 && [ "$(go env GOVERSION)" = "$version" ]; then
  go=go
elif [ -x "$here/.cache/go/bin/go" ]; then
  go="$here/.cache/go/bin/go"
else
  echo "Go $version introuvable : installe-le (brew install go) ou place-le dans tunnel/.cache/go." >&2
  exit 1
fi
export GOTOOLCHAIN=local CGO_ENABLED=1
# Modules and build cache next to the code, so a build never depends on the user's Go setup.
export GOMODCACHE="${GOMODCACHE:-$here/.cache/gomod}" GOCACHE="${GOCACHE:-$here/.cache/gocache}"

mkdir -p build
"$go" build -trimpath -ldflags="-s -w" -o build/waken-tunnel ./cmd/waken-tunnel

ios_min=17.0
archive() { # sdk target-triple output-dir
  sdk_path=$(xcrun --sdk "$1" --show-sdk-path)
  out="build/ios/$3"
  mkdir -p "$out"
  GOOS=ios GOARCH=arm64 \
    CC="$(xcrun --sdk "$1" -f clang) -isysroot $sdk_path -target $2" \
    CGO_CFLAGS="-isysroot $sdk_path -target $2" CGO_LDFLAGS="-isysroot $sdk_path -target $2" \
    "$go" build -trimpath -ldflags="-s -w" -buildmode=c-archive -o "$out/libwakennet.a" ./capi
  mkdir -p "$out/include"
  mv "$out/libwakennet.h" "$out/include/WakenTunnel.h"
  printf 'module WakenTunnelC {\n  header "WakenTunnel.h"\n  export *\n}\n' > "$out/include/module.modulemap"
}
archive iphoneos "arm64-apple-ios$ios_min" device
archive iphonesimulator "arm64-apple-ios$ios_min-simulator" simulator

rm -rf build/WakenTunnel.xcframework
xcodebuild -create-xcframework \
  -library build/ios/device/libwakennet.a -headers build/ios/device/include \
  -library build/ios/simulator/libwakennet.a -headers build/ios/simulator/include \
  -output build/WakenTunnel.xcframework >/dev/null
# The iOS app links it through the waken-tunnel module.
rm -rf "$here/../modules/waken-tunnel/ios/WakenTunnel.xcframework"
cp -R build/WakenTunnel.xcframework "$here/../modules/waken-tunnel/ios/"
echo "build/waken-tunnel et build/WakenTunnel.xcframework prêts"
