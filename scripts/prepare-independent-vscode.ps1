#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReleaseDirectory,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$StateRoot = (Join-Path $env:USERPROFILE '.azrael-ex'),
    [string]$SourceExtensionPath,
    [string]$TypeScriptPath,
    [string]$DevinExecutable,
    [ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
    [string]$HostVersion,
    [string]$SourceCodexHome = (Join-Path $env:USERPROFILE '.codex'),
    [switch]$SkipCodexEnvironmentSnapshot,
    [switch]$Resume,
    [switch]$ChangedOnlyTests,
    [string]$CacheDirectory
)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent

function Expand-AccountUiVsix {
    param(
        [Parameter(Mandatory)][string]$VsixPath,
        [Parameter(Mandatory)][string]$Destination
    )
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($VsixPath)
    try {
        $packageEntry = $archive.GetEntry('extension/package.json')
        if (-not $packageEntry) { throw 'Account UI VSIX does not contain extension/package.json.' }
        $reader = [IO.StreamReader]::new($packageEntry.Open(), [Text.Encoding]::UTF8, $true)
        try { $payloadManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ([version]$payloadManifest.version -lt [version]'0.3.0') { throw 'Integrated account UI payload 0.3.0 or newer is required.' }
        if ([string]$payloadManifest.main -cne './dist/src/extension.js') { throw 'Integrated account UI entry point is unexpected.' }

        $destinationRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\', '/')
        New-Item -ItemType Directory -Path $destinationRoot | Out-Null
        foreach ($entry in $archive.Entries) {
            if (-not $entry.FullName.StartsWith('extension/', [StringComparison]::Ordinal) -or $entry.FullName -eq 'extension/') { continue }
            $relative = $entry.FullName.Substring('extension/'.Length).Replace('/', [IO.Path]::DirectorySeparatorChar)
            $target = [IO.Path]::GetFullPath((Join-Path $destinationRoot $relative))
            if (-not $target.StartsWith($destinationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Account UI VSIX contains an invalid path: $($entry.FullName)"
            }
            if (-not $entry.Name) {
                New-Item -ItemType Directory -Path $target -Force | Out-Null
                continue
            }
            New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
            $inputStream = $entry.Open()
            $outputStream = [IO.File]::Create($target)
            try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
        }
        $payloadManifest
    } finally { $archive.Dispose() }
}

function Assert-IntegratedHostVsixContents {
    param([Parameter(Mandatory)][string]$VsixPath)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($VsixPath)
    try {
        foreach ($requiredEntry in @(
            'extension/integrated-azrael-entry.cjs',
            'extension/out/session-links.cjs',
            'extension/out/azrael-recovery.cjs',
            'extension/out/recovery-state.cjs',
            'extension/out/url-safety-transport.cjs',
            'extension/out/computer-use-approvals.cjs',
            'extension/out/use-control-settings.cjs',
            'extension/out/window-use-approvals.cjs',
            'extension/out/use-settings-host.cjs',
            'extension/out/pdf-file-open.cjs',
            'extension/out/devin-native-host.cjs',
            'extension/out/provider-accounts-host.cjs',
            'extension/account-ui/package.json',
            'extension/account-ui/dist/src/extension.js',
            'extension/account-ui/sync-shared-environment.cjs',
            'extension/account-ui/sync-codex-environment.cjs',
            'extension/account-ui/instruction-package.cjs',
            'extension/account-ui/computer-use-runtime.cjs',
            'extension/account-ui/computer-use-branding.cjs',
            'extension/account-ui/inject-sky-control-policy.cjs',
            'extension/computer-use/sky-controlled-service.mjs',
            'extension/computer-use/sky-control-policy.mjs',
            'extension/computer-use/use-control-settings.cjs',
            'extension/computer-use/use-control-settings.mjs',
            'extension/computer-use/manifest.json',
            'extension/account-ui/node_modules/@xterm/headless/package.json',
            'extension/account-ui/node_modules/node-pty/package.json',
            'extension/account-ui/node_modules/node-pty/prebuilds/win32-x64/pty.node'
        )) {
            if (-not $archive.GetEntry($requiredEntry)) { throw "Integrated host VSIX is missing required account UI content: $requiredEntry" }
        }
        $runtimeDirectory = Join-Path $release 'computer-use'
        & node (Join-Path $PSScriptRoot 'computer-use-runtime.cjs') verify --directory $runtimeDirectory | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Release Computer Use runtime failed verification.' }
        $runtimeManifest = Get-Content -LiteralPath (Join-Path $runtimeDirectory 'manifest.json') -Raw | ConvertFrom-Json
        $expected = @(@{ path = 'manifest.json'; sha256 = (Get-FileHash -LiteralPath (Join-Path $runtimeDirectory 'manifest.json')).Hash.ToLowerInvariant() }) + @($runtimeManifest.files)
        foreach ($file in $expected) {
            $entryName = 'extension/computer-use/' + $file.path
            $entries = @($archive.Entries | Where-Object FullName -CEQ $entryName)
            if ($entries.Count -ne 1) { throw "Computer Use VSIX entry missing or ambiguous: $entryName" }
            $stream = $entries[0].Open()
            try { $actual = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() } finally { $stream.Dispose() }
            if ($actual -cne $file.sha256) { throw "Computer Use VSIX hash mismatch: $entryName" }
        }
        if ($build.sha256.'window-control/manifest.json') {
            $windowRuntime = Join-Path $release 'window-control'
            $windowManifest = Get-Content -LiteralPath (Join-Path $windowRuntime 'manifest.json') -Raw | ConvertFrom-Json
            $windowFiles = @(@{ path = 'manifest.json'; sha256 = $build.sha256.'window-control/manifest.json' }) + @($windowManifest.files)
            foreach ($file in $windowFiles) {
                $entryName = 'extension/window-control/' + $file.path
                $entries = @($archive.Entries | Where-Object FullName -CEQ $entryName)
                if ($entries.Count -ne 1) { throw "Window Control VSIX entry missing or ambiguous: $entryName" }
                $stream = $entries[0].Open()
                try { $actual = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
                if ($actual -ine $file.sha256) { throw "Window Control VSIX hash mismatch: $entryName" }
            }
            foreach ($module in @('window-control-host.cjs', 'window-control-backend.cjs', 'window-control-policy.cjs', 'window-control-errors.cjs', 'window-control-occupancy.cjs', 'window-control-mcp.cjs', 'window-task-macros.cjs', 'window-control-runtime.cjs', 'computer-use-runtime.cjs', 'computer-use-branding.cjs', 'use-control-settings.cjs', 'window-use-approvals.cjs', 'computer-use-approvals.cjs', 'use-settings-host.cjs', 'sky-control-policy.mjs', 'sky-controlled-service.mjs', 'inject-sky-control-policy.cjs')) {
                $entry = $archive.GetEntry("extension/out/$module")
                if (-not $entry) { throw "Window Control host module missing: $module" }
                $stream = $entry.Open()
                try { $actual = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
                if (-not $build.sha256."host/$module" -or $actual -ine $build.sha256."host/$module") { throw "Window Control host module hash mismatch: $module" }
            }
        }
    } finally { $archive.Dispose() }
}

if (-not $SourceExtensionPath) { $SourceExtensionPath = Join-Path $PSScriptRoot '../artifacts/upstream-ui/26.1007.21434' }
$source = (Resolve-Path -LiteralPath $SourceExtensionPath).Path
$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
if (-not [IO.Path]::IsPathFullyQualified($OutputDirectory)) { throw 'OutputDirectory must be absolute.' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\', '/')
if ($Resume) {
    if (-not (Test-Path -LiteralPath (Join-Path $OutputDirectory 'preparation-state.json'))) { throw 'Resume requires a preparation checkpoint.' }
} else {
    if (Test-Path -LiteralPath $OutputDirectory) { throw 'OutputDirectory must be new; use -Resume for a matching checkpoint.' }
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
}
if (-not $CacheDirectory) { $CacheDirectory = Join-Path $project 'artifacts/cache/namespace' }
if (-not [IO.Path]::IsPathFullyQualified($CacheDirectory)) { throw 'CacheDirectory must be absolute.' }
if (-not $DevinExecutable) {
    $candidate = Join-Path $env:LOCALAPPDATA 'azrael-ex/tools/devin/3000.10.21/bin/devin.exe'
    if (Test-Path -LiteralPath $candidate) { $DevinExecutable = $candidate }
}
if ($DevinExecutable) { $DevinExecutable = (Resolve-Path -LiteralPath $DevinExecutable).Path }
$build = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json
if ([version]$build.packageVersion -lt [version]'0.3.0') { throw 'Independent integration requires account UI payload 0.3.0 or newer.' }
if ($TypeScriptPath) {
    $resolvedTypeScript = (Resolve-Path -LiteralPath $TypeScriptPath -ErrorAction Stop).Path
    $stagePath = $resolvedTypeScript
    foreach ($level in 1..5) { $stagePath = Split-Path $stagePath -Parent }
    $expectedTypeScript = Join-Path $stagePath 'companion/node_modules/typescript/lib/typescript.js'
    if ($resolvedTypeScript -ine $expectedTypeScript -or -not (Test-Path -LiteralPath $resolvedTypeScript -PathType Leaf)) {
        throw 'TypeScriptPath must name companion/node_modules/typescript/lib/typescript.js in a build staging directory.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $stagePath 'companion/node_modules/@vscode/vsce/vsce') -PathType Leaf)) {
        throw 'Explicit TypeScript staging directory is missing its pinned VSCE tool.'
    }
    $toolDirectory = Get-Item -LiteralPath $stagePath
} else {
$toolDirectory = @(Get-ChildItem -LiteralPath (Join-Path $project 'artifacts/build') -Directory | Sort-Object LastWriteTime -Descending | Where-Object {
    (Test-Path -LiteralPath (Join-Path $_.FullName 'companion/node_modules/@vscode/vsce/vsce')) -and
    (Test-Path -LiteralPath (Join-Path $_.FullName 'companion/node_modules/typescript/lib/typescript.js'))
}) | Select-Object -First 1
}
if (-not $toolDirectory) { throw 'Build the companion first to install the pinned packaging/TypeScript tools.' }
$preparationTimer = [Diagnostics.Stopwatch]::StartNew()
$script:preparationMetrics = [ordered]@{ schema = 1; resumed = [bool]$Resume; stages = @(); elapsedMs = 0; status = 'running' }
function Invoke-PreparationPhase {
    param([string]$Name, [scriptblock]$Action, [bool]$Reused = $false)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $outcome = 'passed'
    try { & $Action } catch { $outcome = 'failed'; throw } finally {
        $timer.Stop()
        $script:preparationMetrics.stages += [ordered]@{ name = $Name; elapsedMs = $timer.Elapsed.TotalMilliseconds; status = $outcome; reused = $Reused }
        $script:preparationMetrics.elapsedMs = $preparationTimer.Elapsed.TotalMilliseconds
        $script:preparationMetrics | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'preparation-metrics.json') -Encoding utf8NoBOM
    }
}
$checkpointTool = Join-Path $PSScriptRoot 'preparation-state.cjs'
$config = [ordered]@{ release = $release; source = $source; stateRoot = [IO.Path]::GetFullPath($StateRoot); devinExecutable = $DevinExecutable; sourceCodexHome = [IO.Path]::GetFullPath($SourceCodexHome); skipSnapshot = [bool]$SkipCodexEnvironmentSnapshot; toolDirectory = $toolDirectory.FullName }
$config.changedOnlyTests = [bool]$ChangedOnlyTests
$config.hostVersion = $HostVersion
if ($ChangedOnlyTests) { $config.preservationFeatureIds = @() }
$configPath = Join-Path $OutputDirectory 'preparation-inputs.json'
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8NoBOM
# Prevent module cache collection while preparation uses cached TypeScript/vsce.
$moduleCacheLock=Join-Path $project 'artifacts/cache/modules/.lock'
[IO.Directory]::CreateDirectory((Split-Path $moduleCacheLock -Parent)) | Out-Null
$moduleCacheLease=[IO.File]::Open($moduleCacheLock,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
    Invoke-PreparationPhase 'input-verification' {
        & python -B (Join-Path $PSScriptRoot 'engine-provenance.py') verify --root $build.engineSourceRoot --engine-dir (Join-Path $release 'engine') | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Preparation requires an engine built from the current source.' }
        $computerUseText = & node (Join-Path $PSScriptRoot 'computer-use-runtime.cjs') verify --directory (Join-Path $release 'computer-use')
        if ($LASTEXITCODE -ne 0) { throw 'Preparation requires a verified Computer Use runtime.' }
        $computerUse = $computerUseText | ConvertFrom-Json
        if (-not $build.sha256.'computer-use/manifest.json' -or $computerUse.manifestSha256 -ine $build.sha256.'computer-use/manifest.json') { throw 'Release Computer Use manifest hash mismatch.' }
        & node (Join-Path $PSScriptRoot 'window-control-runtime.cjs') verify-release --release $release --source-root (Join-Path $project 'native/window-control') | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Preparation requires a verified Window Control runtime when declared.' }
        & node $checkpointTool init $OutputDirectory $configPath ([string][bool]$Resume).ToLowerInvariant()
        if ($LASTEXITCODE -ne 0) { throw 'Preparation inputs or checkpoint verification failed.' }
    }
    $preservationConfig = [ordered]@{
        projectRoot = $project; uiRoot = $source; engineSourceRoot = [string]$build.engineSourceRoot
        engineDirectory = (Join-Path $release 'engine'); outputDirectory = (Join-Path $OutputDirectory 'feature-preservation')
        area = 'ui'; typeScriptPath = (Join-Path $toolDirectory.FullName 'companion/node_modules/typescript/lib/typescript.js')
    }
    if ($ChangedOnlyTests) { $preservationConfig.featureIds = @() }
    $preservationConfigPath = Join-Path $OutputDirectory 'feature-preservation-inputs.json'
    $preservationConfig | ConvertTo-Json | Set-Content -LiteralPath $preservationConfigPath -Encoding utf8NoBOM
    $preservation = Invoke-PreparationPhase 'feature-preservation' {
        $verified = & node (Join-Path $PSScriptRoot 'feature-preservation.cjs') run --config $preservationConfigPath 2> (Join-Path $OutputDirectory 'feature-preservation.stderr.log')
        if ($LASTEXITCODE -ne 0) { throw 'UI feature preservation failed. See feature-preservation logs.' }
        $verified | ConvertFrom-Json
    }
    $namespaceCheckpoint = [pscustomobject]@{ found = $false }
    $completedCheckpoint = [pscustomobject]@{ found = $false }
    if ($Resume) {
        $namespaceCheckpoint = Invoke-PreparationPhase 'namespace-verification' {
            $loaded = & node $checkpointTool load $OutputDirectory namespace
            if ($LASTEXITCODE -ne 0) { throw 'Completed namespace checkpoint failed verification.' }
            $loaded | ConvertFrom-Json
        }
        if ($namespaceCheckpoint.found) {
            $completedCheckpoint = Invoke-PreparationPhase 'package-verification' {
                $loaded = & node $checkpointTool load $OutputDirectory complete
                if ($LASTEXITCODE -ne 0) { throw 'Completed package checkpoint failed verification.' }
                $loaded | ConvertFrom-Json
            }
        }
    }
    if ($namespaceCheckpoint.found) {
        $prepared = $namespaceCheckpoint.data.prepared
        $hostVersion = $namespaceCheckpoint.data.hostVersion
        Invoke-PreparationPhase 'staging' {} -Reused $true
        Invoke-PreparationPhase 'namespace' {} -Reused $true
    } else {
        $ordinaryOutput = Join-Path $OutputDirectory ('stage-' + [guid]::NewGuid().ToString('N'))
        $arguments = @{ ReleaseDirectory = $release; OutputDirectory = $ordinaryOutput; SourceExtensionPath = $source; OriginalExtensionPath = $source; StateRoot = $StateRoot }
        if ($DevinExecutable) { $arguments.DevinExecutable = $DevinExecutable }
        $prepared = Invoke-PreparationPhase 'staging' {
            & (Join-Path $PSScriptRoot 'prepare-ordinary-vscode.ps1') @arguments
        }
        $accountUiDirectory = Join-Path $prepared.OfficialExtension 'account-ui'
        Invoke-PreparationPhase 'account-payload' {
            foreach ($module in @('platform-runtime.cjs', 'azrael-platforms.json')) {
                Copy-Item -LiteralPath (Join-Path $PSScriptRoot $module) -Destination (Join-Path $prepared.OfficialExtension "out/$module")
            }
            Expand-AccountUiVsix -VsixPath $prepared.CompanionVsix -Destination $accountUiDirectory | Out-Null
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'integrated-azrael-entry.cjs') -Destination (Join-Path $prepared.OfficialExtension 'integrated-azrael-entry.cjs')
            foreach ($module in @('sync-shared-environment.cjs', 'sync-codex-environment.cjs', 'instruction-package.cjs', 'computer-use-runtime.cjs', 'computer-use-branding.cjs', 'window-control-runtime.cjs', 'use-control-settings.cjs', 'window-use-approvals.cjs', 'computer-use-approvals.cjs', 'use-settings-host.cjs', 'sky-control-policy.mjs', 'sky-controlled-service.mjs', 'inject-sky-control-policy.cjs')) {
                Copy-Item -LiteralPath (Join-Path $PSScriptRoot $module) -Destination (Join-Path $accountUiDirectory $module)
            }
            foreach ($module in @('session-links.cjs', 'azrael-recovery.cjs', 'recovery-state.cjs', 'url-safety-transport.cjs', 'pdf-file-open.cjs', 'computer-use-approvals.cjs')) {
                Copy-Item -LiteralPath (Join-Path $PSScriptRoot $module) -Destination (Join-Path $prepared.OfficialExtension "out/$module")
            }
        }
        $typescript = Join-Path $toolDirectory.FullName 'companion/node_modules/typescript/lib/typescript.js'
        $hostVersion = if ($HostVersion) { $HostVersion } else { '0.5.' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
        Invoke-PreparationPhase 'namespace' {
            & node (Join-Path $PSScriptRoot 'namespace-azrael-host.cjs') $prepared.OfficialExtension $typescript $hostVersion $CacheDirectory *> (Join-Path $OutputDirectory 'namespace.log')
            if ($LASTEXITCODE -ne 0) { throw 'Independent host transformation failed. See namespace.log.' }
        }
        $prepared | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'prepared.json') -Encoding utf8NoBOM
        $checkpointDataPath = Join-Path $OutputDirectory 'namespace-checkpoint-data.json'
        @{ prepared = $prepared; hostVersion = $hostVersion } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $checkpointDataPath -Encoding utf8NoBOM
        Invoke-PreparationPhase 'namespace-checkpoint' {
            & node $checkpointTool save $OutputDirectory namespace $checkpointDataPath
            if ($LASTEXITCODE -ne 0) { throw 'Could not save completed namespace checkpoint.' }
        }
    }
    Invoke-PreparationPhase 'window-control-host-verification' {
        & node (Join-Path $PSScriptRoot 'window-control-runtime.cjs') verify-host --directory $prepared.OfficialExtension --release $release | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Prepared or resumed Window Control host dependency closure verification failed.' }
    }
    $hostReport = Get-Content -LiteralPath (Join-Path $prepared.OfficialExtension '.azrael-independent-host.json') -Raw | ConvertFrom-Json
    $accountUiManifest = Get-Content -LiteralPath (Join-Path $prepared.OfficialExtension 'account-ui/package.json') -Raw | ConvertFrom-Json
    $vsix = Join-Path $OutputDirectory 'azrael-host.vsix'
    if ($completedCheckpoint.found) {
        Invoke-PreparationPhase 'packaging' {} -Reused $true
    } else {
        $vsce = Join-Path $toolDirectory.FullName 'companion/node_modules/@vscode/vsce/vsce'
        Invoke-PreparationPhase 'packaging' {
            Push-Location $prepared.OfficialExtension
            try {
                & node (Join-Path $PSScriptRoot 'package-local-host.cjs') $vsce $vsix $source *> (Join-Path $OutputDirectory 'host-package.log')
                if ($LASTEXITCODE -ne 0) { throw 'Independent VSIX packaging failed. See host-package.log; retry with -Resume.' }
            } finally { Pop-Location }
        }
    }
    Invoke-PreparationPhase 'archive-contract' { Assert-IntegratedHostVsixContents -VsixPath $vsix }
    $preservationReportPath = Join-Path $prepared.OfficialExtension '.azrael-independent-host.json'
    $preservationBindingPath = Join-Path $OutputDirectory 'feature-preservation-package.json'
    $preservationBindingConfig = [ordered]@{}
    foreach ($key in $preservationConfig.Keys) { $preservationBindingConfig[$key] = $preservationConfig[$key] }
    $preservationBindingConfig.receiptPath = [string]$preservation.receiptPath
    $preservationBindingConfig.reportPath = $preservationReportPath
    $preservationBindingConfig.packagePath = $vsix
    $preservationBindingConfig.bindingPath = $preservationBindingPath
    $preservationBindingConfigPath = Join-Path $OutputDirectory 'feature-preservation-binding-inputs.json'
    $preservationBindingConfig | ConvertTo-Json | Set-Content -LiteralPath $preservationBindingConfigPath -Encoding utf8NoBOM
    Invoke-PreparationPhase 'feature-preservation-binding' {
        & node (Join-Path $PSScriptRoot 'feature-preservation.cjs') bind --config $preservationBindingConfigPath | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'UI preservation could not be bound to the prepared package.' }
    }
    $environmentSnapshot = $null
    if (-not $SkipCodexEnvironmentSnapshot) {
        $environmentSnapshot = Invoke-PreparationPhase 'environment-validation' {
            $windowArguments = @()
            if ($build.sha256.'window-control/manifest.json') { $windowArguments = @('--window-control-directory', (Join-Path $release 'window-control')) }
            $snapshot = & node (Join-Path $PSScriptRoot 'sync-codex-environment.cjs') --source-home $SourceCodexHome --state-root $prepared.StateRoot --mode validate --engine (Join-Path $release 'engine/codex.exe') --computer-use-directory (Join-Path $release 'computer-use') @windowArguments --manifest (Join-Path $PSScriptRoot 'azrael-codex-environment.json')
            if ($LASTEXITCODE -ne 0) { throw 'Codex environment validation failed.' }
            $snapshot | ConvertFrom-Json
        }
    }
    $result = [ordered]@{
        HostExtension = $prepared.OfficialExtension; HostVsix = $vsix; CompanionVsix = $prepared.CompanionVsix
        CompanionVsixRole = 'integrated-account-ui-provenance-input'
        ReleaseDirectory = $release; StateRoot = $prepared.StateRoot; DevinExecutable = $prepared.DevinExecutable
        HostId = 'azrael-ex-local.azrael'; HostVersion = $hostVersion
        AzraelIntegratedAccounts = $true; AccountPayloadVersion = [string]$accountUiManifest.version
        UiSource = $hostReport.sourceUi; TransformRules = $hostReport.transformRules
        EngineSourceSha256 = [string]$build.engineProvenance.source.sourceSha256
        EngineBinarySha256 = [string]$build.sha256.'engine/codex.exe'
        HostSha256 = (Get-FileHash -LiteralPath $vsix).Hash
        PreservationFeatureIds = @($preservation.featureIds)
        PreservationReceipt = [string]$preservation.receiptPath
        PreservationReport = $preservationReportPath; PreservationBinding = $preservationBindingPath
        CodexEnvironmentSnapshot = $environmentSnapshot
    }
    $resultPath = Join-Path $OutputDirectory 'independent-prepared.json'
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding utf8NoBOM
    Invoke-PreparationPhase 'package-checkpoint' {
        & node $checkpointTool save $OutputDirectory complete $resultPath
        if ($LASTEXITCODE -ne 0) { throw 'Could not save completed package checkpoint.' }
    }
    $script:preparationMetrics.status = 'passed'
    [pscustomobject]$result
    $global:LASTEXITCODE = 0
} catch {
    $script:preparationMetrics.status = 'failed'
    throw
} finally {
    $moduleCacheLease.Dispose()
    $preparationTimer.Stop()
    $script:preparationMetrics.elapsedMs = $preparationTimer.Elapsed.TotalMilliseconds
    $script:preparationMetrics | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'preparation-metrics.json') -Encoding utf8NoBOM
}
