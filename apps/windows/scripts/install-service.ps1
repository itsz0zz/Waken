# Waken starts with Windows, before anybody signs in: the agent, Sunshine and the Waken network run from the
# moment the PC is on (a Windows task started at boot as SYSTEM). Woken from afar, the PC is ready to stream at
# once, its sign-in screen included. The app then only talks to that agent.
#
# Also turns on what Wake-on-LAN needs on the PC itself: the network card's magic packet, and (asked first)
# Windows' fast startup off. The BIOS setting ("Wake on LAN" / "Power on by PCI-E") stays yours to switch on.
#
# Install or update (after each build.ps1), from an administrator PowerShell, with Waken run at least once:
#   powershell -ExecutionPolicy Bypass -File apps\windows\scripts\install-service.ps1
# Remove:
#   powershell -ExecutionPolicy Bypass -File apps\windows\scripts\install-service.ps1 -Uninstall
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$taskName = 'Waken'
$programs = Join-Path $env:ProgramFiles 'Waken'
$data = Join-Path $env:ProgramData 'Waken'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Lance ce script depuis un PowerShell ouvert en administrateur (clic droit, Exécuter en tant qu''administrateur).' }

function Stop-Waken {
  # The app's own agent (and what it runs), or the one started at boot: the files can then be replaced.
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
  Get-Process -Name 'Waken', 'Waken.Agent', 'sunshine', 'waken-tunnel' -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
}

if ($Uninstall) {
  Stop-Waken
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path $programs) { Remove-Item -Recurse -Force $programs }
  Write-Host "Waken ne démarre plus avec Windows. Ses données restent dans $data (à supprimer à la main si besoin)." -ForegroundColor Green
  exit
}

# 1. The app as installed: its host folder (agent, Sunshine, network), its secrets.
$package = Get-AppxPackage -Name Waken | Select-Object -First 1
if (-not $package) { throw 'Waken n''est pas installé : lance d''abord apps\windows\scripts\build.ps1 (ou install.ps1).' }
# Beside Waken.exe, which sits in the package's Waken folder (or at its root, in older layouts).
$hostSource = @('Waken\host', 'host') | ForEach-Object { Join-Path $package.InstallLocation $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $hostSource) { $hostSource = Join-Path $package.InstallLocation 'Waken\host' }
if (-not (Test-Path (Join-Path $hostSource 'agent\Waken.Agent.exe'))) { throw "L'agent manque dans l'app ($hostSource) : reconstruis-la avec build.ps1." }
# The app's own files, where Windows keeps a packaged app's %LOCALAPPDATA%.
$appData = Join-Path $env:LOCALAPPDATA "Packages\$($package.PackageFamilyName)\LocalCache\Local\Waken"
if (-not (Test-Path (Join-Path $appData 'agent-token'))) { $appData = Join-Path $env:LOCALAPPDATA 'Waken' }
$tokenFile = Join-Path $appData 'agent-token'
$passwordFile = Join-Path $appData 'sunshine-admin'
if (-not (Test-Path $tokenFile) -or -not (Test-Path $passwordFile)) { throw 'Ouvre Waken une fois (il crée ses clés), ferme-le, puis relance ce script.' }
$token = (Get-Content -Raw $tokenFile).Trim()
$password = (Get-Content -Raw $passwordFile).Trim()

Write-Host '== Arrêt de Waken' -ForegroundColor Cyan
Stop-Waken

# 2. The programs where only administrators can change them: a task running as SYSTEM never runs a file a user could replace.
Write-Host "== Programmes dans $programs" -ForegroundColor Cyan
New-Item -ItemType Directory -Force $programs | Out-Null
robocopy $hostSource (Join-Path $programs 'host') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copie des programmes impossible (robocopy $LASTEXITCODE)" }

# 3. The data, kept from the app the first time (the network's identity, Sunshine's pairing): nothing to redo.
Write-Host "== Données dans $data" -ForegroundColor Cyan
$first = -not (Test-Path (Join-Path $data 'agent.json'))
New-Item -ItemType Directory -Force $data | Out-Null
# SYSTEM and the administrators only: it holds the agent's token and Sunshine's password. SIDs, not names (French Windows).
icacls $data /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($first) {
  foreach ($part in 'sunshine', 'tunnel', 'agent') {
    $from = Join-Path $appData $part
    if (Test-Path $from) { robocopy $from (Join-Path $data $part) /E /NFL /NDL /NJH /NJS /NP /XF '*.log' | Out-Null }
  }
  $control = Join-Path $appData 'network-control.txt'
  if (Test-Path $control) { Copy-Item $control $data }
}

$hostDir = Join-Path $programs 'host'
$key = Join-Path $hostDir 'steamgriddb.key'
$config = [ordered]@{
  Urls  = 'http://127.0.0.1:47100'
  Agent = [ordered]@{
    Token            = $token
    SunshineHost     = '127.0.0.1'
    SunshineUser     = 'admin'
    SunshinePassword = $password
    SunshineCertPath = Join-Path $data 'sunshine\credentials\cacert.pem'
    DataDir          = Join-Path $data 'agent'
    SteamGridDbKey   = if (Test-Path $key) { (Get-Content -Raw $key).Trim() } else { '' }
    Host             = [ordered]@{
      Enabled        = $true
      ConsoleSession = $true
      Root           = $data
      SunshineExe    = Join-Path $hostDir 'sunshine\sunshine.exe'
      TunnelExe      = Join-Path $hostDir 'waken-tunnel.exe'
      DeviceName     = [System.Net.Dns]::GetHostName()
    }
  }
}
$config | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $data 'agent.json')

# 4. The task: at boot, as SYSTEM, started again if it stops, never ended for running too long.
Write-Host '== Démarrage avec Windows' -ForegroundColor Cyan
$agentExe = Join-Path $hostDir 'agent\Waken.Agent.exe'
$action = New-ScheduledTaskAction -Execute $agentExe -WorkingDirectory (Split-Path $agentExe)
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description 'Waken : agent, Sunshine et réseau Waken dès le démarrage du PC.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$up = $false
for ($i = 0; $i -lt 30 -and -not $up; $i++) {
  Start-Sleep -Seconds 1
  try { $up = (Invoke-RestMethod -Uri 'http://127.0.0.1:47100/health' -TimeoutSec 2).ok } catch { }
}
if (-not $up) { Write-Host "L'agent ne répond pas encore : regarde l'Observateur d'événements, ou relance ce script." -ForegroundColor Yellow }

# 5. Wake-on-LAN on the PC's side: the wired card answers the magic packet, from sleep and from shutdown.
Write-Host '== Wake-on-LAN (carte réseau)' -ForegroundColor Cyan
foreach ($card in Get-NetAdapter -Physical | Where-Object Status -eq 'Up') {
  Set-NetAdapterPowerManagement -Name $card.Name -WakeOnMagicPacket Enabled -ErrorAction SilentlyContinue
  # Standard keywords, whatever the driver's language: magic packet on, and from shutdown where the driver has it.
  foreach ($keyword in '*WakeOnMagicPacket', 'S5WakeOnLan', 'WakeFromS5', '*ModernStandbyWoLMagicPacket') {
    if (Get-NetAdapterAdvancedProperty -Name $card.Name -RegistryKeyword $keyword -ErrorAction SilentlyContinue) {
      Set-NetAdapterAdvancedProperty -Name $card.Name -RegistryKeyword $keyword -RegistryValue 1 -ErrorAction SilentlyContinue
    }
  }
  powercfg /deviceenablewake "$($card.InterfaceDescription)" 2>$null | Out-Null
  Write-Host "  $($card.Name) ($($card.InterfaceDescription)) : $($card.MacAddress)"
}

# Fast startup is half a hibernation: many cards then ignore the magic packet once the PC is shut down.
$power = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'
if ((Get-ItemProperty -Path $power -Name HiberbootEnabled -ErrorAction SilentlyContinue).HiberbootEnabled -eq 1) {
  $answer = Read-Host 'Le démarrage rapide de Windows empêche souvent le réveil d''un PC éteint. Le désactiver ? (o/n)'
  if ($answer -match '^[oOyY]') {
    Set-ItemProperty -Path $power -Name HiberbootEnabled -Value 0
    Write-Host '  Démarrage rapide désactivé.'
  }
}

Write-Host "`nWaken démarre maintenant avec Windows." -ForegroundColor Green
Write-Host 'Reste à activer le Wake-on-LAN dans le BIOS (souvent « Wake on LAN » ou « Power On By PCI-E »).'
Write-Host 'Depuis Internet : sur la Livebox, une IP fixe pour ce PC et une redirection UDP du port 9 vers elle.'
Write-Host 'Après chaque build.ps1, relance ce script pour mettre le démarrage automatique à jour.'
