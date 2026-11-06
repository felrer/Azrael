#requires -Version 7.4
[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/logs/build-metrics-validation'), [switch]$PackagingOnly)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$runDirectory = Join-Path $OutputDirectory ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
. (Join-Path $PSScriptRoot 'build-metrics.ps1')
$pwsh = (Get-Command pwsh -ErrorAction Stop | Select-Object -First 1).Source
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
if ($PackagingOnly) {
    $retained = Join-Path $runDirectory 'retained'
    $working = Join-Path $runDirectory 'working'
    $bundle = Join-Path $runDirectory 'bundle'
    New-Item -ItemType Directory -Path (Join-Path $retained 'codex-rs'), $bundle | Out-Null
    function Invoke-FixtureNative([string]$Command, [string[]]$Arguments) {
        & $Command @Arguments | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Fixture command failed ($LASTEXITCODE): $Command" }
    }
    '[workspace.package]' + "`n" + 'version = "0.159.3"' | Set-Content (Join-Path $retained 'codex-rs/Cargo.toml') -Encoding utf8NoBOM
    'retained engine source' | Set-Content (Join-Path $retained 'source.txt') -Encoding utf8NoBOM
    Invoke-FixtureNative git @('-C', $retained, 'init', '--quiet')
    Invoke-FixtureNative git @('-C', $retained, 'config', 'user.email', 'packaging@example.invalid')
    Invoke-FixtureNative git @('-C', $retained, 'config', 'user.name', 'Packaging Fixture')
    Invoke-FixtureNative git @('-C', $retained, 'config', 'core.autocrlf', 'false')
    Invoke-FixtureNative git @('-C', $retained, 'add', '.')
    Invoke-FixtureNative git @('-C', $retained, 'commit', '--quiet', '-m', 'retained fixture')
    Invoke-FixtureNative git @('-c', 'core.autocrlf=false', 'clone', '--quiet', '--no-hardlinks', $retained, $working)
    foreach ($name in @('azrael.exe', 'azrael-bridge.exe', 'azrael-code-mode-host.exe')) { "fixture $name" | Set-Content (Join-Path $bundle $name) -Encoding utf8NoBOM }
    $provenance = Join-Path $PSScriptRoot 'engine-provenance.py'
    $snapshot = Join-Path $runDirectory 'source-before.json'
    Invoke-FixtureNative python @('-B', $provenance, 'snapshot', '--root', $working, '--file', $snapshot)
    Invoke-FixtureNative python @('-B', $provenance, 'record', '--root', $working, '--file', $snapshot, '--engine-dir', $bundle, '--code-mode-host-source', (Join-Path $bundle 'azrael-code-mode-host.exe'))
    $vsix = Join-Path $runDirectory 'fixture.vsix'
    $archive = [IO.Compression.ZipFile]::Open($vsix, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $writer = [IO.StreamWriter]::new($archive.CreateEntry('extension/package.json').Open())
        try { $writer.Write('{"publisher":"azrael-ex-local","name":"azrael","version":"0.4.1"}') } finally { $writer.Dispose() }
    } finally { $archive.Dispose() }
    $package = Join-Path $PSScriptRoot 'package-azrael.ps1'
    $common = @('-NoProfile', '-File', $package, '-EnginePath', (Join-Path $bundle 'azrael.exe'), '-BridgePath', (Join-Path $bundle 'azrael-bridge.exe'), '-CompanionVsixPath', $vsix, '-SourceRoot', $working)
    Test-Case 'retained-source-package-success' {
        $output = Join-Path $runDirectory 'retained-release'
        & $pwsh @common -RetainedSourceRoot $retained -OutputDirectory $output *> (Join-Path $runDirectory 'retained-package.log')
        Assert-True ($LASTEXITCODE -eq 0) 'Matching mutable/retained snapshots must package successfully.'
        $info = Get-Content (Join-Path $output 'build-info.json') -Raw | ConvertFrom-Json
        Assert-True ($info.engineSourceRoot -ceq (Resolve-Path $retained).Path) 'Build info must bind the resolved retained engine root.'
        Invoke-FixtureNative python @('-B', $provenance, 'verify', '--root', $retained, '--engine-dir', (Join-Path $output 'engine'))
    }
    Test-Case 'default-source-package-preserved' {
        $output = Join-Path $runDirectory 'default-release'
        & $pwsh @common -OutputDirectory $output *> (Join-Path $runDirectory 'default-package.log')
        Assert-True ($LASTEXITCODE -eq 0) 'Default packaging must retain existing behavior.'
        Assert-True ((Get-Content (Join-Path $output 'build-info.json') -Raw | ConvertFrom-Json).engineSourceRoot -ceq (Resolve-Path $working).Path) 'Default build info source differs.'
    }
    foreach ($case in @(@{name='retained-mismatch';root=$retained}, @{name='mutable-mismatch';root=$working})) {
        Test-Case $case.name {
            $file = Join-Path $case.root 'source.txt'; $original = [IO.File]::ReadAllText($file)
            try {
                [IO.File]::WriteAllText($file, 'changed source')
                $output = Join-Path $runDirectory $case.name
                & $pwsh @common -RetainedSourceRoot $retained -OutputDirectory $output *> (Join-Path $runDirectory ($case.name + '.log'))
                Assert-True ($LASTEXITCODE -ne 0) 'Mismatched source must reject packaging.'
                Assert-True (-not (Test-Path $output)) 'Mismatched source reached output creation.'
            } finally { [IO.File]::WriteAllText($file, $original) }
        }
    }
    Test-Case 'retained-change-during-copy-rejected' {
        $wrapper = Join-Path $runDirectory 'mutate-during-copy.ps1'
        @'
param($PackageScript, $Engine, $Bridge, $Vsix, $Working, $Retained, $Output)
$global:retainedSourceFixtureMutationPath = Join-Path $Retained 'source.txt'
$global:retainedSourceFixtureMutated = $false
function Copy-Item {
    param($LiteralPath, $Destination)
    Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination
    if (-not $global:retainedSourceFixtureMutated) {
        $global:retainedSourceFixtureMutated = $true
        [IO.File]::WriteAllText($global:retainedSourceFixtureMutationPath, 'changed during package copy')
    }
}
& $PackageScript -EnginePath $Engine -BridgePath $Bridge -CompanionVsixPath $Vsix -SourceRoot $Working -RetainedSourceRoot $Retained -OutputDirectory $Output
'@ | Set-Content $wrapper -Encoding utf8NoBOM
        $file = Join-Path $retained 'source.txt'; $original = [IO.File]::ReadAllText($file)
        try {
            $output = Join-Path $runDirectory 'copy-race'
            & $pwsh -NoProfile -File $wrapper -PackageScript $package -Engine (Join-Path $bundle 'azrael.exe') -Bridge (Join-Path $bundle 'azrael-bridge.exe') -Vsix $vsix -Working $working -Retained $retained -Output $output *> (Join-Path $runDirectory 'copy-race.log')
            Assert-True ($LASTEXITCODE -ne 0) 'Retained mutation during copying must reject final provenance.'
            Assert-True (Test-Path $output) 'Copy-race fixture must reach output creation.'
            Assert-True (-not (Test-Path (Join-Path $output 'build-info.json'))) 'Copy-race failure published accepted build info.'
        } finally { [IO.File]::WriteAllText($file, $original) }
    }
    Test-Case 'retained-source-handoff-and-preservation-root' {
        $buildText = Get-Content (Join-Path $PSScriptRoot 'build-azrael.ps1') -Raw
        $deployText = Get-Content (Join-Path $PSScriptRoot 'deploy-azrael.ps1') -Raw
        Assert-True ($buildText -match 'RetainedSourceRoot = \$RetainedSourceRoot') 'Build must forward retained root to package.'
        Assert-True ($buildText.IndexOf("'engine-retained-source-check.log'") -lt $buildText.IndexOf("'release-packaging-and-copy'")) 'Retained check must precede packaging.'
        Assert-True ($deployText -match "\('-RetainedSourceRoot', \`$RetainedSourceRoot\)") 'Deploy must pass selected retained root.'
        foreach ($name in @('sourceConfig', 'enginePreservationConfig')) {
            $block = [regex]::Match($deployText, ('\$' + $name + ' = \[ordered\]@\{(?<body>[\s\S]*?)\r?\n\s*\}')).Groups['body'].Value
            Assert-True ($block -match 'engineSourceRoot = \[IO.Path\]::GetFullPath\(\$SourceRoot\)') "$name must keep the same mutable preflight/preservation root."
        }
    }
    $failed = @($results | Where-Object status -eq failed)
    [ordered]@{ passed=$results.Count-$failed.Count; failed=$failed.Count; results=@($results); runDirectory=$runDirectory } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $runDirectory 'results.json')
    Write-Output ([ordered]@{passed=$results.Count-$failed.Count; failed=$failed.Count; runDirectory=$runDirectory} | ConvertTo-Json -Compress)
    if ($failed.Count) { $failed | ForEach-Object { Write-Host "$($_.name): $($_.error)" }; exit 1 }
    exit 0
}
foreach ($code in @(0, 7, 8, -1)) {
    Test-Case "native-exit-$code" {
        $m = New-CaseMetrics "native-$code"
        $call = { Invoke-BuildCommand -Executable $pwsh -CommandArguments @('-NoProfile', '-Command', "exit $code") -LogName "native-$code.log" -LogDirectory $runDirectory -Metrics $m -MaximumSuccessExitCode 7 }
        if ($code -in @(0, 7)) { & $call } else { Expect-Failure $call "exit code $code" | Out-Null }
        Complete-BuildMetrics $m -Status $(if ($code -in @(0, 7)) { 'success' } else { 'failed' })
        $json = Read-CaseMetrics $m
        Assert-True ($json.stages.Count -eq 1) 'Native command must record one stage.'
        Assert-True ($null -ne $json.startedUtc -and $null -ne $json.completedUtc -and $null -ne $json.stages[0].startedUtc -and $null -ne $json.stages[0].completedUtc) 'Actual command/total timestamps missing.'
        Assert-True ($json.stages[0].exitCode -eq $code) 'Native exit must remain exact.'
        Assert-True ($json.stages[0].status -eq $json.status) 'Native status differs from expected total.'
    }
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
Test-Case 'memory-admission-failure-does-not-start-command' {
    $originalAdmission = (Get-Item Function:Wait-BuildMemory).ScriptBlock
    $marker = Join-Path $runDirectory 'memory-admission-command-started'
    try {
        Set-Item Function:Wait-BuildMemory { throw 'memory-admission-fixture-blocked' }
        $m = New-CaseMetrics 'memory-admission'
        Expect-Failure { Invoke-BuildCommand $pwsh @('-NoProfile', '-Command', "Set-Content -LiteralPath '$marker' -Value started") 'memory-admission.log' -LogDirectory $runDirectory -Metrics $m } 'memory-admission-fixture-blocked' | Out-Null
        Assert-True (-not (Test-Path -LiteralPath $marker)) 'Blocked command must remain unstarted.'
        Assert-True ($null -eq (Read-CaseMetrics $m).stages[0].exitCode) 'Admission failure has no child exit code.'
    } finally { Set-Item Function:Wait-BuildMemory $originalAdmission }
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
Test-Case 'shared-cargo-owner-follows-explicit-owner' {
    foreach ($scriptName in @('build-azrael.ps1', 'deploy-azrael.ps1')) {
        $tokens = $null; $errors = $null
        $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $scriptName), [ref]$tokens, [ref]$errors)
        Assert-True (-not $errors) 'Producer must parse.'
        $assignment = @($ast.FindAll({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left -is [Management.Automation.Language.VariableExpressionAst] -and $n.Left.VariablePath.UserPath -ceq 'cacheOwner'}, $true))
        Assert-True ($assignment.Count -eq 1) 'Expected one shared-cache owner selection boundary.'
        $projectRoot = 'execution-project'; $project = $projectRoot
        foreach ($case in @(@('cargo-owner','module-owner','cargo-owner'), @('','module-owner','module-owner'), @('','','execution-project'))) {
            $CargoCacheProjectRoot = $case[0]; $ModuleCacheProjectRoot = $case[1]
            $actual = & ([scriptblock]::Create($assignment[0].Extent.Text + '; $cacheOwner'))
            Assert-True ($actual -ceq $case[2]) "$scriptName selected the wrong shared owner."
        }
    }
}
Test-Case 'cache-context-and-phase-details' {
    $m = New-CaseMetrics 'cache-context'
    Set-BuildMetricContext $m 'cargo' ([ordered]@{ targetDirectory = 'owned-target'; profile = 'release'; decision = 'compile' })
    $s = Start-BuildStage $m 'cache-input' -Details ([ordered]@{ owner = 'module-cache'; reused = $true })
    Complete-BuildStage $m $s -ExitCode 0
    Complete-BuildMetrics $m -Status success
    $j = Read-CaseMetrics $m
    Assert-True ($j.context.cargo.targetDirectory -ceq 'owned-target' -and $j.context.cargo.profile -ceq 'release') 'Selected cache context must survive serialization.'
    Assert-True ($j.stages[0].details.reused -eq $true -and $j.stages[0].exitCode -eq 0) 'Phase details must not replace actual exit evidence.'
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
Test-Case 'release-selection-provenance-guard' {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'build-azrael.ps1'), [ref]$tokens, [ref]$errors)
    $buildTry = @($ast.FindAll({param($node)
        $node -is [Management.Automation.Language.TryStatementAst] -and
        $node.CatchClauses.Count -eq 1 -and
        $node.CatchClauses[0].Extent.Text -match 'Complete-BuildMetrics.*-Status failed'
    }, $true))
    $tryText = $buildTry[0].Body.Extent.Text
    $gate = $tryText.LastIndexOf("'packaged-source-check.log'")
    $move = $tryText.IndexOf('[IO.File]::Move(')
    Assert-True ($gate -ge 0 -and $move -gt $gate) 'Latest selection must follow final provenance command.'
    Assert-True ($buildTry[0].CatchClauses[0].Extent.Text -match '\bthrow\b') 'Failure must finalize metrics and rethrow.'
    Assert-True ($tryText.IndexOf('Complete-BuildMetrics $buildMetrics -Status success') -gt $move) 'Total success must follow pointer publication.'
}
Test-Case 'release-engine-recipe' {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'build-azrael.ps1'), [ref]$tokens, [ref]$errors)
    Assert-True (-not $errors) 'Build script must parse.'
    $engineTarget = Join-Path $runDirectory 'selected-target'
    $rustRoot = Join-Path $runDirectory 'source/codex-rs'
    $RetainedSourceRoot = Join-Path $runDirectory 'retained-source'
    $release = Join-Path $runDirectory 'selected-release'
    $logDirectory = Join-Path $runDirectory 'recipe-logs'
    function Invoke-RecipeExpression([string]$Text) {
        # Dynamic blocks have no script file; bind the production script root.
        $quotedRoot = "'" + $PSScriptRoot.Replace("'", "''") + "'"
        try { & ([scriptblock]::Create($Text.Replace('$PSScriptRoot', $quotedRoot))) }
        catch { throw "Recipe evaluation failed: $Text`n$($_.ScriptStackTrace)`n$_" }
    }
    $assignment = $ast.Find({param($node)
        $node -is [Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq '$EngineDirectory' -and $node.Right.Extent.Text -like '*Join-Path $engineTarget*'
    }, $true)
    Invoke-RecipeExpression ($assignment.Extent.Text + '; $EngineDirectory') | ForEach-Object {
        Assert-True ($_ -eq (Join-Path $engineTarget 'x86_64-pc-windows-msvc/release')) 'Default engine path must consume release outputs.'
    }
    function Invoke-BuildCommand($Command, $Arguments, $Log) {
        [pscustomobject]@{ command = $Command; arguments = $Arguments; log = $Log }
    }
    $cargo = $ast.Find({param($node)
        $node -is [Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'Invoke-BuildCommand' -and $node.Extent.Text -like "*'engine.log'"
    }, $true)
    $CodeModeHostPath = $null
    $call = Invoke-RecipeExpression $cargo.Extent.Text
    Assert-True ($call.command -eq 'node' -and $call.arguments[0] -eq (Join-Path $PSScriptRoot 'cargo-target-owner.cjs')) 'Build must retain the target owner.'
    Assert-True (($call.arguments -join '|') -eq ((@((Join-Path $PSScriptRoot 'cargo-target-owner.cjs'), 'build', '--release', '--locked', '--no-default-features', '--target', 'x86_64-pc-windows-msvc', '-p', 'codex-app-server', '--bin', 'azrael', '-p', 'codex-app-server-client', '--bin', 'azrael-bridge', '-p', 'codex-code-mode-host', '--bin', 'codex-code-mode-host')) -join '|')) 'Default release recipe must build the host from the selected source with the engine.'
    $CodeModeHostPath = 'selected external host'
    $externalCodeModeHost = $CodeModeHostPath
    $importedCall = Invoke-RecipeExpression $cargo.Extent.Text
    Assert-True (($importedCall.arguments -join '|') -eq (($call.arguments[0..($call.arguments.Count - 5)]) -join '|')) 'Imported host selection must preserve the original engine Cargo recipe.'
    $CodeModeHostPath = $null
    foreach ($gate in $ast.FindAll({param($node)
        $node -is [Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'Invoke-BuildCommand' -and $node.Extent.Text -like "*'engine-provenance.py'*" -and
        $node.Extent.Text -match "'(record|verify)'"
    }, $true)) {
        $call = Invoke-RecipeExpression $gate.Extent.Text
        $profileIndex = [Array]::IndexOf($call.arguments, '--profile')
        Assert-True ($profileIndex -ge 0 -and $call.arguments[$profileIndex + 1] -eq 'release') 'Record and every package/reuse gate must bind release.'
    }
    $record = $ast.Find({param($node)
        $node -is [Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'Invoke-BuildCommand' -and $node.Extent.Text -like "*'engine-provenance.log'"
    }, $true)
    $call = Invoke-RecipeExpression $record.Extent.Text
    Assert-True ('--code-mode-host-built' -in $call.arguments -and '--code-mode-host-source' -notin $call.arguments) 'Default host provenance must be source-built.'
    $CodeModeHostPath = $externalCodeModeHost = 'selected external host'
    $call = Invoke-RecipeExpression $record.Extent.Text
    $sourceIndex = [Array]::IndexOf($call.arguments, '--code-mode-host-source')
    Assert-True ($sourceIndex -ge 0 -and $call.arguments[$sourceIndex + 1] -eq $externalCodeModeHost -and '--code-mode-host-built' -notin $call.arguments) 'Imported host provenance must bind the selected host.'
    $selection = $ast.Find({param($node)
        $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$hostSelectionMatches' -and $node.Right -is [Management.Automation.Language.IfStatementAst]
    }, $true)
    $CodeModeHostPath = $null
    $candidateReceipt = [pscustomobject]@{ source = [pscustomobject]@{ sourceSha256 = 'selected source' } }
    foreach ($kind in @('source-built', 'external-import', $null)) {
        foreach ($sourceHash in @('selected source', 'different source')) {
            $candidateHost = [pscustomobject]@{ kind = $kind; sourceSha256 = $sourceHash; sha256 = 'host hash' }
            $actual = Invoke-RecipeExpression ($selection.Extent.Text + '; $hostSelectionMatches')
            Assert-True ($actual -eq ($kind -ceq 'source-built' -and $sourceHash -ceq 'selected source')) 'Default reuse must require source-built host with matching source identity.'
        }
    }
    function Test-Path { return $true }
    function Get-FileHash { return [pscustomobject]@{ Hash = 'selected host hash' } }
    $CodeModeHostPath = 'selected external host'
    foreach ($hostHash in @('selected host hash', 'different host hash')) {
        $candidateHost = [pscustomobject]@{ kind = 'external-import'; sha256 = $hostHash }
        $actual = Invoke-RecipeExpression ($selection.Extent.Text + '; $hostSelectionMatches')
        Assert-True ($actual -eq ($hostHash -eq 'selected host hash')) 'Imported reuse must require the selected host hash.'
    }
    $EngineDirectory = Join-Path $engineTarget 'x86_64-pc-windows-msvc/release'
    $hostSource = $ast.Find({param($node)
        $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$selectedCodeModeHost'
    }, $true)
    $externalCodeModeHost = $null
    $actual = Invoke-RecipeExpression ($hostSource.Extent.Text + '; $selectedCodeModeHost')
    Assert-True ($actual -eq (Join-Path $EngineDirectory 'codex-code-mode-host.exe')) 'Source-built host copy must select the Cargo output name.'
    $externalCodeModeHost = 'selected external host'
    $actual = Invoke-RecipeExpression ($hostSource.Extent.Text + '; $selectedCodeModeHost')
    Assert-True ($actual -eq $externalCodeModeHost) 'Imported host copy must select the explicit input.'
    $hashGuard = $ast.Find({param($node)
        $node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text -like '$externalCodeModeHost -and*' -and $node.Extent.Text -like '*Selected code-mode host changed during compilation*'
    }, $true)
    $externalCodeModeHostHash = 'selected host hash'
    Invoke-RecipeExpression $hashGuard.Extent.Text
    $externalCodeModeHostHash = 'old host hash'
    $rejected = $false
    try { Invoke-RecipeExpression $hashGuard.Extent.Text } catch { $rejected = $_.ToString() -like '*Selected code-mode host changed during compilation*' }
    Assert-True $rejected 'Imported host mutation during compilation must stop the build.'
    $compatibility = $ast.Find({param($node)
        $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Invoke-BuildCommand' -and $node.Extent.Text -like "*'code-mode-host-compatibility.log'"
    }, $true)
    $engine = Join-Path $EngineDirectory 'azrael.exe'
    $previousModuleCache, $previousSkipEngineBuild, $previousForceEngineCompatibility = $moduleCache, $SkipEngineBuild, $ForceEngineCompatibility
    $moduleCache = @{ Owner = 'selected cache project' }
    $SkipEngineBuild = $true
    $ForceEngineCompatibility = $false
    $call = Invoke-RecipeExpression $compatibility.Extent.Text
    $expectedCompatibility = @((Join-Path $PSScriptRoot 'check-build-engine-compatibility.mjs'), $EngineDirectory, (Join-Path $logDirectory 'code-mode-host-compatibility'), '--cache-project-root', $moduleCache.Owner)
    Assert-True (($call.arguments -join '|') -eq ($expectedCompatibility -join '|')) 'Reused engine compatibility must select the actual bundle and shared proof owner.'
    foreach ($condition in @('forced','rebuilt')) {
        $ForceEngineCompatibility = $condition -eq 'forced'
        $SkipEngineBuild = $condition -ne 'rebuilt'
        $call = Invoke-RecipeExpression $compatibility.Extent.Text
        Assert-True (($call.arguments -join '|') -eq (($expectedCompatibility + '--full') -join '|')) 'Forced or rebuilt engine compatibility must retain the full check.'
    }
    $moduleCache, $SkipEngineBuild, $ForceEngineCompatibility = $previousModuleCache, $previousSkipEngineBuild, $previousForceEngineCompatibility
    function python { [pscustomobject]@{ arguments = @($args) } }
    $sourceRoot = Join-Path $runDirectory 'selected-source'
    $candidateEngine = Join-Path $runDirectory 'previous-release/engine'
    $autoGate = $ast.Find({param($node)
        $node -is [Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'python' -and $node.Extent.Text -like '*engine-auto-reuse.log*'
    }, $true)
    # Drop the log redirect so the fixture can inspect the actual evaluated argv.
    $autoCommand = $autoGate.Extent.Text -replace '\s+\*>.*$', ''
    $call = Invoke-RecipeExpression $autoCommand
    $profileIndex = [Array]::IndexOf($call.arguments, '--profile')
    Assert-True ($profileIndex -ge 0 -and $call.arguments[$profileIndex + 1] -eq 'release') 'Automatic reuse must require release provenance.'
}
Test-Case 'actual-build-isolated-provenance-failure' {
    $fixture = Join-Path $runDirectory 'project'
    $fixtureScripts = Join-Path $fixture 'scripts'
    $source = Join-Path $fixture 'source'
    $engine = Join-Path $fixture 'engine'
    New-Item -ItemType Directory -Path $fixtureScripts, (Join-Path $source 'codex-rs'), $engine, (Join-Path $fixture 'artifacts') -Force | Out-Null
    foreach ($name in @('build-azrael.ps1', 'deployment-input-snapshot.cjs', 'pipeline-state.cjs', 'verification-reuse-policy.cjs', 'build-metrics.ps1', 'build-resource-admission.cjs', 'maintenance-preferences.cjs', 'build-module-cache.ps1', 'build-module-companion-recipe.ps1', 'build-module-providers-recipe.ps1', 'artifact-lifecycle.ps1', 'artifact-lifecycle.cjs', 'artifact-observations.cjs', 'maintenance-lock-owner.cjs', 'maintenance-lock-worker.cjs', 'maintenance-lock-client.cjs', 'maintenance-owner-config.cjs', 'engine-provenance.py', 'import-engine-source.py', 'azrael-platforms.json')) {
        Copy-Item (Join-Path $PSScriptRoot $name) (Join-Path $fixtureScripts $name)
        Assert-True ((Get-FileHash (Join-Path $PSScriptRoot $name)).Hash -eq (Get-FileHash (Join-Path $fixtureScripts $name)).Hash) 'Fixture must execute byte-identical production scripts.'
    }
    '[workspace]' | Set-Content (Join-Path $source 'codex-rs/Cargo.toml')
    $pipelineContext = Join-Path $runDirectory 'isolated-pipeline-context.json'
    @{ file = (Join-Path $fixture 'artifacts/pipeline-state.json'); identity = @{ fixture = $fixture } } | ConvertTo-Json -Depth 4 | Set-Content $pipelineContext -Encoding utf8NoBOM
    $latest = Join-Path $fixture 'artifacts/latest.json'
    '{"sentinel":"existing-release"}' | Set-Content $latest
    $before = (Get-FileHash $latest).Hash
    $productionLatest = Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/latest.json'
    $productionBefore = if (Test-Path $productionLatest) { (Get-FileHash $productionLatest).Hash } else { $null }
    # The isolated project has no installed owner receipt. Bind its child to
    # the verified primary owner through the existing explicit override.
    $previousOwner = $env:AZRAEL_MAINTENANCE_OWNER
    $previousMode = $env:AZRAEL_MAINTENANCE_OWNER_MODE
    try {
        $ownerJson = & node -e 'process.stdout.write(JSON.stringify(require(process.argv[1]).resolveMaintenanceCommand(process.argv[2])))' (Join-Path $PSScriptRoot 'maintenance-owner-config.cjs') (Split-Path $PSScriptRoot -Parent)
        if ($LASTEXITCODE -ne 0) { throw 'Fixture maintenance owner prerequisite failed.' }
        $owner = ($ownerJson -join "`n") | ConvertFrom-Json
        $env:AZRAEL_MAINTENANCE_OWNER = $owner.executable
        $env:AZRAEL_MAINTENANCE_OWNER_MODE = if (@($owner.args).Count) { 'azrael-maintenance' } else { 'standalone' }
        & $pwsh -NoProfile -File (Join-Path $fixtureScripts 'build-azrael.ps1') -ReleaseName missing-receipt -SkipEngineBuild -SourceRoot $source -EngineDirectory $engine -PipelineContextPath $pipelineContext -LifecycleParentActive *> (Join-Path $runDirectory 'isolated-build.log')
        $actualExit = $LASTEXITCODE
    } finally { $env:AZRAEL_MAINTENANCE_OWNER = $previousOwner; $env:AZRAEL_MAINTENANCE_OWNER_MODE = $previousMode }
    Assert-True ($actualExit -ne 0) 'Actual build must fail on absent provenance receipt.'
    Assert-True ((Get-Content (Join-Path $fixture 'artifacts/logs/missing-receipt/engine-source-check.log') -Raw) -match 'Engine has no source provenance') 'Fixture must reach the missing engine receipt guard.'
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
if (-not $failed.Count) {
    $fixture = [IO.Path]::GetFullPath((Join-Path $runDirectory 'project'))
    $boundary = [IO.Path]::GetFullPath($runDirectory) + [IO.Path]::DirectorySeparatorChar
    Assert-True ($fixture.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) 'Fixture cleanup escaped generated run.'
    if (Test-Path -LiteralPath $fixture) {
        Assert-True (-not @(Get-ChildItem -LiteralPath $fixture -Force -Recurse | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) 'Unexpected fixture link before cleanup.'
        Remove-Item -LiteralPath $fixture -Recurse -ErrorAction Stop
        Assert-True (-not (Test-Path -LiteralPath $fixture)) 'Metrics fixture remains after cleanup.'
    }
}
[ordered]@{ passed = $results.Count - $failed.Count; failed = $failed.Count; results = @($results); runDirectory = $runDirectory } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $runDirectory 'results.json')
Write-Host "Build metrics validation: $($results.Count - $failed.Count) passed, $($failed.Count) failed. Results: $runDirectory"
if ($failed.Count) { $failed | ForEach-Object { Write-Host "$($_.name): $($_.error)" }; exit 1 }
exit 0
