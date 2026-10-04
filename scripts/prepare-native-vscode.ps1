#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReleaseDirectory,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$StateRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.azrael-ex'),
    [string]$DevinExecutable,
    [string]$VscePath
)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
if (-not [IO.Path]::IsPathFullyQualified($OutputDirectory) -or (Test-Path -LiteralPath $OutputDirectory)) {
    throw 'OutputDirectory must be a new absolute path.'
}
if (-not [IO.Path]::IsPathFullyQualified($StateRoot)) { throw 'StateRoot must be absolute.' }
$state = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\', '/')
$ordinary = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex')).TrimEnd('\', '/')
if ($state -ieq $ordinary -or $state.StartsWith($ordinary + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Azrael state must not use ordinary Codex state.'
}

$build = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json -AsHashtable
if ($build.installationMode -cne 'native-azrael-host' -or -not $build.engineSourceRoot) {
    throw 'The selected release is not a native Azrael host build.'
}
$sourceRoot = (Resolve-Path -LiteralPath ([string]$build.engineSourceRoot)).Path
& python -B (Join-Path $PSScriptRoot 'engine-provenance.py') verify --root $sourceRoot --engine-dir (Join-Path $release 'engine') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Release engine source provenance failed.' }
foreach ($relative in @('engine/codex.exe', 'engine/azrael-bridge.exe', 'engine/codex-code-mode-host.exe', 'azrael-ex.vsix')) {
    $expected = [string]$build.sha256[$relative]
    if (-not $expected -or (Get-FileHash -LiteralPath (Join-Path $release $relative) -Algorithm SHA256).Hash -ine $expected) {
        throw "Release hash mismatch: $relative"
    }
}
& node (Join-Path $PSScriptRoot 'provider-accounts-host.cjs') $release | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Provider bundle verification failed.' }
& node (Join-Path $PSScriptRoot 'devin-native-host.cjs') $release | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Devin bundle verification failed.' }
$provider = Get-Content -LiteralPath (Join-Path $release 'opencodex-accounts-build.json') -Raw | ConvertFrom-Json
$devin = Get-Content -LiteralPath (Join-Path $release 'devin-native-build.json') -Raw | ConvertFrom-Json
if ($provider.schema -ne 2 -or -not $provider.inferenceHelper) { throw 'The native host requires the verified provider inference helper.' }
if (-not $DevinExecutable) {
    $candidate = Join-Path $env:LOCALAPPDATA 'azrael-ex/tools/devin/3000.10.21/bin/devin.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $DevinExecutable = $candidate }
}
if ($DevinExecutable) { $DevinExecutable = (Resolve-Path -LiteralPath $DevinExecutable).Path }

$output = [IO.Path]::GetFullPath($OutputDirectory)
$stage = Join-Path $output 'host'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$archive = [IO.Compression.ZipFile]::OpenRead((Join-Path $release 'azrael-ex.vsix'))
try {
    $stagePrefix = $stage.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    foreach ($entry in $archive.Entries) {
        if (-not $entry.FullName.StartsWith('extension/', [StringComparison]::Ordinal) -or $entry.FullName -eq 'extension/') { continue }
        $relative = $entry.FullName.Substring('extension/'.Length).Replace('/', [IO.Path]::DirectorySeparatorChar)
        $target = [IO.Path]::GetFullPath((Join-Path $stage $relative))
        if (-not $target.StartsWith($stagePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Release VSIX contains an invalid path.' }
        if (-not $entry.Name) { New-Item -ItemType Directory -Path $target -Force | Out-Null; continue }
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        $inputStream = $entry.Open()
        $outputStream = [IO.File]::Create($target)
        try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
    }
} finally { $archive.Dispose() }
$manifestPath = Join-Path $stage 'package.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
if ($manifest.publisher -cne 'azrael-ex-local' -or $manifest.name -cne 'azrael' -or [version]$manifest.version -lt [version]'0.4.0' -or
    $manifest.main -cne './dist/src/extension.js') { throw 'The base VSIX is not the native Azrael extension.' }
$hostVersion = '0.4.' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$manifest.version = $hostVersion
$manifest | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
$helpers = [ordered]@{
    devinNativeHelper = Join-Path $release 'providers/devin/helper.mjs'
    nodeExecutable = [string]$devin.node.path
    providerAccountsHelper = Join-Path $release ([string]$provider.helper)
    providerInferenceHelper = Join-Path $release ([string]$provider.inferenceHelper)
    providerBun = Join-Path $release ([string]$provider.bun.path)
}
if ($DevinExecutable) { $helpers.devinExecutable = $DevinExecutable }
foreach ($candidate in $helpers.Values) {
    if (-not [IO.Path]::IsPathFullyQualified([string]$candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw 'A native runtime helper is missing.'
    }
}
[ordered]@{
    schema = 2
    engine = Join-Path $release 'engine/codex.exe'
    bridge = Join-Path $release 'engine/azrael-bridge.exe'
    codexHome = $state
    engineVersion = [string]$build.engineVersion
    helpers = $helpers
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'azrael-runtime.json') -Encoding utf8NoBOM

$tool = if ($VscePath) { (Resolve-Path -LiteralPath $VscePath).Path } else {
    Join-Path $project ("artifacts/build/" + (Split-Path $release -Leaf) + '/companion/node_modules/@vscode/vsce/vsce')
}
if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw 'Matching VSIX packaging tool is missing.' }
$vsix = Join-Path $output 'azrael-host.vsix'
Push-Location $stage
try {
    & node $tool package --no-dependencies --no-rewrite-relative-links --allow-missing-repository --out $vsix *> (Join-Path $output 'host-package.log')
    if ($LASTEXITCODE -ne 0) { throw 'Native host VSIX packaging failed; see host-package.log.' }
} finally { Pop-Location }
$prepared = [ordered]@{
    schema = 1
    HostExtension = $stage
    HostVsix = $vsix
    HostSha256 = (Get-FileHash -LiteralPath $vsix -Algorithm SHA256).Hash
    HostId = 'azrael-ex-local.azrael'
    HostVersion = $hostVersion
    BaseVsix = Join-Path $release 'azrael-ex.vsix'
    BaseVsixSha256 = [string]$build.sha256['azrael-ex.vsix']
    ReleaseDirectory = $release
    StateRoot = $state
    DevinExecutable = $DevinExecutable
}
$prepared | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'native-prepared.json') -Encoding utf8NoBOM
[pscustomobject]$prepared
$global:LASTEXITCODE = 0
