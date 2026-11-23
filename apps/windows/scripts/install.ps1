# Installs Waken on this PC from the folder next to this script, without a certificate: Windows' developer mode
# allows an app to be registered from its folder, as Visual Studio does. Then sign in with your own Waken account:
# you only see your own computers, never the ones of whoever sent you this.
#
#   Clic droit sur install.ps1, Exécuter avec PowerShell (ou : powershell -ExecutionPolicy Bypass -File install.ps1)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'Waken'
$target = Join-Path $env:LOCALAPPDATA 'Programs\Waken'

function Done($text, $color) {
  Write-Host "`n$text" -ForegroundColor $color
  Read-Host 'Entrée pour fermer'
  exit
}

# 1. Developer mode: what lets Windows register an app from a folder.
$unlock = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue
if ($unlock.AllowDevelopmentWithoutDevLicense -ne 1) {
  Start-Process 'ms-settings:developers'
  Done 'Active le « Mode développeur » dans la page qui vient de s''ouvrir, puis relance install.ps1.' Yellow
}

# 2. The Windows components the app is built on (Windows App SDK, C++ runtime), installed once per PC.
[xml]$manifest = Get-Content -Raw (Join-Path $source 'AppxManifest.xml')
$missing = @()
foreach ($dependency in $manifest.Package.Dependencies.PackageDependency) {
  $installed = Get-AppxPackage -Name $dependency.Name | Where-Object { [version]$_.Version -ge [version]$dependency.MinVersion }
  if (-not $installed) { $missing += $dependency.Name }
}
if ($missing) {
  Write-Host 'Il manque ces composants Windows :' -ForegroundColor Yellow
  $missing | ForEach-Object { Write-Host "  $_" }
  if ($missing -match 'WindowsAppRuntime') { Write-Host "`nWindows App Runtime (Microsoft) : https://learn.microsoft.com/windows/apps/windows-app-sdk/downloads" }
  if ($missing -match 'VCLibs') { Write-Host 'Bibliothèques C++ (Microsoft) : https://learn.microsoft.com/troubleshoot/developer/visualstudio/cpp/libraries/c-runtime-packages-desktop-bridge' }
  Done 'Installe-les depuis ces pages Microsoft, puis relance install.ps1.' Yellow
}

# 3. The app in a folder of its own (it runs from there), registered, started.
Get-AppxPackage -Name Waken | Remove-AppxPackage -ErrorAction SilentlyContinue
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
Copy-Item -Recurse $source $target
Add-AppxPackage -Register (Join-Path $target 'AppxManifest.xml') -ForceApplicationShutdown
$package = Get-AppxPackage -Name Waken
Start-Process "shell:AppsFolder\$($package.PackageFamilyName)!App"
Done 'Waken est installé (menu Démarrer : Waken). Crée ton compte Waken dans l''app. Pour le retirer : Paramètres, Applications, Waken, Désinstaller.' Green
