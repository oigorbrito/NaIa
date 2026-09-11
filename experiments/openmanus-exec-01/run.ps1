param(
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$OpenManusSha = '3309bf4e416fb1c74b008f3e86494439a31bad53'
$ExperimentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ExperimentDir '..\..')
$RuntimeRoot = Join-Path $Root '.experiment-runtime'
$VendorDir = Join-Path $RuntimeRoot 'openmanus'
$VenvDir = Join-Path $RuntimeRoot 'venv-openmanus'

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

if ($Clean -and (Test-Path $RuntimeRoot)) {
    Write-Host '== Clean runtime reset =='
    Remove-Item -LiteralPath $RuntimeRoot -Recurse -Force
}

Write-Host '== Environment =='
Invoke-Checked { node --version } 'Node version check'
Invoke-Checked { python --version } 'Host Python version check'

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

if (-not (Test-Path $VenvDir)) {
    Invoke-Checked { python -m venv $VenvDir } 'Python venv creation'
}

$Python = Join-Path $VenvDir 'Scripts\python.exe'
$Pip = Join-Path $VenvDir 'Scripts\pip.exe'

Invoke-Checked { & $Python --version } 'Experiment Python version check'
Invoke-Checked { & $Pip install --upgrade pip } 'pip upgrade'
Invoke-Checked { & $Pip install -r (Join-Path $VendorDir 'requirements.txt') } 'OpenManus requirements install'

$env:NAIA_OPENMANUS_ROOT = $VendorDir
$env:NAIA_OPENMANUS_PYTHON = $Python

Write-Host '== OpenManus contract =='
Push-Location $Root
try {
    Invoke-Checked { node --test experiments/openmanus-exec-01/adapter.test.mjs } 'OpenManus contract suite'
} finally {
    Pop-Location
}

Write-Host '== Reproduction run complete =='
Write-Host "OpenManus SHA: $OpenManusSha"
Write-Host "Clean run: $Clean"
