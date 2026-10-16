#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('SameWindow')][string]$Target = 'SameWindow',
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

$ErrorActionPreference = 'Stop'
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
