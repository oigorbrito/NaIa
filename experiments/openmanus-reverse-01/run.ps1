param(
    [switch]$Clean,
    [switch]$ProbeBrowserMcp
)

$ErrorActionPreference = 'Stop'
$OpenManusSha = '3309bf4e416fb1c74b008f3e86494439a31bad53'
$ExperimentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ExperimentDir '..\..')
$RuntimeRoot = Join-Path $Root '.experiment-runtime'
$VendorDir = Join-Path $RuntimeRoot 'openmanus'

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Command,
        [Parameter(Mandatory = $true)][string]$Label
    )
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

if ($Clean -and (Test-Path $VendorDir)) {
    Write-Host '== Clean OpenManus checkout reset =='
    Remove-Item -LiteralPath $VendorDir -Recurse -Force
}

Write-Host '== Environment =='
Invoke-Checked { node --version } 'Node version check'

Write-Host '== NaIA baseline =='
Push-Location $Root
try {
    Invoke-Checked { npm test } 'NaIA baseline'
} finally {
    Pop-Location
}

if (-not (Test-Path $VendorDir)) {
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    Invoke-Checked { git clone https://github.com/FoundationAgents/OpenManus.git $VendorDir } 'OpenManus clone'
}

Push-Location $VendorDir
try {
    Invoke-Checked { git fetch --all --tags } 'OpenManus fetch'
    Invoke-Checked { git checkout --detach $OpenManusSha } 'OpenManus checkout'
    $ActualSha = (git rev-parse HEAD).Trim()
    if ($ActualSha -ne $OpenManusSha) {
        throw "OpenManus SHA mismatch: expected $OpenManusSha got $ActualSha"
    }
} finally {
    Pop-Location
}

$env:NAIA_OPENMANUS_ROOT = $VendorDir

Write-Host '== Reverse integration authority suite =='
Push-Location $Root
try {
    Invoke-Checked { node --test experiments/openmanus-reverse-01/reverse-gateway.test.mjs } 'Reverse integration suite'
} finally {
    Pop-Location
}

Write-Host '== Capability value inventory =='
Push-Location $Root
try {
    Invoke-Checked { node --test experiments/openmanus-reverse-01/value-inventory.test.mjs } 'Capability value inventory'
} finally {
    Pop-Location
}

Write-Host '== Optional Browser Use MCP availability probe =='
if ($ProbeBrowserMcp) {
    $Uvx = Get-Command uvx -ErrorAction SilentlyContinue
    if (-not $Uvx) {
        Write-Host 'BROWSER_MCP_PROBE=BLOCKED_EXTERNAL reason=uvx-not-found'
    } else {
        $PreviousErrorActionPreference = $ErrorActionPreference
        $PreviousNativePreference = $null
        $HasNativePreference = Test-Path variable:PSNativeCommandUseErrorActionPreference
        if ($HasNativePreference) {
            $PreviousNativePreference = $PSNativeCommandUseErrorActionPreference
            $PSNativeCommandUseErrorActionPreference = $false
        }
        try {
            $ErrorActionPreference = 'Continue'
            & $Uvx.Source browser-use --help 2>&1 | Out-Null
            $ProbeExit = $LASTEXITCODE
        } catch {
            $ProbeExit = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { -1 }
        } finally {
            $ErrorActionPreference = $PreviousErrorActionPreference
            if ($HasNativePreference) {
                $PSNativeCommandUseErrorActionPreference = $PreviousNativePreference
            }
        }

        if ($ProbeExit -eq 0) {
            Write-Host 'BROWSER_MCP_PROBE=PASS'
        } else {
            Write-Host "BROWSER_MCP_PROBE=BLOCKED_EXTERNAL exit=$ProbeExit"
        }
    }
} else {
    Write-Host 'BROWSER_MCP_PROBE=NOT_EXECUTED (use -ProbeBrowserMcp to probe external CLI availability)'
}

Write-Host '== Reverse integration run complete =='
Write-Host "OpenManus SHA: $OpenManusSha"
Write-Host "Clean checkout: $Clean"
Write-Host 'MVP_ADOPTION_GATE=DEFERRED_UNTIL_LIVE_BROWSER_TASK_PASS'
