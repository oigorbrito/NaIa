$ErrorActionPreference = 'Stop'

$OpenManusSha = '3309bf4e416fb1c74b008f3e86494439a31bad53'
$ExperimentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ExperimentDir '..\..')
$VendorDir = Join-Path $Root '.experiment-runtime\openmanus'
$VenvDir = Join-Path $Root '.experiment-runtime\venv-openmanus'

Write-Host '== NaIA baseline =='
Push-Location $Root
try {
    node --version
    npm test
} finally {
    Pop-Location
}

if (-not (Test-Path $VendorDir)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $VendorDir) | Out-Null
    git clone https://github.com/FoundationAgents/OpenManus.git $VendorDir
}

Push-Location $VendorDir
try {
    git fetch --all --tags
    git checkout --detach $OpenManusSha
    $ActualSha = (git rev-parse HEAD).Trim()
    if ($ActualSha -ne $OpenManusSha) {
        throw "OpenManus SHA mismatch: expected $OpenManusSha got $ActualSha"
    }
} finally {
    Pop-Location
}

if (-not (Test-Path $VenvDir)) {
    python -m venv $VenvDir
}

$Python = Join-Path $VenvDir 'Scripts\python.exe'
$Pip = Join-Path $VenvDir 'Scripts\pip.exe'

& $Python --version
& $Pip install --upgrade pip
& $Pip install -r (Join-Path $VendorDir 'requirements.txt')

$env:NAIA_OPENMANUS_ROOT = $VendorDir
$env:NAIA_OPENMANUS_PYTHON = $Python

Push-Location $Root
try {
    node --test experiments/openmanus-exec-01/adapter.test.mjs
} finally {
    Pop-Location
}
