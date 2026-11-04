#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]*$')]
    [string]$ReleaseName = (Get-Date -Format 'yyyyMMdd-HHmmss-fff'),
    [switch]$SkipEngineBuild,
    [string]$SourceRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'engine'),
    [string]$RetainedSourceRoot,
    [string]$EngineTargetDirectory,
    [string]$CargoCacheProjectRoot,
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
    [switch]$LifecycleParentActive
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$artifactRoot = Join-Path $projectRoot 'artifacts'
$release = Join-Path $artifactRoot "releases/$ReleaseName"
$logDirectory = Join-Path $artifactRoot "logs/$ReleaseName"
if ((Test-Path -LiteralPath $release) -or (Test-Path -LiteralPath $logDirectory)) {
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
    $cacheSelection = & node (Join-Path $PSScriptRoot 'cargo-shared-cache.cjs') --project-root $cacheOwner --source-root $sourceRoot --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw 'Shared Cargo cache selection failed.' }
    $sharedCargoCache = $cacheSelection | ConvertFrom-Json
    if ($EngineTargetDirectory -and [IO.Path]::GetFullPath($EngineTargetDirectory) -ine $sharedCargoCache.targetDirectory) { throw 'Explicit engine target conflicts with selected shared Cargo cache.' }
    $EngineTargetDirectory = $sharedCargoCache.targetDirectory
}
$engineTarget = if ($EngineTargetDirectory) { [IO.Path]::GetFullPath($EngineTargetDirectory) } else { Join-Path $rustRoot 'target' }
. (Join-Path $PSScriptRoot 'artifact-lifecycle.ps1')
$lifecycleMembers = Get-VersionLifecycleMembers $projectRoot $ReleaseName
$null = Register-ArtifactLifecycle -ProjectRoot $projectRoot -Id "version:$ReleaseName" -Kind version -Owner 'azrael-release' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members $lifecycleMembers
try {
if (-not $EngineDirectory) { $EngineDirectory = Join-Path $engineTarget 'x86_64-pc-windows-msvc/release' }
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
. (Join-Path $PSScriptRoot 'build-metrics.ps1')
$buildMetrics = New-BuildMetrics (Join-Path $logDirectory 'build-metrics.json')
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
# Automatically reuse a complete source-verified engine bundle. Explicit reuse
# still follows the existing required provenance check below.
if (-not $SkipEngineBuild -and 'engine' -notin $RebuildModule) {
    $reuseOwner = if ($CargoCacheProjectRoot) { $CargoCacheProjectRoot } elseif ($ModuleCacheProjectRoot) { $ModuleCacheProjectRoot } else { $projectRoot }
    $latestPath = Join-Path $reuseOwner 'artifacts/latest.json'
    if (Test-Path -LiteralPath $latestPath) {
        $previousRelease = (Get-Content $latestPath -Raw | ConvertFrom-Json).releaseDirectory
        $candidateEngine = Join-Path $previousRelease 'engine'
        if (Test-Path -LiteralPath (Join-Path $candidateEngine 'azrael-engine-build.json')) {
            & python -B (Join-Path $PSScriptRoot 'engine-provenance.py') verify --profile release --root $sourceRoot --engine-dir $candidateEngine *> (Join-Path $logDirectory 'engine-auto-reuse.log')
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
    Invoke-BuildCommand 'python' @('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'snapshot', '--root', (Split-Path $rustRoot -Parent), '--file', (Join-Path $logDirectory 'engine-source-before.json')) 'source-snapshot.log'
    Push-Location $rustRoot
    $previousTarget = $env:CARGO_TARGET_DIR
    $previousCacheOwner = $env:AZRAEL_CARGO_CACHE_PROJECT_ROOT
    $previousStableSource = $env:AZRAEL_CARGO_STABLE_SOURCE
    try {
        # The explicit cache may be reused across selected source snapshots.
        # Cargo must successfully build all selected binaries before provenance is recorded.
        $env:CARGO_TARGET_DIR = $engineTarget
        if ($sharedCargoCache) { $env:AZRAEL_CARGO_CACHE_PROJECT_ROOT = $sharedCargoCache.projectRoot }
        $env:AZRAEL_CARGO_STABLE_SOURCE = '1'
        Invoke-BuildCommand 'node' (@((Join-Path $PSScriptRoot 'cargo-target-owner.cjs'), 'build', '--release', '--locked', '--no-default-features', '--target', 'x86_64-pc-windows-msvc', '-p', 'codex-app-server', '--bin', 'azrael', '-p', 'codex-app-server-client', '--bin', 'azrael-bridge') + $(if (-not $CodeModeHostPath) { @('-p', 'codex-code-mode-host', '--bin', 'codex-code-mode-host') } else { @() })) 'engine.log'
        $check = Start-BuildStage $buildMetrics 'engine-host-hash-check-and-copy'
        if ($externalCodeModeHost -and (Get-FileHash -LiteralPath $externalCodeModeHost -Algorithm SHA256).Hash -cne $externalCodeModeHostHash) { throw 'Selected code-mode host changed during compilation; rebuild with a stable runtime.' }
        $selectedCodeModeHost = if ($externalCodeModeHost) { $externalCodeModeHost } else { Join-Path $EngineDirectory 'codex-code-mode-host.exe' }
        $codeModeHostDestination = Join-Path $EngineDirectory 'azrael-code-mode-host.exe'
        if ($selectedCodeModeHost -cne $codeModeHostDestination) {
            Copy-Item -LiteralPath $selectedCodeModeHost -Destination $codeModeHostDestination -Force
        }
        Complete-BuildStage $buildMetrics $check
        Invoke-BuildCommand 'python' (@('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'record', '--profile', 'release', '--root', (Split-Path $rustRoot -Parent), '--file', (Join-Path $logDirectory 'engine-source-before.json'), '--engine-dir', $EngineDirectory) + $(if ($CodeModeHostPath) { @('--code-mode-host-source', $externalCodeModeHost) } else { @('--code-mode-host-built') })) 'engine-provenance.log'
    } finally {
        $env:CARGO_TARGET_DIR = $previousTarget
        $env:AZRAEL_CARGO_CACHE_PROJECT_ROOT = $previousCacheOwner
        $env:AZRAEL_CARGO_STABLE_SOURCE = $previousStableSource
        Pop-Location
    }
    Complete-BuildStage $buildMetrics $phase
}
$phase = Start-BuildStage $buildMetrics 'engine-provenance-and-binary-check'
Invoke-BuildCommand 'python' @('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'verify', '--profile', 'release', '--root', (Split-Path $rustRoot -Parent), '--engine-dir', $EngineDirectory) 'engine-source-check.log'
if ($RetainedSourceRoot) {
    Invoke-BuildCommand 'python' @('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'verify', '--profile', 'release', '--root', $RetainedSourceRoot, '--engine-dir', $EngineDirectory) 'engine-retained-source-check.log'
}
$engine = Join-Path $EngineDirectory 'azrael.exe'
$bridge = Join-Path $EngineDirectory 'azrael-bridge.exe'
$codeModeHost = Join-Path $EngineDirectory 'azrael-code-mode-host.exe'
foreach ($file in @($engine, $bridge, $codeModeHost)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing engine pair member: $file" }
}
Complete-BuildStage $buildMetrics $phase
Invoke-BuildCommand 'node' @((Join-Path $PSScriptRoot 'check-shared-engine.mjs'), $engine, (Join-Path $logDirectory 'code-mode-host-compatibility'), '--extended', '--code-mode-child') 'code-mode-host-compatibility.log'
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

# A failed package is never selected by latest.json. Preserve failure output for
# diagnosis and use a new release name on retry, rather than overwriting files.
$phase = Start-BuildStage $buildMetrics 'release-packaging-and-copy'
Invoke-BuildScript (Join-Path $PSScriptRoot 'package-azrael.ps1') @{
    EnginePath = $engine; BridgePath = $bridge; CompanionVsixPath = $CompanionVsixPath
    SourceRoot = $sourceRoot; RetainedSourceRoot = $RetainedSourceRoot; OutputDirectory = $release
} 'package.log'
if ($companionCache) {
    & node (Join-Path $PSScriptRoot 'module-cache-consumers.cjs') seal $moduleCache.Owner $projectRoot "version:$ReleaseName" companion $companionCache.Key | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Packaged companion consumer release identity sealing failed.' }
}
Complete-BuildStage $buildMetrics $phase
$phase = Start-BuildStage $buildMetrics 'computer-use-runtime-staging'
if (-not $ComputerUseRuntimeDirectory) {
    $configPath = Join-Path $env:USERPROFILE '.azrael-ex/config.toml'
    $configuredCommand = & python -B -c 'import pathlib,sys,tomllib; print(tomllib.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8-sig"))["mcp_servers"]["node_repl"]["command"])' $configPath
    if ($LASTEXITCODE -ne 0 -or -not $configuredCommand -or [IO.Path]::GetFileName($configuredCommand) -ine 'node_repl.exe') { throw 'Pass -ComputerUseRuntimeDirectory or configure an explicit official node_repl.exe source.' }
    $commandDirectory = Split-Path $configuredCommand -Parent
    $ComputerUseRuntimeDirectory = if ((Split-Path $commandDirectory -Leaf) -ieq 'bin') { Split-Path $commandDirectory -Parent } else { $commandDirectory }
}
if (-not $ComputerUsePluginDirectory) {
    $pluginRoot = Join-Path $env:USERPROFILE '.azrael-ex/plugins/cache/openai-bundled/computer-use'
    $candidates = @(Get-ChildItem -LiteralPath $pluginRoot -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName '.codex-plugin/plugin.json') -PathType Leaf })
    if ($candidates.Count -ne 1) { throw 'Pass -ComputerUsePluginDirectory; installed Computer Use plugin selection is missing or ambiguous.' }
    $ComputerUsePluginDirectory = $candidates[0].FullName
}
Invoke-BuildCommand 'node' @((Join-Path $PSScriptRoot 'computer-use-runtime.cjs'), 'stage', '--runtime-directory', $ComputerUseRuntimeDirectory, '--plugin-directory', $ComputerUsePluginDirectory, '--selected-window-guide', (Join-Path $projectRoot 'instructions/computer-use-selected-window.md'), '--destination', (Join-Path $release 'computer-use')) 'computer-use-runtime.log'
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
$childSessionSource = Join-Path $projectRoot 'native/windows-child-session/ChildSession.cs'
$childSessionExecutable = Join-Path $windowTarget 'release/windows-child-session.exe'
$childSessionCompiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $childSessionCompiler -PathType Leaf)) { throw 'Windows child-session helper requires the Windows .NET Framework C# compiler.' }
Invoke-BuildCommand $childSessionCompiler @('/nologo', '/target:exe', '/platform:x64', '/optimize+', '/reference:Microsoft.CSharp.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', '/reference:System.ServiceProcess.dll', ('/out:' + $childSessionExecutable), $childSessionSource) 'window-child-session-build.log'
$windowStageArguments = @((Join-Path $PSScriptRoot 'window-control-runtime.cjs'), 'stage', '--source-root', $windowSource, '--executable', (Join-Path $windowTarget 'release/azrael-window-control.exe'), '--provenance', (Join-Path $windowTarget 'release/azrael-window-control-build.json'), '--script-directory', $PSScriptRoot, '--guidance', (Join-Path $projectRoot 'instructions/computer-use-selected-window.md'), '--destination', (Join-Path $release 'window-control'), '--child-session-executable', $childSessionExecutable)
if ($VirtualInputRuntimeDirectory) { $windowStageArguments += @('--virtual-input-directory', [IO.Path]::GetFullPath($VirtualInputRuntimeDirectory)) }
if ($MultiPointerRuntimeDirectory) { $windowStageArguments += @('--multi-pointer-directory', [IO.Path]::GetFullPath($MultiPointerRuntimeDirectory)) }
Invoke-BuildCommand 'node' $windowStageArguments 'window-control-runtime.log'
if ($windowSharedCache) { Complete-WindowControlSharedCache $windowSharedCache }
} catch {
    if ($windowSharedCache) { try { Fail-WindowControlSharedCache $windowSharedCache } catch { Write-Warning "WindowControl cache remains protected: $($_.Exception.Message)" } }
    throw
} finally { if ($windowSharedCache -and $windowSharedCache.Lease) { $windowSharedCache.Lease.Dispose() } }
$releaseBuildInfoPath = Join-Path $release 'build-info.json'
$releaseBuildInfo = Get-Content -LiteralPath $releaseBuildInfoPath -Raw | ConvertFrom-Json -AsHashtable
foreach ($module in @('platform-runtime.cjs', 'azrael-platforms.json', 'window-control-host.cjs', 'window-use-async-approvals.cjs', 'window-use-resources.cjs', 'window-use-isolation.cjs', 'window-desktop-authority.cjs', 'window-child-session.cjs', 'window-control-backend.cjs', 'window-control-policy.cjs', 'window-control-errors.cjs', 'window-control-occupancy.cjs', 'window-control-mcp.cjs', 'window-task-macros.cjs', 'window-control-runtime.cjs', 'window-virtual-input.cjs', 'computer-use-runtime.cjs', 'computer-use-branding.cjs', 'use-control-settings.cjs', 'window-use-approvals.cjs', 'computer-use-approvals.cjs', 'use-settings-host.cjs', 'sky-control-policy.mjs', 'sky-controlled-service.mjs', 'inject-sky-control-policy.cjs') + @(if ($MultiPointerRuntimeDirectory) { 'multi-pointer-mcp.cjs'; 'window-switched-input.cjs' })) {
    $hostDirectory = Join-Path $release 'host'
    New-Item -ItemType Directory -Path $hostDirectory -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $module) -Destination (Join-Path $hostDirectory $module)
    $releaseBuildInfo.sha256["host/$module"] = (Get-FileHash -LiteralPath (Join-Path $hostDirectory $module) -Algorithm SHA256).Hash
}
$releaseBuildInfo.sha256['window-control/manifest.json'] = (Get-FileHash -LiteralPath (Join-Path $release 'window-control/manifest.json') -Algorithm SHA256).Hash
$releaseBuildInfo.sha256['computer-use/manifest.json'] = (Get-FileHash -LiteralPath (Join-Path $release 'computer-use/manifest.json') -Algorithm SHA256).Hash
$releaseBuildInfo | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $releaseBuildInfoPath -Encoding utf8NoBOM
Complete-BuildStage $buildMetrics $phase
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
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $nodeVersion = (Invoke-BuildCommand $nodePath @('--version') 'devin-node-version.log' -CaptureOutput).Trim()
    if ([version]($nodeVersion.TrimStart('v')) -lt [version]'22.18.0') { throw 'Native Devin requires Node 22.18 or newer.' }
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
$phase = Start-BuildStage $buildMetrics 'packaged-engine-provenance-check'
if ($RetainedSourceRoot) {
    Invoke-BuildCommand 'python' @('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'verify', '--profile', 'release', '--root', $RetainedSourceRoot, '--engine-dir', (Join-Path $release 'engine')) 'packaged-retained-source-check.log'
}
Invoke-BuildCommand 'python' @('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'verify', '--profile', 'release', '--root', (Split-Path $rustRoot -Parent), '--engine-dir', (Join-Path $release 'engine')) 'packaged-source-check.log'
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
    throw
}
