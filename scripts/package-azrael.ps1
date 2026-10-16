[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EnginePath,
    [Parameter(Mandatory)][string]$BridgePath,
    [Parameter(Mandatory)][string]$CompanionVsixPath,
    [string]$SourceRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'engine'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot ("../artifacts/releases/" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')))
)

$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathFullyQualified($OutputDirectory)) { throw 'OutputDirectory must be absolute.' }
$destination = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $destination) { throw 'OutputDirectory must be new.' }
$engine = (Resolve-Path -LiteralPath $EnginePath).Path
$bridge = (Resolve-Path -LiteralPath $BridgePath).Path
$codeModeHost = (Resolve-Path -LiteralPath (Join-Path (Split-Path $engine -Parent) 'azrael-code-mode-host.exe')).Path
$vsix = (Resolve-Path -LiteralPath $CompanionVsixPath).Path
$archive = [IO.Compression.ZipFile]::OpenRead($vsix)
try {
    $reader = [IO.StreamReader]::new($archive.GetEntry('extension/package.json').Open())
    try { $companionManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
} finally { $archive.Dispose() }
if ($companionManifest.publisher -cne 'azrael-ex-local' -or $companionManifest.name -cnotin @('azrael-ex', 'azrael')) { throw 'Unexpected Azrael VSIX identity.' }
$nativeHost = $companionManifest.name -ceq 'azrael' -and [version]$companionManifest.version -ge [version]'0.4.0'
if ($companionManifest.name -ceq 'azrael' -and -not $nativeHost) { throw 'Native Azrael host requires package version 0.4.0 or newer.' }
$integratedAccounts = $companionManifest.name -ceq 'azrael-ex' -and [version]$companionManifest.version -ge [version]'0.3.0'
if (-not $nativeHost -and -not $integratedAccounts) { throw 'Package requires a current native host or integrated account payload.' }
if (-not [IO.Path]::IsPathFullyQualified($SourceRoot)) { throw 'SourceRoot must be absolute.' }
$sourceRoot = (Resolve-Path -LiteralPath ([IO.Path]::GetFullPath($SourceRoot))).Path
if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) { throw 'SourceRoot must be a directory.' }
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'codex-rs/Cargo.toml') -PathType Leaf)) {
    throw 'SourceRoot must contain codex-rs/Cargo.toml.'
}
if ((Split-Path $engine -Parent) -cne (Split-Path $bridge -Parent)) { throw 'Engine and bridge must come from the same recorded build directory.' }
$sourceReceiptText = & python -B (Join-Path $PSScriptRoot 'engine-provenance.py') verify --root $sourceRoot --engine-dir (Split-Path $engine -Parent)
if ($LASTEXITCODE -ne 0) { throw 'Cannot package an engine without matching source provenance.' }
$sourceReceipt = $sourceReceiptText | ConvertFrom-Json
$base = [string]$sourceReceipt.source.head
if ($base -notmatch '^[0-9a-f]{40}$') { throw 'Could not read the verified engine source baseline.' }
$engineVersion = & python -c 'import pathlib, sys, tomllib; print(tomllib.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))["workspace"]["package"]["version"])' (Join-Path $sourceRoot 'codex-rs/Cargo.toml')
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($engineVersion)) { throw 'Could not read the engine source version.' }
New-Item -ItemType Directory -Path $destination | Out-Null
New-Item -ItemType Directory -Path (Join-Path $destination 'engine') | Out-Null
Copy-Item -LiteralPath $engine -Destination (Join-Path $destination 'engine/azrael.exe')
Copy-Item -LiteralPath $bridge -Destination (Join-Path $destination 'engine/azrael-bridge.exe')
Copy-Item -LiteralPath $codeModeHost -Destination (Join-Path $destination 'engine/azrael-code-mode-host.exe')
Copy-Item -LiteralPath (Join-Path (Split-Path $engine -Parent) 'azrael-engine-build.json') -Destination (Join-Path $destination 'engine/azrael-engine-build.json')
Copy-Item -LiteralPath $vsix -Destination (Join-Path $destination 'azrael-ex.vsix')
foreach ($name in @('LICENSE', 'NOTICE')) {
    $license = Join-Path $sourceRoot $name
    if (Test-Path -LiteralPath $license -PathType Leaf) { Copy-Item -LiteralPath $license -Destination (Join-Path $destination "engine/$name") }
}
if ($nativeHost) {
    "Prepare this release using scripts/prepare-native-vscode.ps1, verify the prepared VSIX in a fresh VS Code profile, then install that exact VSIX. The package does not copy or activate the official Codex extension." | Set-Content -LiteralPath (Join-Path $destination 'INSTALL.txt') -Encoding utf8NoBOM
} else {
    "Install this release using the project scripts/install-azrael.ps1 -ReleaseDirectory `"$destination`". azrael-ex.vsix is an internal build input embedded in the independent azrael host, not a separately installed extension." | Set-Content -LiteralPath (Join-Path $destination 'INSTALL.txt') -Encoding utf8NoBOM
}
$files = @('engine/azrael.exe', 'engine/azrael-bridge.exe', 'engine/azrael-code-mode-host.exe', 'azrael-ex.vsix')
& python -B (Join-Path $PSScriptRoot 'engine-provenance.py') verify --root $sourceRoot --engine-dir (Join-Path $destination 'engine') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Packaged engine/source changed during copying. Release is not accepted.' }
$hashes = [ordered]@{}
foreach ($file in $files) { $hashes[$file] = (Get-FileHash -LiteralPath (Join-Path $destination $file) -Algorithm SHA256).Hash }
[ordered]@{
    product = 'azrael-ex'
    packageVersion = $companionManifest.version
    installationMode = if ($nativeHost) { 'native-azrael-host' } else { 'same-window-integrated-host' }
    engineVersion = $engineVersion.Trim()
    officialExtensionVersion = if ($nativeHost) { $null } else { '26.908.40401' }
    engineBaseCommit = $base
    engineSourceRoot = $sourceRoot
    engineIncludesLocalChanges = $true
    engineProvenance = Get-Content -LiteralPath (Join-Path $destination 'engine/azrael-engine-build.json') -Raw | ConvertFrom-Json
    generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    sha256 = $hashes
    officialBundleIncluded = $false
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destination 'build-info.json') -Encoding utf8NoBOM
Write-Output $destination
