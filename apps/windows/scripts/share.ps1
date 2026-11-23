# Makes a zip of the Waken app as build.ps1 compiled it, to give to a friend whose PC has no certificate to trust.
# They unzip it and run install.ps1 (Windows' developer mode, nothing else): see that file.
#
#   powershell -ExecutionPolicy Bypass -File apps\windows\scripts\share.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$here = Split-Path -Parent $PSScriptRoot           # apps\windows
$layout = Join-Path $here 'windows\Waken.Package\bin\x64\Release\AppX'
$dist = Join-Path $here 'dist'
$zip = Join-Path $dist 'Waken-Windows-x64.zip'

if (-not (Test-Path (Join-Path $layout 'AppxManifest.xml'))) {
  throw "Pas d'app compilée : lance d'abord apps\windows\scripts\build.ps1."
}

$staging = Join-Path $env:TEMP 'waken-share'
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
Write-Host 'Copie de l''app...' -ForegroundColor Cyan
Copy-Item -Recurse $layout (Join-Path $staging 'Waken')
# Your own SteamGridDB key stays with you: the friend's app shows Steam covers, or theirs with their own key.
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $staging 'Waken\Waken\host\steamgriddb.key')
Copy-Item (Join-Path $PSScriptRoot 'install.ps1') $staging

New-Item -ItemType Directory -Force $dist | Out-Null
if (Test-Path $zip) { Remove-Item -Force $zip }
Write-Host 'Compression...' -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip
Remove-Item -Recurse -Force $staging
$size = [math]::Round((Get-Item $zip).Length / 1MB)
Write-Host "`n$zip ($size Mo)" -ForegroundColor Green
Write-Host 'À envoyer à ton pote : il décompresse le zip, puis clic droit sur install.ps1, Exécuter avec PowerShell.'
