#requires -Version 7.4
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$testRoot = Join-Path $project ('artifacts/logs/storage-cleanup-20261006/verification-fixtures-' + [guid]::NewGuid().ToString('N'))
$cleaner = Join-Path $PSScriptRoot 'clean-verification-artifacts.ps1'
$passed = 0
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message }; $script:passed++ }
function Write-Json([string]$Path, $Value) {
    New-Item -ItemType Directory -Path (Split-Path $Path -Parent) -Force | Out-Null
    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}
function New-Fixture([string]$Name) {
    $path = Join-Path $testRoot "artifacts/verification/$Name"
    Write-Json (Join-Path $path 'check-result.json') @{ passed = $true; exitCodes = @{initialInventory=0;hostInstall=0;finalInventory=0;namespace=0;standaloneHost=0;host=0} }
    Write-Json (Join-Path $path 'host-result.json') @{passed=$true}
    Write-Json (Join-Path $path 'report.json') @{status='passed'}
    Write-Json (Join-Path $path 'auth-report.json') @{token='private'}
    Write-Json (Join-Path $path 'state/sessions/session.json') @{secret='private'}
    New-Item -ItemType Directory -Path (Join-Path $path 'extensions/payload') -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $path 'extensions/payload/large.bin'), [byte[]]::new(65536))
    $path
}
function Run-Clean([string]$Path, [string[]]$Protected = @(), [bool]$ApplyNow = $true) {
    & $cleaner -ProjectRoot $testRoot -FixtureRoot $Path -ProtectedPaths $Protected -Apply:$ApplyNow
}
function Start-Reference([string]$Reference) {
    $sleeper = Join-Path $testRoot 'sleep.ps1'
    'param([string]$Reference) Start-Sleep -Seconds 60' | Set-Content -LiteralPath $sleeper
    $info = [Diagnostics.ProcessStartInfo]::new((Get-Process -Id $PID).Path)
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    foreach ($arg in @('-NoProfile','-File',$sleeper,'-Reference',$Reference)) { $info.ArgumentList.Add($arg) }
    [Diagnostics.Process]::Start($info)
}
try {
    $fixture = New-Fixture 'completed spaces 한글'
    $preview = Run-Clean $fixture @() $false
    Assert ($preview.candidates[0].status -eq 'selected' -and (Test-Path -LiteralPath $fixture)) 'Preview changed fixture.'
    $report = Run-Clean $fixture
    $archive = Join-Path $testRoot 'artifacts/logs/verification-evidence/completed spaces 한글'
    Assert ($report.candidates[0].status -eq 'deleted' -and -not (Test-Path -LiteralPath $fixture)) 'Completed fixture retained.'
    Assert ((Test-Path -LiteralPath (Join-Path $archive 'check-result.json')) -and (Test-Path -LiteralPath (Join-Path $archive 'host-result.json')) -and (Test-Path -LiteralPath (Join-Path $archive 'report.json'))) 'Compact evidence missing.'
    Assert (@(Get-ChildItem -LiteralPath $archive -Recurse -File).Count -eq 3) 'Private or payload data archived.'
    $fixture = New-Fixture 'protected'
    $report = Run-Clean $fixture @((Join-Path $fixture 'state'))
    Assert ($report.candidates[0].reason -match 'Protected' -and (Test-Path -LiteralPath $fixture)) 'Protected path ignored.'
    $fixture = New-Fixture 'failed'
    Write-Json (Join-Path $fixture 'check-result.json') @{passed=$false;exitCodes=@{host=1}}
    Assert ((Run-Clean $fixture).candidates[0].reason -match 'Failed or incomplete') 'Failed fixture selected.'
    $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $fixture -IncludeDiagnosedFixtures -Apply
    Assert ($diagnosed.candidates[0].status -eq 'deleted' -and (Test-Path -LiteralPath (Join-Path $testRoot 'artifacts/logs/verification-evidence/failed/check-result.json'))) 'Diagnosed failed fixture not removed with evidence.'
    $fixture = New-Fixture 'unknown'
    Remove-Item -LiteralPath (Join-Path $fixture 'check-result.json')
    Assert ((Run-Clean $fixture).candidates[0].reason -match 'Unknown or incomplete') 'Unknown fixture selected.'
    $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $fixture -IncludeDiagnosedFixtures -Apply
    Assert ($diagnosed.candidates[0].status -eq 'deleted' -and (Test-Path -LiteralPath (Join-Path $testRoot 'artifacts/logs/verification-evidence/unknown/cleanup-receipt.json'))) 'Diagnosed unknown fixture not removed with receipt.'
    $fixture = New-Fixture 'active'
    $proc = Start-Reference ('\\?\' + $fixture.Replace('\','/'))
    try { Assert ((Run-Clean $fixture).candidates[0].reason -match 'Active command') 'Normalized active path missed.' }
    finally { if (-not $proc.HasExited) { $proc.Kill($true) }; $proc.WaitForExit(); $proc.Dispose() }
    $proc = Start-Reference ($fixture + '-backup')
    try { Assert ((Run-Clean $fixture).candidates[0].status -eq 'deleted') 'Sibling substring falsely protected.' }
    finally { if (-not $proc.HasExited) { $proc.Kill($true) }; $proc.WaitForExit(); $proc.Dispose() }
    $outside = Join-Path $testRoot 'outside'
    New-Item -ItemType Directory -Path $outside -Force | Out-Null
    $sentinel = Join-Path $outside 'sentinel.txt'
    'preserve me' | Set-Content -LiteralPath $sentinel
    Assert ((Run-Clean $outside).candidates[0].reason -match 'immediate verification child') 'Outside containment not rejected.'
    Assert ((Run-Clean (Join-Path $testRoot 'artifacts/verification')).candidates[0].reason -match 'immediate verification child') 'Verification root selected.'
    $stage = Join-Path $testRoot ('artifacts/deployments/deploy-interrupted/package/stage-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Assert ((Run-Clean $stage).candidates[0].reason -match 'immediate verification child') 'Package stage allowed without explicit diagnosis.'
    $proc = Start-Reference $stage
    try {
        $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $stage -IncludeDiagnosedFixtures -Apply
        Assert ($diagnosed.candidates[0].reason -match 'Active command' -and (Test-Path -LiteralPath $stage)) 'Active package stage removed.'
    } finally { if (-not $proc.HasExited) { $proc.Kill($true) }; $proc.WaitForExit(); $proc.Dispose() }
    $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $stage -IncludeDiagnosedFixtures -Apply
    Assert ($diagnosed.candidates[0].status -eq 'deleted' -and -not (Test-Path -LiteralPath $stage)) 'Diagnosed package stage not removed.'
    $stage = Join-Path $testRoot ('artifacts/deployments/deploy-installed/package/stage-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Write-Json (Join-Path (Split-Path (Split-Path $stage -Parent) -Parent) 'deployment.json') @{hostInstalled=$true}
    $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $stage -IncludeDiagnosedFixtures -Apply
    Assert ($diagnosed.candidates[0].reason -match 'Installed deployment' -and (Test-Path -LiteralPath $stage)) 'Installed package stage removed.'
    $badStage = Join-Path (Split-Path $stage -Parent) 'stage-invalid'
    New-Item -ItemType Directory -Path $badStage -Force | Out-Null
    $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $badStage -IncludeDiagnosedFixtures -Apply
    Assert ($diagnosed.candidates[0].reason -match 'immediate verification child') 'Malformed package stage selected.'
    $fixture = New-Fixture 'nested-junction'
    New-Item -ItemType Junction -Path (Join-Path $fixture 'extensions/outside-link') -Target $outside | Out-Null
    Assert ((Run-Clean $fixture).candidates[0].status -eq 'deleted') 'Nested junction prevented safe fixture removal.'
    Assert ((Get-Content -LiteralPath $sentinel -Raw).Trim() -eq 'preserve me') 'Nested junction target changed.'
    $link = Join-Path $testRoot 'artifacts/verification/linked-candidate'
    New-Item -ItemType Junction -Path $link -Target $outside | Out-Null
    Assert ((Run-Clean $link).candidates[0].reason -match 'Linked path') 'Linked candidate selected.'
    Remove-Item -LiteralPath $link -Force
    $fixture = New-Fixture 'installed'
    Write-Json (Join-Path $testRoot 'artifacts/deployments/current/deployment.json') @{ status='installed-reload-required';hostInstalled=$true;packageDirectory=(Join-Path $testRoot 'package');stateRoot=(Join-Path $fixture 'state') }
    Assert ((Run-Clean $fixture).candidates[0].reason -match 'Protected reference') 'Installed fixture reference ignored.'
    $fixture = New-Fixture 'previous'
    Write-Json (Join-Path $testRoot 'artifacts/deployments/previous/deployment.json') @{ status='installed-reload-required';hostInstalled=$true;packageDirectory=(Join-Path $testRoot 'previous-package') }
    Write-Json (Join-Path $testRoot 'artifacts/logs/previous/deployment-metrics.json') @{packageDirectory=(Join-Path $testRoot 'previous-package');fixtureRoot=$fixture;acceptanceResult=(Join-Path $fixture 'check-result.json')}
    Assert ((Run-Clean $fixture).candidates[0].reason -match 'Protected reference') 'Previous linked metrics ignored.'
    $fixture = New-Fixture 'inspection-failure'
    'invalid json' | Set-Content -LiteralPath (Join-Path $testRoot 'artifacts/deployments/current/deployment.json')
    Assert ((Run-Clean $fixture).status -eq 'blocked' -and (Test-Path -LiteralPath $fixture)) 'Inspection failure did not preserve fixture.'
    [pscustomobject]@{Passed=$passed;Failed=0}
} finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $testContainer = [IO.Path]::GetFullPath((Join-Path $project 'artifacts/logs/storage-cleanup-20261006')).TrimEnd('\')
    if (-not $resolvedTestRoot.StartsWith($testContainer + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup escapes its fixture container.' }
    if (Test-Path -LiteralPath $resolvedTestRoot) { Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force }
}
