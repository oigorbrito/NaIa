param(
  [Parameter(Mandatory = $true)]
  [string]$TaskName,

  [Parameter(Mandatory = $true)]
  [string]$WorkingDirectory,

  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
if ($TimeoutSeconds -le 0) { throw 'TimeoutSeconds must be positive' }

$repo = (Resolve-Path $WorkingDirectory).Path
$receiptPath = Join-Path $repo '.reproduction\external-scheduler.json'
$head = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $head) { throw 'Unable to resolve repository HEAD' }

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if (-not $task) { throw "Scheduled Task not found: $TaskName" }

Remove-Item $receiptPath -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $TaskName

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  if (Test-Path $receiptPath) {
    try {
      $receipt = Get-Content -Raw $receiptPath | ConvertFrom-Json
      if ($receipt.status -eq 'PASS' -and
          $receipt.gate -eq 'EXTERNAL_SCHEDULER_DELIVERY' -and
          $receipt.commit -eq $head) {
        Write-Output (ConvertTo-Json ([ordered]@{
          status = 'PASS'
          gate = 'EXTERNAL_SCHEDULER_TASK'
          taskName = $TaskName
          commit = $head
          deliveryReceipt = $receiptPath
          occurrenceId = $receipt.occurrenceId
          objectiveId = $receipt.objectiveId
          observedAt = (Get-Date).ToUniversalTime().ToString('o')
        }) -Depth 5)
        exit 0
      }
    } catch {
      # The scheduled process may still be replacing/writing the receipt.
    }
  }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)

$info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
$lastResult = if ($info) { $info.LastTaskResult } else { $null }
throw "Scheduled Task did not produce a valid current-commit receipt within $TimeoutSeconds seconds (LastTaskResult=$lastResult)"
