param(
  [Parameter(Mandatory = $true)]
  [string]$WorkingDirectory
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path $WorkingDirectory).Path
$configPath = Join-Path $repo '.naia\ops\schedule.json'
$secretPath = Join-Path $repo '.naia\ops\schedule.secret'

if (Test-Path $configPath) {
  $config = Get-Content -Raw $configPath | ConvertFrom-Json
  if (-not $env:NAIA_SCHEDULE_AUTOMATION_ID) { $env:NAIA_SCHEDULE_AUTOMATION_ID = [string]$config.automationId }
  if (-not $env:NAIA_SCHEDULE_EXPRESSION) { $env:NAIA_SCHEDULE_EXPRESSION = [string]$config.scheduleExpression }
  if (-not $env:NAIA_SCHEDULE_INTENT) { $env:NAIA_SCHEDULE_INTENT = [string]$config.intent }
  if (-not $env:NAIA_SCHEDULE_TIMEZONE) { $env:NAIA_SCHEDULE_TIMEZONE = [string]$config.timezone }
  if (-not $env:NAIA_SCHEDULE_RECEIPT -and $config.receiptPath) {
    $env:NAIA_SCHEDULE_RECEIPT = Join-Path $repo ([string]$config.receiptPath)
  }
}

if (-not $env:NAIA_SCHEDULE_SECRET -and (Test-Path $secretPath)) {
  $encrypted = (Get-Content -Raw $secretPath).Trim()
  if ($encrypted) {
    $secure = ConvertTo-SecureString $encrypted
    $credential = New-Object System.Management.Automation.PSCredential('naia', $secure)
    $env:NAIA_SCHEDULE_SECRET = $credential.GetNetworkCredential().Password
  }
}

if (-not $env:NAIA_SCHEDULE_AUTOMATION_ID) {
  throw 'NAIA_SCHEDULE_AUTOMATION_ID is required; run configure-naia-schedule.ps1 or set the environment variable'
}
if (-not $env:NAIA_SCHEDULE_SECRET) {
  throw 'NAIA_SCHEDULE_SECRET is required; run configure-naia-schedule.ps1 or set the environment variable'
}
if (-not $env:NAIA_SCHEDULE_EXPRESSION) {
  throw 'NAIA_SCHEDULE_EXPRESSION is required; run configure-naia-schedule.ps1 or set the environment variable'
}
if (-not $env:NAIA_SCHEDULE_INTENT) {
  throw 'NAIA_SCHEDULE_INTENT is required; run configure-naia-schedule.ps1 or set the environment variable'
}
if (-not $env:NAIA_SCHEDULE_RECEIPT) {
  $env:NAIA_SCHEDULE_RECEIPT = Join-Path $repo '.reproduction\external-scheduler.json'
}

$at = (Get-Date).ToUniversalTime()
$bucket = $at.ToString('yyyyMMddHHmm')
$occurrenceId = "$($env:NAIA_SCHEDULE_AUTOMATION_ID):$bucket"

Push-Location $repo
try {
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & npm run schedule:deliver -- $occurrenceId $at.ToString('o')
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
    Remove-Item Env:NAIA_SCHEDULE_SECRET -ErrorAction SilentlyContinue
  }
  if ($exitCode -ne 0) {
    throw "NaIA schedule delivery failed with exit code $exitCode"
  }
} finally {
  Pop-Location
}
