# Publishes Waken for Windows: builds it without MSIX, makes the installer and the update packages with Velopack (vpk)
# and puts them on the GitHub release vX.Y.Z of release.json's repository. A draft until -Publish: the Mac's
# release.sh adds its DMG to the same release, and apps only see a published one.
#
#   powershell -ExecutionPolicy Bypass -File apps\windows\scripts\release.ps1 0.3.0
#   powershell -ExecutionPolicy Bypass -File apps\windows\scripts\release.ps1 0.3.0 -Publish
#
# Needs once: gh (winget install --id GitHub.cli -e), signed in with gh auth login, and release.json's githubRepo.
# The tag starts from Forgejo (origin): its mirror copies it to GitHub, which must never get tags of its own (the
# mirror would remove them).
param([Parameter(Mandatory, Position = 0)][string]$Version, [switch]$Publish)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$here = Split-Path -Parent $PSScriptRoot           # apps\windows
$repo = Resolve-Path (Join-Path $here '..\..')
$vpkVersion = '1.2.161'                            # same as Velopack's library in build.ps1

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version attendue sous la forme 1.2.3 (reçu : $Version)." }
$tag = "v$Version"
$release = Get-Content -Raw (Join-Path $repo 'release.json') | ConvertFrom-Json
if (-not $release.githubRepo) { throw 'Renseigne githubRepo dans release.json (par exemple "moncompte/waken").' }
$github = $release.githubRepo
$packId = $release.velopackId
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'gh introuvable : winget install --id GitHub.cli -e, puis gh auth login.' }
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'gh n''est pas connecté : lance gh auth login.' }

Step "Tag $tag (Forgejo, puis GitHub par le miroir)"
$dirty = git -C $repo status --porcelain --untracked-files=no
if ($dirty) { Write-Host 'Attention : des fichiers modifiés ne sont pas commités, ils seront dans ce build sans être dans le tag.' -ForegroundColor Yellow }
git -C $repo rev-parse -q --verify "refs/tags/$tag" | Out-Null
if ($LASTEXITCODE -ne 0) {
  git -C $repo tag -a $tag -m "Waken $Version"
  if ($LASTEXITCODE -ne 0) { throw "Tag $tag impossible." }
}
git -C $repo push origin $tag
if ($LASTEXITCODE -ne 0) { throw "Envoi du tag $tag à Forgejo impossible." }
$seen = $false
for ($i = 0; $i -lt 60 -and -not $seen; $i++) {
  gh api "repos/$github/git/ref/tags/$tag" 2>&1 | Out-Null
  $seen = $LASTEXITCODE -eq 0
  if (-not $seen) {
    if ($i -eq 0) { Write-Host 'En attente du miroir Forgejo vers GitHub...' }
    Start-Sleep -Seconds 5
  }
}
if (-not $seen) { throw "GitHub n'a pas le tag $tag après 5 minutes : vérifie le miroir (Forgejo, Paramètres, Miroirs, Synchroniser maintenant)." }

Step "Build de Waken $Version sans MSIX"
& (Join-Path $PSScriptRoot 'build.ps1') -Unpackaged -Version $Version -NoStart
$dist = Join-Path $here 'dist\Waken'
if (-not (Test-Path (Join-Path $dist 'Waken.exe'))) { throw 'Le build n''a pas produit dist\Waken\Waken.exe.' }

Step "Velopack (vpk $vpkVersion)"
dotnet tool update -g vpk --version $vpkVersion | Out-Null
$vpk = Join-Path $env:USERPROFILE '.dotnet\tools\vpk.exe'
if (-not (Test-Path $vpk)) { throw 'vpk introuvable après son installation (dotnet tool update -g vpk).' }
$out = Join-Path $here 'dist\releases'
New-Item -ItemType Directory -Force $out | Out-Null
$token = (gh auth token).Trim()
# The previous release, for an update that only downloads what changed (nothing to fetch the first time).
& $vpk download github --repoUrl "https://github.com/$github" --token $token --outputDir $out 2>&1 | Out-Host
$packArgs = @('pack', '--packId', $packId, '--packVersion', $Version, '--packDir', $dist, '--mainExe', 'Waken.exe',
  '--packTitle', 'Waken', '--packAuthors', 'Waken', '--icon', (Join-Path $here 'windows\Waken\Waken.ico'), '--outputDir', $out)
$notes = Join-Path $repo "docs\releases\$Version.md"
if (Test-Path $notes) { $packArgs += @('--releaseNotes', $notes) }
& $vpk @packArgs
if ($LASTEXITCODE -ne 0) { throw 'vpk pack a échoué.' }

Step "Release GitHub $tag"
gh release view $tag --repo $github 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  $notesArgs = if (Test-Path $notes) { @('--notes-file', $notes) } else { @('--notes', "Waken $Version") }
  gh release create $tag --repo $github --draft --verify-tag --title "Waken $Version" @notesArgs
  if ($LASTEXITCODE -ne 0) { throw "Création de la release $tag impossible." }
}
# This version's files and the feeds the apps read (releases.win.json); the installer also under a plain name.
$files = Get-ChildItem $out -File | Where-Object {
  $_.Name -like "*-$Version-*" -or $_.Name -like '*Setup.exe' -or $_.Name -like '*Portable.zip' -or
  $_.Name -in @('releases.win.json', 'assets.win.json', 'RELEASES')
}
$setup = $files | Where-Object { $_.Name -like '*Setup.exe' } | Select-Object -First 1
if (-not $setup) { throw 'vpk n''a pas produit d''installateur (*Setup.exe).' }
$plain = Join-Path $out 'Waken-Windows-Setup.exe'
Copy-Item -Force $setup.FullName $plain
gh release upload $tag --repo $github --clobber @($files.FullName) $plain
if ($LASTEXITCODE -ne 0) { throw 'Envoi des fichiers à la release impossible.' }

if ($Publish) {
  gh release edit $tag --repo $github --draft=false
  if ($LASTEXITCODE -ne 0) { throw "Publication de $tag impossible." }
  Write-Host "`nWaken $Version est publié : les apps installées le proposeront." -ForegroundColor Green
} else {
  Write-Host "`nWaken $Version est en brouillon sur GitHub. Publie-le (bouton Publish, ou ce script avec -Publish) quand le Mac y est aussi." -ForegroundColor Green
}
