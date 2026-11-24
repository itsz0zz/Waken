#!/bin/sh
# Publishes Waken for Mac: a release build (Developer ID, hardened runtime), notarized by Apple, in a notarized DMG,
# signed for Sparkle, with the appcast the installed apps read; all on the GitHub release vX.Y.Z of release.json's
# repository. A draft until --publish: Windows' release.ps1 adds its installer to the same release.
#
#   sh apps/macos/scripts/release.sh 0.3.0
#   sh apps/macos/scripts/release.sh 0.3.0 --publish
#
# Needs once:
#   - a "Developer ID Application" certificate (Xcode, Réglages, Comptes, Gérer les certificats, +);
#   - Apple's notary service in the keychain, under the name waken-notary (an app-specific password from
#     account.apple.com):  xcrun notarytool store-credentials waken-notary --apple-id <e-mail> --team-id BPA8N94FHP
#   - Sparkle's key: apps/macos/macos/Pods/Sparkle/bin/generate_keys keeps its private half in the keychain and
#     prints the public one, for sparklePublicKey in release.json;
#   - gh signed in (brew install gh, then gh auth login) and githubRepo in release.json.
# The tag starts from Forgejo (origin): its mirror copies it to GitHub, which must never get tags of its own.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$here/../.." && pwd)
version=${1:-}
publish=${2:-}
case "$version" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "Usage : sh apps/macos/scripts/release.sh 1.2.3 [--publish]" >&2; exit 1 ;;
esac
tag="v$version"
step() { printf '\n== %s\n' "$1"; }
fail() { echo "$1" >&2; exit 1; }

github=$(plutil -extract githubRepo raw -o - "$repo/release.json" 2>/dev/null || true)
sparkle_key=$(plutil -extract sparklePublicKey raw -o - "$repo/release.json" 2>/dev/null || true)
[ -n "$github" ] || fail 'Renseigne githubRepo dans release.json (par exemple "moncompte/waken").'
sparkle_bin="$here/macos/Pods/Sparkle/bin"
[ -n "$sparkle_key" ] || fail "Renseigne sparklePublicKey dans release.json : lance $sparkle_bin/generate_keys et copie la clé publique affichée."
command -v gh >/dev/null || fail 'gh introuvable : brew install gh, puis gh auth login.'
gh auth status >/dev/null 2>&1 || fail "gh n'est pas connecté : lance gh auth login."
xcrun notarytool history --keychain-profile waken-notary >/dev/null 2>&1 \
  || fail 'Pas de profil waken-notary : xcrun notarytool store-credentials waken-notary --apple-id <e-mail> --team-id BPA8N94FHP'

step "Tag $tag (Forgejo, puis GitHub par le miroir)"
if [ -n "$(git -C "$repo" status --porcelain --untracked-files=no)" ]; then
  echo "Attention : des fichiers modifiés ne sont pas commités, ils seront dans ce build sans être dans le tag."
fi
git -C "$repo" rev-parse -q --verify "refs/tags/$tag" >/dev/null || git -C "$repo" tag -a "$tag" -m "Waken $version"
git -C "$repo" push origin "$tag"
seen=0
for _ in $(seq 60); do
  if gh api "repos/$github/git/ref/tags/$tag" >/dev/null 2>&1; then seen=1; break; fi
  echo 'En attente du miroir Forgejo vers GitHub...'
  sleep 5
done
[ "$seen" = 1 ] || fail "GitHub n'a pas le tag $tag après 5 minutes : vérifie le miroir (Forgejo, Paramètres, Miroirs)."

step "Build de Waken $version (Developer ID)"
WAKEN_VERSION="$version" sh "$here/scripts/build.sh"
app="$here/build/Waken.app"
identity=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -1)
dist="$here/dist"
rm -rf "$dist"
mkdir -p "$dist"

step "Notarisation de l'app"
ditto -c -k --keepParent "$app" "$dist/Waken.zip"
xcrun notarytool submit "$dist/Waken.zip" --keychain-profile waken-notary --wait
xcrun stapler staple "$app"
rm "$dist/Waken.zip"

step 'DMG'
dmg="$dist/Waken-$version.dmg"
staging=$(mktemp -d)
ditto "$app" "$staging/Waken.app"
ln -s /Applications "$staging/Applications"
hdiutil create -volname "Waken" -srcfolder "$staging" -ov -format UDZO "$dmg" >/dev/null
rm -rf "$staging"
codesign --force --sign "$identity" --timestamp "$dmg"
xcrun notarytool submit "$dmg" --keychain-profile waken-notary --wait
xcrun stapler staple "$dmg"
cp "$dmg" "$dist/Waken-macOS.dmg"

step 'Sparkle (signature et appcast)'
# The private key never leaves the keychain: sign_update reads it there.
signature=$("$sparkle_bin/sign_update" "$dmg")
build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Contents/Info.plist")
minimum=$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app/Contents/Info.plist")
cat > "$dist/appcast.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Waken</title>
    <item>
      <title>Waken $version</title>
      <pubDate>$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')</pubDate>
      <link>https://github.com/$github/releases/tag/$tag</link>
      <sparkle:version>$build</sparkle:version>
      <sparkle:shortVersionString>$version</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>$minimum</sparkle:minimumSystemVersion>
      <enclosure url="https://github.com/$github/releases/download/$tag/Waken-$version.dmg" type="application/octet-stream" $signature />
    </item>
  </channel>
</rss>
XML

step "Release GitHub $tag"
notes="$repo/docs/releases/$version.md"
if ! gh release view "$tag" --repo "$github" >/dev/null 2>&1; then
  if [ -f "$notes" ]; then
    gh release create "$tag" --repo "$github" --draft --verify-tag --title "Waken $version" --notes-file "$notes"
  else
    gh release create "$tag" --repo "$github" --draft --verify-tag --title "Waken $version" --notes "Waken $version"
  fi
fi
gh release upload "$tag" --repo "$github" --clobber "$dmg" "$dist/Waken-macOS.dmg" "$dist/appcast.xml"

if [ "$publish" = "--publish" ]; then
  gh release edit "$tag" --repo "$github" --draft=false
  printf '\nWaken %s est publié : les Mac installés le proposeront.\n' "$version"
else
  printf '\nWaken %s est en brouillon sur GitHub. Publie-le (bouton Publish, ou ce script avec --publish) quand Windows y est aussi.\n' "$version"
fi
