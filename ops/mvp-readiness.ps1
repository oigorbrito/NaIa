param(
  [string]$ReceiptDir = '.reproduction',
  [switch]$RunClean,
  [switch]$RunSchedulerTask,
  [string]$SchedulerTaskName = 'NaIA-MVP-Schedule',
  [switch]$RunLiveGoogle,
  [switch]$SkipSuite
)

$ErrorActionPreference = 'Stop'
$Root = (Get-Location).Path

function Invoke-NativeCapture {
  param([scriptblock]$Command)
  $PreviousPreference = $ErrorActionPreference
  try {
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

function Invoke-CleanReproduction {
  param([string]$Name)
  $ReceiptPath = Join-Path $ResolvedReceiptDir $Name
  try {
    & (Join-Path $Root 'ops\reproduce-mvp.ps1') -Commit $Head -ReceiptPath $ReceiptPath
  } catch {
    Write-Warning "Clean reproduction $Name did not complete: $($_.Exception.Message)"
  }
}

$SuiteExecuted = -not $SkipSuite
$SuiteExitCode = $null
$ObservedTests = $null
if ($SuiteExecuted) {
  Write-Output '== Local product suite =='
  $TestRun = Invoke-NativeCapture { npm test }
  foreach ($Line in $TestRun.Lines) { Write-Output $Line }
  $SuiteExitCode = $TestRun.ExitCode
  $Matches = [regex]::Matches($TestRun.Text, '(?im)(?:^|\s)tests\s+(\d+)')
  if ($Matches.Count -gt 0) { $ObservedTests = [int]$Matches[$Matches.Count - 1].Groups[1].Value }
}

if ($RunClean) {
  Write-Output '== Clean reproduction #1 =='
  Invoke-CleanReproduction 'run-01.json'
  Write-Output '== Clean reproduction #2 =='
  Invoke-CleanReproduction 'run-02.json'
}

if ($RunSchedulerTask) {
  Write-Output '== Windows Task Scheduler external delivery =='
  try {
    & (Join-Path $Root 'ops\windows\verify-naia-schedule.ps1') `
      -TaskName $SchedulerTaskName `
      -WorkingDirectory $Root
  } catch {
    Write-Warning "External scheduler verification did not complete: $($_.Exception.Message)"
  }
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

$EvaluatorInput = [ordered]@{
  commit = $Head
  observedProductTests = $ObservedTests
  suiteExitCode = $SuiteExitCode
  suiteExecuted = $SuiteExecuted
  cleanRun1 = Read-Receipt 'run-01.json'
  cleanRun2 = Read-Receipt 'run-02.json'
  externalScheduler = Read-Receipt 'external-scheduler.json'
  liveProviderEvent = Read-Receipt 'provider-event.json'
  liveGoogleCalendarRead = Read-Receipt 'google-calendar-live.json'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
}

$InputPath = Join-Path $ResolvedReceiptDir 'readiness-input.json'
$EvaluatorInput | ConvertTo-Json -Depth 12 | Set-Content -Path $InputPath -Encoding utf8
$Evaluation = Invoke-NativeCapture { node src/product/readiness-evaluator-cli.mjs $InputPath }
if ($Evaluation.ExitCode -ne 0 -and $Evaluation.ExitCode -ne 2) {
  foreach ($Line in $Evaluation.Lines) { Write-Output $Line }
  throw "readiness evaluator failed with exit code $($Evaluation.ExitCode)"
}

try {
  $Status = $Evaluation.Text | ConvertFrom-Json
} catch {
  throw 'readiness evaluator returned invalid JSON'
}

$StatusPath = Join-Path $ResolvedReceiptDir 'mvp-readiness.json'
$Status | ConvertTo-Json -Depth 12 | Set-Content -Path $StatusPath -Encoding utf8
Write-Output '== NaIA MVP readiness =='
Write-Output ($Status | ConvertTo-Json -Depth 12)

if ($Status.mvpCoreReady -ne 'PASS') { exit 2 }
