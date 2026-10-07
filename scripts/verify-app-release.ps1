#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$CodePath = 'code.cmd',
    [string]$OriginalExtensionPath,
    [string]$OriginalAudioPath,
    [string]$UiSourcePath,
    [string]$TypeScriptPath,
    [string]$FixtureRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$manifestFile = (Resolve-Path -LiteralPath $ManifestPath).Path
$packageDirectory = Split-Path $manifestFile -Parent
$manifestHash = (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.product -cne 'Azrael' -or
    $manifest.releaseVersion -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' -or
    $manifest.hostVersion -cne $manifest.releaseVersion -or @($manifest.assets).Count -ne 1) {
    throw 'Unsupported app release manifest.'
}
if (-not $TypeScriptPath) {
    if ($manifest.sourceBuild -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]*$') { throw 'Invalid source build name.' }
    $sourceBuild = Get-Content -LiteralPath (Join-Path $projectRoot "artifacts/releases/$($manifest.sourceBuild)/build-info.json") -Raw | ConvertFrom-Json
    $TypeScriptPath = (Resolve-Path -LiteralPath $sourceBuild.moduleBuild.typeScriptPath).Path
}
$asset = $manifest.assets[0]
if ($asset.name -cne "Azrael-$($manifest.releaseVersion)-windows-x64.zip" -or $asset.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid app release asset.' }
$zip = Join-Path $packageDirectory $asset.name
if ((Get-Item -LiteralPath $zip).Length -ne $asset.size -or
    (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -cne $asset.sha256) { throw 'Release asset differs from its manifest.' }
if (-not [IO.Path]::IsPathFullyQualified($OutputDirectory)) { throw 'OutputDirectory must be absolute.' }
$logs = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $logs) { throw 'OutputDirectory must be new.' }
New-Item -ItemType Directory -Path $logs | Out-Null
if (-not $FixtureRoot) { $FixtureRoot = Join-Path $projectRoot ('artifacts/verification/app-release-' + [guid]::NewGuid().ToString('N')) }
if (-not [IO.Path]::IsPathFullyQualified($FixtureRoot)) { throw 'FixtureRoot must be absolute.' }
$fixture = [IO.Path]::GetFullPath($FixtureRoot).TrimEnd('\', '/')
$fixtureParent = [IO.Path]::GetDirectoryName($fixture)
$fixtureArtifacts = [IO.Path]::GetDirectoryName($fixtureParent)
if ([IO.Path]::GetFileName($fixtureParent) -ine 'verification' -or [IO.Path]::GetFileName($fixtureArtifacts) -ine 'artifacts' -or
    (Test-Path -LiteralPath $fixture)) { throw 'FixtureRoot must be a new immediate artifacts/verification child.' }
$cleanupProjectRoot = [IO.Path]::GetDirectoryName($fixtureArtifacts)
$extracted = Join-Path $fixture 'package'
$installed = Join-Path $fixture 'relocated-install'
$hostFixture = Join-Path $fixture 'host-acceptance'
$state = Join-Path $hostFixture 'azrael-state'
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $extracted)
    & (Join-Path $extracted 'install.ps1') -PrepareOnly -InstallRoot $installed -StateRoot $state *> (Join-Path $logs 'relocation.log')
    $installer = Get-Content -LiteralPath (Join-Path $installed 'installer-receipt.json') -Raw | ConvertFrom-Json
    if ($installer.hostVersion -cne $manifest.releaseVersion -or $installer.installed -ne $false) { throw 'Unexpected relocation receipt.' }
    $arguments = @{
        HostVsixPath = [string]$installer.customizedVsix
        FixtureRoot = $hostFixture
        StateRoot = $state
        UseFreshState = $true
        CodePath = $CodePath
    }
    foreach ($name in @('OriginalExtensionPath', 'OriginalAudioPath', 'UiSourcePath', 'TypeScriptPath')) {
        $value = Get-Variable -Name $name -ValueOnly
        if ($value) { $arguments[$name] = $value }
    }
    & (Join-Path $PSScriptRoot 'check-independent-vscode.ps1') @arguments *> (Join-Path $logs 'host-acceptance.log')
    if ($LASTEXITCODE -ne 0) { throw 'Isolated host acceptance failed. See host-acceptance.log.' }
    $summary = Get-Content -LiteralPath (Join-Path $hostFixture 'check-result.json') -Raw | ConvertFrom-Json
    if ($summary.passed -ne $true -or $summary.hostPackage.version -cne $manifest.releaseVersion) { throw 'Host acceptance did not certify the requested version.' }
    $summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $logs 'host-acceptance.json') -Encoding utf8NoBOM
    $installer | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $logs 'relocation.json') -Encoding utf8NoBOM
    if ((Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestHash -or
        (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -cne $asset.sha256) { throw 'Release files changed during verification.' }
    $receipt = [ordered]@{
        schemaVersion = 1
        passed = $true
        releaseVersion = [string]$manifest.releaseVersion
        manifestSha256 = $manifestHash
        assets = @($manifest.assets)
        scope = 'relocated runtime and isolated integrated host acceptance'
        logDirectory = $logs
        hostAcceptance = Join-Path $logs 'host-acceptance.json'
        relocation = Join-Path $logs 'relocation.json'
        fixtureRoot = $fixture
        cleanupProjectRoot = $cleanupProjectRoot
    }
    $receipt | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $logs 'verification.json') -Encoding utf8NoBOM
    $receipt | ConvertTo-Json -Depth 20
} catch {
    [ordered]@{ passed = $false; error = $_.Exception.Message; fixtureRoot = $fixture; logDirectory = $logs } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs 'failure.json') -Encoding utf8NoBOM
    throw
}
# The caller retains the fixture until the result is reviewed, then uses the
# guarded cleanup script. This script never removes uncertain process paths.
