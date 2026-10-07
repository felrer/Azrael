[CmdletBinding()]
param(
    [switch]$PrepareOnly,
    [string]$InstallRoot,
    [string]$ReleasesRoot,
    [string]$StateRoot,
    [string]$CodePath,
    [string]$DevinExecutable
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Write-Json([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 30) + "`n", [Text.UTF8Encoding]::new($false))
}
function Get-Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Valid-Version([string]$Version) {
    if ($Version -notmatch '\A(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\z') { return $false }
    foreach ($component in $Version.Split('.')) {
        [long]$number = 0
        if (-not [long]::TryParse($component, [ref]$number) -or $number -gt 9007199254740991) { return $false }
    }
    return $true
}
function Absolute-Path([string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path) -or $Path -notmatch '^(?:[A-Za-z]:[\\/]|\\\\)') { throw "An absolute Windows path is required: $Path" }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd([char[]]'\/')
    if ($full -eq [IO.Path]::GetPathRoot($full).TrimEnd([char[]]'\/')) { throw 'A drive/share root is not an installation or state directory.' }
    $current = $full
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point forbidden: $current" }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
    return $full
}
function Is-Within([string]$Path, [string]$Root) {
    return $Path.Equals($Root, [StringComparison]::OrdinalIgnoreCase) -or $Path.StartsWith($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Relative-File([string]$Root, [string]$Name) {
    if (-not $Name -or $Name.Contains('\') -or $Name.Contains(':') -or $Name.StartsWith('/') -or @($Name.Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count) { throw "Unsafe package path: $Name" }
    $full = Absolute-Path (Join-Path $Root $Name.Replace('/', '\'))
    if (-not (Is-Within $full $Root) -or $full -eq $Root) { throw "Package path escape: $Name" }
    return $full
}

$created = $false
$installationAttempted = $false
$destination = $null
try {
    $packageRoot = Absolute-Path $PSScriptRoot
    $manifestPath = Join-Path $packageRoot 'package-manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.product -ne 'Azrael' -or -not (Valid-Version $manifest.releaseVersion) -or $manifest.hostVersion -cne $manifest.releaseVersion) { throw 'Invalid package manifest.' }
    $known = @{}
    foreach ($entry in $manifest.files) {
        $file = Relative-File $packageRoot $entry.path
        if ($known.ContainsKey($entry.path) -or $entry.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "Invalid inventory entry: $($entry.path)" }
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -ne $entry.size -or (Get-Hash $file) -cne $entry.sha256.ToLowerInvariant()) { throw "Package inventory mismatch: $($entry.path)" }
        $known[$entry.path] = $true
    }
    foreach ($item in Get-ChildItem -LiteralPath $packageRoot -Recurse -Force) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point forbidden: $($item.FullName)" }
        if (-not $item.PSIsContainer) {
            $name = $item.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
            if ($name -ne 'package-manifest.json' -and -not $known.ContainsKey($name)) { throw "Unlisted package file: $name" }
        }
    }
    foreach ($required in @('host-template.vsix', 'runtime/devin-native-build.json', 'runtime/opencodex-accounts-build.json', 'runtime/node/node.exe', 'runtime/engine/codex.exe', 'runtime/engine/azrael-bridge.exe', 'runtime/engine/codex-code-mode-host.exe')) {
        if (-not $known.ContainsKey($required)) { throw "Missing package dependency: $required" }
    }
    # Only recipient-owned settings are read here. The public template contains
    # relative payload paths; no build-machine location is used for execution.
    if (-not $PSBoundParameters.ContainsKey('InstallRoot')) {
        if (-not $PSBoundParameters.ContainsKey('ReleasesRoot')) {
            $ReleasesRoot = if ($env:AZRAEL_RELEASES_ROOT) { $env:AZRAEL_RELEASES_ROOT } else { Join-Path $env:LOCALAPPDATA 'azrael-ex/releases' }
        }
        $ReleasesRoot = Absolute-Path $ReleasesRoot
        $InstallRoot = Join-Path $ReleasesRoot $manifest.releaseVersion
    }
    if (-not $PSBoundParameters.ContainsKey('StateRoot')) {
        $StateRoot = if ($env:AZRAEL_STATE_ROOT) { $env:AZRAEL_STATE_ROOT } else { Join-Path $env:USERPROFILE '.azrael-ex' }
    }
    if (-not $PSBoundParameters.ContainsKey('CodePath')) {
        $CodePath = if ($env:AZRAEL_CODE_PATH) { $env:AZRAEL_CODE_PATH } else { 'code' }
    }
    if (-not $PSBoundParameters.ContainsKey('DevinExecutable')) { $DevinExecutable = $env:AZRAEL_DEVIN_EXECUTABLE }
    if ($DevinExecutable) {
        $DevinExecutable = Absolute-Path $DevinExecutable
        if (-not (Test-Path -LiteralPath $DevinExecutable -PathType Leaf)) { throw "Devin executable is missing: $DevinExecutable" }
    }
    $destination = Absolute-Path $InstallRoot
    $state = Absolute-Path $StateRoot
    $ordinaryState = Absolute-Path (Join-Path $env:USERPROFILE '.codex')
    if (Is-Within $state $ordinaryState) { throw 'Azrael requires a state directory separate from ordinary Codex.' }
    if ((Is-Within $destination $packageRoot) -or (Is-Within $packageRoot $destination) -or (Is-Within $destination $state) -or (Is-Within $state $destination) -or (Is-Within $state $packageRoot) -or (Is-Within $packageRoot $state)) { throw 'Installation, extracted package and state directories must be separate.' }
    if (Test-Path -LiteralPath $destination) { throw "Installation destination is occupied: $destination" }
    # Resolve the installer CLI before creating anything; PrepareOnly needs no VS Code.
    $codeCommand = $null
    if (-not $PrepareOnly) { $codeCommand = (Get-Command $CodePath -ErrorAction Stop).Source }
    New-Item -Path $destination -ItemType Directory -ErrorAction Stop | Out-Null
    $created = $true
    $runtimeDirectory = Join-Path $destination 'runtime'
    foreach ($entry in $manifest.files) {
        if ($entry.path.StartsWith('runtime/') -or $entry.path.StartsWith('licenses/') -or $entry.path -cin @('LICENSE', 'provenance.json', 'README.txt')) {
            $target = Relative-File $destination $entry.path
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            [IO.File]::Copy((Relative-File $packageRoot $entry.path), $target, $false)
            if ((Get-Hash $target) -cne $entry.sha256.ToLowerInvariant()) { throw "Copy integrity mismatch: $($entry.path)" }
        }
    }
    $devinPath = Join-Path $runtimeDirectory 'devin-native-build.json'
    $devin = Get-Content -LiteralPath $devinPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($devin.node.path -cne 'node/node.exe' -or -not $devin.node.bundled) { throw 'Node runtime is not the portable bundled runtime.' }
    $nodePath = Join-Path $runtimeDirectory 'node/node.exe'
    if ((Get-Hash $nodePath) -cne $devin.node.sha256.ToLowerInvariant()) { throw 'Bundled Node integrity mismatch.' }
    $devin.node.path = $nodePath
    Write-Json $devinPath $devin
    $vsix = Join-Path $destination ('Azrael-' + $manifest.hostVersion + '.vsix')
    [IO.File]::Copy((Join-Path $packageRoot 'host-template.vsix'), $vsix, $false)
    $archive = [IO.Compression.ZipFile]::Open($vsix, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $runtimeEntry = $archive.GetEntry('extension/out/azrael-runtime.json')
        if (-not $runtimeEntry) { throw 'Host runtime template missing.' }
        $reader = [IO.StreamReader]::new($runtimeEntry.Open())
        try { $config = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        $packageEntry = $archive.GetEntry('extension/package.json')
        $reader = [IO.StreamReader]::new($packageEntry.Open())
        try { $hostPackage = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ($hostPackage.version -cne $manifest.hostVersion -or $config.schema -ne 1 -or $config.codexHome -cne '@STATE@') { throw 'Host template version/configuration mismatch.' }
        $config.engine = Relative-File $runtimeDirectory $config.engine
        $config.bridge = Relative-File $runtimeDirectory $config.bridge
        $config.codexHome = $state
        if ($DevinExecutable) { $config | Add-Member -NotePropertyName devinExecutable -NotePropertyValue $DevinExecutable }
        foreach ($provider in @('devinNative', 'providerAccounts')) {
            if ($config.$provider.releaseDirectory -cne '.') { throw "Invalid provider template: $provider" }
            $config.$provider.releaseDirectory = $runtimeDirectory
        }
        $config.computerUse.directory = Relative-File $runtimeDirectory $config.computerUse.directory
        $config.windowControl.directory = Relative-File $runtimeDirectory $config.windowControl.directory
        $config.windowControl.executable = Relative-File $runtimeDirectory $config.windowControl.executable
        $config.windowControl.mcpScript = Relative-File $runtimeDirectory $config.windowControl.mcpScript
        foreach ($owner in @('computerUse', 'windowControl')) {
            if ((Get-Hash (Join-Path $config.$owner.directory 'manifest.json')) -cne $config.$owner.manifestSha256.ToLowerInvariant()) { throw "Installed manifest integrity mismatch: $owner" }
        }
        $runtimeEntry.Delete()
        $replacement = $archive.CreateEntry('extension/out/azrael-runtime.json', [IO.Compression.CompressionLevel]::Optimal)
        $writer = [IO.StreamWriter]::new($replacement.Open(), [Text.UTF8Encoding]::new($false))
        try { $writer.Write(($config | ConvertTo-Json -Depth 30) + "`n") } finally { $writer.Dispose() }
    } finally { $archive.Dispose() }
    $configPath = Join-Path $destination 'runtime-config.json'
    Write-Json $configPath $config
    $receipt = [ordered]@{ schemaVersion = 1; product = 'Azrael'; releaseVersion = $manifest.releaseVersion; hostVersion = $manifest.hostVersion; preparedOnly = [bool]$PrepareOnly; customizedVsix = $vsix; runtimeDirectory = $runtimeDirectory; runtimeConfig = $config; runtimeConfigPath = $configPath; hashes = [ordered]@{ customizedVsix = Get-Hash $vsix; runtimeConfig = Get-Hash $configPath; devinManifest = Get-Hash $devinPath; node = Get-Hash $nodePath }; installed = $false }
    if (-not $PrepareOnly) {
        $installationAttempted = $true
        & $codeCommand --install-extension $vsix
        if ($LASTEXITCODE -ne 0) { throw "VS Code extension installation failed with exit code $LASTEXITCODE. Runtime retained at $destination because the CLI may have partially installed the extension." }
        $receipt.installed = $true
    }
    $receiptPath = Join-Path $destination 'installer-receipt.json'
    Write-Json $receiptPath $receipt
    $receipt | ConvertTo-Json -Depth 30
} catch {
    if ($created -and -not $installationAttempted -and $destination) {
        # Remove only the newly created exact destination, after rechecking containment and links.
        $checked = Absolute-Path $destination
        if ($checked -cne $destination) { throw 'Rollback destination changed; preserving uncertain path.' }
        foreach ($item in Get-ChildItem -LiteralPath $checked -Recurse -Force) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Rollback encountered a reparse point; preserving uncertain path.' }
        }
        Remove-Item -LiteralPath $checked -Recurse -Force
    }
    throw
}
