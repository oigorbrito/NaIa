param(
  [Parameter(Mandatory = $true)]
  [string]$TaskName,

  [Parameter(Mandatory = $true)]
  [string]$WorkingDirectory,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^(?:[01]\d|2[0-3]):[0-5]\d$')]
  [string]$DailyAt
)

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path $WorkingDirectory).Path
$wrapper = Join-Path $repo 'ops\windows\invoke-naia-schedule.ps1'
if (-not (Test-Path $wrapper)) {
  throw "schedule wrapper not found: $wrapper"
}

$time = [DateTime]::ParseExact($DailyAt, 'HH:mm', $null)
$actionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$wrapper`" -WorkingDirectory `"$repo`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArgs -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At $time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'External NaIA schedule delivery' `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State, TaskPath
