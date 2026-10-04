#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('SameWindow', 'Isolated', 'Existing')][string]$Target = 'SameWindow',
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
    [switch]$UpdateDesktopShortcut = $true,
    # Keep old parameter names bindable so retired commands get the migration error below.
    [string]$InstallRoot,
    [string]$OriginalExtensionPath
)

$ErrorActionPreference = 'Stop'
if ($Target -ne 'SameWindow' -or $InstallRoot -or $OriginalExtensionPath) {
    throw 'The isolated/existing installer routes are retired by the independent same-window migration. Use -Target SameWindow for the azrael host beside the untouched original Codex extension; existing isolated installations remain recovery artifacts only.'
}

$arguments = @{
    WorkspacePath = $WorkspacePath
    StateRoot = $StateRoot
    CodePath = $CodePath
    ExtensionsDir = $ExtensionsDir
    PrepareOnly = [bool]$PrepareOnly
    NoLaunch = [bool]$NoLaunch
    UpdateDesktopShortcut = [bool]$UpdateDesktopShortcut
    SourceCodexHome = $SourceCodexHome
    SkipCodexEnvironmentSnapshot = [bool]$SkipCodexEnvironmentSnapshot
}
if ($ReleaseDirectory) { $arguments.ReleaseDirectory = $ReleaseDirectory }
if ($UserDataDir) { $arguments.UserDataDir = $UserDataDir }
if ($SourceExtensionPath) { $arguments.SourceExtensionPath = $SourceExtensionPath }
if ($PreparedPackageDirectory) { $arguments.PreparedPackageDirectory = $PreparedPackageDirectory }
if ($DevinExecutable) { $arguments.DevinExecutable = $DevinExecutable }

& (Join-Path $PSScriptRoot 'install-independent-vscode.ps1') @arguments
if ($LASTEXITCODE -ne 0) { throw "Same-window azrael installer failed with exit code $LASTEXITCODE." }
$global:LASTEXITCODE = 0
