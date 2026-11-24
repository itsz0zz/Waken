# Builds and starts Waken for Windows: the React Native app with the stream server (Sunshine), the Waken agent
# and the Waken network inside. Nothing else to install on the PC once it runs.
#
# Needs, once: Node.js 22+, pnpm, PowerShell 7, the .NET 10 SDK, Visual Studio 2022 with "Desktop development with C++"
# (and the Windows App SDK / UWP C++ tools it proposes for React Native Windows). Go is fetched if missing.
#
#   powershell -ExecutionPolicy Bypass -File apps\windows\scripts\build.ps1            # Release, installed and started
#   powershell -ExecutionPolicy Bypass -File apps\windows\scripts\build.ps1 -Debug     # with Metro, for development
#   powershell -ExecutionPolicy Bypass -File apps\windows\scripts\build.ps1 -Unpackaged
#       without MSIX, in apps\windows\dist\Waken and started from there (what the Velopack installer ships)
param([switch]$Debug, [switch]$Unpackaged)

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
Need git 'installe Git : winget install --id Git.Git -e, puis rouvre la fenêtre'
# React Native Windows runs its tools with PowerShell 7 (pwsh.exe), not Windows PowerShell: without it the
# CLI has no run-windows command at all.
Need pwsh 'installe PowerShell 7 : winget install --id Microsoft.PowerShell -e, puis rouvre la fenêtre'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere) -or -not (& $vswhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)) {
  throw 'Visual Studio 2022 avec « Développement Desktop en C++ » introuvable.'
}
New-Item -ItemType Directory -Force $cache | Out-Null

Step 'moonlight-common-c (le stream, sous-module Git)'
# The stream view's client library: a Git submodule, absent from a plain clone or a ZIP.
git -C $repo submodule update --init --recursive
if ($LASTEXITCODE -ne 0) { throw "Sous-module moonlight-common-c introuvable : le dossier doit être un clone Git (git clone)." }

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
# The app's Réglages run it to start Waken with Windows (after Windows' administrator confirmation).
Copy-Item (Join-Path $PSScriptRoot 'install-service.ps1') $hostDir

if ($Unpackaged) {
  Step 'App Waken sans MSIX (React Native Windows)'
  $env:MSBUILDDISABLENODEREUSE = '1'
  $msbuild = & $vswhere -latest -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\amd64\MSBuild.exe' | Select-Object -First 1
  if (-not $msbuild) { throw 'MSBuild introuvable (Visual Studio 2022).' }
  $solutionDir = (Join-Path $here 'windows') + '\'
  $ErrorActionPreference = 'Continue'
  # Through the solution (React Native Windows' projects refuse to be built alone), its Waken project only: the
  # native modules and libraries it references follow, the MSIX packaging project does not.
  & $msbuild (Join-Path $solutionDir 'Waken.sln') /t:Waken /restore /m /nologo /v:minimal `
    /p:Configuration=Release /p:Platform=x64 /p:WakenUnpackaged=true /p:RestorePackagesConfig=true
  $failed = $LASTEXITCODE -ne 0
  $ErrorActionPreference = 'Stop'
  if ($failed) { throw "L'app n'a pas compilé : colle les erreurs ci-dessus à Claude." }

  # The app's folder: Waken.exe and everything beside it, plus the native modules built as projects of their own.
  $built = Join-Path $solutionDir 'x64\Release'
  $dist = Join-Path $here 'dist\Waken'
  Get-Process -Name Waken -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dist*" } | Stop-Process -Force
  if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
  New-Item -ItemType Directory -Force $dist | Out-Null
  Copy-Item -Recurse (Join-Path $built 'Waken\*') $dist
  Get-ChildItem $built -Directory | Where-Object { $_.Name -notin @('Waken', 'Moonlight', 'Chiaki') } | ForEach-Object {
    Get-ChildItem $_.FullName -File -Include *.dll, *.pri -Recurse -ErrorAction SilentlyContinue | Where-Object { -not (Test-Path (Join-Path $dist $_.Name)) } |
      Copy-Item -Destination $dist
  }
  Write-Host "`nWaken sans MSIX : $dist" -ForegroundColor Green
  Write-Host 'Ferme l''app Waken installée avant (même agent, même port). Le journal : %LOCALAPPDATA%\Waken\waken.log' -ForegroundColor Yellow
  Start-Process (Join-Path $dist 'Waken.exe')
  exit 0
}

Step 'App Waken (React Native Windows)'
# Fresh MSBuild processes, started from this window: reused ones keep the environment they were born with (a
# PATH without pnpm or node, when Visual Studio started them).
$env:MSBUILDDISABLENODEREUSE = '1'
Push-Location $here
$runArgs = @('exec', 'react-native', 'run-windows', '--arch', 'x64', '--logging')
if (-not $Debug) { $runArgs += '--release' }
# Windows PowerShell turns each stderr line into an error once redirected: with 'Stop', the first one would end
# the script. Only the exit code counts here.
$ErrorActionPreference = 'Continue'
& pnpm @runArgs 2>&1 | Tee-Object -Variable runOutput
$failed = $LASTEXITCODE -ne 0
$ErrorActionPreference = 'Stop'
# The last step, CheckNetIsolation (local network exemption, only for Metro in Debug), sometimes fails with
# "error code 6" although the app is built and installed: then Waken is started here instead.
if ($failed -and -not $Debug -and ($runOutput -join "`n") -match 'CheckNetIsolationFailure') {
  Write-Host "Exemption réseau locale refusée par Windows (sans effet pour Waken) : lancement direct." -ForegroundColor Yellow
  $package = Get-AppxPackage -Name Waken | Select-Object -First 1
  if ($package) {
    Start-Process "shell:AppsFolder\$($package.PackageFamilyName)!App"
    $failed = $false
  }
}
if ($failed) { Pop-Location; throw "L'app n'a pas compilé : colle les erreurs ci-dessus à Claude." }
Pop-Location
Write-Host "`nWaken est installé et lancé." -ForegroundColor Green
# Started with Windows (install-service.ps1): that copy stays the previous one until the script runs again.
if (Get-ScheduledTask -TaskName 'Waken' -ErrorAction SilentlyContinue) {
  Write-Host "Waken démarre avec Windows : pour qu'il prenne ce build, relance en administrateur apps\windows\scripts\install-service.ps1." -ForegroundColor Yellow
}
