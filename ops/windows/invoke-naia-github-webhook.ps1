param(
  [Parameter(Mandatory = $true)]
  [string]$WorkingDirectory
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path $WorkingDirectory).Path
$configPath = Join-Path $repo '.naia\ops\github-webhook.json'
$secretPath = Join-Path $repo '.naia\ops\github-webhook.secret'
if (-not (Test-Path $configPath)) { throw "Webhook config not found: $configPath" }
if (-not (Test-Path $secretPath)) { throw "Webhook secret not found: $secretPath" }

$config = Get-Content -Raw $configPath | ConvertFrom-Json
$encrypted = (Get-Content -Raw $secretPath).Trim()
if (-not $encrypted) { throw 'Webhook secret file is empty' }
$secure = ConvertTo-SecureString $encrypted
$credential = New-Object System.Management.Automation.PSCredential('naia', $secure)
$secret = $credential.GetNetworkCredential().Password
if (-not $secret) { throw 'Unable to decrypt webhook secret for current Windows user' }

$env:NAIA_GITHUB_WEBHOOK_SECRET = $secret
$env:NAIA_GITHUB_WEBHOOK_AUTOMATION_ID = [string]$config.automationId
$env:NAIA_GITHUB_WEBHOOK_EVENT = [string]$config.eventType
$env:NAIA_GITHUB_WEBHOOK_INTENT = [string]$config.intent
$env:NAIA_GITHUB_WEBHOOK_HOST = [string]$config.host
$env:NAIA_GITHUB_WEBHOOK_PORT = [string]$config.port
$env:NAIA_GITHUB_WEBHOOK_PATH = [string]$config.path
$env:NAIA_GITHUB_WEBHOOK_MAX_BYTES = [string]$config.maxBytes
$env:NAIA_GITHUB_WEBHOOK_RECEIPT = Join-Path $repo ([string]$config.receiptPath)

# A new listener verification run must require a new accepted delivery.
# Remove any prior receipt, including one from the same commit, before listening.
Remove-Item $env:NAIA_GITHUB_WEBHOOK_RECEIPT -Force -ErrorAction SilentlyContinue

Push-Location $repo
try {
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & npm run webhook:github
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
    Remove-Item Env:NAIA_GITHUB_WEBHOOK_SECRET -ErrorAction SilentlyContinue
  }
  if ($exitCode -ne 0) { throw "NaIA GitHub webhook server exited with code $exitCode" }
} finally {
  Pop-Location
}
