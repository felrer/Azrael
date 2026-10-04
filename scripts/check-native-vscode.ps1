#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$HostVsixPath,
    [Parameter(Mandatory)][string]$FixtureRoot,
    [Parameter(Mandatory)][string]$StateRoot,
    [switch]$UseFreshState,
    [string]$CodePath = 'code.cmd'
)

$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathFullyQualified($FixtureRoot) -or (Test-Path -LiteralPath $FixtureRoot) -or
    -not [IO.Path]::IsPathFullyQualified($StateRoot)) { throw 'FixtureRoot must be new and both paths must be absolute.' }
$fixture = [IO.Path]::GetFullPath($FixtureRoot).TrimEnd('\', '/')
$state = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\', '/')
if (-not $state.StartsWith($fixture + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Fresh StateRoot must be inside FixtureRoot.'
}
$vsix = (Resolve-Path -LiteralPath $HostVsixPath).Path
$code = (Get-Command $CodePath -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$userData = Join-Path $fixture 'user-data'
$extensions = Join-Path $fixture 'extensions'
$workspace = Join-Path $fixture 'workspace'
$runner = Join-Path $fixture 'test-runner-extension'
New-Item -ItemType Directory -Path $fixture, $userData, $extensions, $workspace, $runner, $state -Force | Out-Null
[ordered]@{
    name = 'native-azrael-host-check'; publisher = 'azrael-validation'; version = '0.0.0'
    engines = [ordered]@{ vscode = '^1.96.0' }; main = './extension.cjs'; activationEvents = @('*')
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $runner 'package.json') -Encoding utf8NoBOM
@'
const vscode = require("vscode");
exports.activate = async function () {
  try { await require("./native-vscode-host-check.cjs").run(); }
  finally { await vscode.commands.executeCommand("workbench.action.closeWindow"); }
};
exports.deactivate = function () {};
'@ | Set-Content -LiteralPath (Join-Path $runner 'extension.cjs') -Encoding utf8NoBOM
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native-vscode-host-check.cjs') -Destination (Join-Path $runner 'native-vscode-host-check.cjs')
$installOutput = @(& $code --user-data-dir $userData --extensions-dir $extensions --install-extension $vsix --force 2>&1)
$installExit = $LASTEXITCODE
$installOutput | Set-Content -LiteralPath (Join-Path $fixture 'install.log') -Encoding utf8NoBOM
if ($installExit -ne 0) { throw "Fresh VS Code extension installation failed ($installExit)." }
$inventory = @(& $code --user-data-dir $userData --extensions-dir $extensions --list-extensions --show-versions)
if ($LASTEXITCODE -ne 0 -or @($inventory | Where-Object { $_ -match '^openai\.chatgpt@' }).Count) {
    throw 'Fresh profile inventory failed or contains official Codex.'
}
$installedHosts = @(Get-ChildItem -LiteralPath $extensions -Directory | Where-Object {
    $manifestPath = Join-Path $_.FullName 'package.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $false }
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        return $manifest.publisher -ceq 'azrael-ex-local' -and $manifest.name -ceq 'azrael'
    } catch { return $false }
})
if ($installedHosts.Count -ne 1) { throw 'Fresh profile did not contain exactly one native Azrael host.' }
$runtimePath = Join-Path $installedHosts[0].FullName 'azrael-runtime.json'
$runtimeBeforeSha256 = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash
$runtimeConfig = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json -AsHashtable
if ([string]$runtimeConfig.codexHome -ine $state) {
    if (-not $UseFreshState) { throw 'Packaged state differs from the fixture. Pass UseFreshState for an isolated test-only override.' }
    $runtimeConfig.codexHome = $state
    $runtimeConfig | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $runtimePath -Encoding utf8NoBOM
}
$saved = @{}
foreach ($entry in Get-ChildItem Env:) {
    if ($entry.Name -ceq 'CODEX_HOME' -or $entry.Name.StartsWith('AZRAEL_', [StringComparison]::Ordinal)) {
        $saved[$entry.Name] = $entry.Value
        Remove-Item -LiteralPath "Env:$($entry.Name)"
    }
}
try {
    $env:CODEX_HOME = Join-Path $fixture 'ordinary-codex'
    $env:AZRAEL_NATIVE_CHECK_ROOT = $fixture
    $env:AZRAEL_NATIVE_EXPECTED_STATE = $state
    $hostOutput = @(& $code --user-data-dir $userData --extensions-dir $extensions --new-window --wait --skip-welcome --skip-release-notes `
        --extensionDevelopmentPath $runner $workspace 2>&1)
    $hostExit = $LASTEXITCODE
    ($hostOutput | Out-String) | Set-Content -LiteralPath (Join-Path $fixture 'host.log') -Encoding utf8NoBOM
} finally {
    Remove-Item Env:AZRAEL_NATIVE_CHECK_ROOT, Env:AZRAEL_NATIVE_EXPECTED_STATE, Env:CODEX_HOME -ErrorAction SilentlyContinue
    foreach ($entry in $saved.GetEnumerator()) { Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value }
}
if ($hostExit -ne 0) { throw "Fresh VS Code native host exited with code $hostExit." }
$resultPath = Join-Path $fixture 'host-result.json'
if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
    $mainLogs = @(Get-ChildItem -LiteralPath (Join-Path $userData 'logs') -Filter main.log -File -Recurse -ErrorAction SilentlyContinue)
    if (@($mainLogs | Where-Object { Select-String -LiteralPath $_.FullName -Pattern 'Code is currently being updated' -Quiet }).Count) {
        throw 'VS Code is currently updating and refused to launch the fresh-profile host.'
    }
    throw 'Fresh VS Code native host result is missing; inspect host.log and the fixture user-data/logs.'
}
$result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
if ($result.passed -ne $true) { throw "Fresh VS Code native host failed: $($result.error)" }
[pscustomobject]@{
    Passed = $true; FixtureRoot = $fixture; HostResult = $resultPath
    HostLog = Join-Path $fixture 'host.log'; InstallLog = Join-Path $fixture 'install.log'
    HostVsixSha256 = (Get-FileHash -LiteralPath $vsix -Algorithm SHA256).Hash
    RuntimeOverride = [bool]$UseFreshState
    RuntimeBeforeSha256 = $runtimeBeforeSha256
    RuntimeAfterSha256 = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash
}
$global:LASTEXITCODE = 0
