[CmdletBinding()]
param(
    [string]$EnginePath = (Join-Path $PSScriptRoot '../upstream/codex/codex-rs/target/x86_64-pc-windows-msvc/debug/codex.exe'),
    [string]$StateRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.azrael-ex'),
    [string]$WorkspacePath = (Split-Path $PSScriptRoot -Parent),
    [string]$CodePath = 'code.cmd',
    [string]$OfficialExtensionPath = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.vscode/extensions/openai.chatgpt-26.908.40401-win32-x64'),
    [string]$BridgePath = (Join-Path $PSScriptRoot '../upstream/codex/codex-rs/target/x86_64-pc-windows-msvc/debug/azrael-bridge.exe'),
    [string]$CompanionVsixPath,
    [string]$InstanceId = ([guid]::NewGuid().ToString('N')),
    [string]$ManagementSocket,
    [string]$DevinExecutable,
    [switch]$UpdateEnginePair,
    [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'
if (-not $DevinExecutable) {
    if ($env:AZRAEL_EX_DEVIN_EXECUTABLE) {
        $DevinExecutable = $env:AZRAEL_EX_DEVIN_EXECUTABLE
    } else {
        $installedDevin = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'azrael-ex/tools/devin/3000.10.21/bin/devin.exe'
        if (Test-Path -LiteralPath $installedDevin -PathType Leaf) {
            $DevinExecutable = $installedDevin
        }
    }
}
if (-not [IO.Path]::IsPathFullyQualified($StateRoot)) {
    throw 'StateRoot must be an absolute path.'
}
if ($ManagementSocket -and -not [IO.Path]::IsPathFullyQualified($ManagementSocket)) {
    throw 'ManagementSocket must be an absolute per-instance socket path.'
}
if ($InstanceId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
    throw 'InstanceId must be a safe path segment of 1 to 64 letters, digits, dots, underscores, or hyphens.'
}
if ($CompanionVsixPath -and -not [IO.Path]::IsPathFullyQualified($CompanionVsixPath)) {
    throw 'CompanionVsixPath must be an absolute path.'
}
$statePath = [IO.Path]::GetFullPath($StateRoot)
$ordinaryRoot = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex'))
$normalizedState = $statePath.TrimEnd('\', '/')
if ($normalizedState -ieq $ordinaryRoot -or $normalizedState.StartsWith($ordinaryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Use a dedicated azrael state directory, not the ordinary Codex directory.'
}
$engine = (Resolve-Path -LiteralPath $EnginePath).Path
$bridge = (Resolve-Path -LiteralPath $BridgePath).Path
$workspace = (Resolve-Path -LiteralPath $WorkspacePath).Path
$companionVsix = if ($CompanionVsixPath) { (Resolve-Path -LiteralPath $CompanionVsixPath).Path } else { $null }
New-Item -ItemType Directory -Path $statePath -Force | Out-Null
# Even --version performs native arg0 helper cleanup under CODEX_HOME.
$versionPreviousRoot = $env:CODEX_HOME
try {
    $env:CODEX_HOME = $statePath
    $version = & $engine --version
    if ($LASTEXITCODE -ne 0 -or "$version" -notmatch '^codex-cli 0\.154\.0-alpha\.6\.2$') {
        throw "Engine version mismatch: $version"
    }
} finally {
    $env:CODEX_HOME = $versionPreviousRoot
}
$extensionsRoot = Join-Path $statePath 'azrael/vscode-extensions'
$branding = & (Join-Path $PSScriptRoot 'prepare-official-ui.ps1') -SourceExtensionPath $OfficialExtensionPath -ExtensionsDir $extensionsRoot
$editorRoot = Join-Path $statePath "azrael/vscode-instances/$InstanceId"
$settingsPath = Join-Path $editorRoot 'User/settings.json'
$baseSettingsPath = Join-Path $statePath 'azrael/vscode/User/settings.json'
$expected = [ordered]@{
    'window.title' = 'azrael-ex — ${rootName}${separator}${appName}'
    'chatgpt.cliExecutable' = $engine
    'azrael-ex.bridgeExecutable' = $bridge
    'extensions.autoUpdate' = $false
    'extensions.autoCheckUpdates' = $false
}
if ((Test-Path -LiteralPath $settingsPath) -or (Test-Path -LiteralPath $baseSettingsPath)) {
    $settingsSourcePath = if (Test-Path -LiteralPath $settingsPath) { $settingsPath } else { $baseSettingsPath }
    $settings = Get-Content -LiteralPath $settingsSourcePath -Raw | ConvertFrom-Json -AsHashtable
    if ($settings.ContainsKey('chatgpt.cliExecutable') -and $settings['chatgpt.cliExecutable'] -ne $engine) {
        if (-not ($UpdateEnginePair -and $settingsSourcePath -ceq $baseSettingsPath)) {
            throw "Isolated settings already select a different engine. Review $settingsSourcePath before changing it."
        }
    }
    if ($settings.ContainsKey('azrael-ex.bridgeExecutable') -and $settings['azrael-ex.bridgeExecutable'] -ne $bridge) {
        if (-not ($UpdateEnginePair -and $settingsSourcePath -ceq $baseSettingsPath)) {
            throw "Isolated settings already select a different bridge. Review $settingsSourcePath before changing it."
        }
    }
    $settingsChanged = $false
    foreach ($entry in $expected.GetEnumerator()) {
        if (-not $settings.ContainsKey($entry.Key) -or $settings[$entry.Key] -cne $entry.Value) {
            $settings[$entry.Key] = $entry.Value
            $settingsChanged = $true
        }
    }
    if ($settingsChanged -or $settingsSourcePath -cne $settingsPath) {
        New-Item -ItemType Directory -Path (Split-Path $settingsPath -Parent) -Force | Out-Null
        $settings | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $settingsPath -Encoding utf8NoBOM
    }
} else {
    New-Item -ItemType Directory -Path (Split-Path $settingsPath -Parent) -Force | Out-Null
    $expected | ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding utf8NoBOM
}
if ($PrepareOnly) {
    if ($DevinExecutable) {
        & (Join-Path $PSScriptRoot 'prepare-devin.ps1') -Executable $DevinExecutable -StateRoot $statePath | Out-Null
    }
    [pscustomobject]@{ Engine = $engine; Bridge = $bridge; Version = "$version"; StateRoot = $statePath; InstanceId = $InstanceId; EditorRoot = $editorRoot; ExtensionsDir = $extensionsRoot; OfficialExtension = $branding.Extension; Settings = $settingsPath }
    return
}

# A distinct user-data directory prevents VS Code from forwarding this request to
# an existing ordinary window with a different extension-host environment.
$previousRoot = $env:CODEX_HOME
$previousSocket = $env:AZRAEL_EX_MANAGEMENT_SOCKET
$previousDevin = $env:AZRAEL_EX_DEVIN_EXECUTABLE
$previousAgentTransport = $env:AZRAEL_EX_PLAINTEXT_AGENTS
try {
    $env:CODEX_HOME = $statePath
    $env:AZRAEL_EX_PLAINTEXT_AGENTS = '1'
    if ($DevinExecutable) {
        $env:AZRAEL_EX_DEVIN_EXECUTABLE = & (Join-Path $PSScriptRoot 'prepare-devin.ps1') -Executable $DevinExecutable -StateRoot $statePath
    }
    if (-not $ManagementSocket) {
        $socketRoot = Join-Path ([IO.Path]::GetTempPath()) "az-$(([guid]::NewGuid().ToString('N')).Substring(0, 12))"
        $ManagementSocket = Join-Path $socketRoot 'management.sock'
    }
    $env:AZRAEL_EX_MANAGEMENT_SOCKET = [IO.Path]::GetFullPath($ManagementSocket)
    if ($companionVsix) {
        & $CodePath --user-data-dir $editorRoot --extensions-dir $extensionsRoot --install-extension $companionVsix --force
        if ($LASTEXITCODE -ne 0) { throw "Companion extension install failed with exit code $LASTEXITCODE" }
    }
    $installed = & $CodePath --user-data-dir $editorRoot --extensions-dir $extensionsRoot --list-extensions --show-versions
    if ($LASTEXITCODE -ne 0 -or $installed -notcontains 'openai.chatgpt@26.908.40401') {
        throw 'The isolated editor must have official extension openai.chatgpt@26.908.40401 installed for this engine pair.'
    }
    & $CodePath --user-data-dir $editorRoot --extensions-dir $extensionsRoot --new-window $workspace
    if ($LASTEXITCODE -ne 0) { throw "VS Code launch failed with exit code $LASTEXITCODE" }
} finally {
    $env:CODEX_HOME = $previousRoot
    $env:AZRAEL_EX_MANAGEMENT_SOCKET = $previousSocket
    $env:AZRAEL_EX_DEVIN_EXECUTABLE = $previousDevin
    $env:AZRAEL_EX_PLAINTEXT_AGENTS = $previousAgentTransport
}
