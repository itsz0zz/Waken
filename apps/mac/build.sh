#!/bin/sh
# Builds apps/mac/build/Waken.app: the Mac app with the stream server (Sunshine) and the Waken agent inside.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
build="$here/build"
cache="$here/.cache"
app="$build/Waken.app"

sunshine_version=v2026.914.233613
sunshine_sha256=795f03a389c5726f9a7b15f501dc1ddf204b442cae565859ac83aae027a9e07c
sunshine_team=F8XQ7XCN2R   # LizardByte LLC
runtime=10.0.15

mkdir -p "$cache"
dmg="$cache/Sunshine-$sunshine_version-arm64.dmg"
if [ ! -f "$dmg" ]; then
  curl -fsSL -o "$dmg.part" "https://github.com/SunshineStream/Sunshine/releases/download/$sunshine_version/Sunshine-macOS-arm64.dmg"
  mv "$dmg.part" "$dmg"
fi
echo "$sunshine_sha256  $dmg" | shasum -a 256 -c - >/dev/null

rm -rf "$build"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$here/Info.plist" "$app/Contents/Info.plist"

mount=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$dmg" >/dev/null
trap 'hdiutil detach "$mount" >/dev/null 2>&1 || true; rmdir "$mount" 2>/dev/null || true' EXIT
ditto "$mount/Sunshine.app" "$app/Contents/Resources/Sunshine.app"
codesign --verify --deep --strict "$app/Contents/Resources/Sunshine.app"
codesign -dv "$app/Contents/Resources/Sunshine.app" 2>&1 | grep -q "TeamIdentifier=$sunshine_team"

# Self-contained agent: no .NET to install. Latest runtime patch, not the SDK's own.
props="$build/runtime.props"
cat > "$props" <<EOF
<Project>
  <ItemGroup>
    <KnownFrameworkReference Update="Microsoft.NETCore.App" LatestRuntimeFrameworkVersion="$runtime" />
    <KnownFrameworkReference Update="Microsoft.AspNetCore.App" LatestRuntimeFrameworkVersion="$runtime" />
  </ItemGroup>
</Project>
EOF
dotnet publish "$repo/agent/Waken.Agent" -c Release -r osx-arm64 --self-contained true \
  -p:TargetLatestRuntimePatch=true -p:CustomAfterMicrosoftCommonTargets="$props" \
  -o "$app/Contents/Resources/agent" >/dev/null

# SteamGridDB key (covers, banners and logos for every game), embedded so nobody has to type it.
# Read from $STEAMGRIDDB_KEY or ~/.config/waken/steamgriddb.key, never from the repository.
key_file="${HOME}/.config/waken/steamgriddb.key"
if [ -n "${STEAMGRIDDB_KEY:-}" ]; then
  printf '%s' "$STEAMGRIDDB_KEY" > "$app/Contents/Resources/steamgriddb.key"
elif [ -f "$key_file" ]; then
  tr -d '[:space:]' < "$key_file" > "$app/Contents/Resources/steamgriddb.key"
else
  echo "Pas de clé SteamGridDB : seuls les jeux Steam auront leur pochette." >&2
fi

# The Waken network (embedded Tailscale node): built from tunnel/, Go module cache shared with other builds.
sh "$repo/tunnel/build.sh" >/dev/null
cp "$repo/tunnel/build/waken-tunnel" "$app/Contents/Resources/waken-tunnel"

xcrun --sdk macosx swiftc -O -target arm64-apple-macos14.0 "$here/Sources/main.swift" -o "$app/Contents/MacOS/Waken"

# Signs Waken itself only: the embedded Sunshine keeps LizardByte's notarized signature.
# With a developer certificate, macOS recognises Waken from one build to the next and keeps its
# permissions (screen recording, accessibility). Ad hoc signing ("-") makes every build a new app.
identity=$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' | head -1)
identity=${WAKEN_SIGN_IDENTITY:-${identity:--}}
for code in "$app/Contents/Resources/agent/Waken.Agent" "$app/Contents/Resources/waken-tunnel" "$app"; do
  codesign --force --sign "$identity" --timestamp=none "$code"
done
echo "$app"
