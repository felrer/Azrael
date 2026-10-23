#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]*$')][string]$ReleaseName,
    [string]$SourceRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'engine'),
    [string]$RetainedSourceRoot,
    [string]$EngineTargetDirectory,
    [string]$ModuleCacheProjectRoot,
    [string]$CargoVerificationCacheProjectRoot,
    [string]$NamespaceCacheProjectRoot,
    [string[]]$PreflightToolDirectory,
    [long]$RequiredFreeBytes = 0,
    [long]$EstimatedCompilerGrowthBytes = 0,
    [string]$WindowControlTargetDirectory,
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
    [switch]$SkipCodexEnvironmentSnapshot,
    [switch]$FullRegression,
    [switch]$ExhaustiveRegression,
    [ValidateRange(1,16)][int]$SourceTestConcurrency = 4,
    [switch]$ForceNativeVerification,
    [string[]]$ChangedPath,
    [AllowEmptyCollection()][string[]]$EngineFeatureId,
    [switch]$VerifyAccountControls,
    [string]$HostVersion
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($ExhaustiveRegression) { $FullRegression = $true }
$UiSourcePath = [IO.Path]::GetFullPath($UiSourcePath)
$project = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$run = "deploy-$ReleaseName"
$logs = Join-Path $project "artifacts/logs/$run"
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
$fixtureStateRoot = Join-Path $fixture $(if ($VerificationFixtureRoot) { 's' } else { 'state' })
$accountControlsState = Join-Path $project "artifacts/verification/account-controls-$ReleaseName"
. (Join-Path $PSScriptRoot 'verification-state.ps1')
Assert-AzraelVerificationStatePath -StateRoot $StateRoot
Assert-AzraelVerificationStatePath -StateRoot $fixtureStateRoot
$runPaths = @($logs, $release, (Join-Path $project "artifacts/logs/$ReleaseName"), (Split-Path $package -Parent), $fixture)
if ($VerifyAccountControls) { $runPaths += $accountControlsState }
foreach ($path in $runPaths) {
    if (Test-Path -LiteralPath $path) { throw "Run path already exists: $path. Use a new ReleaseName." }
}
if ($CompanionVsixPath -and -not $TypeScriptPath) { throw 'CompanionVsixPath requires the explicit TypeScriptPath from its pinned build staging.' }
if ($EngineDirectory -and -not $SkipEngineBuild) { throw 'EngineDirectory requires SkipEngineBuild.' }
if ($SkipEngineBuild -and (-not $EngineDirectory -or $CodeModeHostPath)) { throw 'SkipEngineBuild requires EngineDirectory and cannot select CodeModeHostPath.' }
if (-not $SkipEngineBuild -and -not $CodeModeHostPath) { throw 'A full build requires CodeModeHostPath.' }
if ($EngineTargetDirectory -and $SkipEngineBuild) { throw 'EngineTargetDirectory requires a full engine build.' }
if ($EngineTargetDirectory -and -not [IO.Path]::IsPathFullyQualified($EngineTargetDirectory)) { throw 'EngineTargetDirectory must be an absolute cache path.' }
if ($WindowControlTargetDirectory -and -not [IO.Path]::IsPathFullyQualified($WindowControlTargetDirectory)) { throw 'WindowControlTargetDirectory must be an absolute cache path.' }
if ($CargoVerificationCacheProjectRoot -and -not [IO.Path]::IsPathFullyQualified($CargoVerificationCacheProjectRoot)) { throw 'CargoVerificationCacheProjectRoot must be an absolute cache owner path.' }
if ($NamespaceCacheProjectRoot -and -not [IO.Path]::IsPathFullyQualified($NamespaceCacheProjectRoot)) { throw 'NamespaceCacheProjectRoot must be an absolute cache owner path.' }
if ($FullRegression -and $ChangedPath) { throw 'ChangedPath cannot be combined with FullRegression.' }
if ($FullRegression -and $PSBoundParameters.ContainsKey('EngineFeatureId')) { throw 'EngineFeatureId cannot be combined with FullRegression.' }
. (Join-Path $PSScriptRoot 'artifact-lifecycle.ps1')
$lifecycleMembers = Get-VersionLifecycleMembers $project $ReleaseName
$null = Register-ArtifactLifecycle -ProjectRoot $project -Id "version:$ReleaseName" -Kind version -Owner 'azrael-release' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members $lifecycleMembers
$fixtureLifecycleId = "run:verification:$ReleaseName"
$fixtureLifecycleMembers = [ordered]@{fixture=$fixture}
$null = Register-ArtifactLifecycle -ProjectRoot $project -Id $fixtureLifecycleId -Kind run -Owner 'azrael-release' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members $fixtureLifecycleMembers
$accountLifecycleId = "run:account-controls:$ReleaseName"
$accountLifecycleMembers = [ordered]@{fixture=$accountControlsState}
if ($VerifyAccountControls) { $null = Register-ArtifactLifecycle -ProjectRoot $project -Id $accountLifecycleId -Kind run -Owner 'azrael-release' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members $accountLifecycleMembers }
$lifecycleSucceeded = $false
$temporaryLifecycleId = $null
$temporaryLifecycleMembers = $null
$temporaryConsumerReason = 'Deployment temporary inputs'
try {
New-Item -ItemType Directory -Path $logs | Out-Null
$timer = [Diagnostics.Stopwatch]::StartNew()
$children = [Collections.Generic.List[object]]::new()
$script:environmentPatch = @{}
$metrics = [ordered]@{ schema = 1; releaseName = $ReleaseName; startedUtc = [DateTime]::UtcNow.ToString('o'); status = 'running'; verifyOnly = [bool]$VerifyOnly; releaseDirectory = $release; packageDirectory = $package; fixtureRoot = $fixture; stages = @(); inputChecks = @(); engineTargetDirectory = $EngineTargetDirectory; wallTimeMs = 0 }
$pwsh = (Get-Process -Id $PID).Path

function Write-DeploymentMetrics {
    # Checkpoints are diagnostic; a write failure must not mask the command failure.
    try {
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
function Start-OwnedCommand {
    param([string]$Name, [string]$Executable, [string[]]$Arguments)
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
    $record = [ordered]@{ name = $Name; executable = $Executable; arguments = $Arguments; startedUtc = [DateTime]::UtcNow.ToString('o'); durationMs = 0; exitCode = $null; terminated = $false; completedUtc = $null; stdout = (Join-Path $logs "$Name.stdout.log"); stderr = (Join-Path $logs "$Name.stderr.log") }
    $metrics.stages += $record
    $out = [IO.File]::Create($record.stdout)
    $err = [IO.File]::Create($record.stderr)
    try { $proc = [Diagnostics.Process]::Start($info) } catch { $out.Dispose(); $err.Dispose(); $record.startError = $_.Exception.Message; throw }
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
    Write-DeploymentMetrics
}
function Wait-OwnedCommands {
    param([object[]]$Commands, [object[]]$MonitoredCommands = @())
    while (@($Commands | Where-Object { -not $_.Completed }).Count) {
        foreach ($child in @($Commands) + @($MonitoredCommands)) {
            if (-not $child.Completed -and $child.Process.HasExited) {
                Complete-OwnedCommand $child
                if ($child.Record.exitCode -ne 0) { throw "$($child.Record.name) failed with exit code $($child.Record.exitCode). See $($child.Record.stderr) and $($child.Record.stdout)." }
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
function Assert-Package {
    if ((Get-FileHash -LiteralPath $preparedPath).Hash -cne $script:preparedHash) { throw 'Prepared package metadata changed after preparation.' }
    if ((Get-FileHash -LiteralPath $prepared.HostVsix).Hash -ine $prepared.HostSha256) { throw 'Prepared package SHA-256 mismatch.' }
    $preservationBuild = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json
    $preservationConfig = [ordered]@{
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
    $archive = [IO.Compression.ZipFile]::OpenRead($prepared.HostVsix)
    try {
        $entry = $archive.GetEntry('extension/package.json')
        if (-not $entry) { throw 'Prepared package manifest is missing.' }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ([string]$manifest.version -cne [string]$prepared.HostVersion) { throw 'Prepared package version mismatch.' }
    } finally { $archive.Dispose() }
}

function Get-FocusedEngineFeatureIds {
    param([string[]]$PolicyPaths, [string]$EngineSourceRoot,
        [AllowEmptyCollection()][string[]]$EngineFeatureId, [switch]$ExplicitSelection)
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
        throw "Unmapped engine verification scope: $($unmappedNative -join ', '). Select EngineFeatureId explicitly (an empty array is allowed), or use FullRegression."
    }
    return @($selected | Select-Object -Unique)
}
try {
    $script:inputSnapshot = Get-ProjectSnapshot 'initial'
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
    $focusedEngineFeatureIds = @(if (-not $FullRegression) { Get-FocusedEngineFeatureIds -PolicyPaths $policyPaths -EngineSourceRoot $SourceRoot -EngineFeatureId $EngineFeatureId -ExplicitSelection:($PSBoundParameters.ContainsKey('EngineFeatureId')) })
    $buildArgs = @('-ReleaseName', $ReleaseName, '-SourceRoot', $SourceRoot, '-LifecycleParentActive')
    if ($RetainedSourceRoot) { $buildArgs += @('-RetainedSourceRoot', $RetainedSourceRoot) }
    if ($EngineTargetDirectory) { $buildArgs += @('-EngineTargetDirectory', $EngineTargetDirectory) }
    if ($ModuleCacheProjectRoot) { $buildArgs += @('-ModuleCacheProjectRoot', $ModuleCacheProjectRoot) }
    if ($WindowControlTargetDirectory) { $buildArgs += @('-WindowControlTargetDirectory', $WindowControlTargetDirectory) }
    if ($ComputerUseRuntimeDirectory) { $buildArgs += @('-ComputerUseRuntimeDirectory', $ComputerUseRuntimeDirectory) }
    if ($ComputerUsePluginDirectory) { $buildArgs += @('-ComputerUsePluginDirectory', $ComputerUsePluginDirectory) }
    if ($SkipEngineBuild) { $buildArgs += @('-SkipEngineBuild', '-EngineDirectory', $EngineDirectory) } else { $buildArgs += @('-CodeModeHostPath', $CodeModeHostPath) }
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
        projectRoot = $project; engineSourceRoot = [IO.Path]::GetFullPath($SourceRoot)
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
    if ($CargoVerificationCacheProjectRoot) { $sourceConfig.cargoVerificationCacheProjectRoot = $CargoVerificationCacheProjectRoot }
    if (-not $FullRegression) { $sourceConfig.featureIds = $focusedEngineFeatureIds }
    $sourceConfigPath = Join-Path $logs 'engine-source-preflight-inputs.json'
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
    . (Join-Path $PSScriptRoot 'build-module-cache.ps1')
    $preflightModuleCache = Open-BuildModuleCache $project $ModuleCacheProjectRoot
    try {
        $metrics.moduleCachePreflight = [ordered]@{ owner = $preflightModuleCache.Owner; root = $preflightModuleCache.Root; registeredProjects = @(Get-BuildCacheProjects $preflightModuleCache) }
    } finally { $preflightModuleCache.Lease.Dispose() }
    $dependencies = Start-OwnedCommand 'verification-dependencies' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'pipeline-preflight.cjs'), $sourceConfigPath)
    Wait-OwnedCommands @($dependencies)
    $sourcePreflight = Start-OwnedCommand 'engine-source-preflight' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'feature-preservation.cjs'), 'run', '--config', $sourceConfigPath)
    Wait-OwnedCommands @($sourcePreflight)
    $sourcePreflightResult = Get-Content -LiteralPath $sourcePreflight.Record.stdout -Raw | ConvertFrom-Json
    if (-not $sourcePreflightResult.receiptPath) { throw 'Source preflight receipt missing.' }
    $sourceConfig.receiptPath = [string]$sourcePreflightResult.receiptPath
    $sourceConfig | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $sourceConfigPath -Encoding utf8NoBOM
    $sourceTestArgs += @('--source-preflight-config', $sourceConfigPath)
    # Keep logical argv in owned logs; Windows Process.Start has a 32K command-line limit.
    $sourceTestArgsPath = Join-Path $logs 'source-test-arguments.json'
    $sourceLogicalArgs = @($sourceTestArgs | Select-Object -Skip 1)
    ConvertTo-Json -InputObject $sourceLogicalArgs -Depth 5 | Set-Content -LiteralPath $sourceTestArgsPath -Encoding utf8NoBOM
    $metrics.sourceTestArguments = [ordered]@{ path = $sourceTestArgsPath; sha256 = (Get-FileHash -LiteralPath $sourceTestArgsPath -Algorithm SHA256).Hash.ToLowerInvariant(); count = $sourceLogicalArgs.Count; characterCount = ($sourceLogicalArgs | Measure-Object -Property Length -Sum).Sum }
    $sourceTests = Start-OwnedCommand 'source-tests' (Get-Command node -CommandType Application).Source @($sourceTestArgs[0], '--args-file', $sourceTestArgsPath, '--args-sha256', $metrics.sourceTestArguments.sha256)
    $build = Start-OwnedCommand 'build' $pwsh (@('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'build-azrael.ps1')) + $buildArgs)
    # Build completion releases binary consumers; source failures still cancel owned work.
    Wait-OwnedCommands @($build) -MonitoredCommands @($sourceTests)
    Assert-ProjectSnapshot 'post-build'
    $preservationBuild = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json
    $enginePreservationConfig = [ordered]@{
        projectRoot = $project; engineSourceRoot = [IO.Path]::GetFullPath($SourceRoot)
        uiRoot = $UiSourcePath
        engineDirectory = (Join-Path $release 'engine'); outputDirectory = (Join-Path $logs 'engine-preservation'); area = 'engine'
        reuseNativeChecks = -not [bool]$ForceNativeVerification
        sourceReceiptPath = [string]$sourcePreflightResult.receiptPath
    }
    if ($EngineTargetDirectory) { $enginePreservationConfig.cargoTargetDirectory = $EngineTargetDirectory }
    if ($CargoVerificationCacheProjectRoot) { $enginePreservationConfig.cargoVerificationCacheProjectRoot = $CargoVerificationCacheProjectRoot }
    if (-not $FullRegression) {
        $enginePreservationConfig.featureIds = $focusedEngineFeatureIds
    }
    $enginePreservationConfigPath = Join-Path $logs 'engine-preservation-inputs.json'
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
    if ($HostVersion) { $prepareArgs += @('-HostVersion', $HostVersion) }
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
        $accountCheck = Start-OwnedCommand 'account-controls' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'check-accounts.mjs'), $enginePath, $bridgePath, $accountControlsState, $socketPath, '--account-controls-only', '--parent-lifecycle-id', $accountLifecycleId)
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
    Invoke-Stage 'acceptance' 'check-independent-vscode.ps1' @('-HostVsixPath', $prepared.HostVsix, '-FixtureRoot', $fixture, '-StateRoot', $fixtureStateRoot, '-UseFreshState', '-ParentLifecycleId', $fixtureLifecycleId, '-TypeScriptPath', $TypeScriptPath, '-UiSourcePath', $UiSourcePath, '-OriginalExtensionPath', $OriginalExtensionPath, '-OriginalAudioPath', $OriginalAudioPath, '-CodePath', $CodePath)
    $acceptancePath = Join-Path $fixture 'check-result.json'
    $acceptance = Get-Content -LiteralPath $acceptancePath -Raw | ConvertFrom-Json
    $stages = @('initialInventory', 'hostInstall', 'finalInventory', 'namespace', 'standaloneHost', 'host')
    if ($acceptance.passed -isnot [bool] -or $acceptance.passed -cne $true -or @($acceptance.exitCodes.PSObject.Properties).Count -ne 6) { throw 'Host acceptance did not pass all six stages.' }
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
    $metrics.status = if ($metrics.Contains('installation')) { $metrics.installation.status = 'failed'; 'installation-failed' } else { 'failed' }
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
            $metrics.verificationCleanup = & (Join-Path $PSScriptRoot 'clean-verification-artifacts.ps1') -ProjectRoot $project -FixtureRoot $fixture -Apply -ReportPath (Join-Path $logs 'verification-cleanup.json')
            if ($VerifyAccountControls) {
                $metrics.accountControlsCleanup = & (Join-Path $PSScriptRoot 'clean-verification-artifacts.ps1') -ProjectRoot $project -FixtureRoot $accountControlsState -Apply -ReportPath (Join-Path $logs 'account-controls-cleanup.json')
            }
        } catch { $metrics.verificationCleanup = @{ status = 'blocked'; reason = $_.Exception.Message; fixtureRoot = $fixture } }
        $metrics | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $logs 'deployment-metrics.json') -Encoding utf8NoBOM
    }
}
$lifecycleSucceeded = $metrics.status -in @('verified','installed')
[pscustomobject]@{ Status = $metrics.status; ReleaseDirectory = $release; PreparedPackageDirectory = $package; AcceptanceResult = $acceptancePath; Metrics = (Join-Path $logs 'deployment-metrics.json') }
} finally {
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
