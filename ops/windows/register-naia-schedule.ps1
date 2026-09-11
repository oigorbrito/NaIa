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
$configPath = Join-Path $repo '.naia\ops\schedule.json'
$secretPath = Join-Path $repo '.naia\ops\schedule.secret'
if (-not (Test-Path $wrapper)) {
  throw "schedule wrapper not found: $wrapper"
}
if (-not (Test-Path $configPath)) {
  throw "schedule config not found: $configPath; run configure-naia-schedule.ps1 first"
}
if (-not (Test-Path $secretPath)) {
  throw "schedule secret not found: $secretPath; run configure-naia-schedule.ps1 first"
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
