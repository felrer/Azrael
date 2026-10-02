#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReleaseDirectory,
    [Parameter(Mandatory)][string]$PreparedPackageDirectory,
    [string]$StateRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.azrael-ex'),
    [string]$ExtensionsDir = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.vscode/extensions'),
    [string]$CodePath = 'code.cmd',
    [string]$RollbackVsixPath,
    [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$package = (Resolve-Path -LiteralPath $PreparedPackageDirectory).Path
$extensions = (Resolve-Path -LiteralPath $ExtensionsDir).Path
$state = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\', '/')
$prepared = Get-Content -LiteralPath (Join-Path $package 'native-prepared.json') -Raw | ConvertFrom-Json
$build = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json -AsHashtable
if ($build.installationMode -cne 'native-azrael-host' -or $prepared.HostId -cne 'azrael-ex-local.azrael' -or
    $prepared.ReleaseDirectory -ine $release -or $prepared.StateRoot -ine $state) {
    throw 'Prepared native package does not match this release and Azrael state.'
}
if ((Resolve-Path -LiteralPath $prepared.HostVsix).Path -ine (Join-Path $package 'azrael-host.vsix')) { throw 'Prepared host VSIX path changed.' }
if ((Get-FileHash -LiteralPath $prepared.HostVsix -Algorithm SHA256).Hash -ine $prepared.HostSha256 -or
    (Get-FileHash -LiteralPath $prepared.BaseVsix -Algorithm SHA256).Hash -ine $prepared.BaseVsixSha256 -or
    $prepared.BaseVsixSha256 -ine [string]$build.sha256['azrael-ex.vsix']) { throw 'Prepared host or release base VSIX hash changed.' }
$sourceRoot = (Resolve-Path -LiteralPath ([string]$build.engineSourceRoot)).Path
& python -B (Join-Path $PSScriptRoot 'engine-provenance.py') verify --root $sourceRoot --engine-dir (Join-Path $release 'engine') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Engine source provenance changed after package preparation.' }
& node (Join-Path $PSScriptRoot 'provider-accounts-host.cjs') $release | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Provider helper verification failed.' }
& node (Join-Path $PSScriptRoot 'devin-native-host.cjs') $release | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Devin helper verification failed.' }
$archive = [IO.Compression.ZipFile]::OpenRead([string]$prepared.HostVsix)
try {
    $manifestEntry = $archive.GetEntry('extension/package.json')
    $runtimeEntry = $archive.GetEntry('extension/azrael-runtime.json')
    if (-not $manifestEntry -or -not $runtimeEntry -or -not $archive.GetEntry('extension/dist/src/extension.js')) {
        throw 'Prepared native VSIX is missing its host entry point or runtime.'
    }
    $reader = [IO.StreamReader]::new($manifestEntry.Open())
    try { $hostManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    $reader = [IO.StreamReader]::new($runtimeEntry.Open())
    try { $runtime = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($hostManifest.publisher -cne 'azrael-ex-local' -or $hostManifest.name -cne 'azrael' -or $hostManifest.version -cne $prepared.HostVersion -or
        $hostManifest.main -cne './dist/src/extension.js' -or $runtime.schema -ne 2 -or $runtime.codexHome -ine $state -or
        $runtime.engine -ine (Join-Path $release 'engine/codex.exe') -or $runtime.bridge -ine (Join-Path $release 'engine/azrael-bridge.exe')) {
        throw 'Prepared native VSIX identity or runtime does not match its receipt.'
    }
} finally { $archive.Dispose() }

$code = (Get-Command $CodePath -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
function Get-Inventory {
    $rows = @(& $code --extensions-dir $extensions --list-extensions --show-versions)
    if ($LASTEXITCODE -ne 0) { throw 'VS Code extension inventory failed.' }
    @($rows | Where-Object { $_ -match '^[^@]+@[^@]+$' } | Sort-Object)
}
$before = @(Get-Inventory)
$unrelatedBefore = @($before | Where-Object { $_ -notmatch '^azrael-ex-local\.(azrael|azrael-ex)@' })
$priorHost = @($before | Where-Object { $_ -match '^azrael-ex-local\.azrael@' })
if ($priorHost.Count -gt 1) { throw 'Multiple prior Azrael host versions are registered.' }
$rollbackVsix = $null
$rollbackSha256 = $null
if ($RollbackVsixPath) {
    $rollbackVsix = (Resolve-Path -LiteralPath $RollbackVsixPath).Path
    $rollbackSha256 = (Get-FileHash -LiteralPath $rollbackVsix -Algorithm SHA256).Hash
    $priorArchive = [IO.Compression.ZipFile]::OpenRead($rollbackVsix)
    try {
        $priorEntry = $priorArchive.GetEntry('extension/package.json')
        if (-not $priorEntry) { throw 'Rollback VSIX has no extension manifest.' }
        $reader = [IO.StreamReader]::new($priorEntry.Open())
        try { $priorManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ($priorManifest.publisher -cne 'azrael-ex-local' -or $priorManifest.name -cne 'azrael' -or
            $priorHost.Count -ne 1 -or $priorHost[0] -cne "azrael-ex-local.azrael@$($priorManifest.version)") {
            throw 'Rollback VSIX does not match the currently installed Azrael host.'
        }
    } finally { $priorArchive.Dispose() }
}
if (-not $PrepareOnly -and $priorHost.Count -eq 1 -and -not $rollbackVsix) {
    throw 'Pass the exact prior Azrael VSIX for a reversible installation.'
}
$deployment = Join-Path $project ('artifacts/deployments/native-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $deployment | Out-Null
$receiptPath = Join-Path $deployment 'deployment.json'
$receipt = [ordered]@{
    schema = 1; status = 'preparing'; generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    releaseDirectory = $release; preparedPackage = $package; hostVsix = [string]$prepared.HostVsix
    hostSha256 = [string]$prepared.HostSha256; hostVersion = [string]$prepared.HostVersion
    stateRoot = $state; extensionsDir = $extensions; inventoryBefore = $before
    rollbackVsix = $rollbackVsix; rollbackSha256 = $rollbackSha256
    previousOwnExtensions = @(); inventoryAfter = @(); reloadRequired = $false; error = $null
}
function Write-Receipt { $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8NoBOM }
Write-Receipt
try {
    if ($PrepareOnly) {
        $receipt.status = 'prepared'
        $receipt.inventoryAfter = @(Get-Inventory)
        if (($receipt.inventoryAfter | ConvertTo-Json -Compress) -cne ($before | ConvertTo-Json -Compress)) { throw 'PrepareOnly changed VS Code extension inventory.' }
        Write-Receipt
        [pscustomobject]@{ Installed = $false; Prepared = $true; Receipt = $receiptPath }
        return
    }
    $backup = Join-Path $deployment 'previous-own-extensions'
    foreach ($candidate in @(Get-ChildItem -LiteralPath $extensions -Directory)) {
        $candidateManifest = Join-Path $candidate.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $candidateManifest -PathType Leaf)) { continue }
        try { $previous = Get-Content -LiteralPath $candidateManifest -Raw | ConvertFrom-Json } catch { continue }
        if ("$($previous.publisher).$($previous.name)" -cnotin @('azrael-ex-local.azrael', 'azrael-ex-local.azrael-ex')) { continue }
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        $target = Join-Path $backup $candidate.Name
        Copy-Item -LiteralPath $candidate.FullName -Destination $target -Recurse
        $receipt.previousOwnExtensions += [ordered]@{ source = $candidate.FullName; backup = $target; id = "$($previous.publisher).$($previous.name)"; version = [string]$previous.version }
    }
    Write-Receipt
    $null = @(& $code --extensions-dir $extensions --install-extension $prepared.HostVsix --force)
    if ($LASTEXITCODE -ne 0) { throw 'Native Azrael VSIX installation failed.' }
    $receipt.status = 'host-installed'
    $receipt.reloadRequired = $true
    Write-Receipt
    $after = @(Get-Inventory)
    if ($after -notcontains "azrael-ex-local.azrael@$($prepared.HostVersion)") { throw 'Installed native Azrael version was not found.' }
    if (@($after | Where-Object { $_ -match '^azrael-ex-local\.azrael-ex@' }).Count) {
        $null = @(& $code --extensions-dir $extensions --uninstall-extension 'azrael-ex-local.azrael-ex')
        if ($LASTEXITCODE -ne 0) { throw 'Retired account companion removal failed.' }
        $after = @(Get-Inventory)
    }
    $unrelatedAfter = @($after | Where-Object { $_ -notmatch '^azrael-ex-local\.(azrael|azrael-ex)@' })
    if (($unrelatedAfter | ConvertTo-Json -Compress) -cne ($unrelatedBefore | ConvertTo-Json -Compress)) { throw 'An unrelated extension inventory entry changed.' }
    $receipt.inventoryAfter = $after
    $receipt.status = 'installed-reload-required'
    Write-Receipt
    [pscustomobject]@{ Installed = $true; Prepared = $true; ReloadRequired = $true; Receipt = $receiptPath; HostVersion = $prepared.HostVersion }
} catch {
    $receipt.status = 'failed'; $receipt.error = $_.Exception.Message
    try { $receipt.inventoryAfter = @(Get-Inventory) } catch { }
    Write-Receipt
    throw
}
