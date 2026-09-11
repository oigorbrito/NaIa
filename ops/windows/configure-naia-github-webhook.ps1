param(
  [Parameter(Mandatory = $true)]
  [string]$WorkingDirectory,

  [Parameter(Mandatory = $true)]
  [string]$AutomationId,

  [Parameter(Mandatory = $true)]
  [string]$EventType,

  [Parameter(Mandatory = $true)]
  [string]$Intent,

  [string]$HostName = '127.0.0.1',
  [int]$Port = 8788,
  [string]$Path = '/webhook/github',
  [int]$MaxBytes = 262144,
  [SecureString]$Secret
)

$ErrorActionPreference = 'Stop'
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be 1..65535' }
if ($MaxBytes -le 0) { throw 'MaxBytes must be positive' }
if (-not $Path.StartsWith('/')) { throw 'Path must start with /' }

$repo = (Resolve-Path $WorkingDirectory).Path
$opsDir = Join-Path $repo '.naia\ops'
$configPath = Join-Path $opsDir 'github-webhook.json'
$secretPath = Join-Path $opsDir 'github-webhook.secret'
New-Item -ItemType Directory -Force -Path $opsDir | Out-Null

if ($null -eq $Secret) {
  $Secret = Read-Host 'NaIA GitHub webhook HMAC secret' -AsSecureString
}
if ($Secret.Length -eq 0) { throw 'Webhook secret must not be empty' }

$config = [ordered]@{
  automationId = $AutomationId
  eventType = $EventType
  intent = $Intent
  host = $HostName
  port = $Port
  path = $Path
  maxBytes = $MaxBytes
  receiptPath = '.reproduction\provider-event.json'
  configuredAt = (Get-Date).ToUniversalTime().ToString('o')
}
$config | ConvertTo-Json -Depth 4 | Set-Content -Path $configPath -Encoding utf8
$Secret | ConvertFrom-SecureString | Set-Content -Path $secretPath -Encoding ascii

Write-Output (ConvertTo-Json ([ordered]@{
  status = 'CONFIGURED'
  configPath = $configPath
  secretPath = $secretPath
  secretStorage = 'WINDOWS_DPAPI_CURRENT_USER'
  automationId = $AutomationId
  eventType = $EventType
  listen = "${HostName}:$Port$Path"
}) -Depth 4)
