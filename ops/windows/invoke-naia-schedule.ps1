param(
  [Parameter(Mandatory = $true)]
  [string]$WorkingDirectory
)

$ErrorActionPreference = 'Stop'

if (-not $env:NAIA_SCHEDULE_AUTOMATION_ID) {
  throw 'NAIA_SCHEDULE_AUTOMATION_ID is required in the scheduled account environment'
}
if (-not $env:NAIA_SCHEDULE_SECRET) {
  throw 'NAIA_SCHEDULE_SECRET is required in the scheduled account environment'
}
if (-not $env:NAIA_SCHEDULE_EXPRESSION) {
  throw 'NAIA_SCHEDULE_EXPRESSION is required in the scheduled account environment'
}
if (-not $env:NAIA_SCHEDULE_INTENT) {
  throw 'NAIA_SCHEDULE_INTENT is required in the scheduled account environment'
}

$at = (Get-Date).ToUniversalTime()
$bucket = $at.ToString('yyyyMMddHHmm')
$occurrenceId = "$($env:NAIA_SCHEDULE_AUTOMATION_ID):$bucket"

Push-Location $WorkingDirectory
try {
  if (-not $env:NAIA_SCHEDULE_RECEIPT) {
    $env:NAIA_SCHEDULE_RECEIPT = Join-Path $WorkingDirectory '.reproduction\external-scheduler.json'
  }
  & npm run schedule:deliver -- $occurrenceId $at.ToString('o')
  if ($LASTEXITCODE -ne 0) {
    throw "NaIA schedule delivery failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
