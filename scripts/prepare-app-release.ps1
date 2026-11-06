#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$ConfigurationPath = (Join-Path $PSScriptRoot 'azrael-app-release.json'),
    [string]$ReleaseDirectory,
    [string]$OutputDirectory,
    [string]$PreparedHostReceipt,
    [string]$PackagingInputManifest,
    [string]$PackagingInputSha256,
    [string]$LicenseDirectory,
    [string]$SourceExtensionPath,
    [string]$TypeScriptPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$fixedPackaging = [bool]$PackagingInputManifest -or [bool]$PackagingInputSha256
function Assert-PackagingInputs {
    $verification = & node (Join-Path $PSScriptRoot 'packaging-workspace.cjs') verify $PackagingInputManifest $PackagingInputSha256
    if ($LASTEXITCODE -ne 0) { throw 'Fixed packaging input verification failed.' }
    $verified = $verification | ConvertFrom-Json
    if ([IO.Path]::GetFullPath([string]$verified.sourceRoot) -cne [IO.Path]::GetFullPath($projectRoot)) {
        throw 'Fixed packaging source root must match the actual script project root.'
    }
    $build = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json
    if ([string]$build.engineProvenance.source.sourceSha256 -cne [string]$verified.engineSourceSha256) {
        throw 'Existing build engine provenance does not match fixed packaging baseline.'
    }
}
if ($fixedPackaging -and (-not $PackagingInputManifest -or $PackagingInputSha256 -cnotmatch '^[a-f0-9]{64}$' -or -not $ReleaseDirectory -or -not $PreparedHostReceipt)) {
    throw 'Fixed packaging requires PackagingInputManifest/Sha256, explicit ReleaseDirectory and PreparedHostReceipt.'
}
if ($fixedPackaging) {
    if ((Resolve-Path -LiteralPath $ConfigurationPath).Path -cne (Join-Path $PSScriptRoot 'azrael-app-release.json')) {
        throw 'Fixed packaging requires the copied azrael-app-release.json configuration.'
    }
    if ($SourceExtensionPath -or $TypeScriptPath) { throw 'Fixed packaging consumes PreparedHostReceipt; host preparation source options are not accepted.' }
}
$configuration = Get-Content -LiteralPath $ConfigurationPath -Raw | ConvertFrom-Json
if ($configuration.schemaVersion -ne 1 -or $configuration.version -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' -or
    $configuration.repository -cnotmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
    throw 'Invalid app release configuration.'
}
if (-not $ReleaseDirectory) {
    $latest = Get-Content -LiteralPath (Join-Path $projectRoot 'artifacts/latest.json') -Raw | ConvertFrom-Json
    $ReleaseDirectory = $latest.releaseDirectory
}
$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
if ($fixedPackaging) { Assert-PackagingInputs }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot "artifacts/app-releases/$($configuration.version)" }
if (-not [IO.Path]::IsPathFullyQualified($OutputDirectory)) { throw 'OutputDirectory must be absolute.' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'OutputDirectory must be new. Published versions are never overwritten.' }
New-Item -ItemType Directory -Path $output | Out-Null
try {
    if (-not $PreparedHostReceipt) {
        $arguments = @{
            ReleaseDirectory = $release
            OutputDirectory = (Join-Path $output 'preparation')
            HostVersion = [string]$configuration.version
            SkipCodexEnvironmentSnapshot = $true
            ChangedOnlyTests = $true
        }
        if ($SourceExtensionPath) { $arguments.SourceExtensionPath = $SourceExtensionPath }
        if ($TypeScriptPath) { $arguments.TypeScriptPath = $TypeScriptPath }
        & (Join-Path $PSScriptRoot 'prepare-independent-vscode.ps1') @arguments *> (Join-Path $output 'preparation.log')
        if ($LASTEXITCODE -ne 0) { throw 'Integrated host preparation failed. See preparation.log.' }
        $PreparedHostReceipt = Join-Path $output 'preparation/independent-prepared.json'
    }
    $prepared = Get-Content -LiteralPath $PreparedHostReceipt -Raw | ConvertFrom-Json
    if ([string]$prepared.HostVersion -cne [string]$configuration.version -or
        [IO.Path]::GetFullPath([string]$prepared.ReleaseDirectory) -ine $release -or
        (Get-FileHash -LiteralPath $prepared.HostVsix -Algorithm SHA256).Hash -ine [string]$prepared.HostSha256) {
        throw 'Prepared host receipt does not match the selected release, version or package hash.'
    }
    $packageArguments = @(
        '-B', (Join-Path $PSScriptRoot 'package-app-release.py'),
        '--release-directory', $release,
        '--host-vsix', [string]$prepared.HostVsix,
        '--version', [string]$configuration.version,
        '--output', (Join-Path $output 'assets'),
        '--project-root', $projectRoot
    )
    if ($LicenseDirectory) { $packageArguments += @('--license-directory', (Resolve-Path -LiteralPath $LicenseDirectory).Path) }
    $packageText = & python @packageArguments 2> (Join-Path $output 'packaging.stderr.log')
    if ($LASTEXITCODE -ne 0) { throw 'App release packaging failed. See packaging.stderr.log.' }
    if ($fixedPackaging) { Assert-PackagingInputs }
    $packageText | Set-Content -LiteralPath (Join-Path $output 'packaging.json') -Encoding utf8NoBOM
    [ordered]@{
        schemaVersion = 1
        releaseVersion = [string]$configuration.version
        repository = [string]$configuration.repository
        sourceRelease = $release
        hostReceipt = (Resolve-Path -LiteralPath $PreparedHostReceipt).Path
        manifest = Join-Path $output 'assets/release-manifest.json'
        outputDirectory = $output
        verified = $false
        published = $false
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'preparation-receipt.json') -Encoding utf8NoBOM
    Get-Content -LiteralPath (Join-Path $output 'preparation-receipt.json') -Raw
} catch {
    # Preserve failed preparation and its diagnostics for bounded recovery.
    # Never remove an uncertain output path or overwrite it on a retry.
    throw
}
