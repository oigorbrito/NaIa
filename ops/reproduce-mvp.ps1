param(
  [string]$RepoUrl = '',
  [string]$Commit = '',
  [string]$ReceiptPath = '',
  [switch]$Keep
)

$ErrorActionPreference = 'Stop'
$SourceRoot = (Get-Location).Path

function Invoke-Checked {
  param([scriptblock]$Command, [string]$Label)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

if (-not $RepoUrl) {
  $RepoUrl = (& git config --get remote.origin.url).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $RepoUrl) { throw 'Unable to resolve git remote.origin.url; pass -RepoUrl explicitly' }
}
if (-not $Commit) {
  $Commit = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $Commit) { throw 'Unable to resolve HEAD; pass -Commit explicitly' }
}

$RunId = [guid]::NewGuid().ToString('N')
$Root = Join-Path ([IO.Path]::GetTempPath()) "naia-mvp-repro-$RunId"
$Started = (Get-Date).ToUniversalTime()
$Receipt = [ordered]@{
  status = 'RUNNING'
  repoUrl = $RepoUrl
  requestedCommit = $Commit
  checkedOutCommit = $null
  node = $null
  npm = $null
  startedAt = $Started.ToString('o')
  finishedAt = $null
  cleanClone = $true
  npmCi = 'NOT_EXECUTED'
  npmTest = 'NOT_EXECUTED'
  diffCheck = 'NOT_EXECUTED'
  workspace = if ($Keep) { $Root } else { $null }
  error = $null
}

try {
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  $Checkout = Join-Path $Root 'repo'

  Invoke-Checked { git clone --no-checkout $RepoUrl $Checkout } 'git clone'
  Push-Location $Checkout
  try {
    Invoke-Checked { git checkout --detach $Commit } 'git checkout'
    $Receipt.checkedOutCommit = (& git rev-parse HEAD).Trim()
    if ($Receipt.checkedOutCommit -ne $Commit) { throw "Checked out commit $($Receipt.checkedOutCommit) does not match requested $Commit" }

    $Receipt.node = (& node --version).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'node --version failed' }
    $Receipt.npm = (& npm --version).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'npm --version failed' }

    Invoke-Checked { npm ci } 'npm ci'
    $Receipt.npmCi = 'PASS'

    Invoke-Checked { npm test } 'npm test'
    $Receipt.npmTest = 'PASS'

    Invoke-Checked { git diff --check } 'git diff --check'
    $Receipt.diffCheck = 'PASS'

    $Receipt.status = 'PASS'
  } finally {
    Pop-Location
  }
} catch {
  $Receipt.status = 'FAIL'
  $Receipt.error = $_.Exception.Message
  throw
} finally {
  $Receipt.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  $Json = $Receipt | ConvertTo-Json -Depth 6
  if ($ReceiptPath) {
    $ResolvedReceipt = if ([IO.Path]::IsPathRooted($ReceiptPath)) { $ReceiptPath } else { Join-Path $SourceRoot $ReceiptPath }
    $Parent = Split-Path -Parent $ResolvedReceipt
    if ($Parent) { New-Item -ItemType Directory -Force -Path $Parent | Out-Null }
    Set-Content -Path $ResolvedReceipt -Value $Json -Encoding utf8
  }
  Write-Output '== NaIA MVP clean reproduction receipt =='
  Write-Output $Json
  if (-not $Keep) { Remove-Item -Recurse -Force $Root -ErrorAction SilentlyContinue }
}
