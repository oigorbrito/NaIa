param(
  [string]$ExpectedBranch = 'research/qualified-chassis-gate-v1'
)

$ErrorActionPreference = 'Stop'
$results = [ordered]@{}

function Record([string]$Name, [bool]$Pass, [string]$Detail) {
  $script:results[$Name] = [ordered]@{ pass = $Pass; detail = $Detail }
}

function Try-Command([string]$Name, [scriptblock]$Command) {
  try {
    $value = & $Command
    Record $Name $true (($value | Out-String).Trim())
  } catch {
    Record $Name $false $_.Exception.Message
  }
}

Try-Command 'git_available' { git --version }
Try-Command 'repository_branch' {
  $branch = (git branch --show-current).Trim()
  if ($branch -ne $ExpectedBranch) { throw "expected=$ExpectedBranch actual=$branch" }
  $branch
}
Try-Command 'repository_clean' {
  $status = git status --porcelain
  if ($status) { throw "worktree is not clean`n$status" }
  'clean'
}
Try-Command 'local_head' { git rev-parse HEAD }
Try-Command 'remote_head' {
  git fetch origin $ExpectedBranch --quiet
  git rev-parse "origin/$ExpectedBranch"
}
Try-Command 'head_matches_remote' {
  $local = (git rev-parse HEAD).Trim()
  $remote = (git rev-parse "origin/$ExpectedBranch").Trim()
  if ($local -ne $remote) { throw "local=$local remote=$remote" }
  $local
}

Try-Command 'node_available' {
  $version = (node --version).Trim()
  $major = [int]($version.TrimStart('v').Split('.')[0])
  if ($major -notin @(22,24)) { throw "unsupported Node major: $major (expected 22 or 24)" }
  $version
}
Try-Command 'npm_available' { npm --version }
Try-Command 'docker_cli_available' { docker --version }
Try-Command 'docker_daemon_available' { docker info --format '{{.ServerVersion}}' }

foreach ($target in @(
  @{ name='dns_github'; host='github.com' },
  @{ name='dns_npm'; host='registry.npmjs.org' },
  @{ name='dns_ghcr'; host='ghcr.io' }
)) {
  Try-Command $target.name {
    $addresses = [System.Net.Dns]::GetHostAddresses($target.host)
    if (-not $addresses -or $addresses.Count -eq 0) { throw "no addresses for $($target.host)" }
    ($addresses | ForEach-Object { $_.IPAddressToString }) -join ','
  }
}

Try-Command 'https_github' {
  $response = Invoke-WebRequest -Uri 'https://github.com' -Method Head -TimeoutSec 20 -UseBasicParsing
  "HTTP $($response.StatusCode)"
}
Try-Command 'https_npm' {
  $response = Invoke-WebRequest -Uri 'https://registry.npmjs.org' -Method Head -TimeoutSec 20 -UseBasicParsing
  "HTTP $($response.StatusCode)"
}

$failed = @($results.GetEnumerator() | Where-Object { -not $_.Value.pass })
$classification = if ($failed.Count -eq 0) { 'BLOCK2_LOCAL_EXECUTION_PREFLIGHT_PASS' } else { 'BLOCK2_LOCAL_EXECUTION_PREFLIGHT_BLOCKED' }

$output = [ordered]@{
  classification = $classification
  timestampUtc = [DateTime]::UtcNow.ToString('o')
  expectedBranch = $ExpectedBranch
  results = $results
}

$output | ConvertTo-Json -Depth 6

if ($failed.Count -gt 0) {
  exit 2
}
