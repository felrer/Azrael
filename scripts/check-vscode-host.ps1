[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$EnginePath,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$BridgePath,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$CompanionVsixPath,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$FixtureRoot,
    [string]$CodePath = 'code.cmd',
    [string]$OfficialExtensionPath = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.vscode/extensions/openai.chatgpt-26.908.40401-win32-x64')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-AbsoluteFile {
    param([string]$Path, [string]$Name)
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw "$Name must be an absolute path." }
    return (Resolve-Path -LiteralPath $Path).Path
}

if (-not [IO.Path]::IsPathFullyQualified($FixtureRoot)) { throw 'FixtureRoot must be an absolute path.' }
$fixture = [IO.Path]::GetFullPath($FixtureRoot)
if (Test-Path -LiteralPath $fixture) { throw "FixtureRoot must be a new path: $fixture" }

$engine = Assert-AbsoluteFile -Path $EnginePath -Name 'EnginePath'
$bridge = Assert-AbsoluteFile -Path $BridgePath -Name 'BridgePath'
$vsix = Assert-AbsoluteFile -Path $CompanionVsixPath -Name 'CompanionVsixPath'
$official = Assert-AbsoluteFile -Path $OfficialExtensionPath -Name 'OfficialExtensionPath'
$codeCommand = Get-Command $CodePath -ErrorAction Stop
$code = $codeCommand.Source
if (-not $code) { throw "CodePath did not resolve to an executable file: $CodePath" }

$launcher = Join-Path $PSScriptRoot 'start-azrael.ps1'
$testModule = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'vscode-host-check.cjs')).Path
$workspace = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
$instanceId = "host-$([guid]::NewGuid().ToString('N'))"
$resultPath = Join-Path $fixture 'host-result.json'
$logPath = Join-Path $fixture 'host.log'

try {
    $prepared = & $launcher -EnginePath $engine -BridgePath $bridge -OfficialExtensionPath $official -StateRoot $fixture -WorkspacePath $workspace -InstanceId $instanceId -PrepareOnly

    $installOutput = & $code --user-data-dir $prepared.EditorRoot --extensions-dir $prepared.ExtensionsDir --install-extension $vsix --force 2>&1
    $installExit = $LASTEXITCODE
    @($installOutput) | Set-Content -LiteralPath $logPath -Encoding utf8NoBOM
    if ($installExit -ne 0) { throw "Companion VSIX install failed with exit code $installExit. See $logPath" }

    $installed = & $code --user-data-dir $prepared.EditorRoot --extensions-dir $prepared.ExtensionsDir --list-extensions --show-versions 2>&1
    $listExit = $LASTEXITCODE
    @($installed) | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM
    if ($listExit -ne 0 -or $installed -notcontains 'openai.chatgpt@26.908.40401' -or -not ($installed -match '^azrael-ex-local\.azrael-ex@')) {
        throw "Fixture extension inventory did not contain the pinned official and companion extensions. See $logPath"
    }
    $companionCandidates = @(Get-ChildItem -LiteralPath $prepared.ExtensionsDir -Directory | Where-Object {
        $manifestPath = Join-Path $_.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $false }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
        return $manifest['publisher'] -ceq 'azrael-ex-local' -and $manifest['name'] -ceq 'azrael-ex'
    })
    if ($companionCandidates.Count -ne 1) { throw "Expected exactly one installed companion directory, found $($companionCandidates.Count)." }
    $companionExtension = $companionCandidates[0].FullName

    $runnerPath = Join-Path $fixture 'test-runner-extension'
    New-Item -ItemType Directory -Path $runnerPath | Out-Null
    [ordered]@{
        name = 'azrael-host-check'
        displayName = 'azrael host check'
        version = '0.0.0'
        publisher = 'azrael-ex-local'
        engines = [ordered]@{ vscode = '*' }
        main = './extension.cjs'
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $runnerPath 'package.json') -Encoding utf8NoBOM
    "exports.activate = function () {}; exports.deactivate = function () {};" | Set-Content -LiteralPath (Join-Path $runnerPath 'extension.cjs') -Encoding utf8NoBOM

    $socketRoot = Join-Path ([IO.Path]::GetTempPath()) "azh-$(([guid]::NewGuid().ToString('N')).Substring(0, 10))"
    $socket = Join-Path $socketRoot 'm.sock'
    $previous = @{
        CODEX_HOME = $env:CODEX_HOME
        AZRAEL_EX_MANAGEMENT_SOCKET = $env:AZRAEL_EX_MANAGEMENT_SOCKET
        AZRAEL_BRIDGE_BIN = $env:AZRAEL_BRIDGE_BIN
        AZRAEL_HOST_RESULT = $env:AZRAEL_HOST_RESULT
        AZRAEL_EXPECTED_ENGINE = $env:AZRAEL_EXPECTED_ENGINE
    }
    try {
        $env:CODEX_HOME = $fixture
        $env:AZRAEL_EX_MANAGEMENT_SOCKET = $socket
        $env:AZRAEL_BRIDGE_BIN = $bridge
        $env:AZRAEL_HOST_RESULT = $resultPath
        $env:AZRAEL_EXPECTED_ENGINE = $engine
        # VS Code extension-test mode loads development extensions instead of the
        # ordinary user inventory. Point it at the exact prepared official copy
        # and extracted VSIX companion so this remains an installed-artifact test.
        $hostOutput = & $code --user-data-dir $prepared.EditorRoot --extensions-dir $prepared.ExtensionsDir --new-window --skip-welcome --skip-release-notes --extensionDevelopmentPath $prepared.OfficialExtension --extensionDevelopmentPath $companionExtension --extensionDevelopmentPath $runnerPath --extensionTestsPath $testModule $workspace 2>&1
        $hostExit = $LASTEXITCODE
        @($hostOutput) | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM
    }
    finally {
        $env:CODEX_HOME = $previous.CODEX_HOME
        $env:AZRAEL_EX_MANAGEMENT_SOCKET = $previous.AZRAEL_EX_MANAGEMENT_SOCKET
        $env:AZRAEL_BRIDGE_BIN = $previous.AZRAEL_BRIDGE_BIN
        $env:AZRAEL_HOST_RESULT = $previous.AZRAEL_HOST_RESULT
        $env:AZRAEL_EXPECTED_ENGINE = $previous.AZRAEL_EXPECTED_ENGINE
    }

    if ($hostExit -ne 0) { throw "VS Code extension-host check failed with exit code $hostExit. See $logPath" }
    $resultDeadline = [DateTime]::UtcNow.AddSeconds(90)
    $result = $null
    while ($null -eq $result -and [DateTime]::UtcNow -lt $resultDeadline) {
        if (Test-Path -LiteralPath $resultPath -PathType Leaf) {
            try {
                $candidate = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json -AsHashtable
                if ($null -ne $candidate -and $candidate.ContainsKey('passed')) { $result = $candidate }
            }
            catch { <# The test may still be completing its atomic-sized write. #> }
        }
        if ($null -eq $result) { Start-Sleep -Milliseconds 250 }
    }
    if ($null -eq $result) { throw "VS Code host exited without writing a complete $resultPath. See $logPath" }
    if ($result['passed'] -ne $true) { throw "VS Code host reported failure: $($result['error'])" }

    [pscustomobject]@{
        Passed = $true
        FixtureRoot = $fixture
        Result = $resultPath
        Log = $logPath
        OfficialVersion = $result['official']['version']
        CompanionVersion = $result['companion']['version']
        InstanceId = $result['engine']['instanceId']
    }
}
catch {
    if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
        $_.Exception.Message | Set-Content -LiteralPath $logPath -Encoding utf8NoBOM
    }
    throw
}
