#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]*$')]
    [string]$ReleaseName = (Get-Date -Format 'yyyyMMdd-HHmmss-fff'),
    [switch]$SkipEngineBuild,
    [string]$SourceRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/worktrees/azrael-0.159.3'),
    [string]$EngineDirectory,
    [string]$CompanionVsixPath,
    [string]$CodeModeHostPath,
    [switch]$IncludeDevinNative = $true,
    [switch]$IncludeProviderAccounts = $true
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
if (-not $EngineDirectory) {
    $EngineDirectory = Join-Path $rustRoot 'target/x86_64-pc-windows-msvc/debug'
}
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
. (Join-Path $PSScriptRoot 'build-metrics.ps1')
$buildMetrics = New-BuildMetrics (Join-Path $logDirectory 'build-metrics.json')

function Resolve-CodeModeHost {
    if (-not $CodeModeHostPath -or -not (Test-Path -LiteralPath $CodeModeHostPath -PathType Leaf)) {
        throw 'Pass -CodeModeHostPath for the explicitly selected compatible code-mode host. Compatibility must be checked with the selected engine.'
    }
    return (Resolve-Path -LiteralPath $CodeModeHostPath).Path
}

function Get-ProviderAccountsSourceFingerprint {
    $providerRoot = Join-Path $projectRoot 'providers/opencodex'
    $files = @(
        Get-ChildItem -LiteralPath $providerRoot -File | Where-Object Extension -In '.ts', '.mjs'
        Get-Item -LiteralPath (Join-Path $providerRoot 'package.json'), (Join-Path $providerRoot 'bun.lock'), (Join-Path $providerRoot 'LICENSE.opencodex'), (Join-Path $providerRoot 'UPSTREAM.md')
        Get-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/progress.mjs')
        Get-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/stall-diagnostics.mjs')
        Get-ChildItem -LiteralPath (Join-Path $providerRoot 'vendor/src') -File -Recurse
    ) | Sort-Object FullName
    $inventory = foreach ($file in $files) {
        [ordered]@{
            path = [IO.Path]::GetRelativePath($providerRoot, $file.FullName).Replace('\', '/')
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    $json = $inventory | ConvertTo-Json -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function Get-ProviderVendorManifestFingerprint {
    $vendorRoot = Join-Path $projectRoot 'providers/opencodex/vendor/src'
    $records = [Text.StringBuilder]::new()
    foreach ($file in Get-ChildItem -LiteralPath $vendorRoot -File -Recurse | Sort-Object FullName) {
        $relative = [IO.Path]::GetRelativePath($vendorRoot, $file.FullName).Replace('\', '/')
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        [void]$records.Append($relative).Append([char]0).Append($hash).Append("`n")
    }
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($records.ToString()))).ToLowerInvariant()
}

try {
if (-not $SkipEngineBuild) {
    $phase = Start-BuildStage $buildMetrics 'engine-build'
    $check = Start-BuildStage $buildMetrics 'engine-host-source-check'
    $externalCodeModeHost = Resolve-CodeModeHost
    $externalCodeModeHostHash = (Get-FileHash -LiteralPath $externalCodeModeHost -Algorithm SHA256).Hash
    Complete-BuildStage $buildMetrics $check
    Invoke-BuildCommand 'python' @('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'snapshot', '--root', (Split-Path $rustRoot -Parent), '--file', (Join-Path $logDirectory 'engine-source-before.json')) 'source-snapshot.log'
    Push-Location $rustRoot
    $previousTarget = $env:CARGO_TARGET_DIR
    try {
        # Keep the existing incremental cache, even if the caller uses another
        # CARGO_TARGET_DIR. Always package the pair from this build's target.
        $env:CARGO_TARGET_DIR = Join-Path $rustRoot 'target'
        Invoke-BuildCommand 'cargo' @('build', '--locked', '--target', 'x86_64-pc-windows-msvc', '-p', 'codex-cli', '--bin', 'codex', '-p', 'codex-app-server-client', '--bin', 'azrael-bridge') 'engine.log'
        $check = Start-BuildStage $buildMetrics 'engine-host-hash-check-and-copy'
        if ((Get-FileHash -LiteralPath $externalCodeModeHost -Algorithm SHA256).Hash -cne $externalCodeModeHostHash) { throw 'Selected code-mode host changed during compilation; rebuild with a stable runtime.' }
        $codeModeHostDestination = Join-Path $EngineDirectory 'codex-code-mode-host.exe'
        if ($externalCodeModeHost -cne $codeModeHostDestination) {
            Copy-Item -LiteralPath $externalCodeModeHost -Destination $codeModeHostDestination -Force
        }
        Complete-BuildStage $buildMetrics $check
        Invoke-BuildCommand 'python' @('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'record', '--root', (Split-Path $rustRoot -Parent), '--file', (Join-Path $logDirectory 'engine-source-before.json'), '--engine-dir', $EngineDirectory, '--code-mode-host-source', $externalCodeModeHost) 'engine-provenance.log'
    } finally {
        $env:CARGO_TARGET_DIR = $previousTarget
        Pop-Location
    }
    Complete-BuildStage $buildMetrics $phase
}
$phase = Start-BuildStage $buildMetrics 'engine-provenance-and-binary-check'
Invoke-BuildCommand 'python' @('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'verify', '--root', (Split-Path $rustRoot -Parent), '--engine-dir', $EngineDirectory) 'engine-source-check.log'
$engine = Join-Path $EngineDirectory 'codex.exe'
$bridge = Join-Path $EngineDirectory 'azrael-bridge.exe'
$codeModeHost = Join-Path $EngineDirectory 'codex-code-mode-host.exe'
foreach ($file in @($engine, $bridge, $codeModeHost)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing engine pair member: $file" }
}
Complete-BuildStage $buildMetrics $phase
if (-not $CompanionVsixPath) {
    $phase = Start-BuildStage $buildMetrics 'companion-staging'
    $vsixDirectory = Join-Path $artifactRoot "vsix/$ReleaseName"
    New-Item -ItemType Directory -Path $vsixDirectory -Force | Out-Null
    $CompanionVsixPath = Join-Path $vsixDirectory 'azrael-ex.vsix'
    # A running extension/test host can retain node-pty's native DLL. Build from
    # a fresh source copy so npm ci never removes modules used by that host.
    $companionSource = Join-Path $projectRoot 'extensions/azrael-ex'
    $companionBuild = Join-Path $artifactRoot "build/$ReleaseName/companion"
    New-Item -ItemType Directory -Path $companionBuild -Force | Out-Null
    Invoke-BuildCommand 'robocopy.exe' @($companionSource, $companionBuild, '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/XD', 'node_modules', 'dist', 'artifacts', '.git', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') 'companion-stage.log' -MaximumSuccessExitCode 7
    $global:LASTEXITCODE = 0
    Complete-BuildStage $buildMetrics $phase
    $phase = Start-BuildStage $buildMetrics 'companion-build'
    Push-Location $companionBuild
    try {
        Invoke-BuildCommand 'npm.cmd' @('ci') 'npm-ci.log'
        Invoke-BuildCommand 'npm.cmd' @('run', 'package', '--', $CompanionVsixPath) 'companion-package.log'
    } finally { Pop-Location }
    Complete-BuildStage $buildMetrics $phase
}

# A failed package is never selected by latest.json. Preserve failure output for
# diagnosis and use a new release name on retry, rather than overwriting files.
$phase = Start-BuildStage $buildMetrics 'release-packaging-and-copy'
Invoke-BuildScript (Join-Path $PSScriptRoot 'package-azrael.ps1') @{
    EnginePath = $engine; BridgePath = $bridge; CompanionVsixPath = $CompanionVsixPath
    SourceRoot = $sourceRoot; OutputDirectory = $release
} 'package.log'
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
    $phase = Start-BuildStage $buildMetrics 'provider-source-and-runtime-checks'
    $providerSource = Join-Path $projectRoot 'providers/opencodex'
    $bunSource = Join-Path $artifactRoot 'tools/bun-1.4.2/package/bin/bun.exe'
    foreach ($required in @(
        (Join-Path $providerSource 'helper.ts'),
        (Join-Path $providerSource 'inference.ts'),
        (Join-Path $providerSource 'vendor/src'),
        (Join-Path $providerSource 'package.json'),
        (Join-Path $providerSource 'bun.lock'),
        (Join-Path $providerSource 'LICENSE.opencodex'),
        (Join-Path $providerSource 'UPSTREAM.md'),
        (Join-Path $projectRoot 'providers/devin/progress.mjs'),
        (Join-Path $projectRoot 'providers/devin/stall-diagnostics.mjs'),
        $bunSource
    )) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Provider accounts build input is missing: $required" }
    }
    $bunVersion = (Invoke-BuildCommand $bunSource @('--version') 'opencodex-bun-version.log' -CaptureOutput).Trim()
    if ($bunVersion -cne '1.4.2') {
        throw "Provider accounts requires the pinned Bun 1.4.2 runtime; selected runtime reported '$bunVersion'."
    }
    $bunDownloadManifest = Join-Path $artifactRoot 'tools/bun-1.4.2/download.json'
    if (-not (Test-Path -LiteralPath $bunDownloadManifest -PathType Leaf)) { throw 'Pinned Bun download provenance is missing.' }
    $providerSourceBefore = Get-ProviderAccountsSourceFingerprint
    $vendorSourceManifest = Get-ProviderVendorManifestFingerprint
    if ($vendorSourceManifest -cne '59d0a9f1edf17ca1592a8a2a37b9405dcf6eb71bcf3f36234694ac9bd5d46ca0') {
        throw 'Provider accounts vendor sources do not match the reviewed patched-source manifest.'
    }
    Complete-BuildStage $buildMetrics $phase
    $phase = Start-BuildStage $buildMetrics 'provider-staging'
    $providerStage = Join-Path $artifactRoot "build/$ReleaseName/opencodex"
    New-Item -ItemType Directory -Path (Join-Path $providerStage 'vendor') -Force | Out-Null
    $progressStage = Join-Path $artifactRoot "build/$ReleaseName/devin"
    New-Item -ItemType Directory -Path $progressStage -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/progress.mjs') -Destination $progressStage
    Copy-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/stall-diagnostics.mjs') -Destination $progressStage
    Get-ChildItem -LiteralPath $providerSource -File | Where-Object Extension -In '.ts', '.mjs' | Copy-Item -Destination $providerStage
    Copy-Item -LiteralPath (Join-Path $providerSource 'package.json'), (Join-Path $providerSource 'bun.lock'), (Join-Path $providerSource 'LICENSE.opencodex'), (Join-Path $providerSource 'UPSTREAM.md') -Destination $providerStage
    Copy-Item -LiteralPath (Join-Path $providerSource 'vendor/src') -Destination (Join-Path $providerStage 'vendor/src') -Recurse
    Complete-BuildStage $buildMetrics $phase
    Push-Location $providerStage
    try {
        Invoke-BuildCommand $bunSource @('install', '--frozen-lockfile', '--production') 'opencodex-bun-install.log'
    } finally { Pop-Location }
    $phase = Start-BuildStage $buildMetrics 'provider-native-dependency-checks'
    $keyring = Join-Path $providerStage 'node_modules/@napi-rs/keyring'
    $keyringNative = Join-Path $providerStage 'node_modules/@napi-rs/keyring-win32-x64-msvc'
    foreach ($required in @($keyring, $keyringNative)) {
        if (-not (Test-Path -LiteralPath $required -PathType Container)) { throw "Provider accounts native dependency is missing: $required" }
    }
    Complete-BuildStage $buildMetrics $phase
    $providerDestination = Join-Path $release 'providers/opencodex'
    New-Item -ItemType Directory -Path (Join-Path $providerDestination 'node_modules/@napi-rs') -Force | Out-Null
    Invoke-BuildCommand $bunSource @('build', (Join-Path $providerStage 'helper.ts'), '--target=bun', '--external=@napi-rs/keyring', ('--outfile=' + (Join-Path $providerDestination 'helper.js'))) 'opencodex-helper-bundle.log'
    Invoke-BuildCommand $bunSource @('build', (Join-Path $providerStage 'inference.ts'), '--target=bun', '--external=@napi-rs/keyring', ('--outfile=' + (Join-Path $providerDestination 'inference.js'))) 'opencodex-inference-bundle.log'
    $phase = Start-BuildStage $buildMetrics 'provider-release-copy'
    Get-ChildItem -LiteralPath $providerStage -File | Where-Object Extension -In '.ts', '.mjs' | Copy-Item -Destination $providerDestination
    Copy-Item -LiteralPath (Join-Path $providerStage 'package.json'), (Join-Path $providerStage 'bun.lock'), (Join-Path $providerStage 'LICENSE.opencodex'), (Join-Path $providerStage 'UPSTREAM.md') -Destination $providerDestination
    Copy-Item -LiteralPath $keyring -Destination (Join-Path $providerDestination 'node_modules/@napi-rs/keyring') -Recurse
    Copy-Item -LiteralPath $keyringNative -Destination (Join-Path $providerDestination 'node_modules/@napi-rs/keyring-win32-x64-msvc') -Recurse
    $runtimeDirectory = Join-Path $providerDestination 'runtime'
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    Copy-Item -LiteralPath $bunSource -Destination (Join-Path $runtimeDirectory 'bun.exe')
    Complete-BuildStage $buildMetrics $phase
    $phase = Start-BuildStage $buildMetrics 'provider-source-stability-and-hash-checks'
    if ((Get-ProviderAccountsSourceFingerprint) -cne $providerSourceBefore) {
        throw 'Provider accounts source changed during packaging. Retry with stable sources.'
    }
    $providerFiles = [ordered]@{}
    foreach ($file in Get-ChildItem -LiteralPath $providerDestination -File -Recurse | Sort-Object FullName) {
        $relative = [IO.Path]::GetRelativePath($release, $file.FullName).Replace('\', '/')
        $providerFiles[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $helperRelative = 'providers/opencodex/helper.js'
    $inferenceRelative = 'providers/opencodex/inference.js'
    $bunRelative = 'providers/opencodex/runtime/bun.exe'
    [ordered]@{
        schema = 2
        upstreamRevision = '9f7397ed1582d95c6c1fcf4ae9951213b3fa2d19'
        upstreamSourceTree = 'fbdc3ee52e3ecde4fa5e4a5cf630ccae98a73698'
        vendorSourceManifestSha256 = $vendorSourceManifest
        sourceSha256 = $providerSourceBefore
        helper = $helperRelative
        inferenceHelper = $inferenceRelative
        bun = [ordered]@{
            path = $bunRelative
            version = $bunVersion
            sha256 = $providerFiles[$bunRelative]
            bundled = $true
            npmPackage = '@oven/bun-windows-x64@1.4.2'
            npmIntegrity = 'sha512-+bN6OuVld/9diT/RLSXSW7JE6CvNE3gL9XsAEjULi1nUsXd6DNO6GuA9jNdNb3r8PdJFnYHr5aypNV1Oj3Rd9g=='
            downloadManifestSha256 = (Get-FileHash -LiteralPath $bunDownloadManifest -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        files = $providerFiles
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $release 'opencodex-accounts-build.json') -Encoding utf8NoBOM
    Complete-BuildStage $buildMetrics $phase
}
$phase = Start-BuildStage $buildMetrics 'packaged-engine-provenance-check'
Invoke-BuildCommand 'python' @('-B', (Join-Path $PSScriptRoot 'engine-provenance.py'), 'verify', '--root', (Split-Path $rustRoot -Parent), '--engine-dir', (Join-Path $release 'engine')) 'packaged-source-check.log'
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
Complete-BuildMetrics $buildMetrics -Status success
$global:LASTEXITCODE = 0
[pscustomobject]@{ ReleaseDirectory = $release; Logs = $logDirectory; EngineReused = [bool]$SkipEngineBuild }
} catch {
    Complete-BuildMetrics $buildMetrics -Status failed
    throw
}
