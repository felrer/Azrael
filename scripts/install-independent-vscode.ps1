#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$ReleaseDirectory,
    [string]$WorkspacePath = (Split-Path $PSScriptRoot -Parent),
    [string]$StateRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.azrael-ex'),
    [string]$CodePath = 'code.cmd',
    [string]$UserDataDir,
    [string]$ExtensionsDir = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.vscode/extensions'),
    [string]$SourceExtensionPath,
    [string]$PreparedPackageDirectory,
    [string]$DevinExecutable,
    [string]$SourceCodexHome = (Join-Path $env:USERPROFILE '.codex'),
    [switch]$SkipCodexEnvironmentSnapshot,
    [switch]$PrepareOnly,
    [switch]$NoLaunch = $true,
    [switch]$UpdateDesktopShortcut = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:installationTimer = [Diagnostics.Stopwatch]::StartNew()
$script:directoryHashMetrics = @()
$projectRoot = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
$hostId = 'azrael-ex-local.azrael'
$companionId = 'azrael-ex-local.azrael-ex'

function Get-AbsolutePath {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Name, [switch]$MustExist)
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw "$Name must be absolute: $Path" }
    $full = [IO.Path]::GetFullPath($Path)
    if ($full -cne [IO.Path]::GetPathRoot($full)) { $full = $full.TrimEnd('\', '/') }
    if ($MustExist -and -not (Test-Path -LiteralPath $full)) { throw "$Name does not exist: $full" }
    if ($MustExist) {
        $full = (Resolve-Path -LiteralPath $full).Path
        if ($full -cne [IO.Path]::GetPathRoot($full)) { $full = $full.TrimEnd('\', '/') }
    }
    $full
}

function Resolve-ReleaseEngineSourceRoot {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$BuildInfo)
    $root = if ($BuildInfo.Contains('engineSourceRoot')) { $BuildInfo['engineSourceRoot'] } else { Join-Path $projectRoot 'upstream/codex' }
    if ($root -isnot [string] -or -not [IO.Path]::IsPathFullyQualified($root)) { throw 'Release engineSourceRoot must be an absolute directory path.' }
    $root = Get-AbsolutePath -Path $root -Name 'release engineSourceRoot' -MustExist
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'Release engineSourceRoot must be a directory.' }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'codex-rs/Cargo.toml') -PathType Leaf)) { throw 'Release engine source is not a Codex checkout.' }
    $root
}

function Get-FileState {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return [ordered]@{ exists = $false; sha256 = $null } }
    [ordered]@{ exists = $true; sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
}

. (Join-Path $PSScriptRoot 'directory-state.ps1')

function Get-DirectoryState {
    param([Parameter(Mandatory)][string]$Path)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    try {
        $state = Get-AzraelDirectoryState -Path $Path
        $state
    } finally {
        $timer.Stop()
        $script:directoryHashMetrics += [ordered]@{ path = $Path; elapsedMs = $timer.Elapsed.TotalMilliseconds }
    }
}

function ConvertTo-ComparableJson {
    param($Value)
    function Convert-Node($Node) {
        if ($null -eq $Node) { return $null }
        if ($Node -is [Collections.IDictionary]) {
            $ordered = [ordered]@{}
            foreach ($key in @($Node.Keys | Sort-Object)) { $ordered[[string]$key] = Convert-Node $Node[$key] }
            return $ordered
        }
        if ($Node -is [Management.Automation.PSCustomObject]) {
            $ordered = [ordered]@{}
            foreach ($property in @($Node.PSObject.Properties | Sort-Object Name)) { $ordered[$property.Name] = Convert-Node $property.Value }
            return $ordered
        }
        if ($Node -is [Collections.IEnumerable] -and $Node -isnot [string]) { return @($Node | ForEach-Object { Convert-Node $_ }) }
        $Node
    }
    Convert-Node $Value | ConvertTo-Json -Depth 100 -Compress
}

function ConvertTo-RegistryComparableJson {
    param($Value)
    $copy = ConvertTo-Json -InputObject $Value -Depth 100 | ConvertFrom-Json -AsHashtable
    foreach ($entry in @($copy)) {
        if ($entry -is [Collections.IDictionary] -and
            $entry['identifier'] -is [Collections.IDictionary] -and
            $entry['metadata'] -is [Collections.IDictionary] -and
            -not $entry['identifier'].Contains('uuid') -and $entry['metadata']['id']) {
            $entry['identifier']['uuid'] = $entry['metadata']['id']
        }
        if ($entry -isnot [Collections.IDictionary] -or -not $entry.Contains('location')) { continue }
        $location = $entry['location']
        if ($location -isnot [Collections.IDictionary] -or [string]$location['scheme'] -cne 'file') { continue }
        # VS Code rewrites these URI serialization details when installing a VSIX.
        [void]$location.Remove('fsPath')
        [void]$location.Remove('_sep')
        $locationPath = [string]$location['path']
        if ($location.Contains('external')) {
            $externalUri = $null
            if ([Uri]::TryCreate([string]$location['external'], [UriKind]::Absolute, [ref]$externalUri) -and
                $externalUri.IsFile -and $externalUri.Query -ceq '' -and $externalUri.Fragment -ceq '' -and
                $externalUri.Host -ieq [string]$location['authority'] -and
                [Uri]::UnescapeDataString($externalUri.AbsolutePath) -ieq $locationPath) {
                [void]$location.Remove('external')
            }
        }
        if ($locationPath -cmatch '^/[A-Za-z]:/') {
            $location['path'] = '/' + $locationPath.Substring(1, 1).ToUpperInvariant() + $locationPath.Substring(2)
        }
    }
    ConvertTo-ComparableJson $copy
}

function Get-Inventory {
    param([Parameter(Mandatory)][string]$Executable, [string[]]$Arguments)
    $output = @(& $Executable @Arguments --list-extensions --show-versions)
    if ($LASTEXITCODE -ne 0) { throw "Could not read VS Code extension inventory (exit $LASTEXITCODE)." }
    @($output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -match '^[^\s@]+@[^\s]+$' } | Sort-Object)
}

function Write-Receipt {
    param([Parameter(Mandatory)]$Receipt, [Parameter(Mandatory)][string]$Path)
    $Receipt.performance = [ordered]@{ elapsedMs = $script:installationTimer.Elapsed.TotalMilliseconds; directoryHashes = $script:directoryHashMetrics }
    $temporary = Join-Path (Split-Path $Path -Parent) ('.receipt-' + [guid]::NewGuid().ToString('N') + '.json')
    $Receipt | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $temporary -Encoding utf8NoBOM
    [IO.File]::Move($temporary, $Path, $true)
}

function Get-IntegratedHostManifest {
    param(
        [Parameter(Mandatory)][string]$VsixPath,
        [Parameter(Mandatory)][string]$ExpectedVersion
    )
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($VsixPath)
    try {
        $entry = $archive.GetEntry('extension/package.json')
        if (-not $entry) { throw 'Prepared host VSIX does not contain extension/package.json.' }
        $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8, $true)
        try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        $manifestHostId = "$($manifest.publisher).$($manifest.name)"
        if ($manifestHostId -cne $hostId) { throw "Prepared host VSIX manifest ID is $manifestHostId, expected $hostId." }
        if ([string]$manifest.version -cne $ExpectedVersion) { throw 'Prepared host VSIX version does not match independent-prepared.json.' }
        if ($manifest.azraelIntegratedAccounts -ne $true) { throw 'Prepared host VSIX is missing the integrated account UI marker.' }
        if (-not $manifest.azraelAccountPayloadVersion -or [version]$manifest.azraelAccountPayloadVersion -lt [version]'0.3.0') {
            throw 'Prepared host VSIX requires integrated account UI payload 0.3.0 or newer.'
        }
        if ([string]$manifest.main -cne './integrated-azrael-entry.cjs') { throw 'Prepared host VSIX does not use the integrated entry point.' }
        foreach ($requiredEntry in @(
            'extension/integrated-azrael-entry.cjs',
            'extension/account-ui/package.json',
            'extension/account-ui/dist/src/extension.js',
            'extension/account-ui/node_modules/@xterm/headless/package.json',
            'extension/account-ui/node_modules/node-pty/package.json',
            'extension/account-ui/node_modules/node-pty/prebuilds/win32-x64/pty.node'
        )) {
            if (-not $archive.GetEntry($requiredEntry)) { throw "Prepared host VSIX is missing integrated account UI content: $requiredEntry" }
        }
        $payloadEntry = $archive.GetEntry('extension/account-ui/package.json')
        $payloadReader = [IO.StreamReader]::new($payloadEntry.Open(), [Text.Encoding]::UTF8, $true)
        try { $payloadManifest = $payloadReader.ReadToEnd() | ConvertFrom-Json } finally { $payloadReader.Dispose() }
        if ([string]$payloadManifest.version -cne [string]$manifest.azraelAccountPayloadVersion) {
            throw 'Integrated account UI payload version does not match the host marker.'
        }
        $manifest
    } finally { $archive.Dispose() }
}

function Get-PreparedPackage {
    param(
        [Parameter(Mandatory)][string]$Directory,
        [Parameter(Mandatory)][string]$RequestedRelease,
        [Parameter(Mandatory)][string]$RequestedState
    )
    $manifestPath = Join-Path $Directory 'independent-prepared.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Prepared package manifest is missing: $manifestPath" }
    $prepared = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach ($property in @('HostExtension', 'HostVsix', 'HostSha256', 'HostId', 'HostVersion', 'CompanionVsix', 'ReleaseDirectory', 'StateRoot', 'DevinExecutable')) {
        if ($prepared.PSObject.Properties.Name -notcontains $property) { throw "Prepared package manifest is missing $property." }
    }
    $recordedRelease = Get-AbsolutePath -Path ([string]$prepared.ReleaseDirectory) -Name 'prepared ReleaseDirectory' -MustExist
    $recordedState = Get-AbsolutePath -Path ([string]$prepared.StateRoot) -Name 'prepared StateRoot'
    if ($recordedRelease -ine $RequestedRelease) { throw "Prepared package ReleaseDirectory does not match the requested release: $recordedRelease" }
    if ($recordedState -ine $RequestedState) { throw "Prepared package StateRoot does not match the requested state: $recordedState" }

    $hostExtension = Get-AbsolutePath -Path ([string]$prepared.HostExtension) -Name 'prepared HostExtension' -MustExist
    $hostVsix = Get-AbsolutePath -Path ([string]$prepared.HostVsix) -Name 'prepared HostVsix' -MustExist
    $companionVsix = Get-AbsolutePath -Path ([string]$prepared.CompanionVsix) -Name 'prepared CompanionVsix' -MustExist
    $expectedCompanion = Get-AbsolutePath -Path (Join-Path $RequestedRelease 'azrael-ex.vsix') -Name 'release CompanionVsix' -MustExist
    if ($companionVsix -ine $expectedCompanion) { throw "Prepared companion path must be the selected release azrael-ex.vsix: $companionVsix" }

    $buildInfoPath = Join-Path $RequestedRelease 'build-info.json'
    $buildInfo = Get-Content -LiteralPath $buildInfoPath -Raw | ConvertFrom-Json -AsHashtable
    $sourceRoot = Resolve-ReleaseEngineSourceRoot -BuildInfo $buildInfo
    $expectedCompanionSha = [string]$buildInfo.sha256['azrael-ex.vsix']
    if (-not $expectedCompanionSha -or (Get-FileHash -LiteralPath $companionVsix -Algorithm SHA256).Hash -ine $expectedCompanionSha) { throw 'Prepared companion VSIX hash does not match build-info.json.' }
    if ((Get-FileHash -LiteralPath $hostVsix -Algorithm SHA256).Hash -ine [string]$prepared.HostSha256) { throw 'Prepared host VSIX hash does not match independent-prepared.json.' }
    if ([string]$prepared.HostId -cne $hostId) { throw "Prepared host ID must be $hostId." }

    $hostManifest = Get-IntegratedHostManifest -VsixPath $hostVsix -ExpectedVersion ([string]$prepared.HostVersion)

    & python -B (Join-Path $PSScriptRoot 'engine-provenance.py') verify --root $sourceRoot --engine-dir (Join-Path $RequestedRelease 'engine') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Prepared installation requires an engine built from the current source. Rebuild and prepare again.' }

    $prepared.HostExtension = $hostExtension
    $prepared.HostVsix = $hostVsix
    $prepared.CompanionVsix = $companionVsix
    $prepared.ReleaseDirectory = $recordedRelease
    $prepared.StateRoot = $recordedState
    $prepared.AccountPayloadVersion = [string]$hostManifest.azraelAccountPayloadVersion
    $prepared
}

function Get-OriginalExtensionPath {
    param([Parameter(Mandatory)][string]$Directory, [Parameter(Mandatory)][string[]]$Inventory)
    $versions = @($Inventory | Where-Object { $_ -match '^openai\.chatgpt@(.+)$' } | ForEach-Object { $Matches[1] })
    if ($versions.Count -eq 0) { throw 'The ordinary profile does not contain the original openai.chatgpt extension. No profile changes were made.' }
    $matches = foreach ($candidate in @(Get-ChildItem -LiteralPath $Directory -Directory -Filter 'openai.chatgpt-*' -ErrorAction SilentlyContinue)) {
        $packagePath = Join-Path $candidate.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { continue }
        try { $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json } catch { continue }
        if ($package.publisher -eq 'openai' -and $package.name -eq 'chatgpt' -and ([string]$package.version) -in $versions) { $candidate.FullName }
    }
    $matches = @($matches)
    if ($matches.Count -ne 1) { throw "Expected one active original openai.chatgpt directory, found $($matches.Count). No profile changes were made." }
    [IO.Path]::GetFullPath($matches[0])
}

$workspace = Get-AbsolutePath -Path $WorkspacePath -Name 'WorkspacePath' -MustExist
$state = Get-AbsolutePath -Path $StateRoot -Name 'StateRoot'
$ordinaryState = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex')).TrimEnd('\', '/')
if ($state -ieq $ordinaryState -or $state.StartsWith($ordinaryState + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'StateRoot must not use ordinary Codex state.' }
if ($UserDataDir) { $UserDataDir = Get-AbsolutePath -Path $UserDataDir -Name 'UserDataDir' }

if (-not $ReleaseDirectory) {
    $latestPath = Join-Path $projectRoot 'artifacts/latest.json'
    $ReleaseDirectory = (Get-Content -LiteralPath $latestPath -Raw | ConvertFrom-Json).releaseDirectory
}
$release = Get-AbsolutePath -Path $ReleaseDirectory -Name 'ReleaseDirectory' -MustExist
if ($PrepareOnly) {
    if ($PreparedPackageDirectory -and $SourceExtensionPath) { throw 'SourceExtensionPath cannot be combined with PreparedPackageDirectory.' }
    $deploymentDirectory = Join-Path (Join-Path $projectRoot 'artifacts/deployments') ('independent-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory -Path $deploymentDirectory -Force | Out-Null
    $receiptPath = Join-Path $deploymentDirectory 'deployment.json'
    $packageDirectory = if ($PreparedPackageDirectory) { Get-AbsolutePath -Path $PreparedPackageDirectory -Name 'PreparedPackageDirectory' -MustExist } else { Join-Path $deploymentDirectory 'package' }
    $receipt = [ordered]@{ schema = 1; status = 'preparing'; releaseDirectory = $release; packageDirectory = $packageDirectory; stateRoot = $state; profileAccessed = $false; hostInstalled = $false; reloadRequired = $false; error = $null }
    try {
        if ($PreparedPackageDirectory) {
            $prepared = Get-PreparedPackage -Directory $packageDirectory -RequestedRelease $release -RequestedState $state
        } else {
            $prepareArguments = @{ ReleaseDirectory = $release; OutputDirectory = $packageDirectory; StateRoot = $state; SourceCodexHome = $SourceCodexHome; SkipCodexEnvironmentSnapshot = [bool]$SkipCodexEnvironmentSnapshot }
            if ($SourceExtensionPath) { $prepareArguments.SourceExtensionPath = $SourceExtensionPath }
            if ($DevinExecutable) { $prepareArguments.DevinExecutable = $DevinExecutable }
            $prepared = & (Join-Path $PSScriptRoot 'prepare-independent-vscode.ps1') @prepareArguments
        }
        $receipt.status = 'prepared'; $receipt.hostVsix = $prepared.HostVsix; $receipt.hostVersion = $prepared.HostVersion
        $receipt.hostSha256 = $prepared.HostSha256; $receipt.accountPayloadVersion = $prepared.AccountPayloadVersion
        Write-Receipt -Receipt $receipt -Path $receiptPath
        [pscustomobject]@{ Prepared = $true; Installed = $false; ReloadRequired = $false; Receipt = $receiptPath; HostExtension = $prepared.HostExtension; HostVsix = $prepared.HostVsix; CompanionVsix = $prepared.CompanionVsix; CompanionVsixRole = $prepared.CompanionVsixRole; AccountPayloadVersion = $prepared.AccountPayloadVersion; ReleaseDirectory = $release; StateRoot = $state; DevinExecutable = $prepared.DevinExecutable }
        $global:LASTEXITCODE = 0
        return
    } catch {
        $receipt.status = 'failed'; $receipt.error = $_.Exception.Message
        Write-Receipt -Receipt $receipt -Path $receiptPath
        throw
    }
}
$extensions = Get-AbsolutePath -Path $ExtensionsDir -Name 'ExtensionsDir' -MustExist
$resolvedCodePath = (Get-Command $CodePath -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$codeArguments = @('--extensions-dir', $extensions)
if ($UserDataDir) { $codeArguments = @('--user-data-dir', $UserDataDir) + $codeArguments }

$beforeInventory = @(Get-Inventory -Executable $resolvedCodePath -Arguments $codeArguments)
$originalPath = Get-OriginalExtensionPath -Directory $extensions -Inventory $beforeInventory
foreach ($legacyPatch in @('out/azrael-runtime.cjs', 'out/azrael-runtime.json', '.azrael-official-ui.json', '.azrael-profile-menu.json', '.azrael-startup-notices.json')) {
    if (Test-Path -LiteralPath (Join-Path $originalPath $legacyPatch)) { throw "The original Codex extension still contains a retired azrael patch ($legacyPatch). Restore the original before independent installation." }
}
$originalBefore = Get-DirectoryState -Path $originalPath
$settingsPath = if ($UserDataDir) { Join-Path $UserDataDir 'User/settings.json' } else { Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Code/User/settings.json' }
$settingsBefore = Get-FileState -Path $settingsPath
$unrelatedBefore = @($beforeInventory | Where-Object { $_ -notmatch '^azrael-ex-local\.(azrael|azrael-ex)@' })
$registryPath = Join-Path $extensions 'extensions.json'
$registryBeforeText = if (Test-Path -LiteralPath $registryPath -PathType Leaf) { Get-Content -LiteralPath $registryPath -Raw } else { $null }
$registryBefore = if ($registryBeforeText) { @($registryBeforeText | ConvertFrom-Json -AsHashtable) } else { @() }
$officialRegistryBefore = @($registryBefore | Where-Object { $_.identifier.id -eq 'openai.chatgpt' })
if ($officialRegistryBefore.Count -ne 1) { throw "Expected one original openai.chatgpt registry object, found $($officialRegistryBefore.Count). No profile changes were made." }
$officialRegistryComparableBefore = ConvertTo-ComparableJson $officialRegistryBefore
$officialRegistryCanonicalBefore = ConvertTo-RegistryComparableJson $officialRegistryBefore
$unrelatedRegistryBefore = @($registryBefore | Where-Object { $_.identifier.id -notin @($hostId, $companionId) } | Sort-Object { $_.identifier.id })
$unrelatedRegistryComparableBefore = ConvertTo-ComparableJson $unrelatedRegistryBefore
$unrelatedRegistryCanonicalBefore = ConvertTo-RegistryComparableJson $unrelatedRegistryBefore
$beforeRegistryByComparable = @{}
foreach ($entry in $unrelatedRegistryBefore) {
    $key = ConvertTo-RegistryComparableJson @($entry)
    if ($beforeRegistryByComparable.ContainsKey($key)) { throw 'Non-azrael registry entries are ambiguous before installation. No profile changes were made.' }
    $beforeRegistryByComparable[$key] = $entry
}

. (Join-Path $PSScriptRoot 'extension-backup-plan.ps1')
$extensionBackupPlan = Get-AzraelExtensionBackupPlan -ExtensionsDirectory $extensions -Registry $registryBefore -OwnIds @($hostId, $companionId) -Inventory $beforeInventory

$source = $null
if (-not $PreparedPackageDirectory) {
    if (-not $SourceExtensionPath) { $SourceExtensionPath = Join-Path $PSScriptRoot '../artifacts/upstream-ui/26.928.31416' }
    $source = Get-AbsolutePath -Path $SourceExtensionPath -Name 'SourceExtensionPath' -MustExist
} elseif ($SourceExtensionPath) {
    throw 'SourceExtensionPath cannot be combined with PreparedPackageDirectory.'
}
$suppliedPackage = if ($PreparedPackageDirectory) { Get-AbsolutePath -Path $PreparedPackageDirectory -Name 'PreparedPackageDirectory' -MustExist } else { $null }
$deploymentDirectory = Join-Path (Join-Path $projectRoot 'artifacts/deployments') ('independent-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$packageDirectory = if ($suppliedPackage) { $suppliedPackage } else { Join-Path $deploymentDirectory 'package' }
New-Item -ItemType Directory -Path $deploymentDirectory -Force | Out-Null

$receiptPath = Join-Path $deploymentDirectory 'deployment.json'
$receipt = [ordered]@{
    schema = 1; status = 'preparing'; generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    releaseDirectory = $release; packageDirectory = $packageDirectory; extensionsDir = $extensions; userDataDir = $UserDataDir
    workspacePath = $workspace; stateRoot = $state; sourceExtensionPath = $source
    preparedPackageVerification = [ordered]@{ supplied = [bool]$suppliedPackage; status = if ($suppliedPackage) { 'pending' } else { 'not-supplied' }; manifestPath = if ($suppliedPackage) { Join-Path $suppliedPackage 'independent-prepared.json' } else { $null } }
    originalExtension = [ordered]@{ before = $originalBefore; after = $null; unchanged = $null }
    settings = [ordered]@{ path = $settingsPath; before = $settingsBefore; after = $null; unchanged = $null }
    inventory = [ordered]@{ before = $beforeInventory; unrelatedBefore = $unrelatedBefore; after = $null; unrelatedUnchanged = $null }
    originalRegistryObjects = $officialRegistryBefore
    unrelatedRegistryObjects = $unrelatedRegistryBefore
    previousOwnRegistryObjects = @($registryBefore | Where-Object { $_.identifier.id -in @($hostId, $companionId) })
    previousOwnExtensionDirectories = @(); registryBackup = $null
    extensionBackupSelection = [ordered]@{ policy = 'none'; registered = $extensionBackupPlan.selected; skipped = $extensionBackupPlan.skipped; reason = 'extension-directory-backups-disabled' }
    hostExtension = $null; devinExecutable = $null; shortcutBackup = $null; validationError = $null
    hostVersion = $null; hostVsix = $null; companionVsix = $null; companionVsixRole = 'integrated-account-ui-provenance-input'
    accountPayloadVersion = $null; hostInstalled = $false; legacyCompanionPresent = [bool](@($beforeInventory | Where-Object { $_ -like "$companionId@*" }).Count); legacyCompanionUninstalled = $false
    shortcutUpdated = $false; reloadRequired = $false; error = $null
}
Write-Receipt -Receipt $receipt -Path $receiptPath

try {
    $computerUseArguments = @()
    $computerUseDirectory = Join-Path $release 'computer-use'
    if (Test-Path -LiteralPath $computerUseDirectory) { $computerUseArguments = @('--computer-use-directory', $computerUseDirectory) }
    if ($suppliedPackage) {
        $prepared = Get-PreparedPackage -Directory $suppliedPackage -RequestedRelease $release -RequestedState $state
        if ($DevinExecutable -and [string]$prepared.DevinExecutable -ine (Get-AbsolutePath -Path $DevinExecutable -Name 'DevinExecutable' -MustExist)) { throw 'Prepared DevinExecutable does not match the requested executable.' }
        $receipt.preparedPackageVerification.status = 'verified'
    } else {
        $prepareArguments = @{ ReleaseDirectory = $release; OutputDirectory = $packageDirectory; StateRoot = $state; SourceExtensionPath = $source; SourceCodexHome = $SourceCodexHome; SkipCodexEnvironmentSnapshot = [bool]$SkipCodexEnvironmentSnapshot }
        if ($DevinExecutable) { $prepareArguments.DevinExecutable = $DevinExecutable }
        $prepared = & (Join-Path $PSScriptRoot 'prepare-independent-vscode.ps1') @prepareArguments
        if ($LASTEXITCODE -ne 0) { throw "Host preparation failed with exit code $LASTEXITCODE." }
    }
    if ($suppliedPackage -and -not $SkipCodexEnvironmentSnapshot) {
        $snapshotOutput = & node (Join-Path $PSScriptRoot 'sync-codex-environment.cjs') `
            --source-home $SourceCodexHome `
            --state-root $state `
            --mode validate `
            --engine (Join-Path $release 'engine/codex.exe') `
            --manifest (Join-Path $PSScriptRoot 'azrael-codex-environment.json') @computerUseArguments
        if ($LASTEXITCODE -ne 0) { throw 'Codex environment snapshot failed; the prepared host was not installed.' }
        $prepared | Add-Member -NotePropertyName CodexEnvironmentSnapshot -NotePropertyValue ($snapshotOutput | ConvertFrom-Json) -Force
    }
    foreach ($property in @('HostExtension', 'HostVsix', 'HostSha256', 'HostVersion', 'CompanionVsix', 'ReleaseDirectory', 'StateRoot', 'DevinExecutable')) {
        if ($prepared.PSObject.Properties.Name -notcontains $property) { throw "Host preparation result is missing $property." }
    }
    foreach ($artifact in @($prepared.HostExtension, $prepared.HostVsix, $prepared.CompanionVsix)) {
        if (-not (Test-Path -LiteralPath $artifact)) { throw "Prepared artifact is missing: $artifact" }
    }
    $receipt.hostExtension = $prepared.HostExtension
    $receipt.hostVersion = [string]$prepared.HostVersion
    $receipt.hostVsix = [IO.Path]::GetFullPath($prepared.HostVsix)
    $receipt.companionVsix = [IO.Path]::GetFullPath($prepared.CompanionVsix)
    if ((Get-FileHash -LiteralPath $receipt.hostVsix -Algorithm SHA256).Hash -ine [string]$prepared.HostSha256) { throw 'Prepared host VSIX hash does not match independent-prepared.json.' }
    $integratedManifest = Get-IntegratedHostManifest -VsixPath $receipt.hostVsix -ExpectedVersion $receipt.hostVersion
    $receipt.accountPayloadVersion = [string]$integratedManifest.azraelAccountPayloadVersion
    $receipt.devinExecutable = $prepared.DevinExecutable
    $receipt.status = 'prepared'
    Write-Receipt -Receipt $receipt -Path $receiptPath

    if (-not $SkipCodexEnvironmentSnapshot) {
        $snapshotOutput = & node (Join-Path $PSScriptRoot 'sync-codex-environment.cjs') `
            --source-home $SourceCodexHome `
            --state-root $state `
            --mode apply `
            --engine (Join-Path $release 'engine/codex.exe') `
            --manifest (Join-Path $PSScriptRoot 'azrael-codex-environment.json') @computerUseArguments
        if ($LASTEXITCODE -ne 0) { throw 'Codex environment snapshot failed; host installation was not started.' }
        $receipt.codexEnvironmentSnapshot = $snapshotOutput | ConvertFrom-Json
        Write-Receipt -Receipt $receipt -Path $receiptPath
    }

    $currentRegistryText = Get-Content -LiteralPath $registryPath -Raw -ErrorAction Stop
    if ($currentRegistryText -cne $registryBeforeText) { throw 'Extension registry changed before installation. Retry installation.' }
    $currentBackupPlan = Get-AzraelExtensionBackupPlan -ExtensionsDirectory $extensions -Registry $registryBefore -OwnIds @($hostId, $companionId) -Inventory $beforeInventory
    if ((ConvertTo-ComparableJson $currentBackupPlan.selected) -cne (ConvertTo-ComparableJson $extensionBackupPlan.selected)) { throw 'Registered Azrael directories changed before installation.' }
    if ($registryBeforeText) {
        $registryBackup = Join-Path $deploymentDirectory 'extensions-before.json'
        Copy-Item -LiteralPath $registryPath -Destination $registryBackup
        $receipt.registryBackup = $registryBackup
    }
    Write-Receipt -Receipt $receipt -Path $receiptPath

    if ($prepared.DevinExecutable) {
        & (Join-Path $PSScriptRoot 'prepare-devin.ps1') -Executable $prepared.DevinExecutable -StateRoot $state | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Devin integration preparation failed with exit code $LASTEXITCODE." }
    }
    $null = @(& $resolvedCodePath @codeArguments --install-extension $receipt.hostVsix --force)
    if ($LASTEXITCODE -ne 0) { throw "Host VSIX installation failed with exit code $LASTEXITCODE." }
    $receipt.hostInstalled = $true; $receipt.reloadRequired = $true; $receipt.status = 'host-installed'; Write-Receipt -Receipt $receipt -Path $receiptPath
    $postHostInventory = @(Get-Inventory -Executable $resolvedCodePath -Arguments $codeArguments)
    if (@($postHostInventory | Where-Object { $_ -like "$companionId@*" }).Count) {
        $null = @(& $resolvedCodePath @codeArguments --uninstall-extension $companionId)
        if ($LASTEXITCODE -ne 0) { throw "Legacy companion uninstall failed with exit code $LASTEXITCODE." }
        $receipt.legacyCompanionUninstalled = $true
    }
    $receipt.status = 'host-installed-companion-removed'; Write-Receipt -Receipt $receipt -Path $receiptPath

    $afterInventory = @(Get-Inventory -Executable $resolvedCodePath -Arguments $codeArguments)
    $requiredHost = "${hostId}@$($receipt.hostVersion)"
    if ($afterInventory -notcontains $requiredHost) { throw "Installed extension inventory is missing $requiredHost." }
    if (@($afterInventory | Where-Object { $_ -like "$companionId@*" }).Count) { throw 'Legacy companion remains installed after integrated host installation.' }
    $unrelatedAfter = @($afterInventory | Where-Object { $_ -notmatch '^azrael-ex-local\.(azrael|azrael-ex)@' })
    if ((ConvertTo-ComparableJson $unrelatedAfter) -cne (ConvertTo-ComparableJson $unrelatedBefore)) { throw 'An unrelated extension inventory entry changed during installation.' }
    if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) { throw 'VS Code extension registry is missing after installation.' }
    $registry = @(Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json -AsHashtable)
    if ((ConvertTo-RegistryComparableJson @($registry | Where-Object { $_.identifier.id -eq 'openai.chatgpt' })) -cne $officialRegistryCanonicalBefore) { throw 'Original Codex registry object changed during installation.' }
    if ((ConvertTo-RegistryComparableJson @($registry | Where-Object { $_.identifier.id -notin @($hostId, $companionId) } | Sort-Object { $_.identifier.id })) -cne $unrelatedRegistryCanonicalBefore) { throw 'An unrelated extension registry object changed during installation.' }
    for ($index = 0; $index -lt $registry.Count; $index++) {
        $entry = $registry[$index]
        if ($entry.identifier.id -notin @($hostId, $companionId)) {
            $key = ConvertTo-RegistryComparableJson @($entry)
            if (-not $beforeRegistryByComparable.ContainsKey($key)) { throw "Cannot restore registry object exactly after installation: $($entry.identifier.id)" }
            $registry[$index] = $beforeRegistryByComparable[$key]
            continue
        }
        if ($entry.identifier.id -eq $hostId) {
            if (-not $entry.ContainsKey('metadata') -or $null -eq $entry.metadata) { $entry.metadata = @{} }
            $entry.metadata['pinned'] = $true
        }
    }
    $registryTemporary = Join-Path $extensions ('.azrael-independent-registry-' + [guid]::NewGuid().ToString('N') + '.json')
    ConvertTo-Json -InputObject $registry -Depth 100 | Set-Content -LiteralPath $registryTemporary -Encoding utf8NoBOM
    [IO.File]::Move($registryTemporary, $registryPath, $true)
    $registryVerified = @(Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json -AsHashtable)
    if ((ConvertTo-ComparableJson @($registryVerified | Where-Object { $_.identifier.id -eq 'openai.chatgpt' })) -cne $officialRegistryComparableBefore) { throw 'Original Codex registry object was not preserved while pinning azrael extensions.' }
    if ((ConvertTo-ComparableJson @($registryVerified | Where-Object { $_.identifier.id -notin @($hostId, $companionId) } | Sort-Object { $_.identifier.id })) -cne $unrelatedRegistryComparableBefore) { throw 'Unrelated extension registry objects were not preserved while pinning the azrael host.' }
    $hostEntries = @($registryVerified | Where-Object { $_.identifier.id -eq $hostId })
    if ($hostEntries.Count -eq 0 -or @($hostEntries | Where-Object { $_.metadata.pinned -eq $true }).Count -ne $hostEntries.Count) { throw "Azrael host registry entries were not pinned: $hostId" }

    $originalAfter = Get-DirectoryState -Path $originalPath
    if ($originalAfter.sha256 -cne $originalBefore.sha256 -or $originalAfter.fileCount -ne $originalBefore.fileCount -or $originalAfter.bytes -ne $originalBefore.bytes) { throw 'Original Codex extension files changed during installation.' }
    $settingsAfter = Get-FileState -Path $settingsPath
    if ((ConvertTo-ComparableJson $settingsAfter) -cne (ConvertTo-ComparableJson $settingsBefore)) { throw 'VS Code settings changed during installation.' }

    $defaultExtensions = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('UserProfile')) '.vscode/extensions')).TrimEnd('\', '/')
    if ($UpdateDesktopShortcut -and -not $UserDataDir -and $extensions -ieq $defaultExtensions) {
        $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'azrael-ex.lnk'
        if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
            $shortcutBackup = Join-Path $deploymentDirectory 'previous-azrael-shortcut.lnk'
            Copy-Item -LiteralPath $shortcutPath -Destination $shortcutBackup
            $receipt.shortcutBackup = $shortcutBackup
        }
        $codeCandidates = @(
            [IO.Path]::GetFullPath((Join-Path (Split-Path $resolvedCodePath -Parent) 'Code.exe')),
            [IO.Path]::GetFullPath((Join-Path (Split-Path $resolvedCodePath -Parent) '../Code.exe'))
        )
        $codeExe = @($codeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1)
        if ($codeExe.Count -ne 1) { throw 'Cannot update azrael shortcut: Code.exe was not found.' }
        $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $codeExe[0]
        $shortcut.WorkingDirectory = $workspace
        $shortcut.Arguments = '"' + $workspace + '"'
        $shortcut.Save()
        $receipt.shortcutUpdated = $true
    }

    $receipt.originalExtension = [ordered]@{ before = $originalBefore; after = $originalAfter; unchanged = $true }
    $receipt.settings.after = $settingsAfter; $receipt.settings.unchanged = $true
    $receipt.inventory.after = $afterInventory; $receipt.inventory.unrelatedUnchanged = $true
    $receipt.status = 'installed-reload-required'; $receipt.reloadRequired = $true
    Write-Receipt -Receipt $receipt -Path $receiptPath

    if (-not $NoLaunch) {
        $null = @(& $resolvedCodePath @codeArguments --reuse-window $workspace)
        if ($LASTEXITCODE -ne 0) { throw "Installed successfully, but VS Code launch failed with exit code $LASTEXITCODE." }
    }
    [pscustomobject]@{ Prepared = $true; Installed = $true; ReloadRequired = $true; Receipt = $receiptPath; HostVsix = $receipt.hostVsix; CompanionVsix = $receipt.companionVsix; CompanionVsixRole = $receipt.companionVsixRole; AccountPayloadVersion = $receipt.accountPayloadVersion; ReleaseDirectory = $release; StateRoot = $state; ShortcutUpdated = [bool]$receipt.shortcutUpdated; Launched = -not [bool]$NoLaunch }
    $global:LASTEXITCODE = 0
} catch {
    $failure = $_
    $receipt.status = 'failed'; $receipt.error = $failure.Exception.Message
    if ($suppliedPackage -and $receipt.preparedPackageVerification.status -ne 'verified') { $receipt.preparedPackageVerification.status = 'failed' }
    try {
        $receipt.inventory.after = @(Get-Inventory -Executable $resolvedCodePath -Arguments $codeArguments)
        $receipt.settings.after = Get-FileState -Path $settingsPath
        $receipt.originalExtension = [ordered]@{ before = $originalBefore; after = (Get-DirectoryState -Path $originalPath); unchanged = $null }
        $receipt.originalExtension.unchanged = $receipt.originalExtension.after.sha256 -ceq $originalBefore.sha256
    } catch { $receipt.validationError = $_.Exception.Message }
    Write-Receipt -Receipt $receipt -Path $receiptPath
    throw "$($failure.Exception.Message) Backup and receipt: $deploymentDirectory"
}
