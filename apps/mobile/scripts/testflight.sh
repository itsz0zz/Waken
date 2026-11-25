#!/bin/sh
# Sends the iPhone and iPad app to TestFlight: a Release archive, exported for App Store Connect and uploaded with
# the Apple account signed in to Xcode. Each upload gets a build number of its own (the moment it was built).
#
#   sh apps/mobile/scripts/testflight.sh
#
# Needs once: the app fr.wakenplay.app created in App Store Connect (Apps, +, New app), and Xcode signed in to the
# team's account. Then App Store Connect, TestFlight: the build shows after Apple's processing (a few minutes).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
cache="$here/.cache"
archive="$cache/Waken-ios.xcarchive"
team=BPA8N94FHP
build=$(date +%Y%m%d%H%M)
mkdir -p "$cache"

(cd "$here/ios" && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install >/dev/null)

printf '== Archive (build %s)\n' "$build"
rm -rf "$archive"
xcodebuild -workspace "$here/ios/Waken.xcworkspace" -scheme Waken -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$archive" -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$build" archive >"$cache/testflight.log" 2>&1 \
  || { grep -E "error:" "$cache/testflight.log" | sort -u | head -20; exit 1; }

printf '== Envoi à App Store Connect\n'
cat > "$cache/ExportOptions-ios.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$team</string>
</dict>
</plist>
PLIST
rm -rf "$cache/export-ios"
xcodebuild -exportArchive -archivePath "$archive" -exportPath "$cache/export-ios" \
  -exportOptionsPlist "$cache/ExportOptions-ios.plist" -allowProvisioningUpdates >>"$cache/testflight.log" 2>&1 \
  || { grep -iE "error" "$cache/testflight.log" | sort -u | tail -20; exit 1; }
printf '\nBuild %s envoyé : il apparaît dans TestFlight après le traitement d’Apple.\n' "$build"
