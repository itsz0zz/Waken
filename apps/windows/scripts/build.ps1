# Builds and starts Waken for Windows: the React Native app with the stream server (Sunshine), the Waken agent
# and the Waken network inside. Nothing else to install on the PC once it runs.
#
# Needs, once: Node.js 22+, pnpm, PowerShell 7, the .NET 10 SDK, Visual Studio 2022 with "Desktop development with C++"
# (and the Windows App SDK / UWP C++ tools it proposes for React Native Windows). Go is fetched if missing.
#
#   powershell -ExecutionPolicy Bypass -File apps\windows\scripts\build.ps1            # Release, installed and started
#   powershell -ExecutionPolicy Bypass -File apps\windows\scripts\build.ps1 -Debug     # with Metro, for development
param([switch]$Debug)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is ten times slower with its progress bar
$here = Split-Path -Parent $PSScriptRoot           # apps\windows
$repo = Resolve-Path (Join-Path $here '..\..')
$cache = Join-Path $here '.cache'
$hostDir = Join-Path $here 'windows\Waken\host'

$sunshineVersion = 'v2026.914.233613'
$sunshineSha256 = '233008e46f4c0e501a586cbfd6c4fd4a4c0d414a0b5fc7f13c070eb92ec3824b'   # Sunshine-Windows-AMD64-lite.zip
$goVersion = 'go1.27.4'   # same as tunnel/build.sh
$runtime = '10.0.15'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Need($command, $hint) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command introuvable : $hint" }
}
function Download($url, $file, $sha256) {
  if (-not (Test-Path $file)) {
    Invoke-WebRequest -Uri $url -OutFile "$file.part"
    Move-Item "$file.part" $file
  }
  $actual = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLowerInvariant()
  if ($actual -ne $sha256.ToLowerInvariant()) {
    Remove-Item $file
    throw "Empreinte inattendue pour $(Split-Path -Leaf $file) : $actual (attendue $sha256). Fichier supprimé."
  }
}

Step 'Outils'
Need node 'installe Node.js 22 ou plus (https://nodejs.org)'
Need pnpm 'installe-le : npm install -g pnpm'
Need dotnet 'installe le SDK .NET 10 (https://dot.net)'
# React Native Windows runs its tools with PowerShell 7 (pwsh.exe), not Windows PowerShell: without it the
# CLI has no run-windows command at all.
Need pwsh 'installe PowerShell 7 : winget install --id Microsoft.PowerShell -e, puis rouvre la fenêtre'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere) -or -not (& $vswhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)) {
  throw 'Visual Studio 2022 avec « Développement Desktop en C++ » introuvable.'
}
New-Item -ItemType Directory -Force $cache | Out-Null

Step 'Dépendances JavaScript'
Push-Location $repo
pnpm install
Pop-Location

if (Test-Path $hostDir) { Remove-Item -Recurse -Force $hostDir }
New-Item -ItemType Directory -Force $hostDir | Out-Null

Step "Sunshine $sunshineVersion (serveur de stream)"
$zip = Join-Path $cache "Sunshine-$sunshineVersion-Windows-AMD64-lite.zip"
Download "https://github.com/SunshineStream/Sunshine/releases/download/$sunshineVersion/Sunshine-Windows-AMD64-lite.zip" $zip $sunshineSha256
$unpacked = Join-Path $cache 'sunshine-unpacked'
if (Test-Path $unpacked) { Remove-Item -Recurse -Force $unpacked }
Expand-Archive $zip $unpacked
# The archive may hold its files in a folder of its own: take the one with sunshine.exe.
$exe = Get-ChildItem $unpacked -Recurse -Filter 'sunshine.exe' | Select-Object -First 1
if (-not $exe) { throw "sunshine.exe absent de l'archive Sunshine." }
Copy-Item -Recurse $exe.Directory.FullName (Join-Path $hostDir 'sunshine')

Step "Agent Waken (.NET $runtime, autonome)"
$props = Join-Path $cache 'runtime.props'
@"
<Project>
  <ItemGroup>
    <KnownFrameworkReference Update="Microsoft.NETCore.App" LatestRuntimeFrameworkVersion="$runtime" />
    <KnownFrameworkReference Update="Microsoft.AspNetCore.App" LatestRuntimeFrameworkVersion="$runtime" />
  </ItemGroup>
</Project>
"@ | Set-Content -Encoding UTF8 $props
dotnet publish (Join-Path $repo 'agent\Waken.Agent') -c Release -r win-x64 --self-contained true `
  -p:TargetLatestRuntimePatch=true "-p:CustomAfterMicrosoftCommonTargets=$props" -o (Join-Path $hostDir 'agent')
if ($LASTEXITCODE -ne 0) { throw "L'agent n'a pas compilé." }

Step "Réseau Waken ($goVersion)"
$go = Get-Command go -ErrorAction SilentlyContinue
if (-not $go -or (& go env GOVERSION) -ne $goVersion) {
  $goRoot = Join-Path $cache 'go'
  $goExe = Join-Path $goRoot 'bin\go.exe'
  if (-not (Test-Path $goExe)) {
    # The checksum comes from go.dev's own list of releases.
    $release = (Invoke-RestMethod 'https://go.dev/dl/?mode=json&include=all') | Where-Object { $_.version -eq $goVersion }
    $file = $release.files | Where-Object { $_.os -eq 'windows' -and $_.arch -eq 'amd64' -and $_.kind -eq 'archive' }
    if (-not $file) { throw "$goVersion introuvable sur go.dev." }
    $goZip = Join-Path $cache $file.filename
    Download "https://go.dev/dl/$($file.filename)" $goZip $file.sha256
    Expand-Archive $goZip $cache
  }
  $go = $goExe
} else {
  $go = $go.Source
}
Push-Location (Join-Path $repo 'tunnel')
$env:GOTOOLCHAIN = 'local'; $env:CGO_ENABLED = '0'; $env:GOOS = 'windows'; $env:GOARCH = 'amd64'
$env:GOMODCACHE = Join-Path $repo 'tunnel\.cache\gomod'; $env:GOCACHE = Join-Path $repo 'tunnel\.cache\gocache-windows'
& $go build -trimpath -ldflags='-s -w' -o (Join-Path $hostDir 'waken-tunnel.exe') ./cmd/waken-tunnel
if ($LASTEXITCODE -ne 0) { throw "Le réseau Waken n'a pas compilé." }
Pop-Location

Step 'Clé SteamGridDB (pochettes)'
$keyFile = Join-Path $env:USERPROFILE '.config\waken\steamgriddb.key'
if ($env:STEAMGRIDDB_KEY) { $env:STEAMGRIDDB_KEY.Trim() | Set-Content -NoNewline (Join-Path $hostDir 'steamgriddb.key') }
elseif (Test-Path $keyFile) { (Get-Content -Raw $keyFile).Trim() | Set-Content -NoNewline (Join-Path $hostDir 'steamgriddb.key') }
else { Write-Host 'Pas de clé SteamGridDB : seuls les jeux Steam auront leur pochette.' -ForegroundColor Yellow }

Step 'App Waken (React Native Windows)'
Push-Location $here
if ($Debug) {
  pnpm exec react-native run-windows --arch x64 --logging
} else {
  pnpm exec react-native run-windows --release --arch x64 --logging
}
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "L'app n'a pas compilé : colle les erreurs ci-dessus à Claude." }
Pop-Location
Write-Host "`nWaken est installé et lancé." -ForegroundColor Green
