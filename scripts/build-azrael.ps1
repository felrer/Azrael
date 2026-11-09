#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]*$')]
    [string]$ReleaseName = (Get-Date -Format 'yyyyMMdd-HHmmss-fff'),
    [switch]$SkipEngineBuild,
    [switch]$ForceEngineCompatibility,
    [string]$SourceRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'engine'),
    [string]$RetainedSourceRoot,
    [string]$EngineTargetDirectory,
    [string]$CargoCacheProjectRoot,
    [string]$CargoCacheScope = $(if ($null -ne $env:AZRAEL_CARGO_CACHE_SCOPE) { $env:AZRAEL_CARGO_CACHE_SCOPE } else { 'product-release' }),
    [string]$ModuleCacheProjectRoot,
    [string]$WindowControlTargetDirectory,
    [string]$VirtualInputRuntimeDirectory,
    [string]$MultiPointerRuntimeDirectory,
    [string]$EngineDirectory,
    [string]$CompanionVsixPath,
    [string]$CodeModeHostPath,
    [string]$ComputerUseRuntimeDirectory,
    [string]$ComputerUsePluginDirectory,
    [switch]$IncludeDevinNative = $true,
    [switch]$IncludeProviderAccounts = $true,
    [ValidateSet('engine','companion','providers','window-control')][string[]]$RebuildModule = @(),
    [ValidateRange(0,10)][int]$KeepModuleCaches = 0,
    [switch]$SkipCacheCleanup,
    [switch]$Resume,
    [string]$ReuseDecisionsPath,
    [string]$PipelineContextPath,
    [string]$SourceStateHandoffPath,
    [string]$SourceStateHandoffToken,
    [switch]$LifecycleParentActive
)

$ErrorActionPreference = 'Stop'
if ([bool]$SourceStateHandoffPath -ne [bool]$SourceStateHandoffToken) { throw 'Source state handoff path and attempt token must be supplied together.' }
if ($ReuseDecisionsPath) {
    & node -e 'require(process.argv[1]).loadDecisions(process.argv[2])' (Join-Path $PSScriptRoot 'verification-reuse-policy.cjs') $ReuseDecisionsPath
    if ($LASTEXITCODE -ne 0) { throw 'Invalid ReuseDecisionsPath; supply an absolute regular schema-1 decision file.' }
}
$projectRoot = Split-Path $PSScriptRoot -Parent
$committedContextJson = & node (Join-Path $PSScriptRoot 'committed-build-context.cjs') $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'A verified commit-bound workspace is required before building.' }
$committedContext = $committedContextJson | ConvertFrom-Json
if ([IO.Path]::GetFullPath($SourceRoot) -ine (Join-Path $projectRoot 'engine')) { throw 'SourceRoot must be the prepared workspace engine.' }
$artifactRoot = Join-Path $projectRoot 'artifacts'
$release = Join-Path $artifactRoot "releases/$ReleaseName"
$logDirectory = Join-Path $artifactRoot "logs/$ReleaseName"
if (-not $Resume -and ((Test-Path -LiteralPath $release) -or (Test-Path -LiteralPath $logDirectory))) {
    throw "ReleaseName already exists: $ReleaseName. Use a new name."
}
if ($EngineDirectory -and -not $SkipEngineBuild) {
    throw 'EngineDirectory requires SkipEngineBuild; otherwise the freshly built pair is used.'
}
if ($SkipEngineBuild -and $CodeModeHostPath) { throw 'CodeModeHostPath cannot replace a member of a reused recorded bundle. Run a full build to select a different host.' }
$sourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
$rustRoot = Join-Path $sourceRoot 'codex-rs'
if (-not (Test-Path -LiteralPath (Join-Path $rustRoot 'Cargo.toml') -PathType Leaf)) {
    throw 'SourceRoot must contain codex-rs/Cargo.toml.'
}
if ($RetainedSourceRoot) {
    if (-not [IO.Path]::IsPathFullyQualified($RetainedSourceRoot)) { throw 'RetainedSourceRoot must be absolute.' }
    $RetainedSourceRoot = (Resolve-Path -LiteralPath $RetainedSourceRoot).Path
    if (-not (Test-Path -LiteralPath (Join-Path $RetainedSourceRoot 'codex-rs/Cargo.toml') -PathType Leaf)) { throw 'RetainedSourceRoot must contain codex-rs/Cargo.toml.' }
}
if ($EngineTargetDirectory -and $SkipEngineBuild) { throw 'EngineTargetDirectory requires a full engine build.' }
if ($EngineTargetDirectory -and -not [IO.Path]::IsPathFullyQualified($EngineTargetDirectory)) { throw 'EngineTargetDirectory must be an absolute cache path.' }
$sharedCargoCache = $null
if (-not $SkipEngineBuild -and (-not $EngineTargetDirectory -or $CargoCacheProjectRoot)) {
    $cacheOwner = if ($CargoCacheProjectRoot) { $CargoCacheProjectRoot } elseif ($ModuleCacheProjectRoot) { $ModuleCacheProjectRoot } else { $projectRoot }
    $cacheSelection = & node (Join-Path $PSScriptRoot 'cargo-shared-cache.cjs') --project-root $cacheOwner --source-root $sourceRoot --target x86_64-pc-windows-msvc --scope $CargoCacheScope
    if ($LASTEXITCODE -ne 0) { throw 'Shared Cargo cache selection failed.' }
    $sharedCargoCache = $cacheSelection | ConvertFrom-Json
    if ($EngineTargetDirectory -and [IO.Path]::GetFullPath($EngineTargetDirectory) -ine $sharedCargoCache.targetDirectory) { throw 'Explicit engine target conflicts with selected shared Cargo cache.' }
    $EngineTargetDirectory = $sharedCargoCache.targetDirectory
}
$engineTarget = if ($EngineTargetDirectory) { [IO.Path]::GetFullPath($EngineTargetDirectory) } else { Join-Path $rustRoot 'target' }
if ($PipelineContextPath -and -not $LifecycleParentActive) { throw 'PipelineContextPath requires the active deployment parent.' }
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$buildLogRoot=$logDirectory
$buildDeploymentLease=$null
if (-not $PipelineContextPath) {
    $pipelineDirectory=Join-Path $projectRoot "artifacts/logs/deploy-$ReleaseName"
    New-Item -ItemType Directory -Path $pipelineDirectory -Force | Out-Null
    $buildDeploymentLease=[IO.File]::Open((Join-Path $pipelineDirectory 'pipeline.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
}
$buildLease=[IO.File]::Open((Join-Path $buildLogRoot 'build.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
. (Join-Path $PSScriptRoot 'artifact-lifecycle.ps1')
$lifecycleMembers = Get-VersionLifecycleMembers $projectRoot $ReleaseName
$null = Register-ArtifactLifecycle -ProjectRoot $projectRoot -Id "version:$ReleaseName" -Kind version -Owner 'azrael-release' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members $lifecycleMembers
try {
if (-not $EngineDirectory) { $EngineDirectory = Join-Path $engineTarget 'x86_64-pc-windows-msvc/release' }
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
if ($Resume) { $logDirectory = Join-Path $buildLogRoot ('attempts/' + [guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $logDirectory | Out-Null }
. (Join-Path $PSScriptRoot 'build-metrics.ps1')
$buildPipelineContext = if ($PipelineContextPath) { Get-Content -LiteralPath $PipelineContextPath -Raw | ConvertFrom-Json -AsHashtable } else {
    $snapshotPath=Join-Path $logDirectory 'build-inputs.json'
    $snapshot = & node (Join-Path $PSScriptRoot 'deployment-input-snapshot.cjs') $projectRoot $snapshotPath
    if ($LASTEXITCODE -ne 0) { throw 'Build input fingerprint failed.' }
    if (($snapshot | ConvertFrom-Json).sha256 -cne $committedContext.projectSha256) { throw 'Prepared source differs from its committed input receipt.' }
    @{file=(Join-Path $projectRoot "artifacts/logs/deploy-$ReleaseName/pipeline-state.json"); identity=@{project=[IO.Path]::GetFullPath($projectRoot); platform='windows-x64'; releaseName=$ReleaseName; sourceSnapshot=($snapshot|ConvertFrom-Json).sha256;sourceCommit=$committedContext.sourceCommit}}
}
if ($buildPipelineContext.identity.sourceCommit -cne $committedContext.sourceCommit -or $buildPipelineContext.identity.sourceSnapshot -cne $committedContext.projectSha256) { throw 'Build pipeline differs from committed workspace identity.' }
$script:buildPipelineActive = $null
function Invoke-BuildCheckpoint([string]$Action, [string]$Name, $Options=@{}) {
    if (-not $buildLease -or $buildLease.SafeFileHandle.IsClosed) { throw 'Build checkpoint requires its exclusive owner lease.' }
    $requestPath=Join-Path $logDirectory 'pipeline-request.json'
    @{file=$buildPipelineContext.file; identity=$buildPipelineContext.identity; resume=[bool](Test-Path -LiteralPath $buildPipelineContext.file); lockHeld=$true; reuseDecisionsPath=$ReuseDecisionsPath; action=$Action; name=$Name; options=$Options} | ConvertTo-Json -Depth 35 | Set-Content -LiteralPath $requestPath -Encoding utf8NoBOM
    $errorPath=Join-Path $logDirectory 'pipeline-review-error.json'
    $result=& node (Join-Path $PSScriptRoot 'pipeline-state.cjs') $requestPath 2> $errorPath
    if ($LASTEXITCODE -ne 0) {
        $failure=[Exception]::new("Build checkpoint $Action failed for $Name. $(Get-Content -LiteralPath $errorPath -Raw)")
        $failure.Data['exitCode']=$LASTEXITCODE
        throw $failure
    }
    return ($result|ConvertFrom-Json)
}
$null=Invoke-BuildCheckpoint 'snapshot' ''
function Get-BuildRuntimeSourceIdentity([System.Collections.IDictionary]$Sources, [string]$Name) {
    $code = 'const fs=require("node:fs"),crypto=require("node:crypto"),{getDirectoryState}=require(process.argv[1]),sources=JSON.parse(process.argv[2]);(async()=>{const result={};for(const key of Object.keys(sources).sort()){const source=sources[key];if(typeof source==="object"){result[key]={path:source.path,sha256:require(source.helper).sourceFingerprint(source.path)};}else{const stat=fs.statSync(source);result[key]=stat.isDirectory()?await getDirectoryState(source):{path:source,sha256:crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex")};}}console.log(JSON.stringify(result));})().catch(e=>{console.error(e.message);process.exitCode=1})'
    $json = Invoke-BuildCommand 'node' @('-e', $code, (Join-Path $PSScriptRoot 'directory-state.cjs'), (ConvertTo-Json -InputObject $Sources -Compress -Depth 5)) "$Name-sources.log" -CaptureOutput
    return ($json | ConvertFrom-Json -AsHashtable)
}
function Get-BuildRuntimeOutputs([string]$Helper, [string]$Destination, [string]$Name) {
    $code = 'const path=require("node:path"),result=require(process.argv[1]).verifyRuntime(process.argv[2]);console.log(JSON.stringify([path.join(result.directory,"manifest.json"),...result.manifest.files.map(file=>path.join(result.directory,file.path))]))'
    $json = Invoke-BuildCommand 'node' @('-e', $code, $Helper, $Destination) "$Name-outputs.log" -CaptureOutput
    return @($json | ConvertFrom-Json)
}
function Invoke-BuildRuntimeStaging {
    param([string]$Name, [string]$Helper, [string]$Destination, [System.Collections.IDictionary]$Sources, [scriptblock]$Stage)
    $sourceIdentity = Get-BuildRuntimeSourceIdentity $Sources $Name
    $inputs = @{sources=$sourceIdentity;destination=[IO.Path]::GetFullPath($Destination);frozenSource=$buildPipelineContext.identity.sourceSnapshot;helperSha256=(Get-FileHash -LiteralPath $Helper -Algorithm SHA256).Hash.ToLowerInvariant()}
    $options = @{inputs=$inputs;dependencies=@('build.package')}
    if (Test-Path -LiteralPath $Destination) { $options.outputs = @(Get-BuildRuntimeOutputs $Helper $Destination $Name) }
    $checkpoint = Invoke-BuildCheckpoint 'lookup' $Name $options
    if ($checkpoint) { return }
    if (Test-Path -LiteralPath $Destination) { throw "Runtime output lacks a successful matching staging checkpoint; reconcile it through its owner before retrying: $Destination" }
    $null = Invoke-BuildCheckpoint 'start' $Name @{inputs=$inputs;dependencies=@('build.package')}
    $script:buildPipelineActive = $Name
    $commandCountBefore = $buildMetrics.Stages.Count
    try {
        & $Stage
        $after = Get-BuildRuntimeSourceIdentity $Sources $Name
        if ((ConvertTo-Json -InputObject $sourceIdentity -Compress -Depth 10) -cne (ConvertTo-Json -InputObject $after -Compress -Depth 10)) { throw 'Runtime staging source changed during publication.' }
        $outputs = @(Get-BuildRuntimeOutputs $Helper $Destination $Name)
    } catch {
        $failure = $_
        $lastCommand = @($buildMetrics.Stages | Select-Object -Skip $commandCountBefore | Where-Object { $_.Status -eq 'failed' -and $null -ne $_.ExitCode } | Select-Object -Last 1)
        $actualExit = if ($lastCommand.Count) { $lastCommand[0].ExitCode } else { $null }
        $script:buildPipelineActive = $null
        $null = Invoke-BuildCheckpoint 'finish' $Name @{exitCode=$actualExit;outcome='failed';error=$failure.Exception.Message}
        throw $failure
    }
    # Once publication starts, an unobserved response must remain unresolved;
    # an outer catch must not publish a second, invented failure completion.
    $script:buildPipelineActive = $null
    $null = Invoke-BuildCheckpoint 'finish' $Name @{exitCode=0;outputs=$outputs}
}
$engineInputs=@{sourceRoot=$sourceRoot; retainedSourceRoot=$RetainedSourceRoot; engineDirectory=$EngineDirectory; host=$CodeModeHostPath; target=$engineTarget; skip=[bool]$SkipEngineBuild; rebuild=@($RebuildModule)}
$ambientEnvironment=[Environment]::GetEnvironmentVariables()
$buildEnvironment=Get-LogicalBuildEnvironment -Environment $ambientEnvironment -PipelineRoot (Join-Path $projectRoot "artifacts/logs/deploy-$ReleaseName") -SourceFixtureRoot $(if ($buildPipelineContext.ContainsKey('sourceFixtureRoot')) { [string]$buildPipelineContext.sourceFixtureRoot } else { '' })
$engineInputs.environmentSha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $buildEnvironment -Compress)))).ToLowerInvariant()
$engineInputs.tools=@{}
foreach ($tool in @('node.exe','python.exe','cargo.exe','rustc.exe')) {
    foreach ($directory in @($env:PATH.Split([IO.Path]::PathSeparator))) {
        if (-not $directory) { continue }
        $candidate=Join-Path $directory.Trim('"') $tool
        if ([IO.File]::Exists($candidate)) { $engineInputs.tools[[IO.Path]::GetFullPath($candidate)]=(Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant(); break }
    }
}
if ($CodeModeHostPath) { $engineInputs.hostSha256=(Get-FileHash -LiteralPath $CodeModeHostPath -Algorithm SHA256).Hash.ToLowerInvariant() }
$buildMetrics = New-BuildMetrics (Join-Path $logDirectory 'build-metrics.json')
$sourceStatePath = Join-Path $logDirectory 'engine-source-state.json'
$sourceGeneration = [guid]::NewGuid().ToString('N')
$sourceStateArguments = @('--source-state', $sourceStatePath, '--source-generation', $sourceGeneration)
Set-BuildMetricContext -Metrics $buildMetrics -Name 'cargo' -Value @{ targetDirectory=$engineTarget; profile='release'; target='x86_64-pc-windows-msvc'; selectedSourceRoot=$sourceRoot; sourceMode=$(if ($sharedCargoCache) {'stable-shared-when-compatible'} else {'frozen-explicit-target'}); cacheOwner=$(if ($sharedCargoCache) {$sharedCargoCache.projectRoot} else {$null}) }

function Resolve-CodeModeHost {
    if (-not (Test-Path -LiteralPath $CodeModeHostPath -PathType Leaf)) {
        throw 'CodeModeHostPath must select an existing compatible code-mode host. Compatibility must be checked with the selected engine.'
    }
    return (Resolve-Path -LiteralPath $CodeModeHostPath).Path
}

. (Join-Path $PSScriptRoot 'build-module-cache.ps1')
$moduleCache = Open-BuildModuleCache $projectRoot $ModuleCacheProjectRoot
$moduleCache.Keep = $KeepModuleCaches
$moduleCache.SkipCleanup = [bool]$SkipCacheCleanup
$moduleCache.LogDirectory = $logDirectory
$moduleInputs = @((Join-Path $PSScriptRoot 'build-module-cache.ps1'), (Join-Path $PSScriptRoot 'build-metrics.ps1'))
. (Join-Path $PSScriptRoot 'build-module-companion-recipe.ps1')
. (Join-Path $PSScriptRoot 'build-module-providers-recipe.ps1')
$moduleTypeScriptPath = $null
try {
$engineCheckpoint=Invoke-BuildCheckpoint 'lookup' 'build.engine' @{inputs=$engineInputs}
if ($engineCheckpoint) {
    $EngineDirectory=$engineCheckpoint.data.engineDirectory
    $SkipEngineBuild=[bool]$engineCheckpoint.data.engineReused
    $engine=Join-Path $EngineDirectory 'azrael.exe'
    $bridge=Join-Path $EngineDirectory 'azrael-bridge.exe'
} else {
    $null=Invoke-BuildCheckpoint 'start' 'build.engine' @{inputs=$engineInputs}
    $script:buildPipelineActive='build.engine'
# Automatically reuse a complete source-verified engine bundle. Explicit reuse
# still follows the existing required provenance check below.
if (-not $SkipEngineBuild -and 'engine' -notin $RebuildModule) {
    $reuseOwner = if ($CargoCacheProjectRoot) { $CargoCacheProjectRoot } elseif ($ModuleCacheProjectRoot) { $ModuleCacheProjectRoot } else { $projectRoot }
    $latestPath = Join-Path $reuseOwner 'artifacts/latest.json'
    if (Test-Path -LiteralPath $latestPath) {
        $previousRelease = (Get-Content $latestPath -Raw | ConvertFrom-Json).releaseDirectory
        $candidateEngine = Join-Path $previousRelease 'engine'
        if (Test-Path -LiteralPath (Join-Path $candidateEngine 'azrael-engine-build.json')) {
            & python -B (Join-Path $PSScriptRoot 'engine-provenance.py') verify --profile release --root $sourceRoot --engine-dir $candidateEngine @sourceStateArguments *> (Join-Path $logDirectory 'engine-auto-reuse.log')
            $reuseVerified = $LASTEXITCODE -eq 0
            $hostSelectionMatches = $false
            if ($reuseVerified) {
                $candidateReceipt = Get-Content (Join-Path $candidateEngine 'azrael-engine-build.json') -Raw | ConvertFrom-Json
                $candidateHost = $candidateReceipt.externalRuntimes.codeModeHost
                $hostSelectionMatches = if ($CodeModeHostPath) {
                    (Test-Path -LiteralPath $CodeModeHostPath -PathType Leaf) -and (Get-FileHash -LiteralPath $CodeModeHostPath -Algorithm SHA256).Hash -ieq $candidateHost.sha256
                } else {
                    $candidateHost.kind -ceq 'source-built' -and $candidateHost.sourceSha256 -ceq $candidateReceipt.source.sourceSha256
                }
            }
            if ($reuseVerified -and $hostSelectionMatches) {
                $EngineDirectory=$candidateEngine;$SkipEngineBuild=$true
            }
        }
    }
}
if (-not $SkipEngineBuild) {
    $phase = Start-BuildStage $buildMetrics 'engine-build'
    $check = Start-BuildStage $buildMetrics 'engine-host-source-check'
    $externalCodeModeHost = if ($CodeModeHostPath) { Resolve-CodeModeHost } else { $null }
    $externalCodeModeHostHash = if ($externalCodeModeHost) { (Get-FileHash -LiteralPath $externalCodeModeHost -Algorithm SHA256).Hash } else { $null }
    Complete-BuildStage $buildMetrics $check
    Invoke-BuildCommand 'python' (@('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'snapshot', '--root', (Split-Path $rustRoot -Parent), '--file', (Join-Path $logDirectory 'engine-source-before.json')) + $sourceStateArguments) 'source-snapshot.log'
    Push-Location $rustRoot
    $previousTarget = $env:CARGO_TARGET_DIR
    $previousCacheOwner = $env:AZRAEL_CARGO_CACHE_PROJECT_ROOT
    $previousCacheScope = $env:AZRAEL_CARGO_CACHE_SCOPE
    $previousStableSource = $env:AZRAEL_CARGO_STABLE_SOURCE
    try {
        # The explicit cache may be reused across selected source snapshots.
        # Cargo must successfully build all selected binaries before provenance is recorded.
        $env:CARGO_TARGET_DIR = $engineTarget
        if ($sharedCargoCache) {
            $env:AZRAEL_CARGO_CACHE_PROJECT_ROOT = $sharedCargoCache.projectRoot
            $env:AZRAEL_CARGO_CACHE_SCOPE = $sharedCargoCache.identity.scope
        }
        $env:AZRAEL_CARGO_STABLE_SOURCE = '1'
        Invoke-BuildCommand 'node' (@((Join-Path $PSScriptRoot 'cargo-target-owner.cjs'), 'build', '--release', '--locked', '--no-default-features', '--jobs', '6', '--target', 'x86_64-pc-windows-msvc', '-p', 'codex-app-server', '--bin', 'azrael', '-p', 'codex-app-server-client', '--bin', 'azrael-bridge') + $(if (-not $CodeModeHostPath) { @('-p', 'codex-code-mode-host', '--bin', 'codex-code-mode-host') } else { @() })) 'engine.log'
        $check = Start-BuildStage $buildMetrics 'engine-host-hash-check-and-copy'
        if ($externalCodeModeHost -and (Get-FileHash -LiteralPath $externalCodeModeHost -Algorithm SHA256).Hash -cne $externalCodeModeHostHash) { throw 'Selected code-mode host changed during compilation; rebuild with a stable runtime.' }
        $selectedCodeModeHost = if ($externalCodeModeHost) { $externalCodeModeHost } else { Join-Path $EngineDirectory 'codex-code-mode-host.exe' }
        $codeModeHostDestination = Join-Path $EngineDirectory 'azrael-code-mode-host.exe'
        if ($selectedCodeModeHost -cne $codeModeHostDestination) {
            Copy-Item -LiteralPath $selectedCodeModeHost -Destination $codeModeHostDestination -Force
        }
        Complete-BuildStage $buildMetrics $check
        Invoke-BuildCommand 'python' (@('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'record', '--profile', 'release', '--root', (Split-Path $rustRoot -Parent), '--file', (Join-Path $logDirectory 'engine-source-before.json'), '--engine-dir', $EngineDirectory) + $sourceStateArguments + $(if ($CodeModeHostPath) { @('--code-mode-host-source', $externalCodeModeHost) } else { @('--code-mode-host-built') })) 'engine-provenance.log'
    } finally {
        $env:CARGO_TARGET_DIR = $previousTarget
        $env:AZRAEL_CARGO_CACHE_PROJECT_ROOT = $previousCacheOwner
        $env:AZRAEL_CARGO_CACHE_SCOPE = $previousCacheScope
        $env:AZRAEL_CARGO_STABLE_SOURCE = $previousStableSource
        Pop-Location
    }
    Complete-BuildStage $buildMetrics $phase
}
$phase = Start-BuildStage $buildMetrics 'engine-provenance-and-binary-check'
Invoke-BuildCommand 'python' (@('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'verify', '--profile', 'release', '--root', (Split-Path $rustRoot -Parent), '--engine-dir', $EngineDirectory) + $sourceStateArguments) 'engine-source-check.log'
if ($RetainedSourceRoot) {
    Invoke-BuildCommand 'python' (@('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'verify', '--profile', 'release', '--root', $RetainedSourceRoot, '--engine-dir', $EngineDirectory) + $sourceStateArguments) 'engine-retained-source-check.log'
}
$engine = Join-Path $EngineDirectory 'azrael.exe'
$bridge = Join-Path $EngineDirectory 'azrael-bridge.exe'
$codeModeHost = Join-Path $EngineDirectory 'azrael-code-mode-host.exe'
foreach ($file in @($engine, $bridge, $codeModeHost)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing engine pair member: $file" }
}
Complete-BuildStage $buildMetrics $phase
    $null=Invoke-BuildCheckpoint 'finish' 'build.engine' @{exitCode=0; outputs=@($engine,$bridge,$codeModeHost,(Join-Path $EngineDirectory 'azrael-engine-build.json')); data=@{engineDirectory=$EngineDirectory;engineReused=[bool]$SkipEngineBuild}}
    $script:buildPipelineActive=$null
}
Invoke-BuildCommand 'node' (@((Join-Path $PSScriptRoot 'check-build-engine-compatibility.mjs'), $EngineDirectory, (Join-Path $logDirectory 'code-mode-host-compatibility'), '--cache-project-root', $moduleCache.Owner) + $(if ($ForceEngineCompatibility -or -not $SkipEngineBuild) { @('--full') } else { @() })) 'code-mode-host-compatibility.log'
$null=Invoke-BuildCheckpoint 'start' 'build.engine-ready' @{inputs=@{processId=$PID};dependencies=@('build.engine')}
$null=Invoke-BuildCheckpoint 'finish' 'build.engine-ready' @{exitCode=0;data=@{processId=$PID}}
$companionCache = $null
if (-not $CompanionVsixPath) {
    $phase = Start-BuildStage $buildMetrics 'companion-staging'
    $companionSource = Join-Path $projectRoot 'extensions/azrael-ex'
    $nodeVersion = (& node --version).Trim()
    $npmVersion = (& npm.cmd --version).Trim()
    $companionPreferenceInputs = @('maintenance-preferences-host.cjs','maintenance-owner-config.cjs','maintenance-lock-owner.cjs','maintenance-lock-worker.cjs') | ForEach-Object { Join-Path $PSScriptRoot $_ }
    $companionCache = Get-BuildModuleEntry $moduleCache companion (@($companionSource, (Join-Path $PSScriptRoot 'platform-runtime.cjs'), (Join-Path $PSScriptRoot 'azrael-platforms.json'), (Join-Path $PSScriptRoot 'build-module-companion-recipe.ps1'))+$moduleInputs+$companionPreferenceInputs) @($nodeVersion,$npmVersion) -AdditionalInputs {Get-BuildCompanionToolInputs} -Force:('companion' -in $RebuildModule)
    $null = Register-ArtifactLifecycle -ProjectRoot $projectRoot -Id "version:$ReleaseName" -Kind version -Owner 'azrael-release' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members $lifecycleMembers -References @{ $companionCache.LifecycleId='companion-tool' } -ReferenceKind dependency
    & node (Join-Path $PSScriptRoot 'module-cache-consumers.cjs') attach $moduleCache.Owner $projectRoot "version:$ReleaseName" companion $companionCache.Key | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Durable companion cache consumer registration failed.' }
    $CompanionVsixPath = Join-Path $companionCache.Path 'azrael-ex.vsix'
    $moduleTypeScriptPath = Join-Path $companionCache.Path 'companion/node_modules/typescript/lib/typescript.js'
    if (-not $companionCache.Hit) {
    . Invoke-BuildModuleCompanionRecipe
    }
    Complete-BuildStage $buildMetrics $phase
}

# Package attempts write fresh owned staging paths; a partial package is never
# selected or overwritten by the next attempt.
$packageInputs=@{engine=$engine;bridge=$bridge;companion=$CompanionVsixPath;source=$sourceRoot;retained=$RetainedSourceRoot}
$packageCheckpoint=Invoke-BuildCheckpoint 'lookup' 'build.package' @{inputs=$packageInputs;dependencies=@('build.engine')}
if (-not $packageCheckpoint) {
if (Test-Path -LiteralPath $release) { throw 'Release output changed or lacks a successful package checkpoint; reconcile it through its owner before retrying.' }
$null=Invoke-BuildCheckpoint 'start' 'build.package' @{inputs=$packageInputs;dependencies=@('build.engine')}
$script:buildPipelineActive='build.package'
$packageStaging=Join-Path $artifactRoot ("build/$ReleaseName/package-"+[guid]::NewGuid().ToString('N'))
$phase = Start-BuildStage $buildMetrics 'release-packaging-and-copy'
Invoke-BuildScript (Join-Path $PSScriptRoot 'package-azrael.ps1') @{
    EnginePath = $engine; BridgePath = $bridge; CompanionVsixPath = $CompanionVsixPath
    SourceRoot = $sourceRoot; RetainedSourceRoot = $RetainedSourceRoot; OutputDirectory = $packageStaging
    SourceStatePath = $sourceStatePath; SourceGeneration = $sourceGeneration
} 'package.log'
$releaseParent = Split-Path $release -Parent
if (-not (Test-Path -LiteralPath $releaseParent -PathType Container)) { New-Item -ItemType Directory -Path $releaseParent | Out-Null }
Move-Item -LiteralPath $packageStaging -Destination $release
$null=Invoke-BuildCheckpoint 'finish' 'build.package' @{exitCode=0;outputs=@((Join-Path $release 'engine/azrael.exe'),(Join-Path $release 'engine/azrael-bridge.exe'),(Join-Path $release 'engine/azrael-code-mode-host.exe'),(Join-Path $release 'engine/azrael-engine-build.json'),(Join-Path $release 'azrael-ex.vsix'))}
$script:buildPipelineActive=$null
Complete-BuildStage $buildMetrics $phase
}
if ($companionCache) {
    & node (Join-Path $PSScriptRoot 'module-cache-consumers.cjs') seal $moduleCache.Owner $projectRoot "version:$ReleaseName" companion $companionCache.Key | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Packaged companion consumer release identity sealing failed.' }
}
$phase = Start-BuildStage $buildMetrics 'computer-use-runtime-staging'
if (-not $ComputerUseRuntimeDirectory) {
    $configPath = Join-Path $env:USERPROFILE '.azrael-ex/config.toml'
    $configuredCommand = & python -B -c 'import pathlib,sys,tomllib; print(tomllib.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8-sig"))["mcp_servers"]["node_repl"]["command"])' $configPath
    if ($LASTEXITCODE -ne 0 -or -not $configuredCommand -or [IO.Path]::GetFileName($configuredCommand) -ine 'node_repl.exe') { throw 'Pass -ComputerUseRuntimeDirectory or configure an explicit official node_repl.exe source.' }
    $commandDirectory = Split-Path $configuredCommand -Parent
    $ComputerUseRuntimeDirectory = if ((Split-Path $commandDirectory -Leaf) -ieq 'bin') { Split-Path $commandDirectory -Parent } else { $commandDirectory }
}
$computerRuntimeHelper = Join-Path $PSScriptRoot 'computer-use-runtime.cjs'
Invoke-BuildRuntimeStaging -Name 'build.computer-use-runtime' -Helper $computerRuntimeHelper -Destination (Join-Path $release 'computer-use') -Sources @{runtime=[IO.Path]::GetFullPath($ComputerUseRuntimeDirectory)} -Stage {
    Invoke-BuildCommand 'node' @($computerRuntimeHelper, 'stage', '--runtime-directory', $ComputerUseRuntimeDirectory, '--destination', (Join-Path $release 'computer-use')) 'computer-use-runtime.log'
}
$windowSource = Join-Path $projectRoot 'native/window-control'
$windowSharedCache=$null
if (-not $WindowControlTargetDirectory) {
    . (Join-Path $PSScriptRoot 'window-control-cache.ps1')
    $windowSharedCache=Open-WindowControlSharedCache $projectRoot $moduleCache.Owner
}
try {
$windowTarget = if ($WindowControlTargetDirectory) { [IO.Path]::GetFullPath($WindowControlTargetDirectory) } else { $windowSharedCache.Target }
$windowBuildArguments=@('-NoProfile', '-File', (Join-Path $PSScriptRoot 'build-window-control.ps1'))
$windowBuildArguments += @('-TargetDirectory', $windowTarget, '-LogDirectory', (Join-Path $logDirectory 'window-control-native'))
if ('window-control' -in $RebuildModule -or ($windowSharedCache -and -not $windowSharedCache.CanReuse)) { $windowBuildArguments += '-Rebuild' }
Invoke-BuildCommand 'pwsh' $windowBuildArguments 'window-control-build.log'
$windowStageArguments = @((Join-Path $PSScriptRoot 'window-control-runtime.cjs'), 'stage', '--source-root', $windowSource, '--executable', (Join-Path $windowTarget 'release/azrael-window-control.exe'), '--provenance', (Join-Path $windowTarget 'release/azrael-window-control-build.json'), '--script-directory', $PSScriptRoot, '--guidance', (Join-Path $projectRoot 'instructions/window-use/common.md'), '--destination', (Join-Path $release 'window-control'))
if ($VirtualInputRuntimeDirectory) { $windowStageArguments += @('--virtual-input-directory', [IO.Path]::GetFullPath($VirtualInputRuntimeDirectory)) }
if ($MultiPointerRuntimeDirectory) { $windowStageArguments += @('--multi-pointer-directory', [IO.Path]::GetFullPath($MultiPointerRuntimeDirectory)) }
$windowRuntimeHelper = Join-Path $PSScriptRoot 'window-control-runtime.cjs'
$windowRuntimeSources = @{source=@{path=$windowSource;helper=$windowRuntimeHelper};executable=(Join-Path $windowTarget 'release/azrael-window-control.exe');provenance=(Join-Path $windowTarget 'release/azrael-window-control-build.json');guidance=(Join-Path $projectRoot 'instructions/window-use/common.md')}
if ($VirtualInputRuntimeDirectory) { $windowRuntimeSources.virtualInput = [IO.Path]::GetFullPath($VirtualInputRuntimeDirectory) }
if ($MultiPointerRuntimeDirectory) { $windowRuntimeSources.multiPointer = [IO.Path]::GetFullPath($MultiPointerRuntimeDirectory) }
Invoke-BuildRuntimeStaging -Name 'build.window-control-runtime' -Helper $windowRuntimeHelper -Destination (Join-Path $release 'window-control') -Sources $windowRuntimeSources -Stage {
    Invoke-BuildCommand 'node' $windowStageArguments 'window-control-runtime.log'
}
if ($windowSharedCache) { Complete-WindowControlSharedCache $windowSharedCache }
} catch {
    if ($script:buildPipelineActive) {
        $lastCommand=@($buildMetrics.Stages | Where-Object { $_.Status -eq 'failed' -and $null -ne $_.ExitCode } | Select-Object -Last 1)
        $actualExit=if($lastCommand.Count){$lastCommand[0].ExitCode}else{$null}
        $null=Invoke-BuildCheckpoint 'finish' $script:buildPipelineActive @{exitCode=$actualExit;outcome='failed';error=$_.Exception.Message}
    }
    if ($windowSharedCache) { try { Fail-WindowControlSharedCache $windowSharedCache } catch { Write-Warning "WindowControl cache remains protected: $($_.Exception.Message)" } }
    throw
} finally { if ($windowSharedCache -and $windowSharedCache.Lease) { $windowSharedCache.Lease.Dispose() } }
$releaseBuildInfoPath = Join-Path $release 'build-info.json'
$releaseBuildInfo = Get-Content -LiteralPath $releaseBuildInfoPath -Raw | ConvertFrom-Json -AsHashtable
foreach ($module in @('platform-runtime.cjs', 'azrael-platforms.json', 'window-control-host.cjs', 'window-use-async-approvals.cjs', 'window-control-backend.cjs', 'window-control-policy.cjs', 'window-control-errors.cjs', 'window-control-occupancy.cjs', 'window-control-mcp.cjs', 'window-task-macros.cjs', 'window-control-runtime.cjs', 'window-virtual-input.cjs', 'computer-use-runtime.cjs', 'use-control-settings.cjs', 'window-use-approvals.cjs', 'use-settings-host.cjs') + @(if ($MultiPointerRuntimeDirectory) { 'multi-pointer-mcp.cjs'; 'window-switched-input.cjs' })) {
    $hostDirectory = Join-Path $release 'host'
    New-Item -ItemType Directory -Path $hostDirectory -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $module) -Destination (Join-Path $hostDirectory $module)
    $releaseBuildInfo.sha256["host/$module"] = (Get-FileHash -LiteralPath (Join-Path $hostDirectory $module) -Algorithm SHA256).Hash
}
$releaseBuildInfo.sha256['window-control/manifest.json'] = (Get-FileHash -LiteralPath (Join-Path $release 'window-control/manifest.json') -Algorithm SHA256).Hash
$releaseBuildInfo.sha256['computer-use/manifest.json'] = (Get-FileHash -LiteralPath (Join-Path $release 'computer-use/manifest.json') -Algorithm SHA256).Hash
$releaseBuildInfo | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $releaseBuildInfoPath -Encoding utf8NoBOM
Complete-BuildStage $buildMetrics $phase
$nodePath = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = (Invoke-BuildCommand $nodePath @('--version') 'managed-node-version.log' -CaptureOutput).Trim()
if ([version]($nodeVersion.TrimStart('v')) -lt [version]'22.18.0') { throw 'Managed Azrael helpers require Node 22.18 or newer.' }
if ($IncludeDevinNative) {
    $phase = Start-BuildStage $buildMetrics 'devin-staging'
    $providerDestination = Join-Path $release 'providers/devin'
    New-Item -ItemType Directory -Path (Split-Path $providerDestination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'providers/devin') -Destination $providerDestination -Recurse
    $scriptDestination = Join-Path $release 'scripts'
    New-Item -ItemType Directory -Path $scriptDestination -Force | Out-Null
    foreach ($scriptName in @('start-devin-native.ps1', 'prepare-devin.ps1')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $scriptName) -Destination (Join-Path $scriptDestination $scriptName)
    }
    Copy-Item -LiteralPath (Join-Path $rustRoot 'models-manager/models.json') -Destination (Join-Path $scriptDestination 'devin-catalog.json')
    Complete-BuildStage $buildMetrics $phase
    $phase = Start-BuildStage $buildMetrics 'devin-runtime-and-hash-checks'
    $providerFiles = [ordered]@{}
    foreach ($file in @(Get-ChildItem -LiteralPath $providerDestination -File -Recurse) + @(Get-ChildItem -LiteralPath $scriptDestination -File | Where-Object Name -In @('start-devin-native.ps1', 'prepare-devin.ps1', 'devin-catalog.json'))) {
        $providerFiles[[IO.Path]::GetRelativePath($release, $file.FullName).Replace('\', '/')] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    $nativeManifest = [ordered]@{
        schema = 1; mode = 'opt-in'; model = 'devin/swe-2-high'
        upstreamRevision = '9f7397ed1582d95c6c1fcf4ae9951213b3fa2d19'
        node = @{ path = $nodePath; version = $nodeVersion; sha256 = (Get-FileHash -LiteralPath $nodePath -Algorithm SHA256).Hash; bundled = $false }
        files = $providerFiles
    }
    $nativeManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $release 'devin-native-build.json') -Encoding utf8NoBOM
    Complete-BuildStage $buildMetrics $phase
}
if ($IncludeProviderAccounts) {
    $providerCache = Get-BuildModuleEntry $moduleCache providers (@((Join-Path $projectRoot 'providers/opencodex'),(Join-Path $projectRoot 'providers/devin/progress.mjs'),(Join-Path $projectRoot 'providers/devin/stall-diagnostics.mjs'),(Join-Path $projectRoot 'providers/devin/diagnostic-policy.mjs'),(Join-Path $projectRoot 'providers/devin/tool-search-history.mjs'),(Join-Path $projectRoot 'providers/devin/context-budget.mjs'),(Join-Path $PSScriptRoot 'provider-vendor-manifest.cjs'),(Join-Path $PSScriptRoot 'freeze-platform-inputs.cjs'),(Join-Path $artifactRoot 'tools/bun-1.4.2/package/bin/bun.exe'),(Join-Path $artifactRoot 'tools/bun-1.4.2/download.json'), (Join-Path $PSScriptRoot 'build-module-providers-recipe.ps1'))+$moduleInputs) -Force:('providers' -in $RebuildModule)
    if ($providerCache.Hit) {
        New-Item -ItemType Directory -Path (Join-Path $release 'providers') -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $providerCache.Path 'output/providers/opencodex') -Destination (Join-Path $release 'providers/opencodex') -Recurse
        Copy-Item -LiteralPath (Join-Path $providerCache.Path 'output/opencodex-accounts-build.json') -Destination $release
    } else {
    . Invoke-BuildModuleProvidersRecipe
    }
}
if (-not $moduleTypeScriptPath) { $moduleTypeScriptPath = Join-Path $projectRoot 'extensions/azrael-ex/node_modules/typescript/lib/typescript.js' }
Invoke-BuildCommand 'node' @((Join-Path $PSScriptRoot 'find-names-runtime.cjs'), 'stage', $release, $projectRoot, $moduleTypeScriptPath, $nodePath) 'find-names-staging.log'
$findNamesBuildInfo = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json -AsHashtable
$findNamesBuildInfo.sha256['node/node.exe'] = (Get-FileHash -LiteralPath (Join-Path $release 'node/node.exe') -Algorithm SHA256).Hash
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $release 'tools/find-names') -File) {
    $findNamesBuildInfo.sha256[('tools/find-names/' + $file.Name)] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'find-names-runtime.cjs') -Destination (Join-Path $release 'host/find-names-runtime.cjs')
$findNamesBuildInfo.sha256['host/find-names-runtime.cjs'] = (Get-FileHash -LiteralPath (Join-Path $release 'host/find-names-runtime.cjs') -Algorithm SHA256).Hash
$findNamesBuildInfo | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $release 'build-info.json') -Encoding utf8NoBOM
$phase = Start-BuildStage $buildMetrics 'packaged-engine-provenance-check'
if ($RetainedSourceRoot) {
    Invoke-BuildCommand 'python' (@('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'verify', '--profile', 'release', '--root', $RetainedSourceRoot, '--engine-dir', (Join-Path $release 'engine')) + $sourceStateArguments) 'packaged-retained-source-check.log'
}
Invoke-BuildCommand 'python' (@('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'verify', '--profile', 'release', '--root', (Split-Path $rustRoot -Parent), '--engine-dir', (Join-Path $release 'engine')) + $sourceStateArguments) 'packaged-source-check.log'
Invoke-BuildCommand 'node' @((Join-Path $PSScriptRoot 'window-control-runtime.cjs'), 'verify-release', '--release', $release, '--source-root', $windowSource) 'packaged-window-control-source-check.log'
Complete-BuildStage $buildMetrics $phase
$phase = Start-BuildStage $buildMetrics 'release-selection'
$selection = [ordered]@{
    releaseDirectory = $release
    generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    engineReused = [bool]$SkipEngineBuild
    engineSource = (Resolve-Path -LiteralPath $EngineDirectory).Path
    engineSourceSha256 = (Get-Content (Join-Path $release 'engine/azrael-engine-build.json') -Raw | ConvertFrom-Json).source.sourceSha256
}
$temporaryPointer = Join-Path $artifactRoot ('.latest-' + [guid]::NewGuid().ToString('N') + '.json')
$selection | ConvertTo-Json | Set-Content -LiteralPath $temporaryPointer -Encoding utf8NoBOM
[IO.File]::Move($temporaryPointer, (Join-Path $artifactRoot 'latest.json'), $true)
Complete-BuildStage $buildMetrics $phase
$buildInfoPath=Join-Path $release 'build-info.json'
$buildInfo=Get-Content $buildInfoPath -Raw | ConvertFrom-Json -AsHashtable
$buildInfo.moduleBuild=@{typeScriptPath=$moduleTypeScriptPath;modules=$moduleCache.Results;engineReused=[bool]$SkipEngineBuild;cacheOwner=$moduleCache.Owner}
$buildInfo | ConvertTo-Json -Depth 30 | Set-Content $buildInfoPath -Encoding utf8NoBOM
$moduleCache.Results | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $logDirectory 'modules.json') -Encoding utf8NoBOM
if (-not $SkipCacheCleanup) {
    try {
    $protectedCachePaths = @(Get-ProtectedBuildCachePaths $moduleCache)
    $moduleCache.CleanupResults += @(Remove-OldBuildModuleCaches $moduleCache -Keep $KeepModuleCaches -ProtectedPaths $protectedCachePaths)
    $moduleCache.CleanupResults | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $logDirectory 'module-cache-cleanup.json') -Encoding utf8NoBOM
    $moduleCache.StagingCleanupResults += @(Remove-OldBuildStaging $moduleCache -Keep $KeepModuleCaches -ProtectedPaths $protectedCachePaths)
    $moduleCache.StagingCleanupResults | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $logDirectory 'legacy-cache-cleanup.json') -Encoding utf8NoBOM
    & (Join-Path $PSScriptRoot 'clean-engine-caches.ps1') -ProjectRoot $projectRoot -CurrentSourceRoot $sourceRoot -TargetDirectory $engineTarget -Apply -ReportPath (Join-Path $logDirectory 'engine-cache-cleanup.json') | Out-Null
    } catch { Write-Warning "Cache cleanup preserved uncertain paths: $($_.Exception.Message)"; @{status='blocked';reason=$_.Exception.Message}|ConvertTo-Json|Set-Content (Join-Path $logDirectory 'cache-cleanup-warning.json') }
}
if ($SourceStateHandoffPath) {
    Invoke-BuildCommand 'node' @((Join-Path $PSScriptRoot 'engine-source-handoff.cjs'), 'publish', '--handoff', $SourceStateHandoffPath, '--token', $SourceStateHandoffToken, '--release', $release, '--state', $sourceStatePath, '--generation', $sourceGeneration) 'source-state-handoff.log'
}
Complete-BuildMetrics $buildMetrics -Status success
$null = Register-ArtifactLifecycle -ProjectRoot $projectRoot -Id "version:$ReleaseName" -Kind version -Owner 'azrael-release' -Generated -ProtectionKnown -State $(if ($LifecycleParentActive) {'pending'} else {'complete'}) -MembershipComplete (-not $LifecycleParentActive) -Members $lifecycleMembers
$global:LASTEXITCODE = 0
[pscustomobject]@{ ReleaseDirectory = $release; Logs = $logDirectory; EngineReused = [bool]$SkipEngineBuild }
} catch {
    Complete-BuildMetrics $buildMetrics -Status failed
    throw
}
finally { $moduleCache.Lease.Dispose() }
} catch {
    try { $null = Register-ArtifactLifecycle -ProjectRoot $projectRoot -Id "version:$ReleaseName" -Kind version -Owner 'azrael-release' -Generated -ProtectionKnown -State failed -MembershipComplete $false -Members $lifecycleMembers } catch { Write-Warning "Lifecycle failure receipt could not be updated: $($_.Exception.Message)" }
    if ($_.Exception.Data['exitCode'] -eq 3) { [Console]::Error.WriteLine($_.Exception.Message); $global:LASTEXITCODE = 3; exit 3 }
    throw
} finally {
    if ($buildLease) { $buildLease.Dispose() }
    if ($buildDeploymentLease) { $buildDeploymentLease.Dispose() }
}
