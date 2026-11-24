#!/bin/sh
# Builds apps/macos/build/Waken.app: the React Native app with the stream server (Sunshine), the Waken agent
# and the Waken network inside. Nothing else to install on the Mac.
#
# WAKEN_VERSION=1.2.3 (scripts/release.sh): a release build instead, Xcode's export for Developer ID, the version,
# Sparkle's feed and key (release.json), every program signed for notarization.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$here/../.." && pwd)
cache="$here/.cache"
out="$here/build"
derived="$cache/derived"

sunshine_version=v2026.914.233613
sunshine_sha256=795f03a389c5726f9a7b15f501dc1ddf204b442cae565859ac83aae027a9e07c
sunshine_team=F8XQ7XCN2R   # LizardByte LLC
runtime=10.0.15

version="${WAKEN_VERSION:-}"
team=BPA8N94FHP

# 1. The app itself (JavaScript bundled in by the "Bundle React Native code" phase).
mkdir -p "$cache"
(cd "$here/macos" && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install >/dev/null)
if [ -n "$version" ]; then
  # A release: Xcode's own export for Developer ID. It brings the profile push notifications and Sign in with
  # Apple need outside the App Store, and signs the frameworks with the hardened runtime notarization asks for.
  archive="$cache/Waken.xcarchive"
  exported="$cache/export"
  rm -rf "$archive" "$exported"
  cat > "$cache/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>developer-id</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$team</string>
</dict>
</plist>
PLIST
  xcodebuild -workspace "$here/macos/Waken.xcworkspace" -scheme Waken-macOS -configuration Release \
    -archivePath "$archive" -allowProvisioningUpdates ENABLE_HARDENED_RUNTIME=YES archive >"$cache/xcodebuild.log" 2>&1 \
    || { grep -E "error:" "$cache/xcodebuild.log" | sort -u | head -20; exit 1; }
  xcodebuild -exportArchive -archivePath "$archive" -exportPath "$exported" -exportOptionsPlist "$cache/ExportOptions.plist" \
    -allowProvisioningUpdates >>"$cache/xcodebuild.log" 2>&1 \
    || { grep -E "error" "$cache/xcodebuild.log" | sort -u | tail -20; exit 1; }
  built="$exported/Waken.app"
else
  xcodebuild -workspace "$here/macos/Waken.xcworkspace" -scheme Waken-macOS -configuration Release \
    -derivedDataPath "$derived" -allowProvisioningUpdates build >"$cache/xcodebuild.log" 2>&1 \
    || { grep -E "error:" "$cache/xcodebuild.log" | sort -u | head -20; exit 1; }
  built="$derived/Build/Products/Release/Waken.app"
fi
rm -rf "$out"
mkdir -p "$out"
ditto "$built" "$out/Waken.app"
app="$out/Waken.app"
res="$app/Contents/Resources"

# 2. Sunshine, checked against its published checksum and LizardByte's signature.
mkdir -p "$cache"
dmg="$cache/Sunshine-$sunshine_version-arm64.dmg"
if [ ! -f "$dmg" ]; then
  curl -fsSL -o "$dmg.part" "https://github.com/SunshineStream/Sunshine/releases/download/$sunshine_version/Sunshine-macOS-arm64.dmg"
  mv "$dmg.part" "$dmg"
fi
echo "$sunshine_sha256  $dmg" | shasum -a 256 -c - >/dev/null
mount=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$dmg" >/dev/null
trap 'hdiutil detach "$mount" >/dev/null 2>&1 || true; rmdir "$mount" 2>/dev/null || true' EXIT
ditto "$mount/Sunshine.app" "$res/Sunshine.app"
codesign --verify --deep --strict "$res/Sunshine.app"
codesign -dv "$res/Sunshine.app" 2>&1 | grep -q "TeamIdentifier=$sunshine_team"

# 3. The agent, self-contained: no .NET to install. Latest runtime patch, not the SDK's own.
props="$cache/runtime.props"
cat > "$props" <<PROPS
<Project>
  <ItemGroup>
    <KnownFrameworkReference Update="Microsoft.NETCore.App" LatestRuntimeFrameworkVersion="$runtime" />
    <KnownFrameworkReference Update="Microsoft.AspNetCore.App" LatestRuntimeFrameworkVersion="$runtime" />
  </ItemGroup>
</Project>
PROPS
dotnet publish "$repo/agent/Waken.Agent" -c Release -r osx-arm64 --self-contained true \
  -p:TargetLatestRuntimePatch=true -p:CustomAfterMicrosoftCommonTargets="$props" -o "$res/agent" >/dev/null

# 4. SteamGridDB key (covers of every game), from $STEAMGRIDDB_KEY or ~/.config/waken/steamgriddb.key.
key_file="${HOME}/.config/waken/steamgriddb.key"
if [ -n "${STEAMGRIDDB_KEY:-}" ]; then
  printf '%s' "$STEAMGRIDDB_KEY" > "$res/steamgriddb.key"
elif [ -f "$key_file" ]; then
  tr -d '[:space:]' < "$key_file" > "$res/steamgriddb.key"
else
  echo "Pas de clé SteamGridDB : seuls les jeux Steam auront leur pochette." >&2
fi

# 5. The Waken network.
sh "$repo/tunnel/build.sh" >/dev/null
cp "$repo/tunnel/build/waken-tunnel" "$res/waken-tunnel"

# A build number of its own (the moment it was built): macOS keeps app icons by identifier and version, and an
# entry made when the app had none (or for the old host-only app, same identifier) would otherwise stay.
# Sparkle also compares it: always growing, a later build is a newer one.
plist="$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $(date +%Y%m%d.%H%M)" "$plist"

if [ -n "$version" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$plist"
  # Sparkle: the appcast of the latest GitHub release, and the public half of the key that signs the DMGs.
  github=$(plutil -extract githubRepo raw -o - "$repo/release.json" 2>/dev/null || true)
  sparkle_key=$(plutil -extract sparklePublicKey raw -o - "$repo/release.json" 2>/dev/null || true)
  if [ -n "$github" ] && [ -n "$sparkle_key" ]; then
    for key in SUFeedURL SUPublicEDKey SUEnableAutomaticChecks; do /usr/libexec/PlistBuddy -c "Delete :$key" "$plist" 2>/dev/null || true; done
    /usr/libexec/PlistBuddy -c "Add :SUFeedURL string https://github.com/$github/releases/latest/download/appcast.xml" "$plist"
    /usr/libexec/PlistBuddy -c "Add :SUPublicEDKey string $sparkle_key" "$plist"
    /usr/libexec/PlistBuddy -c "Add :SUEnableAutomaticChecks bool true" "$plist"
  else
    echo "Pas de githubRepo ou de sparklePublicKey dans release.json : cette app ne se mettra pas à jour." >&2
  fi

  # 6. Signature for notarization: Developer ID, hardened runtime, Apple's timestamp, inside out. Sunshine keeps
  # LizardByte's (Developer ID too), the frameworks Xcode's export.
  identity=$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -1)
  if [ -z "$identity" ]; then
    echo "Pas de certificat « Developer ID Application » : Xcode, Réglages, Comptes, Gérer les certificats, +." >&2
    exit 1
  fi
  find "$res/agent" -type f | while read -r file; do
    if file "$file" | grep -q "Mach-O"; then
      if [ "$file" = "$res/agent/Waken.Agent" ]; then
        codesign --force --sign "$identity" --options runtime --timestamp --entitlements "$here/scripts/agent.entitlements" "$file"
      else
        codesign --force --sign "$identity" --options runtime --timestamp "$file"
      fi
    fi
  done
  codesign --force --sign "$identity" --options runtime --timestamp "$res/waken-tunnel"
  codesign --force --sign "$identity" --options runtime --timestamp --preserve-metadata=entitlements "$app"
  codesign --verify --deep --strict "$app"
else
  # 6. Signature: the developer certificate keeps macOS permissions from one build to the next.
  # Sunshine keeps LizardByte's signature.
  identity=$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' | head -1)
  identity=${WAKEN_SIGN_IDENTITY:-${identity:--}}
  for code in "$res/agent/Waken.Agent" "$res/waken-tunnel" "$app"; do
    codesign --force --sign "$identity" --timestamp=none --preserve-metadata=entitlements "$code"
  done
fi

# 7. The Dock and the Finder take the icon from macOS's register of apps: this copy is the one for its identifier,
# not the build's intermediate copy (nor the old host-only app of apps/mac, which has no icon).
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
if [ -x "$lsregister" ]; then
  "$lsregister" -u "$derived/Build/Products/Release/Waken.app" >/dev/null 2>&1 || true
  "$lsregister" -u "$repo/apps/mac/build/Waken.app" >/dev/null 2>&1 || true
  "$lsregister" -f "$app" >/dev/null 2>&1 || true
fi
echo "$app"
