#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]*$')][string]$ReleaseName,
    [string]$SourceRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'engine'),
    [string]$RetainedSourceRoot,
    [string]$EngineTargetDirectory,
    [string]$CargoCacheProjectRoot,
    [string]$ModuleCacheProjectRoot,
    [string]$DeploymentWorkspaceManifest,
    [string]$DeploymentWorkspaceSha256,
    [string]$CargoVerificationCacheProjectRoot,
    [string]$NamespaceCacheProjectRoot,
    [string[]]$PreflightToolDirectory,
    [long]$RequiredFreeBytes = 0,
    [long]$EstimatedCompilerGrowthBytes = 0,
    [string]$WindowControlTargetDirectory,
    [string]$VirtualInputRuntimeDirectory,
    [string]$MultiPointerRuntimeDirectory,
    [switch]$SkipEngineBuild,
    [string]$EngineDirectory,
    [string]$CodeModeHostPath,
    [string]$ComputerUseRuntimeDirectory,
    [string]$ComputerUsePluginDirectory,
    [string]$CompanionVsixPath,
    [string]$TypeScriptPath,
    [string]$UiSourcePath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/upstream-ui/26.1007.21434'),
    [string]$OriginalExtensionPath = (Join-Path $env:USERPROFILE '.vscode/extensions/openai.chatgpt-26.1007.21434-win32-x64'),
    [string]$OriginalAudioPath = (Join-Path $env:USERPROFILE '.vscode/extensions/openai.codex-audio-26.1007.21434'),
    [string]$CodePath = 'code.cmd',
    [string]$StateRoot = (Join-Path $env:USERPROFILE '.azrael-ex'),
    [string]$SourceCodexHome = (Join-Path $env:USERPROFILE '.codex'),
    [string]$WorkspacePath = (Split-Path $PSScriptRoot -Parent),
    [string]$ExtensionsDir = (Join-Path $env:USERPROFILE '.vscode/extensions'),
    [string]$UserDataDir,
    [string]$VerificationFixtureRoot,
    [switch]$VerifyOnly,
    [switch]$Resume,
    [string]$ReuseDecisionsPath,
    [switch]$VerifyStandaloneHost,
    [switch]$SkipCodexEnvironmentSnapshot,
    [switch]$FullRegression,
    [ValidateSet('cache-lifetime')][string]$EngineVerificationProfile,
    [switch]$ExhaustiveRegression,
    [ValidateRange(1,16)][int]$SourceTestConcurrency = 4,
    [ValidateRange(1,4)][int]$SourceCheckConcurrency = 4,
    [string]$SourcePreflightReceipt,
    [switch]$ForceNativeVerification,
    [string[]]$ChangedPath,
    [AllowEmptyCollection()][string[]]$EngineFeatureId,
    [switch]$VerifyAccountControls,
    [string]$HostVersion
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($ReuseDecisionsPath) {
    & node -e 'require(process.argv[1]).loadDecisions(process.argv[2])' (Join-Path $PSScriptRoot 'verification-reuse-policy.cjs') $ReuseDecisionsPath
    if ($LASTEXITCODE -ne 0) { throw 'Invalid ReuseDecisionsPath; supply an absolute regular schema-1 decision file.' }
}
if ($ExhaustiveRegression) { $FullRegression = $true }
$UiSourcePath = [IO.Path]::GetFullPath($UiSourcePath)
$project = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
function Resolve-DeploymentModuleCacheOwner([string]$Project, [string]$ManifestPath, [string]$ManifestSha256, [string]$ExplicitOwner) {
    if (-not $ManifestPath -and -not $ManifestSha256) { return $ExplicitOwner }
    if (-not $ManifestPath -or -not $ManifestSha256) { throw 'DeploymentWorkspaceManifest and DeploymentWorkspaceSha256 must be supplied together.' }
    $selection = & node (Join-Path $Project 'scripts/deployment-workspace.cjs') --module-cache-owner $ManifestPath $ManifestSha256 $Project
    if ($LASTEXITCODE -ne 0) { throw 'Deployment workspace cache owner verification failed.' }
    $selectedOwner = [string](($selection | ConvertFrom-Json).moduleCacheProjectRoot)
    if (-not $selectedOwner -or -not [IO.Path]::IsPathFullyQualified($selectedOwner)) { throw 'Verified deployment module cache owner missing.' }
    if ($ExplicitOwner -and [IO.Path]::GetFullPath($ExplicitOwner) -ine [IO.Path]::GetFullPath($selectedOwner)) { throw 'Explicit ModuleCacheProjectRoot conflicts with deployment workspace owner.' }
    return $selectedOwner
}
$ModuleCacheProjectRoot = Resolve-DeploymentModuleCacheOwner $project $DeploymentWorkspaceManifest $DeploymentWorkspaceSha256 $ModuleCacheProjectRoot
$run = "deploy-$ReleaseName"
$logs = Join-Path $project "artifacts/logs/$run"
$pipelineRoot = $logs
$pipelineFile = Join-Path $pipelineRoot 'pipeline-state.json'
$attemptId = [guid]::NewGuid().ToString('N')
$pipelineLease = $null
$release = Join-Path $project "artifacts/releases/$ReleaseName"
$package = Join-Path $project "artifacts/deployments/$run/package"
$fixture = Join-Path $project "artifacts/verification/$run"
if ($VerificationFixtureRoot) {
    if (-not [IO.Path]::IsPathFullyQualified($VerificationFixtureRoot)) { throw 'VerificationFixtureRoot must be absolute.' }
    $fixture = [IO.Path]::GetFullPath($VerificationFixtureRoot).TrimEnd('\', '/')
    if ([IO.Path]::GetDirectoryName($fixture) -ine (Join-Path $project 'artifacts') -or [IO.Path]::GetFileName($fixture) -cnotmatch '^v(?:-[A-Za-z0-9_-]+)?$') {
        throw 'VerificationFixtureRoot must be a fresh immediate artifacts/v or artifacts/v-<name> directory.'
    }
}
if ($Resume -and -not $VerificationFixtureRoot) { $fixture = "$fixture-$($attemptId.Substring(0,8))" }
if ($Resume -and $VerificationFixtureRoot -and (Test-Path -LiteralPath $fixture)) {
    throw 'Resume requires a fresh explicit VerificationFixtureRoot; existing fixtures remain protected.'
}
$fixtureStateRoot = Join-Path $fixture $(if ($VerificationFixtureRoot) { 's' } else { 'state' })
$accountControlsState = Join-Path $project "artifacts/verification/account-controls-$ReleaseName$(if ($Resume) {'-' + $attemptId.Substring(0,8)})"
. (Join-Path $PSScriptRoot 'verification-state.ps1')
Assert-AzraelVerificationStatePath -StateRoot $StateRoot
Assert-AzraelVerificationStatePath -StateRoot $fixtureStateRoot
$runPaths = @($logs, $release, (Join-Path $project "artifacts/logs/$ReleaseName"), (Split-Path $package -Parent), $fixture)
if ($VerifyAccountControls) { $runPaths += $accountControlsState }
foreach ($path in $runPaths) {
    if (-not $Resume -and (Test-Path -LiteralPath $path)) { throw "Run path already exists: $path. Use a new ReleaseName or explicit -Resume." }
}
if ($Resume -and -not (Test-Path -LiteralPath $pipelineFile -PathType Leaf)) { throw 'Resume requires durable pipeline state for this ReleaseName.' }
if ($CompanionVsixPath -and -not $TypeScriptPath) { throw 'CompanionVsixPath requires the explicit TypeScriptPath from its pinned build staging.' }
if ($EngineDirectory -and -not $SkipEngineBuild) { throw 'EngineDirectory requires SkipEngineBuild.' }
if ($SkipEngineBuild -and (-not $EngineDirectory -or $CodeModeHostPath)) { throw 'SkipEngineBuild requires EngineDirectory and cannot select CodeModeHostPath.' }
if ($EngineTargetDirectory -and $SkipEngineBuild) { throw 'EngineTargetDirectory requires a full engine build.' }
if ($EngineTargetDirectory -and -not [IO.Path]::IsPathFullyQualified($EngineTargetDirectory)) { throw 'EngineTargetDirectory must be an absolute cache path.' }
if ($WindowControlTargetDirectory -and -not [IO.Path]::IsPathFullyQualified($WindowControlTargetDirectory)) { throw 'WindowControlTargetDirectory must be an absolute cache path.' }
if ($VirtualInputRuntimeDirectory -and -not [IO.Path]::IsPathFullyQualified($VirtualInputRuntimeDirectory)) { throw 'VirtualInputRuntimeDirectory must be an absolute verified runtime path.' }
if ($MultiPointerRuntimeDirectory -and -not [IO.Path]::IsPathFullyQualified($MultiPointerRuntimeDirectory)) { throw 'MultiPointerRuntimeDirectory must be an absolute verified runtime path.' }
if ($CargoVerificationCacheProjectRoot -and -not [IO.Path]::IsPathFullyQualified($CargoVerificationCacheProjectRoot)) { throw 'CargoVerificationCacheProjectRoot must be an absolute cache owner path.' }
if ($NamespaceCacheProjectRoot -and -not [IO.Path]::IsPathFullyQualified($NamespaceCacheProjectRoot)) { throw 'NamespaceCacheProjectRoot must be an absolute cache owner path.' }
if ($SourcePreflightReceipt -and -not [IO.Path]::IsPathFullyQualified($SourcePreflightReceipt)) { throw 'SourcePreflightReceipt must be an absolute receipt path.' }
if ($FullRegression -and $ChangedPath) { throw 'ChangedPath cannot be combined with FullRegression.' }
if ($FullRegression -and $PSBoundParameters.ContainsKey('EngineFeatureId')) { throw 'EngineFeatureId cannot be combined with FullRegression.' }
if ($EngineVerificationProfile -and ($FullRegression -or $PSBoundParameters.ContainsKey('EngineFeatureId'))) { throw 'EngineVerificationProfile cannot be combined with FullRegression or EngineFeatureId.' }
New-Item -ItemType Directory -Path $pipelineRoot -Force | Out-Null
try { $pipelineLease = [IO.File]::Open((Join-Path $pipelineRoot 'pipeline.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) } catch { throw 'Another deployment owns this ReleaseName; wait for its terminal outcome before resuming.' }
. (Join-Path $PSScriptRoot 'artifact-lifecycle.ps1')
$lifecycleMembers = Get-VersionLifecycleMembers $project $ReleaseName
$null = Register-ArtifactLifecycle -ProjectRoot $project -Id "version:$ReleaseName" -Kind version -Owner 'azrael-release' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members $lifecycleMembers
$fixtureLifecycleId = "run:verification:$ReleaseName$(if ($Resume) {'-' + $attemptId.Substring(0,8)})"
$fixtureLifecycleMembers = [ordered]@{fixture=$fixture}
$null = Register-ArtifactLifecycle -ProjectRoot $project -Id $fixtureLifecycleId -Kind run -Owner 'azrael-release' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members $fixtureLifecycleMembers
$accountLifecycleId = "run:account-controls:$ReleaseName$(if ($Resume) {'-' + $attemptId.Substring(0,8)})"
$accountLifecycleMembers = [ordered]@{fixture=$accountControlsState}
if ($VerifyAccountControls) { $null = Register-ArtifactLifecycle -ProjectRoot $project -Id $accountLifecycleId -Kind run -Owner 'azrael-release' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members $accountLifecycleMembers }
$lifecycleSucceeded = $false
$temporaryLifecycleId = $null
$temporaryLifecycleMembers = $null
$temporaryConsumerReason = 'Deployment temporary inputs'
try {
if ($Resume) { $logs = Join-Path $pipelineRoot "attempts/$attemptId"; New-Item -ItemType Directory -Path $logs | Out-Null }
$timer = [Diagnostics.Stopwatch]::StartNew()
$children = [Collections.Generic.List[object]]::new()
$script:environmentPatch = @{}
$script:sourceFixtureRoot = ''
. (Join-Path $PSScriptRoot 'build-metrics.ps1')
$script:toolIdentities = @{}
$metrics = [ordered]@{ schema = 1; releaseName = $ReleaseName; startedUtc = [DateTime]::UtcNow.ToString('o'); status = 'running'; verifyOnly = [bool]$VerifyOnly; releaseDirectory = $release; packageDirectory = $package; fixtureRoot = $fixture; stages = @(); inputChecks = @(); engineTargetDirectory = $EngineTargetDirectory; wallTimeMs = 0
    verificationPolicy = [ordered]@{ scope = $(if ($FullRegression) { 'full' } else { 'changed' }); engineVerificationProfile = $EngineVerificationProfile; sourceReuse = $true; nativeReuse = -not [bool]$ForceNativeVerification; forceNativeVerification = [bool]$ForceNativeVerification; cargoVerificationCacheProjectRoot = $(if ($CargoVerificationCacheProjectRoot) { $CargoVerificationCacheProjectRoot } else { $project }) }
    verificationResults = [ordered]@{}
}
$pwsh = (Get-Process -Id $PID).Path

function Write-DeploymentMetrics {
    # Checkpoints are diagnostic; a write failure must not mask the command failure.
    try {
        # Receipts remain the per-check authority; retain separate stages so a
        # preflight handoff is not presented as a second fresh execution.
        foreach ($entry in @(@{ name = 'sourcePreflight'; directory = 'engine-source-preflight' }, @{ name = 'enginePreservation'; directory = 'engine-preservation' })) {
            $directory = Join-Path $logs $entry.directory
            if (Test-Path -LiteralPath $directory -PathType Container) {
                foreach ($file in @(Get-ChildItem -LiteralPath $directory -Filter receipt.json -File -Recurse)) {
                    $result = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
                    if ($result.PSObject.Properties['executionSummary']) {
                        $metrics.verificationResults[$entry.name] = [ordered]@{ receiptPath = $file.FullName; status = $result.status; summary = $result.executionSummary }
                    }
                }
            }
        }
        $metrics.wallTimeMs = $timer.Elapsed.TotalMilliseconds
        $temporary = Join-Path $logs 'deployment-metrics.json.tmp'
        $metrics | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $temporary -Encoding utf8NoBOM
        [IO.File]::Move($temporary, (Join-Path $logs 'deployment-metrics.json'), $true)
    } catch { Write-Warning "Could not checkpoint deployment metrics: $($_.Exception.Message)" }
}
Write-DeploymentMetrics

function Get-ProjectSnapshot {
    param([string]$Phase)
    $checkTimer = [Diagnostics.Stopwatch]::StartNew()
    $report = Join-Path $logs "inputs-$Phase.json"
    $stdout = Join-Path $logs "inputs-$Phase.stdout.log"
    $stderr = Join-Path $logs "inputs-$Phase.stderr.log"
    & (Get-Command node -CommandType Application).Source (Join-Path $PSScriptRoot 'deployment-input-snapshot.cjs') $project $report 1> $stdout 2> $stderr
    $checkExit = $LASTEXITCODE
    $record = [ordered]@{ phase = $Phase; exitCode = $checkExit; durationMs = $checkTimer.Elapsed.TotalMilliseconds; report = $report }
    $metrics.inputChecks += $record
    if ($checkExit -ne 0) { throw "Project input snapshot failed ($checkExit). See $stderr" }
    $snapshot = Get-Content -LiteralPath $stdout -Raw | ConvertFrom-Json
    $record.fileCount = $snapshot.fileCount
    $record.bytes = $snapshot.bytes
    $record.sha256 = $snapshot.sha256
    $snapshot.sha256
}
function Assert-ProjectSnapshot {
    param([string]$Phase)
    $currentSnapshot = Get-ProjectSnapshot $Phase
    if ($currentSnapshot -cne $script:inputSnapshot) {
        $difference = Join-Path $logs "input-changes-$Phase.json"
        & (Get-Command node -CommandType Application).Source (Join-Path $PSScriptRoot 'deployment-input-snapshot.cjs') compare (Join-Path $logs 'inputs-initial.json') (Join-Path $logs "inputs-$Phase.json") $difference $script:inputSnapshot $currentSnapshot *> (Join-Path $logs "input-changes-$Phase.log")
        if ($LASTEXITCODE -ne 0) { throw "Consumed deployment inputs changed and the detailed comparison could not be validated. See $logs/input-changes-$Phase.log. Select new inputs and a new ReleaseName." }
        throw "Consumed deployment inputs changed under $project. See $difference for exact changed paths. Changes outside the selected input root are excluded; select corrected inputs and a new ReleaseName."
    }
}
function Assert-DeploymentCapacity {
    if ($RequiredFreeBytes -le 0) { return }
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($project))
    $available = $drive.AvailableFreeSpace
    if ($available -lt $RequiredFreeBytes) {
        throw "Deployment capacity guard: project volume $($drive.Name) has $available available bytes; RequiredFreeBytes is $RequiredFreeBytes. Stop owned stages before reviewing safe cleanup and retry only after capacity recovers."
    }
}
function Invoke-PipelineState {
    param([string]$Action, [string]$Name, $Options = @{})
    if (-not $pipelineLease -or $pipelineLease.SafeFileHandle.IsClosed) { throw 'Pipeline operation requires its exclusive deployment lease.' }
    $request = Join-Path $logs 'pipeline-request.json'
    @{file=$pipelineFile; identity=@{project=$project; platform='windows-x64'; releaseName=$ReleaseName; sourceSnapshot=$script:inputSnapshot}; resume=[bool](Test-Path -LiteralPath $pipelineFile); lockHeld=$true; reuseDecisionsPath=$ReuseDecisionsPath; action=$Action; name=$Name; options=$Options} | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $request -Encoding utf8NoBOM
    $errorPath=Join-Path $logs 'pipeline-review-error.json'
    $result = & node (Join-Path $PSScriptRoot 'pipeline-state.cjs') $request 2> $errorPath
    if ($LASTEXITCODE -ne 0) {
        $failure=[Exception]::new("Pipeline state $Action failed for $Name. $(Get-Content -LiteralPath $errorPath -Raw)")
        $failure.Data['exitCode']=$LASTEXITCODE
        throw $failure
    }
    return ($result | ConvertFrom-Json)
}
function Get-StageDependencies([string]$Name) {
    switch ($Name) {
        'engine-source-preflight' { @('verification-dependencies') }
        'build' { @('engine-source-preflight') }
        'source-tests' { @('engine-source-preflight') }
        'engine-preservation' { @('build', 'engine-source-preflight') }
        'prepare' { @('build', 'engine-source-preflight') }
        'acceptance' { @('prepare', 'engine-preservation', 'source-tests') }
        'install' { @('acceptance', 'engine-preservation-recheck') }
        default { @() }
    }
}
function ConvertTo-StageInput($Value) {
    if ($Value -is [System.Collections.IDictionary]) {
        $normalized = @{}
        foreach ($entry in $Value.GetEnumerator()) {
            if ($entry.Key -notin @('outputDirectory','temporaryDirectory','logDirectory','reuseDecisionsPath')) { $normalized[$entry.Key] = ConvertTo-StageInput $entry.Value }
        }
        return $normalized
    }
    if ($Value -is [array]) { return ,@($Value | ForEach-Object { ConvertTo-StageInput $_ }) }
    if ($Value -is [string]) {
        return ($Value.Replace($logs, '<attempt-logs>').Replace($pipelineRoot, '<attempt-logs>'))
    }
    return $Value
}
function Get-StageInputs([string]$Executable, [string[]]$Arguments) {
    if (-not $script:toolIdentities.ContainsKey($Executable)) { $script:toolIdentities[$Executable]=(Get-FileHash -LiteralPath $Executable -Algorithm SHA256).Hash.ToLowerInvariant() }
    $logical = [Collections.Generic.List[object]]::new()
    for ($index=0; $index -lt $Arguments.Count; $index++) {
        $argument = $Arguments[$index]
        if ($argument -eq '-Resume') { continue }
        if ($argument -eq '-ReuseDecisionsPath') { $index++; continue }
        if ($argument -eq '--args-sha256') { $index++; continue }
        if ($argument -like '*.json' -and (Test-Path -LiteralPath $argument -PathType Leaf)) {
            try { $logical.Add((ConvertTo-StageInput (Get-Content -LiteralPath $argument -Raw | ConvertFrom-Json -AsHashtable))); continue } catch { }
        }
        $logical.Add((ConvertTo-StageInput $argument))
    }
    $effectiveEnvironment = @{}
    foreach ($entry in [Environment]::GetEnvironmentVariables().GetEnumerator()) { $effectiveEnvironment[$entry.Key]=[string]$entry.Value }
    foreach ($entry in $script:environmentPatch.GetEnumerator()) { $effectiveEnvironment[$entry.Key]=[string]$entry.Value }
    $orderedEnvironment=Get-LogicalBuildEnvironment -Environment $effectiveEnvironment -PipelineRoot $pipelineRoot -SourceFixtureRoot $script:sourceFixtureRoot
    $environmentJson=ConvertTo-Json -InputObject $orderedEnvironment -Compress -Depth 5
    $environmentSha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($environmentJson))).ToLowerInvariant()
    $toolFiles=@($Executable)
    # Resolve only actual executable files in the effective child PATH. Asking
    # PowerShell to discover absent commands can trigger unrelated module scans.
    foreach ($tool in @('node.exe','python.exe','cargo.exe','rustc.exe','npm.cmd')) {
        foreach ($directory in @(([string]$effectiveEnvironment.PATH).Split([IO.Path]::PathSeparator))) {
            if (-not $directory) { continue }
            $candidate=Join-Path $directory.Trim('"') $tool
            if ([IO.File]::Exists($candidate)) { $toolFiles += [IO.Path]::GetFullPath($candidate); break }
        }
    }
    foreach ($name in @('AZRAEL_PYTHON','AZRAEL_PYTHON_SDK')) { if ($effectiveEnvironment.ContainsKey($name) -and (Test-Path -LiteralPath $effectiveEnvironment[$name] -PathType Leaf)) { $toolFiles += $effectiveEnvironment[$name] } }
    $toolHashes=@{}
    foreach ($tool in @($toolFiles | Select-Object -Unique)) {
        if (-not $script:toolIdentities.ContainsKey($tool)) { $script:toolIdentities[$tool]=(Get-FileHash -LiteralPath $tool -Algorithm SHA256).Hash.ToLowerInvariant() }
        $toolHashes[$tool]=$script:toolIdentities[$tool]
    }
    return @{executable=$Executable; tools=$toolHashes; arguments=@($logical); source=$script:inputSnapshot; environmentSha256=$environmentSha256}
}
function Get-StageOutputs([string]$Name, $Record) {
    $files = @($Record.stdout, $Record.stderr)
    if ($Name -eq 'build') {
        $files += Join-Path $release 'build-info.json'
        foreach ($member in @('azrael.exe','azrael-bridge.exe','azrael-code-mode-host.exe','azrael-engine-build.json')) {
            $candidate = Join-Path $release "engine/$member"
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $files += $candidate }
        }
        $manifest=Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json
        if ($manifest.PSObject.Properties['sha256']) {
            foreach ($entry in $manifest.sha256.PSObject.Properties) {
                $candidate=[IO.Path]::GetFullPath((Join-Path $release $entry.Name))
                if (-not $candidate.StartsWith($release+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Build manifest output is outside its release.' }
                $files += $candidate
            }
        }
    }
    if ($Name -eq 'prepare') {
        $files += (Join-Path $package 'independent-prepared.json'), (Join-Path $package 'azrael-host.vsix')
        $metadata=Get-Content -LiteralPath (Join-Path $package 'independent-prepared.json') -Raw | ConvertFrom-Json
        foreach ($field in @('PreservationReceipt','PreservationReport','PreservationBinding')) { if ($metadata.PSObject.Properties[$field]) { $files += [string]$metadata.$field } }
    }
    if ($Name -in @('engine-source-preflight','engine-preservation')) {
        $result=Get-Content -LiteralPath $Record.stdout -Raw | ConvertFrom-Json
        if ($result.PSObject.Properties['receiptPath']) { $files += [string]$result.receiptPath }
    }
    return @($files | Select-Object -Unique)
}
function Start-OwnedCommand {
    param([string]$Name, [string]$Executable, [string[]]$Arguments, $ReviewedRerun = $null)
    Assert-DeploymentCapacity
    $stageInputs = Get-StageInputs $Executable $Arguments
    $stageDependencies = @(Get-StageDependencies $Name)
    $prior = $null
    if ($null -ne $ReviewedRerun) {
        if ($ReviewedRerun.action -cne 'rerun' -or $ReviewedRerun.decision.action -cne 'rerun' -or
            [string]::IsNullOrWhiteSpace([string]$ReviewedRerun.decision.reason) -or
            $ReviewedRerun.decision.reviewId -cne $ReviewedRerun.review.reviewId) { throw 'A validated, candidate-bound rerun decision is required.' }
    } else { $prior = Invoke-PipelineState 'lookup' $Name @{inputs=$stageInputs; dependencies=$stageDependencies} }
    # Installation always re-enters its owner: a prior exit is insufficient to
    # establish the current installed receipt and selected package identity.
    if ($prior -and $Name -ne 'install') {
        $record = $prior.data.record
        $record | Add-Member -NotePropertyName reused -NotePropertyValue $true -Force
        $metrics.stages += $record
        return [pscustomobject]@{Record=$record; Completed=$true; Reused=$true}
    }
    & node (Join-Path $PSScriptRoot 'build-resource-admission.cjs') $Name
    if ($LASTEXITCODE -ne 0) { throw "Memory admission failed for $Name; command was not started." }
    Assert-DeploymentCapacity
    $null = Invoke-PipelineState 'start' $Name @{inputs=$stageInputs; dependencies=$stageDependencies}
    $info = [Diagnostics.ProcessStartInfo]::new($Executable)
    $info.WorkingDirectory = $project
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($entry in $script:environmentPatch.GetEnumerator()) {
        foreach ($key in @($info.Environment.Keys | Where-Object { $_ -ieq $entry.Key })) { $null = $info.Environment.Remove($key) }
        $info.Environment[$entry.Key] = [string]$entry.Value
    }
    foreach ($arg in $Arguments) { $info.ArgumentList.Add($arg) }
    $logName = if ($null -ne $ReviewedRerun) { "$Name-reviewed-rerun" } else { $Name }
    $record = [ordered]@{ name = $Name; executable = $Executable; arguments = $Arguments; startedUtc = [DateTime]::UtcNow.ToString('o'); durationMs = 0; exitCode = $null; terminated = $false; completedUtc = $null; stdout = (Join-Path $logs "$logName.stdout.log"); stderr = (Join-Path $logs "$logName.stderr.log") }
    if ($null -ne $ReviewedRerun) { $record.reuseDecision = $ReviewedRerun.decision }
    $metrics.stages += $record
    $out = [IO.File]::Create($record.stdout)
    $err = [IO.File]::Create($record.stderr)
    try { $proc = [Diagnostics.Process]::Start($info) } catch { $out.Dispose(); $err.Dispose(); $record.startError = $_.Exception.Message; $null=Invoke-PipelineState 'finish' $Name @{exitCode=$null; outcome='failed'; error=$record.startError}; throw }
    $record.processId=$proc.Id
    $record.processStartedUtc=$proc.StartTime.ToUniversalTime().ToString('o')
    $child = [pscustomobject]@{ Process = $proc; Record = $record; Timer = [Diagnostics.Stopwatch]::StartNew(); Out = $out; Err = $err; OutTask = $proc.StandardOutput.BaseStream.CopyToAsync($out); ErrTask = $proc.StandardError.BaseStream.CopyToAsync($err); Completed = $false }
    $children.Add($child)
    Write-DeploymentMetrics
    return $child
}
function Complete-OwnedCommand {
    param($Child)
    if ($Child.Completed) { return }
    $Child.Process.WaitForExit()
    try { $Child.OutTask.GetAwaiter().GetResult(); $Child.ErrTask.GetAwaiter().GetResult() } finally { $Child.Out.Dispose(); $Child.Err.Dispose() }
    $Child.Record.exitCode = $Child.Process.ExitCode
    $Child.Record.durationMs = $Child.Timer.Elapsed.TotalMilliseconds
    $Child.Completed = $true
    $Child.Record.completedUtc = [DateTime]::UtcNow.ToString('o')
    $stageOutputs = @(if ($Child.Record.exitCode -eq 0) { Get-StageOutputs $Child.Record.name $Child.Record } else { @($Child.Record.stdout, $Child.Record.stderr) })
    $null = Invoke-PipelineState 'finish' $Child.Record.name @{exitCode=$Child.Record.exitCode; outputs=$stageOutputs; data=@{record=$Child.Record}}
    Write-DeploymentMetrics
}
function Wait-OwnedCommands {
    param([object[]]$Commands, [object[]]$MonitoredCommands = @())
    $capacityTimer = [Diagnostics.Stopwatch]::StartNew()
    $checkCapacity = $true
    while (@($Commands | Where-Object { -not $_.Completed }).Count) {
        if ($RequiredFreeBytes -gt 0 -and ($checkCapacity -or $capacityTimer.ElapsedMilliseconds -ge 1000)) {
            Assert-DeploymentCapacity
            $checkCapacity = $false
            $capacityTimer.Restart()
        }
        foreach ($child in @($Commands) + @($MonitoredCommands)) {
            if (-not $child.Completed -and $child.Process.HasExited) {
                Complete-OwnedCommand $child
                if ($child.Record.exitCode -ne 0) {
                    $failure = [Exception]::new("$($child.Record.name) failed with exit code $($child.Record.exitCode). See $($child.Record.stderr) and $($child.Record.stdout).")
                    $failure.Data['exitCode'] = $child.Record.exitCode
                    throw $failure
                }
            }
        }
        if (@($Commands | Where-Object { -not $_.Completed }).Count) { Start-Sleep -Milliseconds 100 }
    }
}
function Invoke-Stage {
    param([string]$Name, [string]$Script, [string[]]$Arguments)
    $child = Start-OwnedCommand $Name $pwsh (@('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot $Script)) + $Arguments)
    Wait-OwnedCommands @($child)
}
function Read-DeploymentCheckpoint {
    param([string]$Path)
    # Use the writer's exclusive-create lock: Windows replacement can fail even
    # when a destination reader grants delete sharing.
    $lockPath = "$Path.update-lock"
    $lock = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ($null -eq $lock) {
        try { $lock = [System.IO.FileStream]::new($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)) }
        catch [System.IO.IOException] {
            $code = $_.Exception.HResult -band 0xffff
            if ($code -notin @(80, 183) -or [DateTime]::UtcNow -ge $deadline) {
                throw [System.IO.IOException]::new("Pipeline state update lock is unavailable; preserve unresolved ownership: $lockPath", $_.Exception)
            }
            Start-Sleep -Milliseconds 10
        }
    }
    try {
        $stream = [System.IO.FileStream]::new($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
        $reader = $null
        try {
            $reader = [System.IO.StreamReader]::new($stream)
            $reader.ReadToEnd() | ConvertFrom-Json
        } finally {
            if ($null -ne $reader) { $reader.Dispose() } else { $stream.Dispose() }
        }
    } finally {
        $lock.Dispose()
        [System.IO.File]::Delete($lockPath)
    }
}
function Wait-BuildEngineReady($Build) {
    # The build publishes this stage only after provenance and real engine/host
    # IPC pass. Heavy source regression can then overlap packaging without
    # competing with engine startup, including automatic engine reuse.
    while (-not $Build.Completed) {
        if ($Build.Process.HasExited) {
            Complete-OwnedCommand $Build
            if ($Build.Record.exitCode -ne 0) { throw "Build failed with exit code $($Build.Record.exitCode). See $($Build.Record.stderr)." }
            return
        }
        $checkpoint=Read-DeploymentCheckpoint $pipelineFile
        if ($checkpoint.stages.PSObject.Properties['build.engine-ready']) {
            $ready=@($checkpoint.stages.'build.engine-ready')[-1]
            if ($ready.status -eq 'succeeded' -and $ready.data.processId -eq $Build.Process.Id) { return }
        }
        Assert-DeploymentCapacity
        Start-Sleep -Milliseconds 100
    }
}
function Assert-Package {
    if ((Get-FileHash -LiteralPath $preparedPath).Hash -cne $script:preparedHash) { throw 'Prepared package metadata changed after preparation.' }
    if ((Get-FileHash -LiteralPath $prepared.HostVsix).Hash -ine $prepared.HostSha256) { throw 'Prepared package SHA-256 mismatch.' }
    if ($script:packageFullyVerified) { return }
    $preservationBuild = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json
    $preservationConfig = [ordered]@{
        reuseDecisionsPath = $ReuseDecisionsPath
        projectRoot = $project; uiRoot = $UiSourcePath; engineSourceRoot = [string]$preservationBuild.engineSourceRoot
        engineDirectory = (Join-Path $release 'engine'); area = 'ui'; typeScriptPath = $TypeScriptPath
        outputDirectory = (Join-Path $logs 'package-preservation')
        receiptPath = $prepared.PreservationReceipt; reportPath = $prepared.PreservationReport
        packagePath = $prepared.HostVsix; bindingPath = $prepared.PreservationBinding
        sourceTestPolicy = (Get-Content -LiteralPath $sourceTestPolicyPath -Raw | ConvertFrom-Json)
    }
    if ($prepared.PSObject.Properties['PreservationFeatureIds']) {
        $preservationConfig.featureIds = @($prepared.PreservationFeatureIds)
    }
    $preservationConfigPath = Join-Path $logs 'package-preservation-inputs.json'
    $preservationConfig | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $preservationConfigPath -Encoding utf8NoBOM
    & node (Join-Path $PSScriptRoot 'feature-preservation.cjs') verify --config $preservationConfigPath *> (Join-Path $logs 'package-preservation.log')
    if ($LASTEXITCODE -ne 0) { throw 'Package feature preservation verification failed. See package-preservation.log.' }
    $packageReceipt = Get-Content -LiteralPath $prepared.PreservationReceipt -Raw | ConvertFrom-Json
    $metrics.verificationResults['packagePreservation'] = [ordered]@{ receiptPath = $prepared.PreservationReceipt; status = $packageReceipt.status; summary = $packageReceipt.executionSummary }
    $archive = [IO.Compression.ZipFile]::OpenRead($prepared.HostVsix)
    try {
        $entry = $archive.GetEntry('extension/package.json')
        if (-not $entry) { throw 'Prepared package manifest is missing.' }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ([string]$manifest.version -cne [string]$prepared.HostVersion) { throw 'Prepared package version mismatch.' }
    } finally { $archive.Dispose() }
    $script:packageFullyVerified = $true
}

function Get-FocusedEngineFeatureIds {
    param([string[]]$PolicyPaths, [string]$EngineSourceRoot,
        [AllowEmptyCollection()][string[]]$EngineFeatureId, [switch]$ExplicitSelection, [switch]$ProfileSelection)
    $selected = @()
    $inventoryPath = Join-Path $project 'scripts/azrael-feature-contracts.json'
    $engineFeatures = @((Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json).features | Where-Object area -eq 'engine')
    if ($ExplicitSelection) {
        $unknownIds = @($EngineFeatureId | Where-Object { $_ -cnotin @($engineFeatures.id) })
        if ($unknownIds.Count) { throw "Unknown engine feature IDs: $($unknownIds -join ', ')" }
        return @($EngineFeatureId | Select-Object -Unique)
    }
    $unmappedNative = @()
    foreach ($changed in $PolicyPaths) {
        $owners = @($engineFeatures | Where-Object {
            @($_.owners | Where-Object { $changed -ceq $_ -or $changed.StartsWith($_.TrimEnd('/') + '/', [StringComparison]::Ordinal) }).Count -gt 0
        })
        $selected += @($owners | ForEach-Object id)
        if (-not $owners.Count -and ($changed -match '^engine/.*(\.rs|Cargo\.(toml|lock)|rust-toolchain(\.toml)?|\.cargo/config(\.toml)?)$' -or
            $changed -in @('scripts/cargo-verification.cjs', 'scripts/cargo-target-owner.cjs'))) {
            $unmappedNative += $changed
        }
    }
    if ($unmappedNative.Count) {
        if ($ProfileSelection) { $script:profileUnmappedNativePaths = @($unmappedNative) }
        else { throw "Unmapped engine verification scope: $($unmappedNative -join ', '). Select EngineFeatureId explicitly (an empty array is allowed), or use FullRegression." }
    }
    return @($selected | Select-Object -Unique)
}
try {
    $script:inputSnapshot = Get-ProjectSnapshot 'initial'
    $pipelineSnapshot = Invoke-PipelineState 'snapshot' ''
    $script:packageFullyVerified = $false
    $metrics.projectInputSha256 = $inputSnapshot
    # Read NUL-delimited git output without shell quoting or line-based path decoding.
    $policyPaths = @($ChangedPath)
    if (-not $ChangedPath) {
        $policyPaths = @()
        foreach ($gitArguments in @(@('diff', 'HEAD', '--name-only', '-z'), @('ls-files', '--others', '--exclude-standard', '-z'))) {
            $gitStart = [Diagnostics.ProcessStartInfo]::new('git')
            $gitStart.WorkingDirectory = $project
            $gitStart.UseShellExecute = $false
            $gitStart.RedirectStandardOutput = $true
            $gitStart.RedirectStandardError = $true
            $gitStart.StandardOutputEncoding = [Text.Encoding]::UTF8
            $gitStart.StandardErrorEncoding = [Text.Encoding]::UTF8
            foreach ($argument in $gitArguments) { $gitStart.ArgumentList.Add($argument) }
            $gitProcess = [Diagnostics.Process]::Start($gitStart)
            try {
                $stdoutTask = $gitProcess.StandardOutput.ReadToEndAsync()
                $stderrTask = $gitProcess.StandardError.ReadToEndAsync()
                $gitProcess.WaitForExit()
                if ($gitProcess.ExitCode -ne 0) { throw "Cannot determine source test policy inputs: $($stderrTask.GetAwaiter().GetResult())" }
                $policyPaths += @($stdoutTask.GetAwaiter().GetResult().Split([char]0, [StringSplitOptions]::RemoveEmptyEntries))
            } finally { $gitProcess.Dispose() }
        }
    }
    $policyPaths = @($policyPaths | ForEach-Object {
        $absolute = [IO.Path]::GetFullPath($_, $project)
        $relative = [IO.Path]::GetRelativePath($project, $absolute).Replace('\', '/')
        if ($relative -eq '..' -or $relative.StartsWith('../') -or [IO.Path]::IsPathFullyQualified($relative)) { throw "Changed path is outside project: $_" }
        $relative
    } | Sort-Object -Unique)
    $sourceTestPolicyPath = Join-Path $logs 'source-test-policy-inputs.json'
    @{changedPaths = @($policyPaths); exhaustive = [bool]$ExhaustiveRegression} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $sourceTestPolicyPath -Encoding utf8NoBOM
    $script:profileUnmappedNativePaths = @()
    $focusedEngineFeatureIds = @(if (-not $FullRegression) { Get-FocusedEngineFeatureIds -PolicyPaths $policyPaths -EngineSourceRoot $SourceRoot -EngineFeatureId $EngineFeatureId -ExplicitSelection:($PSBoundParameters.ContainsKey('EngineFeatureId')) -ProfileSelection:([bool]$EngineVerificationProfile) })
    . (Join-Path $PSScriptRoot 'build-module-cache.ps1')
    $preflightModuleCache = Open-BuildModuleCache $project $ModuleCacheProjectRoot
    try {
        $ModuleCacheProjectRoot = $preflightModuleCache.Owner
        $metrics.moduleCachePreflight = [ordered]@{ owner = $preflightModuleCache.Owner; root = $preflightModuleCache.Root; registeredProjects = @(Get-BuildCacheProjects $preflightModuleCache) }
    } finally { $preflightModuleCache.Lease.Dispose() }
    $buildArgs = @('-ReleaseName', $ReleaseName, '-SourceRoot', $SourceRoot, '-LifecycleParentActive')
    # Fresh even on Resume: no handoff from an earlier deployment attempt is accepted.
    $sourceHandoffToken = [guid]::NewGuid().ToString('N')
    $sourceHandoffPath = Join-Path $logs "engine-source-handoff-$sourceHandoffToken.json"
    $sourceHandoffHelper = Join-Path $PSScriptRoot 'engine-source-handoff.cjs'
    $buildArgs += @('-SourceStateHandoffPath', $sourceHandoffPath, '-SourceStateHandoffToken', $sourceHandoffToken)
    if ($ReuseDecisionsPath) { $buildArgs += @('-ReuseDecisionsPath', $ReuseDecisionsPath) }
    $pipelineContextPath=Join-Path $logs 'pipeline-context.json'
    @{file=$pipelineFile;identity=@{project=$project;platform='windows-x64';releaseName=$ReleaseName;sourceSnapshot=$script:inputSnapshot}} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $pipelineContextPath -Encoding utf8NoBOM
    $buildArgs += @('-PipelineContextPath',$pipelineContextPath)
    if ($Resume) { $buildArgs += '-Resume' }
    if ($RetainedSourceRoot) { $buildArgs += @('-RetainedSourceRoot', $RetainedSourceRoot) }
    if ((-not $SkipEngineBuild -and -not $EngineTargetDirectory) -or $CargoCacheProjectRoot) {
        $cacheOwner = if ($CargoCacheProjectRoot) { $CargoCacheProjectRoot } elseif ($ModuleCacheProjectRoot) { $ModuleCacheProjectRoot } else { $project }
        $selection = & node (Join-Path $PSScriptRoot 'cargo-shared-cache.cjs') --project-root $cacheOwner --source-root $SourceRoot --target x86_64-pc-windows-msvc
        if ($LASTEXITCODE -ne 0) { throw 'Shared Cargo cache selection failed.' }
        $sharedCargoCache = $selection | ConvertFrom-Json
        if ($EngineTargetDirectory -and [IO.Path]::GetFullPath($EngineTargetDirectory) -ine $sharedCargoCache.targetDirectory) { throw 'Explicit engine target conflicts with shared Cargo cache.' }
        $EngineTargetDirectory = $sharedCargoCache.targetDirectory
        $CargoCacheProjectRoot = $sharedCargoCache.projectRoot
        $metrics.cargoCache = $sharedCargoCache
    }
    if ($EngineTargetDirectory -and -not $SkipEngineBuild) { $buildArgs += @('-EngineTargetDirectory', $EngineTargetDirectory) }
    if ($CargoCacheProjectRoot -and -not $SkipEngineBuild) { $buildArgs += @('-CargoCacheProjectRoot', $CargoCacheProjectRoot) }
    if ($ModuleCacheProjectRoot) { $buildArgs += @('-ModuleCacheProjectRoot', $ModuleCacheProjectRoot) }
    if ($FullRegression -or $ForceNativeVerification) { $buildArgs += '-ForceEngineCompatibility' }
    if ($WindowControlTargetDirectory) { $buildArgs += @('-WindowControlTargetDirectory', $WindowControlTargetDirectory) }
    if ($VirtualInputRuntimeDirectory) { $buildArgs += @('-VirtualInputRuntimeDirectory', $VirtualInputRuntimeDirectory) }
    if ($MultiPointerRuntimeDirectory) { $buildArgs += @('-MultiPointerRuntimeDirectory', $MultiPointerRuntimeDirectory) }
    if ($ComputerUseRuntimeDirectory) { $buildArgs += @('-ComputerUseRuntimeDirectory', $ComputerUseRuntimeDirectory) }
    if ($ComputerUsePluginDirectory) { $buildArgs += @('-ComputerUsePluginDirectory', $ComputerUsePluginDirectory) }
    if ($SkipEngineBuild) { $buildArgs += @('-SkipEngineBuild', '-EngineDirectory', $EngineDirectory) } elseif ($CodeModeHostPath) { $buildArgs += @('-CodeModeHostPath', $CodeModeHostPath) }
    if ($CompanionVsixPath) { $buildArgs += @('-CompanionVsixPath', $CompanionVsixPath) }
    $sourceTestArgs = @((Join-Path $PSScriptRoot 'test-project.cjs'))
    $sourceTestArgs += @('--test-concurrency', [string]$SourceTestConcurrency)
    if ($FullRegression) { $sourceTestArgs += @('--area', 'current', '--area', 'standalone', '--defer-preservation-cache-owner') }
    else {
        $sourceTestArgs += '--changed-only'
    }
    foreach ($path in $policyPaths) { $sourceTestArgs += @('--changed', $path) }
    if ($ExhaustiveRegression) { $sourceTestArgs += '--exhaustive' }
    $sourceTestArgs += @('--log-directory', (Join-Path $logs 'source-tests'))
    # The version's owned log root contains fresh per-attempt test fixtures.
    # Never reuse a caller's persistent fixture parent across deployment attempts.
    $sourceFixtureRoot = Join-Path $pipelineRoot 'source-fixtures'
    if ($Resume -and $pipelineSnapshot.stages.PSObject.Properties['source-tests'] -and @($pipelineSnapshot.stages.'source-tests')[-1].status -ne 'succeeded') { $sourceFixtureRoot=Join-Path $logs 'source-fixtures' }
    if (-not (Test-Path -LiteralPath $sourceFixtureRoot)) { New-Item -ItemType Directory -Path $sourceFixtureRoot | Out-Null }
    foreach ($selection in @(
        @{ key = 'AZRAEL_INSTRUCTION_TEST_ROOT'; name = 'instructions' },
        @{ key = 'AZRAEL_CATALOG_TEST_ROOT'; name = 'catalog' },
        @{ key = 'AZRAEL_MIGRATION_TEST_ROOT'; name = 'migration' },
        @{ key = 'AZRAEL_WORKBENCH_TEST_ROOT'; name = 'workbench' }
    )) {
        $parent = Join-Path $sourceFixtureRoot $selection.name
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
        $script:environmentPatch[$selection.key] = $parent
    }
    $metrics.sourceFixtureRoot = $sourceFixtureRoot
    $pipelineContext = Get-Content -LiteralPath $pipelineContextPath -Raw | ConvertFrom-Json -AsHashtable
    $pipelineContext.sourceFixtureRoot = $sourceFixtureRoot
    $pipelineContext | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $pipelineContextPath -Encoding utf8NoBOM
    # Resolve selected tests' external fixtures before any expensive producer.
    $fixtureArgsPath = Join-Path $logs 'source-fixture-arguments.json'
    $fixtureLogicalArgs = @($sourceTestArgs | Select-Object -Skip 1) + @('--check-fixtures')
    ConvertTo-Json -InputObject $fixtureLogicalArgs -Depth 5 | Set-Content -LiteralPath $fixtureArgsPath -Encoding utf8NoBOM
    $fixtureArgsHash = (Get-FileHash -LiteralPath $fixtureArgsPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $fixtureReadiness = Start-OwnedCommand 'source-fixtures' (Get-Command node -CommandType Application).Source @($sourceTestArgs[0], '--args-file', $fixtureArgsPath, '--args-sha256', $fixtureArgsHash)
    Wait-OwnedCommands @($fixtureReadiness)
    $metrics.testScope = $(if ($FullRegression) { 'full' } else { 'changed' })
    $metrics.forceNativeVerification = [bool]$ForceNativeVerification
    $metrics.changedPaths = @($ChangedPath)
    $sourceConfig = [ordered]@{
        deploymentFixtureIdentity = @{pipelineRoot=$pipelineRoot;sourceFixtureRoot=$sourceFixtureRoot}
        reuseDecisionsPath = $ReuseDecisionsPath
        projectRoot = $project; engineSourceRoot = [IO.Path]::GetFullPath($SourceRoot)
        sourceTestConcurrency = $SourceTestConcurrency
        sourceConcurrency = $SourceCheckConcurrency
        uiRoot = $UiSourcePath
        outputDirectory = (Join-Path $logs 'engine-source-preflight'); area = 'engine'; checkPhase = 'source'
        reuseNativeChecks = -not [bool]$ForceNativeVerification
        cargoTarget = 'x86_64-pc-windows-msvc'
        temporaryDirectory = (Join-Path $project 'artifacts/t')
    }
    if ($PreflightToolDirectory) { $sourceConfig.toolDirectories = @($PreflightToolDirectory) }
    if ($RequiredFreeBytes -lt 0) { throw 'RequiredFreeBytes must not be negative.' }
    if ($RequiredFreeBytes) { $sourceConfig.requiredFreeBytes = $RequiredFreeBytes }
    if ($EstimatedCompilerGrowthBytes -lt 0) { throw 'EstimatedCompilerGrowthBytes must not be negative.' }
    if ($EstimatedCompilerGrowthBytes) { $sourceConfig.estimatedGrowthBytes = $EstimatedCompilerGrowthBytes }
    if ($EngineTargetDirectory) { $sourceConfig.cargoTargetDirectory = $EngineTargetDirectory }
    if ($CargoCacheProjectRoot) { $sourceConfig.cargoCacheProjectRoot = $CargoCacheProjectRoot }
    if ($CargoVerificationCacheProjectRoot) { $sourceConfig.cargoVerificationCacheProjectRoot = $CargoVerificationCacheProjectRoot }
    if ($EngineVerificationProfile) {
        $sourceConfig.engineVerificationProfile = $EngineVerificationProfile
        $sourceConfig.sourceFeatureIds = $focusedEngineFeatureIds
        $sourceConfig.unmappedNativePaths = @($script:profileUnmappedNativePaths)
    } elseif (-not $FullRegression) { $sourceConfig.featureIds = $focusedEngineFeatureIds }
    $sourceConfigPath = Join-Path $logs 'engine-source-preflight-inputs.json'
    if (-not $FullRegression -and -not $PSBoundParameters.ContainsKey('EngineFeatureId')) {
        $sourceConfig.sourceCheckPaths = @($policyPaths)
    }
    $temporaryIdentity = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($sourceConfig.temporaryDirectory))).ToLowerInvariant()
    $temporaryLifecycleId = "work:deployment-temporary:$temporaryIdentity"
    $temporaryLifecycleMembers = [ordered]@{ temporary = $sourceConfig.temporaryDirectory }
    $null = Register-ArtifactLifecycle -ProjectRoot $project -Id $temporaryLifecycleId -Kind work -Owner 'azrael-deployment-temporary' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members $temporaryLifecycleMembers -References @{ "version:$ReleaseName" = $temporaryConsumerReason } -ReferenceKind execution
    $sourceConfig | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $sourceConfigPath -Encoding utf8NoBOM
    $environmentPreflight = Start-OwnedCommand 'environment-preflight' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'pipeline-preflight.cjs'), '--environment', $sourceConfigPath)
    Wait-OwnedCommands @($environmentPreflight)
    $environmentResult = Get-Content -LiteralPath $environmentPreflight.Record.stdout -Raw | ConvertFrom-Json
    if (-not $environmentResult.PSObject.Properties['environmentPatch']) { throw 'Environment preflight did not return a validated environment patch.' }
    foreach ($entry in $environmentResult.environmentPatch.PSObject.Properties) { $script:environmentPatch[$entry.Name] = [string]$entry.Value }
    $null = Register-ArtifactLifecycle -ProjectRoot $project -Id $temporaryLifecycleId -Kind work -Owner 'azrael-deployment-temporary' -Generated -ProtectionKnown -State complete -MembershipComplete $true -Members $temporaryLifecycleMembers
    $metrics.environmentPreflight = [ordered]@{ report = $environmentPreflight.Record.stdout; required = $environmentResult.required }
    $dependencies = Start-OwnedCommand 'verification-dependencies' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'pipeline-preflight.cjs'), $sourceConfigPath)
    Wait-OwnedCommands @($dependencies)
    $sourceAction = 'run'
    if ($SourcePreflightReceipt) {
        $sourceConfig.receiptPath = $SourcePreflightReceipt
        $sourceConfig | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $sourceConfigPath -Encoding utf8NoBOM
        $sourceAction = 'verify-receipt'
    }
    $sourcePreflight = Start-OwnedCommand 'engine-source-preflight' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'feature-preservation.cjs'), $sourceAction, '--config', $sourceConfigPath)
    Wait-OwnedCommands @($sourcePreflight)
    $sourcePreflightResult = Get-Content -LiteralPath $sourcePreflight.Record.stdout -Raw | ConvertFrom-Json
    $sourceDisposition = if ($SourcePreflightReceipt) { 'reused' } else { 'executed' }
    if ($sourcePreflightResult.status -ceq 'rerun-required') {
        $sourceConfig.Remove('receiptPath')
        $sourceConfig.reuseSourceChecks = $false
        $sourceConfig | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $sourceConfigPath -Encoding utf8NoBOM
        $sourcePreflight = Start-OwnedCommand 'engine-source-preflight' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'feature-preservation.cjs'), 'run', '--config', $sourceConfigPath) -ReviewedRerun $sourcePreflightResult.reuseReview
        Wait-OwnedCommands @($sourcePreflight)
        $sourcePreflightResult = Get-Content -LiteralPath $sourcePreflight.Record.stdout -Raw | ConvertFrom-Json
        $sourceDisposition = 'reviewed-rerun'
    }
    if (-not $sourcePreflightResult.receiptPath) { throw 'Source preflight receipt missing.' }
    if (-not $sourcePreflightResult.sourceExecution) { throw 'Source preflight execution environment evidence missing.' }
    $metrics.sourcePreflight = [ordered]@{ disposition = $sourceDisposition; receiptPath = [string]$sourcePreflightResult.receiptPath; report = $sourcePreflight.Record.stdout }
    $sourceConfig.receiptPath = [string]$sourcePreflightResult.receiptPath
    $sourceConfig | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $sourceConfigPath -Encoding utf8NoBOM
    $sourceTestArgs += @('--source-preflight-config', $sourceConfigPath)
    # Keep logical argv in owned logs; Windows Process.Start has a 32K command-line limit.
    $sourceTestArgsPath = Join-Path $logs 'source-test-arguments.json'
    $sourceLogicalArgs = @($sourceTestArgs | Select-Object -Skip 1)
    ConvertTo-Json -InputObject $sourceLogicalArgs -Depth 5 | Set-Content -LiteralPath $sourceTestArgsPath -Encoding utf8NoBOM
    $metrics.sourceTestArguments = [ordered]@{ path = $sourceTestArgsPath; sha256 = (Get-FileHash -LiteralPath $sourceTestArgsPath -Algorithm SHA256).Hash.ToLowerInvariant(); count = $sourceLogicalArgs.Count; characterCount = ($sourceLogicalArgs | Measure-Object -Property Length -Sum).Sum }
    $build = Start-OwnedCommand 'build' $pwsh (@('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'build-azrael.ps1')) + $buildArgs)
    Wait-BuildEngineReady $build
    $sourceTests = Start-OwnedCommand 'source-tests' (Get-Command node -CommandType Application).Source @($sourceTestArgs[0], '--args-file', $sourceTestArgsPath, '--args-sha256', $metrics.sourceTestArguments.sha256)
    # Build completion releases binary consumers; source failures still cancel owned work.
    Wait-OwnedCommands @($build) -MonitoredCommands @($sourceTests)
    # Only a successfully terminated build can seed consumers. Each owns a writable copy.
    $sourceHandoff = @{}
    foreach ($consumer in @('engine-preservation', 'prepare')) {
        $destination = Join-Path $logs "$consumer-source-state-$sourceHandoffToken.json"
        $handoffJson = & node $sourceHandoffHelper consume --handoff $sourceHandoffPath --token $sourceHandoffToken --release $release --destination $destination
        if ($LASTEXITCODE -ne 0) { throw "Source state handoff failed for $consumer" }
        $sourceHandoff[$consumer] = $handoffJson | ConvertFrom-Json
    }
    $metrics.sourceObservationHandoff = $sourceHandoff
    # Entry/resume validates the frozen inputs; pre-install validates them again.
    $preservationBuild = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json
    $enginePreservationConfig = [ordered]@{
        deploymentFixtureIdentity = @{pipelineRoot=$pipelineRoot;sourceFixtureRoot=$sourceFixtureRoot}
        reuseDecisionsPath = $ReuseDecisionsPath
        projectRoot = $project; engineSourceRoot = [IO.Path]::GetFullPath($SourceRoot)
        sourceTestConcurrency = $SourceTestConcurrency
        sourceConcurrency = $SourceCheckConcurrency
        uiRoot = $UiSourcePath
        engineDirectory = (Join-Path $release 'engine'); outputDirectory = (Join-Path $logs 'engine-preservation'); area = 'engine'
        reuseNativeChecks = -not [bool]$ForceNativeVerification
        sourceReceiptPath = [string]$sourcePreflightResult.receiptPath
    }
    if ($sourceHandoff['engine-preservation'].usable) {
        $enginePreservationConfig.sourceStatePath = $sourceHandoff['engine-preservation'].sourceStatePath
        $enginePreservationConfig.sourceGeneration = $sourceHandoff['engine-preservation'].sourceGeneration
    }
    if ($EngineTargetDirectory) { $enginePreservationConfig.cargoTargetDirectory = $EngineTargetDirectory }
    if ($CargoCacheProjectRoot) { $enginePreservationConfig.cargoCacheProjectRoot = $CargoCacheProjectRoot }
    if ($CargoVerificationCacheProjectRoot) { $enginePreservationConfig.cargoVerificationCacheProjectRoot = $CargoVerificationCacheProjectRoot }
    if ($EngineVerificationProfile) {
        $enginePreservationConfig.engineVerificationProfile = $EngineVerificationProfile
        $enginePreservationConfig.sourceFeatureIds = $focusedEngineFeatureIds
        $enginePreservationConfig.unmappedNativePaths = @($script:profileUnmappedNativePaths)
    } elseif (-not $FullRegression) {
        $enginePreservationConfig.featureIds = $focusedEngineFeatureIds
    }
    $enginePreservationConfigPath = Join-Path $logs 'engine-preservation-inputs.json'
    if (-not $FullRegression -and -not $PSBoundParameters.ContainsKey('EngineFeatureId')) {
        $enginePreservationConfig.sourceCheckPaths = @($policyPaths)
    }
    $enginePreservationConfig | ConvertTo-Json | Set-Content -LiteralPath $enginePreservationConfigPath -Encoding utf8NoBOM
    $enginePreservation = Start-OwnedCommand 'engine-preservation' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'feature-preservation.cjs'), 'run', '--config', $enginePreservationConfigPath)
    if (-not $TypeScriptPath) {
        if ($preservationBuild.PSObject.Properties['moduleBuild'] -and $preservationBuild.moduleBuild.PSObject.Properties['typeScriptPath']) {
            $TypeScriptPath = $preservationBuild.moduleBuild.typeScriptPath
        }
        if (-not $TypeScriptPath) { $TypeScriptPath = Join-Path $project "artifacts/build/$ReleaseName/companion/node_modules/typescript/lib/typescript.js" }
    }
    $TypeScriptPath = (Resolve-Path -LiteralPath $TypeScriptPath).Path
    $prepareArgs = @('-ReleaseDirectory', $release, '-OutputDirectory', $package, '-StateRoot', $StateRoot, '-SourceCodexHome', $SourceCodexHome, '-SourceExtensionPath', $UiSourcePath, '-TypeScriptPath', $TypeScriptPath)
    $prepareArgs += @('-SourceTestPolicyPath', $sourceTestPolicyPath)
    if ($sourceHandoff['prepare'].usable) {
        $prepareArgs += @('-SourceStatePath', $sourceHandoff['prepare'].sourceStatePath, '-SourceGeneration', $sourceHandoff['prepare'].sourceGeneration)
    }
    if ($HostVersion) { $prepareArgs += @('-HostVersion', $HostVersion) }
    if ($ReuseDecisionsPath) { $prepareArgs += @('-ReuseDecisionsPath', $ReuseDecisionsPath) }
    if ($Resume -and (Test-Path -LiteralPath (Join-Path $package 'preparation-state.json'))) { $prepareArgs += '-Resume' }
    if ($NamespaceCacheProjectRoot) { $prepareArgs += @('-NamespaceCacheProjectRoot', $NamespaceCacheProjectRoot) }
    if ($SkipCodexEnvironmentSnapshot) { $prepareArgs += '-SkipCodexEnvironmentSnapshot' }
    if (-not $FullRegression) { $prepareArgs += '-ChangedOnlyTests' }
    $prepare = Start-OwnedCommand 'prepare' $pwsh (@('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'prepare-independent-vscode.ps1')) + $prepareArgs)
    # Source tests, engine checks and private package preparation must all pass before external probes.
    Wait-OwnedCommands @($sourceTests, $enginePreservation, $prepare)
    if ($VerifyAccountControls) {
        $enginePath = Join-Path $release 'engine/azrael.exe'
        $bridgePath = Join-Path $release 'engine/azrael-bridge.exe'
        $socketPath = Join-Path $accountControlsState 'socket/a.sock'
        if ([Text.Encoding]::UTF8.GetByteCount($socketPath) -gt 100) {
            $socketPath = Join-Path ([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) "a$([guid]::NewGuid().ToString('N').Substring(0, 12))/a.sock"
        }
        if ([Text.Encoding]::UTF8.GetByteCount($socketPath) -gt 100) { throw 'Account controls socket path exceeds the Windows AF_UNIX limit.' }
        if (Test-Path -LiteralPath (Split-Path $socketPath -Parent)) { throw 'Account controls socket directory already exists.' }
        $reportPath = Join-Path $accountControlsState 'verification.json'
        $metrics.accountControls = [ordered]@{ status = 'running'; verification = $reportPath; stateRoot = $accountControlsState; socket = $socketPath; engine = $enginePath; bridge = $bridgePath; engineSha256 = (Get-FileHash -LiteralPath $enginePath).Hash; bridgeSha256 = (Get-FileHash -LiteralPath $bridgePath).Hash }
        $accountCheck = Start-OwnedCommand 'account-controls' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'check-accounts.mjs'), $enginePath, $bridgePath, $accountControlsState, $socketPath, '--account-controls-only', '--models-catalog', (Join-Path $release 'scripts/devin-catalog.json'), '--parent-lifecycle-id', $accountLifecycleId)
        Wait-OwnedCommands @($accountCheck)
        $accountReport = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
        if ($accountReport.status -cne 'passed' -or $accountReport.route -cne 'account-controls' -or
            -not [IO.Path]::IsPathFullyQualified($accountReport.engine) -or [IO.Path]::GetFullPath($accountReport.engine) -ine $enginePath -or
            -not [IO.Path]::IsPathFullyQualified($accountReport.bridge) -or [IO.Path]::GetFullPath($accountReport.bridge) -ine $bridgePath -or
            ($accountReport.modelRequests -isnot [long] -and $accountReport.modelRequests -isnot [int]) -or $accountReport.modelRequests -ne 0 -or
            ($accountReport.usageCreditConsumeRequests -isnot [long] -and $accountReport.usageCreditConsumeRequests -isnot [int]) -or $accountReport.usageCreditConsumeRequests -ne 0) {
            throw 'Account controls verification status, route, binary identity, or request counts mismatch.'
        }
        if ((Get-FileHash -LiteralPath $enginePath).Hash -cne $metrics.accountControls.engineSha256 -or (Get-FileHash -LiteralPath $bridgePath).Hash -cne $metrics.accountControls.bridgeSha256) { throw 'Account controls binaries changed during verification.' }
        $metrics.accountControls.status = 'passed'
    }
    $enginePreservationResult = Get-Content -LiteralPath $enginePreservation.Record.stdout -Raw | ConvertFrom-Json
    $enginePreservationConfig.receiptPath = [string]$enginePreservationResult.receiptPath
    if (-not $enginePreservationConfig.receiptPath) { throw 'Engine preservation receiptPath missing.' }
    $enginePreservationConfig | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $enginePreservationConfigPath -Encoding utf8NoBOM
    $preparedPath = Join-Path $package 'independent-prepared.json'
    $prepared = Get-Content -LiteralPath $preparedPath -Raw | ConvertFrom-Json
    if ([IO.Path]::GetFullPath($prepared.ReleaseDirectory) -ine $release -or [IO.Path]::GetFullPath($prepared.HostVsix) -ine (Join-Path $package 'azrael-host.vsix')) { throw 'Preparation returned a different release or package path.' }
    $script:preparedHash = (Get-FileHash -LiteralPath $preparedPath).Hash
    Assert-Package
    # Unknown impact and exhaustive runs retain both activation modes.
    $standaloneOwners = @('scripts/integrated-azrael-entry.cjs','scripts/namespace-azrael-host.cjs','scripts/prepare-independent-vscode.ps1','scripts/check-independent-vscode.ps1','scripts/independent-vscode-host-check.cjs','scripts/install-app-release.ps1','scripts/install-azrael.ps1','scripts/package-app-release.py','scripts/ordinary-runtime.cjs','scripts/shared-engine-host.cjs','scripts/devin-native-host.cjs','scripts/provider-accounts-host.cjs','scripts/platform-runtime.cjs','scripts/azrael-platforms.json','scripts/azrael-app-release.json')
    $standaloneRequired = $VerifyStandaloneHost -or $FullRegression -or $ExhaustiveRegression -or -not $ChangedPath -or @($ChangedPath | Where-Object { $p = $_ -replace '\\','/'; $p -in $standaloneOwners -or $p.StartsWith('extensions/azrael-ex/', [StringComparison]::Ordinal) }).Count -gt 0
    $acceptanceArgs = @('-HostVsixPath', $prepared.HostVsix, '-FixtureRoot', $fixture, '-StateRoot', $fixtureStateRoot, '-UseFreshState', '-ParentLifecycleId', $fixtureLifecycleId, '-OriginalExtensionPath', $OriginalExtensionPath, '-OriginalAudioPath', $OriginalAudioPath, '-CodePath', $CodePath)
    if ($standaloneRequired) { $acceptanceArgs += '-VerifyStandalone' }
    Invoke-Stage 'acceptance' 'check-independent-vscode.ps1' $acceptanceArgs
    $acceptancePath = Join-Path $fixture 'check-result.json'
    $acceptance = Get-Content -LiteralPath $acceptancePath -Raw | ConvertFrom-Json
    $stages = @('initialInventory', 'hostInstall', 'finalInventory', 'host')
    if ($standaloneRequired) { $stages += 'standaloneHost' }
    if ($acceptance.passed -isnot [bool] -or $acceptance.passed -cne $true -or @($acceptance.exitCodes.PSObject.Properties).Count -ne $stages.Count -or $acceptance.standaloneVerified -isnot [bool] -or $acceptance.standaloneVerified -ne [bool]$standaloneRequired) { throw 'Host acceptance did not pass the selected stages.' }
    foreach ($stage in $stages) {
        $value = $acceptance.exitCodes.PSObject.Properties[$stage]
        if ($null -eq $value -or $null -eq $value.Value -or $value.Value -isnot [long] -and $value.Value -isnot [int] -or $value.Value -ne 0) { throw "Host acceptance stage failed or missing: $stage" }
    }
    if ($acceptance.useFreshState -isnot [bool] -or $acceptance.useFreshState -cne $true -or [IO.Path]::GetFullPath($acceptance.hostPackage.vsix) -ine $prepared.HostVsix -or $acceptance.hostPackage.sha256 -ine $prepared.HostSha256 -or [string]$acceptance.hostPackage.version -cne [string]$prepared.HostVersion) { throw 'Host acceptance package identity or fresh state mismatch.' }
    Assert-Package
    Assert-ProjectSnapshot 'pre-install'
    $engineRecheck = Start-OwnedCommand 'engine-preservation-recheck' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'feature-preservation.cjs'), 'verify-receipt', '--config', $enginePreservationConfigPath)
    Wait-OwnedCommands @($engineRecheck)
    $metrics.acceptanceResult = $acceptancePath
    $metrics.hostPackage = @{ vsix = $prepared.HostVsix; sha256 = $prepared.HostSha256; version = $prepared.HostVersion }
    if (-not $VerifyOnly) {
        $installArgs = @{ ReleaseDirectory = $release; PreparedPackageDirectory = $package; StateRoot = $StateRoot; SourceCodexHome = $SourceCodexHome; WorkspacePath = $WorkspacePath; ExtensionsDir = $ExtensionsDir; CodePath = $CodePath; NoLaunch = $true; SkipCodexEnvironmentSnapshot = [bool]$SkipCodexEnvironmentSnapshot }
        if ($UserDataDir) { $installArgs.UserDataDir = $UserDataDir }
        $argsPath = Join-Path $logs 'install-arguments.json'
        $installArgs | ConvertTo-Json | Set-Content -LiteralPath $argsPath -Encoding utf8NoBOM
        $resultPath = Join-Path $logs 'install-result.json'
        $wrapper = Join-Path $logs 'invoke-install.ps1'
        @'
param([string]$Script, [string]$ArgumentsPath, [string]$ResultPath)
$ErrorActionPreference = 'Stop'
$arguments = Get-Content -LiteralPath $ArgumentsPath -Raw | ConvertFrom-Json -AsHashtable
$global:LASTEXITCODE = 0
$result = @(& $Script @arguments)
$installExitCode = $global:LASTEXITCODE
$result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ResultPath -Encoding utf8NoBOM
if ($installExitCode -ne 0) {
    [Console]::Error.WriteLine("Installer returned exit code $installExitCode.")
    exit $installExitCode
}
'@ | Set-Content -LiteralPath $wrapper -Encoding utf8NoBOM
        $metrics.installation = [ordered]@{ status = 'started'; resultPath = $resultPath; receipt = $null }
        $install = Start-OwnedCommand 'install' $pwsh @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $wrapper, '-Script', (Join-Path $PSScriptRoot 'install-azrael.ps1'), '-ArgumentsPath', $argsPath, '-ResultPath', $resultPath)
        Wait-OwnedCommands @($install)
        if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) { throw 'Installer result was not recorded.' }
        $metrics.installResult = $resultPath
        # The owning installer returns the exact retained receipt path in its result.
        $metrics.installerResult = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
        $installedResults = @($metrics.installerResult | Where-Object { $null -ne $_ -and $null -ne $_.PSObject.Properties['Installed'] })
        if ($installedResults.Count -ne 1) { throw 'Installer did not return one successful installation result.' }
        $installed = $installedResults[0]
        if ($installed.Installed -isnot [bool] -or $installed.Installed -cne $true -or $installed.ReloadRequired -isnot [bool] -or $installed.ReloadRequired -cne $true -or
            $installed.Launched -isnot [bool] -or $installed.Launched -cne $false -or
            [IO.Path]::GetFullPath($installed.ReleaseDirectory) -ine $release -or [IO.Path]::GetFullPath($installed.HostVsix) -ine $prepared.HostVsix) {
            throw 'Installer result does not confirm installation of the tested release/package with reload required and no launch.'
        }
        if (-not [IO.Path]::IsPathFullyQualified($installed.Receipt) -or -not (Test-Path -LiteralPath $installed.Receipt -PathType Leaf)) { throw 'Installer receipt is missing or its path is not absolute.' }
        $metrics.installation.receipt = [IO.Path]::GetFullPath($installed.Receipt)
        $receipt = Get-Content -LiteralPath $metrics.installation.receipt -Raw | ConvertFrom-Json
        if ($receipt.status -cne 'installed-reload-required' -or $receipt.hostInstalled -isnot [bool] -or $receipt.hostInstalled -cne $true -or
            $receipt.reloadRequired -isnot [bool] -or $receipt.reloadRequired -cne $true -or
            [IO.Path]::GetFullPath($receipt.releaseDirectory) -ine $release -or [IO.Path]::GetFullPath($receipt.packageDirectory) -ine $package -or
            [IO.Path]::GetFullPath($receipt.hostVsix) -ine $prepared.HostVsix -or [string]$receipt.hostVersion -cne [string]$prepared.HostVersion) {
            throw 'Installer receipt does not confirm installation of the tested release/package/version.'
        }
        $metrics.installation.status = 'verified'
    }
    $metrics.status = if ($VerifyOnly) { 'verified' } else { 'installed' }
} catch {
    if ($metrics.Contains('accountControls') -and $metrics.accountControls.status -cne 'passed') { $metrics.accountControls.status = 'failed' }
    $metrics.status = if ($_.Exception.Data['exitCode'] -eq 3) { 'review-required' } elseif ($metrics.Contains('installation')) { $metrics.installation.status = 'failed'; 'installation-failed' } else { 'failed' }
    $metrics.error = $_.Exception.Message
    throw
} finally {
    foreach ($child in $children) {
        try {
            if (-not $child.Completed) {
                if (-not $child.Process.HasExited) { $child.Record.terminated = $true; $child.Process.Kill($true) }
                Complete-OwnedCommand $child
            }
        } finally { $child.Process.Dispose() }
    }
    $metrics.completedUtc = [DateTime]::UtcNow.ToString('o')
    Write-DeploymentMetrics
    if ($metrics.status -in @('verified', 'installed') -and @($metrics.stages | Where-Object { $null -eq $_.exitCode -or $_.exitCode -ne 0 -or $_.terminated }).Count -eq 0) {
        try {
            # Publish the durable acceptance reference before the cleaner inspects
            # installed/previous deployment dependencies. All children are disposed.
            $archivedAcceptance = Join-Path $project "artifacts/logs/verification-evidence/$run/check-result.json"
            for ($cursor = $archivedAcceptance; $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
                if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Linked acceptance archive path: $cursor" }
            }
            New-Item -ItemType Directory -Path (Split-Path $archivedAcceptance -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $acceptancePath -Destination $archivedAcceptance -Force
            $acceptancePath = $archivedAcceptance
            $metrics.acceptanceResult = $archivedAcceptance
            $metrics.fixtureLifecycle = Register-ArtifactLifecycle -ProjectRoot $project -Id $fixtureLifecycleId -Kind run -Owner 'azrael-release' -Generated -ProtectionKnown -State complete -MembershipComplete $true -Members $fixtureLifecycleMembers
            if ($VerifyAccountControls) {
                $archivedAccount = Join-Path $project "artifacts/logs/verification-evidence/account-controls-$ReleaseName/verification.json"
                for ($cursor = $archivedAccount; $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
                    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Linked account archive path: $cursor" }
                }
                New-Item -ItemType Directory -Path (Split-Path $archivedAccount -Parent) -Force | Out-Null
                Copy-Item -LiteralPath $metrics.accountControls.verification -Destination $archivedAccount
                $metrics.accountControls.verification = $archivedAccount
                $metrics.accountLifecycle = Register-ArtifactLifecycle -ProjectRoot $project -Id $accountLifecycleId -Kind run -Owner 'azrael-release' -Generated -ProtectionKnown -State complete -MembershipComplete $true -Members $accountLifecycleMembers
            }
            $metrics | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $logs 'deployment-metrics.json') -Encoding utf8NoBOM
            $metrics.verificationCleanup = & (Join-Path $PSScriptRoot 'clean-verification-artifacts.ps1') -ProjectRoot $project -FixtureRoot $fixture -Apply -ReportPath (Join-Path $logs 'verification-cleanup.json') -ReportLifecycleId "version:$ReleaseName"
            if ($VerifyAccountControls) {
                $metrics.accountControlsCleanup = & (Join-Path $PSScriptRoot 'clean-verification-artifacts.ps1') -ProjectRoot $project -FixtureRoot $accountControlsState -Apply -ReportPath (Join-Path $logs 'account-controls-cleanup.json') -ReportLifecycleId "version:$ReleaseName"
            }
        } catch { $metrics.verificationCleanup = @{ status = 'blocked'; reason = $_.Exception.Message; fixtureRoot = $fixture } }
        $metrics | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $logs 'deployment-metrics.json') -Encoding utf8NoBOM
    }
}
$lifecycleSucceeded = $metrics.status -in @('verified','installed')
[pscustomobject]@{ Status = $metrics.status; ReleaseDirectory = $release; PreparedPackageDirectory = $package; AcceptanceResult = $acceptancePath; Metrics = (Join-Path $logs 'deployment-metrics.json') }
} catch {
    if ($_.Exception.Data['exitCode'] -eq 3) { [Console]::Error.WriteLine($_.Exception.Message); $global:LASTEXITCODE = 3; exit 3 }
    throw
} finally {
    if ($pipelineLease) { $pipelineLease.Dispose() }
    if ($lifecycleSucceeded) { $null = Register-ArtifactLifecycle -ProjectRoot $project -Id "version:$ReleaseName" -Kind version -Owner 'azrael-release' -Generated -ProtectionKnown -State complete -MembershipComplete $true -Members $lifecycleMembers }
    else { try {
        $null = Register-ArtifactLifecycle -ProjectRoot $project -Id "version:$ReleaseName" -Kind version -Owner 'azrael-release' -Generated -ProtectionKnown -State failed -MembershipComplete $false -Members $lifecycleMembers
        $null = Register-ArtifactLifecycle -ProjectRoot $project -Id $fixtureLifecycleId -Kind run -Owner 'azrael-release' -Generated -ProtectionKnown -State failed -MembershipComplete $false -Members $fixtureLifecycleMembers
        if ($VerifyAccountControls) { $null = Register-ArtifactLifecycle -ProjectRoot $project -Id $accountLifecycleId -Kind run -Owner 'azrael-release' -Generated -ProtectionKnown -State failed -MembershipComplete $false -Members $accountLifecycleMembers }
    } catch { Write-Warning "Lifecycle failure receipt could not be updated: $($_.Exception.Message)" } }
    if ($temporaryLifecycleId -and $metrics.completedUtc) {
        # Release only this completed consumer. Other executions, installations,
        # recovery and evidence references belong to their own owners.
        $uncertainConsumers = @($metrics.stages | Where-Object { $null -eq $_.exitCode -or $_.name -in @('source-tests','build','engine-preservation','prepare','acceptance','account-controls','install') })
        if ($lifecycleSucceeded -or $uncertainConsumers.Count -eq 0) {
            try {
                $record = Register-ArtifactLifecycle -ProjectRoot $project -Id $temporaryLifecycleId -Kind work -Owner 'azrael-deployment-temporary' -Generated -ProtectionKnown -State complete -MembershipComplete $true -Members $temporaryLifecycleMembers
                $referenceIdentity = ConvertTo-Json -InputObject @("version:$ReleaseName", $temporaryConsumerReason, 'execution') -Compress
                $referenceHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($referenceIdentity))).ToLowerInvariant()
                $terminalEvidence = Join-Path $logs 'deployment-metrics.json'
                $requestPath = Join-Path $logs 'temporary-consumer-release.json'
                @{ owner = 'azrael-deployment-temporary'; expected_revision = $record.revision; reference_ids = @($referenceHash); reason = 'This deployment consumer has terminated; preserve all other references.'; evidence_ref = $terminalEvidence; evidence_sha256 = (Get-FileHash -LiteralPath $terminalEvidence -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $requestPath -Encoding utf8NoBOM
                $null = Release-ArtifactLifecycleReferences -ProjectRoot $project -Id $temporaryLifecycleId -RequestFile $requestPath
            } catch { Write-Warning "Temporary consumer protection retained: $($_.Exception.Message)" }
        } else { Write-Warning 'Temporary consumer protection retained until interrupted or failed downstream producers are diagnosed and their closure is verified.' }
    }
}
