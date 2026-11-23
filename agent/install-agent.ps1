# Installe ou met à jour l'agent Waken comme tâche planifiée au démarrage (compte SYSTEM),
# pour qu'il réponde avant même l'ouverture de session Windows.
# À lancer dans un PowerShell administrateur, après :
#   dotnet publish Waken.Agent -c Release -o publish
# Le mot de passe Sunshine est demandé à l'écran, pour ne pas rester dans l'historique PowerShell.
#Requires -RunAsAdministrator
param(
  [string]$InstallDir = "C:\Program Files\Waken\Agent",
  [string]$PublishDir = (Join-Path $PSScriptRoot "publish"),
  [string]$SunshineUser = "admin",
  [switch]$NewToken
)

$ErrorActionPreference = "Stop"
$taskName = "Waken Agent"
$ruleName = "Waken Agent (Tailscale)"
$port = 47100
$tailscaleNetwork = "100.64.0.0/10"

if (-not (Test-Path (Join-Path $PublishDir "Waken.Agent.exe"))) {
  throw "Agent introuvable dans $PublishDir. Lance d'abord : dotnet publish Waken.Agent -c Release -o publish"
}
$runtimes = if (Get-Command dotnet -ErrorAction SilentlyContinue) { dotnet --list-runtimes } else { @() }
if (-not ($runtimes -match "^Microsoft\.AspNetCore\.App 10\.")) {
  throw "Runtime ASP.NET Core 10 absent : winget install Microsoft.DotNet.AspNetCore.10"
}

# Configuration et certificat client : SYSTEM et administrateurs uniquement.
$dataDir = Join-Path $env:ProgramData "Waken"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetSecurityDescriptorSddlForm("O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)")
Set-Acl -Path $dataDir -AclObject $acl
foreach ($child in Get-ChildItem -Path $dataDir -Force) {
  & icacls.exe $child.FullName /reset /T /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Impossible de protéger $($child.FullName)." }
}

$configPath = Join-Path $dataDir "agent.json"
$token = $null
if (-not $NewToken -and (Test-Path $configPath)) {
  $token = (Get-Content -Raw -Path $configPath | ConvertFrom-Json).Agent.Token
}
if (-not $token) {
  $bytes = New-Object byte[] 32
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $random.GetBytes($bytes)
  $random.Dispose()
  $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

$securePassword = Read-Host "Mot de passe admin de Sunshine" -AsSecureString
$password = (New-Object System.Management.Automation.PSCredential("sunshine", $securePassword)).GetNetworkCredential().Password
$config = @{ Agent = @{ Token = $token; SunshineUser = $SunshineUser; SunshinePassword = $password } } | ConvertTo-Json
[System.IO.File]::WriteAllText($configPath, $config)

# Les versions précédentes de ce script rangeaient les secrets ici, lisibles par tous les utilisateurs.
foreach ($name in "Agent__Token", "Agent__SunshineUser", "Agent__SunshinePassword") {
  if ([Environment]::GetEnvironmentVariable($name, "Machine")) {
    [Environment]::SetEnvironmentVariable($name, $null, "Machine")
  }
}

# Une mise à jour ne peut pas remplacer un exécutable en cours d'exécution.
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName
  Get-Process -Name "Waken.Agent" -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
}
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Recurse -Force -Path (Join-Path $PublishDir "*") -Destination $InstallDir

$action = New-ScheduledTaskAction -Execute "$InstallDir\Waken.Agent.exe" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null

# N'ouvre le port qu'à Tailscale.
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $port -RemoteAddress $tailscaleNetwork -Action Allow | Out-Null

Start-ScheduledTask -TaskName $taskName

$healthy = $false
foreach ($attempt in 1..20) {
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2 | Out-Null
    $healthy = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $healthy) { throw "L'agent est installé mais ne répond pas sur le port $port. Vérifie la tâche '$taskName'." }

Write-Host "Agent installé."
Write-Host "Jeton à saisir dans Waken (Appareils > PC > Jeton de l'agent) :"
Write-Host $token
