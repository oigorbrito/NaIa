param(
  [Parameter(Mandatory = $true)]
  [string]$WorkingDirectory,

  [Parameter(Mandatory = $true)]
  [string]$AutomationId,

  [Parameter(Mandatory = $true)]
  [string]$ScheduleExpression,

  [Parameter(Mandatory = $true)]
  [string]$Intent,

  [string]$Timezone = 'America/Sao_Paulo',

  [SecureString]$Secret
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path $WorkingDirectory).Path
$opsDir = Join-Path $repo '.naia\ops'
$configPath = Join-Path $opsDir 'schedule.json'
$secretPath = Join-Path $opsDir 'schedule.secret'
New-Item -ItemType Directory -Force -Path $opsDir | Out-Null

if ($null -eq $Secret) {
  $Secret = Read-Host 'NaIA schedule HMAC secret' -AsSecureString
}
if ($Secret.Length -eq 0) { throw 'Schedule secret must not be empty' }

$config = [ordered]@{
  automationId = $AutomationId
  scheduleExpression = $ScheduleExpression
  intent = $Intent
  timezone = $Timezone
  receiptPath = '.reproduction\external-scheduler.json'
  configuredAt = (Get-Date).ToUniversalTime().ToString('o')
}
$config | ConvertTo-Json -Depth 4 | Set-Content -Path $configPath -Encoding utf8

# ConvertFrom-SecureString without -Key uses Windows DPAPI bound to the current
# user account. The Scheduled Task must run as the same user to decrypt it.
$Secret | ConvertFrom-SecureString | Set-Content -Path $secretPath -Encoding ascii

Write-Output (ConvertTo-Json ([ordered]@{
  status = 'CONFIGURED'
  configPath = $configPath
  secretPath = $secretPath
  secretStorage = 'WINDOWS_DPAPI_CURRENT_USER'
  automationId = $AutomationId
  timezone = $Timezone
}) -Depth 4)
