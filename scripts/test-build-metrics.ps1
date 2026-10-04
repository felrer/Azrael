#requires -Version 7.4
[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/logs/build-metrics-validation'))
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$runDirectory = Join-Path $OutputDirectory ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
. (Join-Path $PSScriptRoot 'build-metrics.ps1')
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$results = [Collections.Generic.List[object]]::new()
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Test-Case([string]$Name, [scriptblock]$Body) {
    try {
        & $Body
        $results.Add([ordered]@{ name = $Name; status = 'passed' })
    } catch {
        $results.Add([ordered]@{ name = $Name; status = 'failed'; error = $_.ToString() })
    }
}
function New-CaseMetrics([string]$Name) {
    New-BuildMetrics -Path (Join-Path $runDirectory ($Name + '.json'))
}
function Read-CaseMetrics($Metrics) {
    Get-Content -LiteralPath $Metrics.Path -Raw | ConvertFrom-Json
}
function Expect-Failure([scriptblock]$Body, [string]$Pattern) {
    $caught = $null
    try { & $Body | Out-Null } catch { $caught = $_ }
    Assert-True ($null -ne $caught) 'Expected a terminating failure.'
    Assert-True ($caught.ToString() -match $Pattern) "Unexpected failure: $caught"
    return $caught
}
foreach ($code in @(0, 7, 8, -1)) {
    Test-Case "native-exit-$code" {
        $m = New-CaseMetrics "native-$code"
        $call = { Invoke-BuildCommand -Executable $pwsh -CommandArguments @('-NoProfile', '-Command', "exit $code") -LogName "native-$code.log" -LogDirectory $runDirectory -Metrics $m -MaximumSuccessExitCode 7 }
        if ($code -in @(0, 7)) { & $call } else { Expect-Failure $call "exit code $code" | Out-Null }
        Complete-BuildMetrics $m -Status $(if ($code -in @(0, 7)) { 'success' } else { 'failed' })
        $json = Read-CaseMetrics $m
        Assert-True ($json.stages.Count -eq 1) 'Native command must record one stage.'
        Assert-True ($json.stages[0].exitCode -eq $code) 'Native exit must remain exact.'
        Assert-True ($json.stages[0].status -eq $json.status) 'Native status differs from expected total.'
    }.GetNewClosure()
}
Test-Case 'native-default-rejects-seven' {
    $m = New-CaseMetrics 'native-default'
    Expect-Failure { Invoke-BuildCommand $pwsh @('-NoProfile', '-Command', 'exit 7') 'default.log' -LogDirectory $runDirectory -Metrics $m } 'exit code 7' | Out-Null
    Assert-True ((Read-CaseMetrics $m).stages[0].status -eq 'failed') 'Default accepts only zero.'
}
Test-Case 'stdout-stderr-capture' {
    $m = New-CaseMetrics 'capture'
    $captured = Invoke-BuildCommand $pwsh @('-NoProfile', '-Command', '[Console]::Out.WriteLine("stdout-marker"); [Console]::Error.WriteLine("stderr-marker"); exit 0') 'capture.log' -LogDirectory $runDirectory -Metrics $m -CaptureOutput
    Assert-True ($captured -match 'stdout-marker' -and $captured -match 'stderr-marker') 'Both streams must be captured.'
    Assert-True ($captured -eq (Get-Content (Join-Path $runDirectory 'capture.log') -Raw)) 'Capture differs from retained log.'
}
Test-Case 'command-not-found' {
    $m = New-CaseMetrics 'not-found'
    Expect-Failure { Invoke-BuildCommand 'missing-build-command-07d151' @() 'not-found.log' -LogDirectory $runDirectory -Metrics $m } 'missing-build-command-07d151' | Out-Null
    $j = Read-CaseMetrics $m
    Assert-True ($j.stages[0].status -eq 'failed') 'Missing command must fail its stage.'
    Assert-True ($null -eq $j.stages[0].exitCode) 'Missing command has no native exit.'
    Assert-True ((Get-Content (Join-Path $runDirectory 'not-found.log') -Raw) -match 'missing-build-command') 'Missing command error must be logged.'
}
Test-Case 'throwing-command' {
    function Throw-BuildFixture { throw 'original-command-throw' }
    $m = New-CaseMetrics 'throw'
    Expect-Failure { Invoke-BuildCommand 'Throw-BuildFixture' @() 'throw.log' -LogDirectory $runDirectory -Metrics $m } 'original-command-throw' | Out-Null
    Assert-True ((Read-CaseMetrics $m).stages[0].status -eq 'failed') 'Throwing command must fail.'
}
$nativeScript = Join-Path $runDirectory 'native-package.ps1'
$laterMarker = Join-Path $runDirectory 'later-native-marker'
@'
param($Native, $Marker)
& $Native -NoProfile -Command 'exit 9'
Set-Content -LiteralPath $Marker -Value 'later command reached'
& $Native -NoProfile -Command 'exit 0'
'@ | Set-Content $nativeScript
$throwScript = Join-Path $runDirectory 'throw-package.ps1'
"throw 'original-package-throw'" | Set-Content $throwScript
$successScript = Join-Path $runDirectory 'successful-package.ps1'
"param(`$Native); & `$Native -NoProfile -Command 'exit 0'" | Set-Content $successScript
Test-Case 'script-success' {
    $m = New-CaseMetrics 'script-success'
    Invoke-BuildScript $successScript @{ Native = $pwsh } 'script-success.log' -LogDirectory $runDirectory -Metrics $m
    $j = Read-CaseMetrics $m
    Assert-True ($j.stages[0].status -eq 'success' -and $j.stages[0].exitCode -eq 0) 'Script success must record zero.'
}
Test-Case 'script-terminating-powershell-failure' {
    $m = New-CaseMetrics 'script-throw'
    Expect-Failure { Invoke-BuildScript $throwScript @{} 'script-throw.log' -LogDirectory $runDirectory -Metrics $m } 'original-package-throw' | Out-Null
    Assert-True ((Read-CaseMetrics $m).stages[0].status -eq 'failed') 'Package throw must fail.'
    Assert-True ((Get-Content (Join-Path $runDirectory 'script-throw.log') -Raw) -match 'original-package-throw') 'Package error missing from log.'
}
Test-Case 'script-native-failure-stops-before-success' {
    $m = New-CaseMetrics 'script-native'
    Expect-Failure { Invoke-BuildScript $nativeScript @{ Native = $pwsh; Marker = $laterMarker } 'script-native.log' -LogDirectory $runDirectory -Metrics $m } '9' | Out-Null
    $j = Read-CaseMetrics $m
    Assert-True ($j.stages[0].status -eq 'failed' -and $j.stages[0].exitCode -eq 9) 'Package must retain first failing native exit.'
    Assert-True (-not (Test-Path $laterMarker)) 'Package continued after native failure.'
}
Test-Case 'advisory-metrics-write-failure' {
    $m = New-BuildMetrics -Path $runDirectory
    Expect-Failure { Invoke-BuildCommand $pwsh @('-NoProfile', '-Command', 'exit 11') 'write-failure-native.log' -LogDirectory $runDirectory -Metrics $m } 'exit code 11' | Out-Null
    Assert-True ($m.Stages[0].ExitCode -eq 11) 'Metrics write failure replaced native exit.'
    Expect-Failure { Invoke-BuildScript $throwScript @{} 'write-failure-throw.log' -LogDirectory $runDirectory -Metrics $m } 'original-package-throw' | Out-Null
    Complete-BuildMetrics $m -Status failed
    Assert-True ($m.Status -eq 'failed') 'In-memory metrics must finish despite filesystem failure.'
}
Test-Case 'pending-outer-phase-and-total-fail' {
    $m = New-CaseMetrics 'outer-phase'
    $phase = Start-BuildStage $m 'outer-phase'
    Expect-Failure { Invoke-BuildCommand $pwsh @('-NoProfile', '-Command', 'exit 12') 'outer-command.log' -LogDirectory $runDirectory -Metrics $m } 'exit code 12' | Out-Null
    Complete-BuildMetrics $m -Status failed
    $j = Read-CaseMetrics $m
    Assert-True ($j.status -eq 'failed' -and $j.stages.Count -eq 2) 'Total must fail and preserve both stages.'
    Assert-True (@($j.stages | Where-Object status -ne 'failed').Count -eq 0) 'Pending phase must be finalized as failed.'
    Assert-True (-not $m.Timer.IsRunning -and -not $phase.Timer.IsRunning) 'Total and phase timers must stop.'
    Assert-True ($j.elapsedMs -ge 0 -and $j.stages[0].elapsedMs -ge 0) 'Elapsed milliseconds must be nonnegative.'
}
Test-Case 'parse-production-scripts' {
    foreach ($file in @('build-metrics.ps1', 'build-azrael.ps1')) {
        $tokens = $null; $errors = $null
        [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file), [ref]$tokens, [ref]$errors)
        Assert-True ($errors.Count -eq 0) "Parse errors in $file`: $errors"
    }
}
Test-Case 'release-selection-provenance-guard' {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'build-azrael.ps1'), [ref]$tokens, [ref]$errors)
    $topTry = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })
    Assert-True ($topTry.Count -eq 1) 'Expected one top-level build try/catch.'
    $tryText = $topTry[0].Body.Extent.Text
    $gate = $tryText.LastIndexOf("'packaged-source-check.log'")
    $move = $tryText.IndexOf('[IO.File]::Move(')
    Assert-True ($gate -ge 0 -and $move -gt $gate) 'Latest selection must follow final provenance command.'
    Assert-True (($tryText.Substring($gate, $move - $gate)) -notmatch '(?m)^\s*(catch|finally|if|else|try)\b') 'Final provenance command must unconditionally precede selection.'
    $allText = $ast.Extent.Text
    Assert-True ([regex]::Matches($allText, '\[IO.File\]::Move\(').Count -eq 1) 'Unexpected alternative pointer publication.'
    Assert-True ($topTry[0].CatchClauses.Count -eq 1 -and $topTry[0].CatchClauses[0].Extent.Text -match 'Complete-BuildMetrics.*-Status failed' -and $topTry[0].CatchClauses[0].Extent.Text -match '\bthrow\b') 'Failure must finalize metrics and rethrow.'
    Assert-True ($tryText.IndexOf('Complete-BuildMetrics $buildMetrics -Status success') -gt $move) 'Total success must follow pointer publication.'
}
Test-Case 'actual-build-isolated-provenance-failure' {
    $fixture = Join-Path $runDirectory 'project'
    $fixtureScripts = Join-Path $fixture 'scripts'
    $source = Join-Path $fixture 'source'
    $engine = Join-Path $fixture 'engine'
    New-Item -ItemType Directory -Path $fixtureScripts, (Join-Path $source 'codex-rs'), $engine, (Join-Path $fixture 'artifacts') -Force | Out-Null
    foreach ($name in @('build-azrael.ps1', 'build-metrics.ps1', 'engine-provenance.py')) {
        Copy-Item (Join-Path $PSScriptRoot $name) (Join-Path $fixtureScripts $name)
        Assert-True ((Get-FileHash (Join-Path $PSScriptRoot $name)).Hash -eq (Get-FileHash (Join-Path $fixtureScripts $name)).Hash) 'Fixture must execute byte-identical production scripts.'
    }
    '[workspace]' | Set-Content (Join-Path $source 'codex-rs/Cargo.toml')
    $latest = Join-Path $fixture 'artifacts/latest.json'
    '{"sentinel":"existing-release"}' | Set-Content $latest
    $before = (Get-FileHash $latest).Hash
    $productionLatest = Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/latest.json'
    $productionBefore = if (Test-Path $productionLatest) { (Get-FileHash $productionLatest).Hash } else { $null }
    & $pwsh -NoProfile -File (Join-Path $fixtureScripts 'build-azrael.ps1') -ReleaseName missing-receipt -SkipEngineBuild -SourceRoot $source -EngineDirectory $engine *> (Join-Path $runDirectory 'isolated-build.log')
    $actualExit = $LASTEXITCODE
    Assert-True ($actualExit -ne 0) 'Actual build must fail on absent provenance receipt.'
    $j = Get-Content (Join-Path $fixture 'artifacts/logs/missing-receipt/build-metrics.json') -Raw | ConvertFrom-Json
    Assert-True ($j.status -eq 'failed' -and $j.stages.Count -eq 2) 'Actual build must record exactly provenance phase and command failures.'
    Assert-True (@($j.stages | Where-Object status -ne 'failed').Count -eq 0) 'Actual build left a running or successful failure phase.'
    Assert-True ($j.stages[0].name -eq 'engine-provenance-and-binary-check' -and $j.stages[1].exitCode -ne 0) 'Actual build failure phase/exit mismatch.'
    Assert-True ((Get-FileHash $latest).Hash -eq $before) 'Failed fixture build replaced latest.'
    $productionAfter = if (Test-Path $productionLatest) { (Get-FileHash $productionLatest).Hash } else { $null }
    Assert-True ($productionAfter -eq $productionBefore) 'Production latest changed.'
    Assert-True (-not (Test-Path (Join-Path $fixture 'artifacts/releases/missing-receipt'))) 'Early failure reached release packaging.'
    [ordered]@{ actualExitCode = $actualExit; metricsStageCount = $j.stages.Count; latestUnchanged = $true } | ConvertTo-Json | Set-Content (Join-Path $runDirectory 'integration-summary.json')
}
$failed = @($results | Where-Object status -eq 'failed')
[ordered]@{ passed = $results.Count - $failed.Count; failed = $failed.Count; results = @($results); runDirectory = $runDirectory } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $runDirectory 'results.json')
Write-Host "Build metrics validation: $($results.Count - $failed.Count) passed, $($failed.Count) failed. Results: $runDirectory"
if ($failed.Count) { $failed | ForEach-Object { Write-Host "$($_.name): $($_.error)" }; exit 1 }
exit 0
