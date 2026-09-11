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
  $PreviousPreference = $ErrorActionPreference
  try {
    # Windows PowerShell can surface native stderr (for example git clone progress)
    # as NativeCommandError even when the process exits successfully. Native exit
    # code is the authoritative result for these commands.
    $ErrorActionPreference = 'Continue'
    & $Command
    $ExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousPreference
  }
  if ($ExitCode -ne 0) {
    throw "$Label failed with exit code $ExitCode"
  }
}

function Invoke-Captured {
  param([scriptblock]$Command, [string]$Label)
  $PreviousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $Output = @(& $Command 2>&1)
    $ExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousPreference
  }
  if ($ExitCode -ne 0) {
    throw "$Label failed with exit code $ExitCode"
  }
  return (($Output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
}

if (-not $RepoUrl) {
  $RepoUrl = Invoke-Captured { git config --get remote.origin.url } 'git config remote.origin.url'
  if (-not $RepoUrl) { throw 'Unable to resolve git remote.origin.url; pass -RepoUrl explicitly' }
}
if (-not $Commit) {
  $Commit = Invoke-Captured { git rev-parse HEAD } 'git rev-parse HEAD'
  if (-not $Commit) { throw 'Unable to resolve HEAD; pass -Commit explicitly' }
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
    $Receipt.checkedOutCommit = Invoke-Captured { git rev-parse HEAD } 'git rev-parse checked-out HEAD'
    if ($Receipt.checkedOutCommit -ne $Commit) { throw "Checked out commit $($Receipt.checkedOutCommit) does not match requested $Commit" }

    $Receipt.node = Invoke-Captured { node --version } 'node --version'
    $Receipt.npm = Invoke-Captured { npm --version } 'npm --version'

    try {
      Invoke-Checked { npm ci } 'npm ci'
      $Receipt.npmCi = 'PASS'
    } catch {
      $Receipt.npmCi = 'FAIL'
      throw
    }

    try {
      Invoke-Checked { npm test } 'npm test'
      $Receipt.npmTest = 'PASS'
    } catch {
      $Receipt.npmTest = 'FAIL'
      throw
    }

    try {
      Invoke-Checked { git diff --check } 'git diff --check'
      $Receipt.diffCheck = 'PASS'
    } catch {
      $Receipt.diffCheck = 'FAIL'
      throw
    }

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
