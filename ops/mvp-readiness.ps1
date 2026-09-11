param(
  [string]$ReceiptDir = '.reproduction',
  [switch]$RunClean,
  [switch]$RunLiveGoogle,
  [switch]$SkipSuite
)

$ErrorActionPreference = 'Stop'
$Root = (Get-Location).Path

function Invoke-NativeCapture {
  param([scriptblock]$Command)
  $PreviousPreference = $ErrorActionPreference
  try {
    # Windows PowerShell may convert native stderr into NativeCommandError.
    # For native programs the process exit code is authoritative.
    $ErrorActionPreference = 'Continue'
    $Output = @(& $Command 2>&1)
    $ExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousPreference
  }
  return [pscustomobject]@{
    ExitCode = $ExitCode
    Lines = $Output
    Text = (($Output | ForEach-Object { $_.ToString() }) -join "`n")
  }
}

$HeadProbe = Invoke-NativeCapture { git rev-parse HEAD }
$Head = $HeadProbe.Text.Trim()
if ($HeadProbe.ExitCode -ne 0 -or -not $Head) { throw 'Unable to resolve current git HEAD' }

$ResolvedReceiptDir = if ([IO.Path]::IsPathRooted($ReceiptDir)) { $ReceiptDir } else { Join-Path $Root $ReceiptDir }
New-Item -ItemType Directory -Force -Path $ResolvedReceiptDir | Out-Null

function Read-Receipt {
  param([string]$Name)
  $Path = Join-Path $ResolvedReceiptDir $Name
  if (-not (Test-Path $Path)) { return $null }
  try { return Get-Content -Raw $Path | ConvertFrom-Json } catch { return $null }
}

function Clean-Repro-Pass {
  param($Receipt)
  return $null -ne $Receipt -and
    $Receipt.status -eq 'PASS' -and
    $Receipt.cleanClone -eq $true -and
    $Receipt.requestedCommit -eq $Head -and
    $Receipt.checkedOutCommit -eq $Head -and
    $Receipt.npmCi -eq 'PASS' -and
    $Receipt.npmTest -eq 'PASS' -and
    $Receipt.diffCheck -eq 'PASS'
}

function Gate-Pass {
  param($Receipt, [string]$Gate)
  return $null -ne $Receipt -and $Receipt.status -eq 'PASS' -and $Receipt.gate -eq $Gate
}

function Invoke-CleanReproduction {
  param([string]$Name)
  $ReceiptPath = Join-Path $ResolvedReceiptDir $Name
  try {
    & (Join-Path $Root 'ops\reproduce-mvp.ps1') -Commit $Head -ReceiptPath $ReceiptPath
  } catch {
    Write-Warning "Clean reproduction $Name did not complete: $($_.Exception.Message)"
  }
}

$Suite = 'NOT_EXECUTED'
$ObservedTests = $null
if (-not $SkipSuite) {
  Write-Output '== Local product suite =='
  $TestRun = Invoke-NativeCapture { npm test }
  foreach ($Line in $TestRun.Lines) { Write-Output $Line }
  $Matches = [regex]::Matches($TestRun.Text, '(?im)(?:^|\s)tests\s+(\d+)')
  if ($Matches.Count -gt 0) { $ObservedTests = [int]$Matches[$Matches.Count - 1].Groups[1].Value }
  $Suite = if ($TestRun.ExitCode -eq 0 -and $ObservedTests -eq 67) { 'PASS' } else { 'FAIL' }
}

if ($RunClean) {
  Write-Output '== Clean reproduction #1 =='
  Invoke-CleanReproduction 'run-01.json'
  Write-Output '== Clean reproduction #2 =='
  Invoke-CleanReproduction 'run-02.json'
}

if ($RunLiveGoogle) {
  if ([string]::IsNullOrWhiteSpace($env:NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN)) {
    Write-Warning 'NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN is absent; LIVE_GCAL_READ remains BLOCKED_EXTERNAL.'
  } else {
    $env:NAIA_GOOGLE_CALENDAR_LIVE_RECEIPT = Join-Path $ResolvedReceiptDir 'google-calendar-live.json'
    Write-Output '== Google Calendar live read =='
    $LiveRun = Invoke-NativeCapture { npm run live:google-calendar }
    foreach ($Line in $LiveRun.Lines) { Write-Output $Line }
    if ($LiveRun.ExitCode -ne 0) { Write-Warning "Google Calendar live run exited $($LiveRun.ExitCode)" }
  }
}

$Run1 = Read-Receipt 'run-01.json'
$Run2 = Read-Receipt 'run-02.json'
$Scheduler = Read-Receipt 'external-scheduler.json'
$ProviderEvent = Read-Receipt 'provider-event.json'
$Google = Read-Receipt 'google-calendar-live.json'

$Clean1 = if (Clean-Repro-Pass $Run1) { 'PASS' } elseif ($null -eq $Run1) { 'NOT_EXECUTED' } else { 'FAIL' }
$Clean2 = if (Clean-Repro-Pass $Run2) { 'PASS' } elseif ($null -eq $Run2) { 'NOT_EXECUTED' } else { 'FAIL' }
$SchedulerGate = if (Gate-Pass $Scheduler 'EXTERNAL_SCHEDULER_DELIVERY') { 'PASS' } elseif ($null -eq $Scheduler) { 'NOT_EXECUTED' } else { 'FAIL' }
$ProviderEventGate = if (Gate-Pass $ProviderEvent 'LIVE_PROVIDER_EVENT') { 'PASS' } elseif ($null -eq $ProviderEvent) { 'NOT_EXECUTED' } else { 'FAIL' }
$GoogleGate = if (Gate-Pass $Google 'LIVE_GCAL_READ') { 'PASS' } elseif ($null -eq $Google) { 'BLOCKED_EXTERNAL_OR_NOT_EXECUTED' } else { 'FAIL' }

$CoreReady = $Suite -eq 'PASS' -and $Clean1 -eq 'PASS' -and $Clean2 -eq 'PASS' -and $SchedulerGate -eq 'PASS' -and $ProviderEventGate -eq 'PASS'

$Status = [ordered]@{
  commit = $Head
  expectedProductTests = 67
  observedProductTests = $ObservedTests
  localSuite = $Suite
  cleanReproduction1 = $Clean1
  cleanReproduction2 = $Clean2
  externalScheduler = $SchedulerGate
  liveProviderEvent = $ProviderEventGate
  liveGoogleCalendarRead = $GoogleGate
  mvpCoreReady = if ($CoreReady) { 'PASS' } else { 'NOT_READY' }
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
}

$StatusPath = Join-Path $ResolvedReceiptDir 'mvp-readiness.json'
$Json = $Status | ConvertTo-Json -Depth 6
Set-Content -Path $StatusPath -Value $Json -Encoding utf8
Write-Output '== NaIA MVP readiness =='
Write-Output $Json

if (-not $CoreReady) { exit 2 }
