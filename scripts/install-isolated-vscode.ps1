#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$ReleaseDirectory,
    [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'azrael-ex/vscode'),
    [string]$WorkspacePath = (Split-Path $PSScriptRoot -Parent),
    [string]$StateRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.azrael-ex'),
    [string]$CodePath = 'code.cmd',
    [string]$SourceExtensionPath,
    [string]$OriginalExtensionPath,
    [string]$DevinExecutable,
    [switch]$PrepareOnly,
    [switch]$NoLaunch,
    [switch]$UpdateDesktopShortcut = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path

function Get-NormalizedPath {
    param([Parameter(Mandatory)][string]$Path)
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw "Path must be absolute: $Path" }
    $fullPath = [IO.Path]::GetFullPath($Path)
    $pathRoot = [IO.Path]::GetPathRoot($fullPath)
    if ($fullPath.Length -eq $pathRoot.Length) { return $fullPath }
    return $fullPath.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Test-PathOverlap {
    param([Parameter(Mandatory)][string]$Left, [Parameter(Mandatory)][string]$Right)
    $separator = [IO.Path]::DirectorySeparatorChar
    $leftPrefix = if ($Left.EndsWith($separator)) { $Left } else { $Left + $separator }
    $rightPrefix = if ($Right.EndsWith($separator)) { $Right } else { $Right + $separator }
    return $Left.Equals($Right, [StringComparison]::OrdinalIgnoreCase) -or
        $Left.StartsWith($rightPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        $Right.StartsWith($leftPrefix, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-SafeInstallationPath {
    param([Parameter(Mandatory)][string]$Candidate, [Parameter(Mandatory)][hashtable]$Forbidden)
    foreach ($entry in $Forbidden.GetEnumerator()) {
        if (Test-PathOverlap -Left $Candidate -Right $entry.Value) {
            throw "Installation path '$Candidate' collides with $($entry.Key) '$($entry.Value)'."
        }
    }
}

function Copy-Directory {
    param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Destination)
    if (Test-Path -LiteralPath $Destination) { throw "Copy destination must be new: $Destination" }
    & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "Directory copy failed with robocopy exit code ${LASTEXITCODE}: $Source" }
    $global:LASTEXITCODE = 0
}

$installPath = Get-NormalizedPath -Path $InstallRoot
$statePath = Get-NormalizedPath -Path $StateRoot
$userDataPath = Get-NormalizedPath -Path (Join-Path $installPath 'user-data')
$installationsPath = Get-NormalizedPath -Path (Join-Path $installPath 'installations')
$forbidden = @{
    'ordinary VS Code extensions' = Get-NormalizedPath -Path (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.vscode')
    'ordinary VS Code user data' = Get-NormalizedPath -Path (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Code')
    'ordinary Codex state' = Get-NormalizedPath -Path (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex')
    'repository root' = Get-NormalizedPath -Path $projectRoot
    'azrael state root' = $statePath
}
foreach ($candidate in @($installPath, $userDataPath, $installationsPath)) {
    Assert-SafeInstallationPath -Candidate $candidate -Forbidden $forbidden
}

$workspace = (Resolve-Path -LiteralPath $WorkspacePath).Path
if (-not $SourceExtensionPath) {
    $retainedOfficial = Join-Path $projectRoot 'artifacts/deployments/original-official-26.908.40401'
    $SourceExtensionPath = if (Test-Path -LiteralPath $retainedOfficial -PathType Container) {
        $retainedOfficial
    } else {
        Join-Path ([Environment]::GetFolderPath('UserProfile')) '.vscode/extensions/openai.chatgpt-26.908.40401-win32-x64'
    }
}
$sourceExtension = (Resolve-Path -LiteralPath $SourceExtensionPath).Path
$sourceRuntime = Join-Path $sourceExtension 'out/azrael-runtime.json'
if (Test-Path -LiteralPath $sourceRuntime -PathType Leaf) {
    $recordedOriginal = (Get-Content -LiteralPath $sourceRuntime -Raw | ConvertFrom-Json).originalExtension
    if (-not $recordedOriginal -or -not [IO.Path]::IsPathFullyQualified($recordedOriginal)) {
        throw 'The prepared source extension does not record an absolute pristine originalExtension.'
    }
    $sourceExtension = (Resolve-Path -LiteralPath $recordedOriginal).Path
}
$runtimeOriginal = if ($OriginalExtensionPath) { (Resolve-Path -LiteralPath $OriginalExtensionPath).Path } else { $sourceExtension }
$codeCommand = Get-Command $CodePath -CommandType Application -ErrorAction Stop | Select-Object -First 1
$resolvedCodePath = (Resolve-Path -LiteralPath $codeCommand.Source).Path
if ([IO.Path]::GetFileName($resolvedCodePath) -ine 'code.cmd') { throw "CodePath must resolve to code.cmd: $resolvedCodePath" }

if (-not $ReleaseDirectory) {
    $pointerPath = Join-Path $projectRoot 'artifacts/latest.json'
    if (-not (Test-Path -LiteralPath $pointerPath -PathType Leaf)) { throw 'No built release is selected. Run scripts/build-azrael.ps1 first.' }
    $ReleaseDirectory = (Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json).releaseDirectory
}
$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path

$generationName = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$generationPath = Get-NormalizedPath -Path (Join-Path $installationsPath $generationName)
$extensionsPath = Get-NormalizedPath -Path (Join-Path $generationPath 'extensions')
$stagingPath = Get-NormalizedPath -Path (Join-Path $generationPath 'staging')
foreach ($candidate in @($generationPath, $extensionsPath, $stagingPath)) {
    Assert-SafeInstallationPath -Candidate $candidate -Forbidden $forbidden
}
if (Test-Path -LiteralPath $generationPath) { throw "Installation generation already exists: $generationPath" }
New-Item -ItemType Directory -Path $generationPath -Force | Out-Null

$prepareArguments = @{
    ReleaseDirectory = $release
    OutputDirectory = $stagingPath
    SourceExtensionPath = $sourceExtension
    OriginalExtensionPath = $runtimeOriginal
    StateRoot = $statePath
}
if ($DevinExecutable) { $prepareArguments.DevinExecutable = $DevinExecutable }
$prepared = & (Join-Path $PSScriptRoot 'prepare-ordinary-vscode.ps1') @prepareArguments
if ($LASTEXITCODE -ne 0) { throw "Host preparation failed with exit code $LASTEXITCODE." }

if ($PrepareOnly) {
    [pscustomobject]@{
        Prepared = $true
        Installed = $false
        GenerationPath = $generationPath
        PreparedOfficialExtension = $prepared.OfficialExtension
        CompanionVsix = $prepared.CompanionVsix
        ReleaseDirectory = $release
        StateRoot = $statePath
    }
    $global:LASTEXITCODE = 0
    return
}

if ($prepared.DevinExecutable) {
    & (Join-Path $PSScriptRoot 'prepare-devin.ps1') -Executable $prepared.DevinExecutable -StateRoot $statePath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Devin integration preparation failed with exit code $LASTEXITCODE." }
}

$officialDestination = Join-Path $extensionsPath (Split-Path $prepared.OfficialExtension -Leaf)
Copy-Directory -Source $prepared.OfficialExtension -Destination $officialDestination
New-Item -ItemType Directory -Path $userDataPath -Force | Out-Null
$settingsPath = Join-Path $userDataPath 'User/settings.json'
if (-not (Test-Path -LiteralPath $settingsPath)) {
    New-Item -ItemType Directory -Path (Split-Path $settingsPath -Parent) -Force | Out-Null
    [ordered]@{
        'window.title' = 'azrael-ex — ${rootName}${separator}${appName}'
        'extensions.autoUpdate' = $false
        'extensions.autoCheckUpdates' = $false
    } | ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding utf8NoBOM
}

$codeArguments = @('--user-data-dir', $userDataPath, '--extensions-dir', $extensionsPath)
& $resolvedCodePath @codeArguments --install-extension $prepared.CompanionVsix --force
if ($LASTEXITCODE -ne 0) { throw "Companion VSIX installation failed with exit code $LASTEXITCODE." }

$inventory = @(& $resolvedCodePath @codeArguments --list-extensions --show-versions)
if ($LASTEXITCODE -ne 0) { throw "Installed extension inventory failed with exit code $LASTEXITCODE." }
$buildInfo = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json
$officialInventory = "openai.chatgpt@$($buildInfo.officialExtensionVersion)"
$companionInventory = "azrael-ex-local.azrael-ex@$($buildInfo.packageVersion)"
foreach ($required in @($officialInventory, $companionInventory)) {
    if ($inventory -notcontains $required) { throw "Installed extension inventory is missing $required." }
}
$registryPath = Join-Path $extensionsPath 'extensions.json'
if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) { throw 'Private extension registry is missing after installation.' }
$registry = @(Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json -AsHashtable)
foreach ($entry in $registry) {
    if ($entry.identifier.id -in @('openai.chatgpt', 'azrael-ex-local.azrael-ex')) {
        if (-not $entry.ContainsKey('metadata')) { $entry.metadata = @{} }
        $entry.metadata['pinned'] = $true
    }
}
$registryTemporaryPath = Join-Path $extensionsPath ('.registry-' + [guid]::NewGuid().ToString('N') + '.json')
ConvertTo-Json -InputObject $registry -Depth 100 | Set-Content -LiteralPath $registryTemporaryPath -Encoding utf8NoBOM
[IO.File]::Move($registryTemporaryPath, $registryPath, $true)

$manifestPath = Join-Path $generationPath 'installation.json'
[ordered]@{
    schema = 1
    codePath = $resolvedCodePath
    userDataDir = $userDataPath
    extensionsDir = $extensionsPath
    workspacePath = $workspace
    stateRoot = $statePath
    releaseDirectory = $release
} | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM

$launcherPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'launch-installed-azrael.ps1')).Path
if ($UpdateDesktopShortcut) {
    $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'azrael-ex.lnk'
    if (Test-Path -LiteralPath $shortcutPath) {
        Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $generationPath 'previous-azrael-shortcut.lnk')
    }
    $pwshPath = (Get-Command pwsh.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $pwshPath
    $shortcut.WorkingDirectory = $workspace
    $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcherPath`" -ManifestPath `"$manifestPath`""
    $shortcut.WindowStyle = 7
    $shortcut.Save()
}

$currentPath = Join-Path $installPath 'current.json'
$currentTemporaryPath = Join-Path $installPath ('.current-' + [guid]::NewGuid().ToString('N') + '.json')
[ordered]@{ schema = 1; manifestPath = $manifestPath } | ConvertTo-Json | Set-Content -LiteralPath $currentTemporaryPath -Encoding utf8NoBOM
[IO.File]::Move($currentTemporaryPath, $currentPath, $true)

if (-not $NoLaunch) {
    & $launcherPath -ManifestPath $manifestPath
    if ($LASTEXITCODE -ne 0) { throw "Installed azrael launch failed with exit code $LASTEXITCODE." }
}

[pscustomobject]@{
    Prepared = $true
    Installed = $true
    ManifestPath = $manifestPath
    CurrentSelection = $currentPath
    ShortcutUpdated = [bool]$UpdateDesktopShortcut
    Launched = -not [bool]$NoLaunch
}
$global:LASTEXITCODE = 0
