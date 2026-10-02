#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$EngineDirectory,
    [Parameter(Mandatory = $true)][string]$StateRoot,
    [string]$WorkspacePath = (Split-Path $PSScriptRoot -Parent),
    [string]$NodePath = (Get-Command node -ErrorAction Stop).Source,
    [string]$HelperPath = (Join-Path $PSScriptRoot '../providers/devin/helper.mjs'),
    [string]$DevinExecutable = (Join-Path $env:LOCALAPPDATA 'azrael-ex/tools/devin/3000.10.21/bin/devin.exe'),
    [string]$ResumeThreadId,
    [switch]$AppServer,
    [switch]$CodeMode
)

$ErrorActionPreference = 'Stop'
foreach ($path in @($EngineDirectory, $StateRoot, $WorkspacePath, $NodePath, $DevinExecutable, $HelperPath)) {
    if (-not [IO.Path]::IsPathFullyQualified($path)) { throw 'Native Devin paths must be absolute.' }
}
$state = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\', '/')
$ordinary = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex'))
if ($state -ieq $ordinary -or $state.StartsWith($ordinary + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Use a dedicated Azrael state root.'
}
if ($AppServer -and $ResumeThreadId) { throw 'App-server clients resume through thread/resume.' }
$engine = (Resolve-Path -LiteralPath (Join-Path $EngineDirectory 'codex.exe')).Path
$node = (Resolve-Path -LiteralPath $NodePath).Path
$workspace = (Resolve-Path -LiteralPath $WorkspacePath).Path
$helper = (Resolve-Path -LiteralPath $HelperPath).Path
$nodeVersion = & $node --version
if ($LASTEXITCODE -ne 0 -or [version]($nodeVersion.TrimStart('v')) -lt [version]'22.18.0') {
    throw 'Node 22.18 or newer with built-in TypeScript stripping is required; Node 26.7.0 is the verified runtime.'
}
$devin = & (Join-Path $PSScriptRoot 'prepare-devin.ps1') -Executable $DevinExecutable -StateRoot $state
$names = @('CODEX_HOME', 'AZRAEL_DEVIN_NATIVE_HELPER', 'AZRAEL_DEVIN_NODE', 'AZRAEL_EX_DEVIN_EXECUTABLE', 'AZRAEL_EX_PLAINTEXT_AGENTS', 'WINDSURF_API_KEY', 'TMP', 'TEMP', 'RUST_LOG')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:CODEX_HOME = $state
    $env:AZRAEL_DEVIN_NATIVE_HELPER = $helper
    $env:AZRAEL_DEVIN_NODE = $node
    if ([string]::IsNullOrWhiteSpace($env:RUST_LOG)) { $env:RUST_LOG = 'error,devin_native_progress=info' }
    $env:AZRAEL_EX_DEVIN_EXECUTABLE = $devin
    $env:AZRAEL_EX_PLAINTEXT_AGENTS = '1'
    $env:WINDSURF_API_KEY = $null
    # Keep sandbox temporary write roots local to this state. Shared user Temp
    # can make restricted-token setup traverse a large unrelated directory.
    $nativeTemp = Join-Path $state 'tmp/devin-native'
    [IO.Directory]::CreateDirectory($nativeTemp) | Out-Null
    $env:TMP = $nativeTemp
    $env:TEMP = $nativeTemp
    $catalogText = (& $devin models list --format json 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $catalogText.Length -gt 8MB) { throw 'Unable to read the authenticated Devin catalog.' }
    $catalog = $catalogText | ConvertFrom-Json
    if (-not ($catalog.families.variants.model_uid -contains 'swe-2-high')) { throw 'The Devin catalog does not contain swe-2-high.' }
    $catalogPath = Join-Path $state 'azrael/devin/models.json'
    $catalogTemp = Join-Path $state ('azrael/devin/models-' + [guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($catalogTemp, $catalogText, [Text.UTF8Encoding]::new($false))
    [IO.File]::Move($catalogTemp, $catalogPath, $true)
    $engineArgs = @('-c', 'features.code_mode_host=true', '-c', 'features.multi_agent_v2.enabled=true', '-c', 'web_search="disabled"')
    if ($CodeMode) { $engineArgs += @('-c', 'features.code_mode=true') }
    if ($AppServer) { $engineArgs += 'app-server' }
    elseif ($ResumeThreadId) { $engineArgs += @('resume', $ResumeThreadId, '-m', 'devin/swe-2-high', '-C', $workspace) }
    else { $engineArgs += @('-m', 'devin/swe-2-high', '-C', $workspace) }
    & $engine @engineArgs
    $runExit = $LASTEXITCODE
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
exit $runExit
