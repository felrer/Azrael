#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$HostVsixPath,
    [string]$OriginalExtensionPath = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.vscode/extensions/openai.chatgpt-26.1007.21434-win32-x64'),
    [string]$UiSourcePath,
    [string]$OriginalAudioPath = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.vscode/extensions/openai.codex-audio-26.1007.21434'),
    [string]$StateRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.azrael-ex'),
    [switch]$UseFreshState,
    [string]$CodePath = 'code.cmd',
    [string]$FixtureRoot,
    [string]$TypeScriptPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/build/integrated_accounts_20260913/companion/node_modules/typescript/lib/typescript.js')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
if (-not $FixtureRoot) { $FixtureRoot = Join-Path $projectRoot "artifacts/verification/same-window-$stamp" }
if (-not [IO.Path]::IsPathFullyQualified($FixtureRoot)) { throw 'FixtureRoot must be an absolute path.' }
$fixture = [IO.Path]::GetFullPath($FixtureRoot).TrimEnd('\', '/')
if (Test-Path -LiteralPath $fixture) { throw "FixtureRoot must be a new path: $fixture" }

function Resolve-File {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Name)
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw "$Name must be absolute." }
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) { throw "$Name must be a file: $Path" }
    $resolved.Path
}

function Resolve-Directory {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Name)
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw "$Name must be absolute." }
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Container)) { throw "$Name must be a directory: $Path" }
    $resolved.Path
}

. (Join-Path $PSScriptRoot 'directory-state.ps1')

function Get-DirectoryState {
    param([Parameter(Mandatory)][string]$Path)
    Get-AzraelDirectoryState -Path $Path
}

function Find-InstalledExtension {
    param([Parameter(Mandatory)][string]$ExtensionsDir, [Parameter(Mandatory)][string]$Id, [Parameter(Mandatory)][string]$Version)
    $matches = foreach ($directory in @(Get-ChildItem -LiteralPath $ExtensionsDir -Directory)) {
        $manifestPath = Join-Path $directory.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { continue }
        try { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { continue }
        if ("$($manifest.publisher).$($manifest.name)" -ceq $Id -and [string]$manifest.version -ceq $Version) { $directory.FullName }
    }
    $matches = @($matches)
    if ($matches.Count -ne 1) { throw "Expected one installed $Id@$Version directory, found $($matches.Count)." }
    $matches[0]
}

$hostVsix = Resolve-File -Path $HostVsixPath -Name 'HostVsixPath'
$hostVsixSha256 = (Get-FileHash -LiteralPath $hostVsix -Algorithm SHA256).Hash.ToLowerInvariant()
$originalSource = Resolve-Directory -Path $OriginalExtensionPath -Name 'OriginalExtensionPath'
$audioSource = Resolve-Directory -Path $OriginalAudioPath -Name 'OriginalAudioPath'
$uiSource = if ($UiSourcePath) { Resolve-Directory -Path $UiSourcePath -Name 'UiSourcePath' } else { $originalSource }
$originalManifest = Get-Content -LiteralPath (Join-Path $originalSource 'package.json') -Raw | ConvertFrom-Json
$audioManifest = Get-Content -LiteralPath (Join-Path $audioSource 'package.json') -Raw | ConvertFrom-Json
$originalVersion = [string]$originalManifest.version
$audioVersion = [string]$audioManifest.version
if ("$($originalManifest.publisher).$($originalManifest.name)" -cne 'openai.chatgpt' -or
    $originalVersion -notmatch '^\d+\.\d+\.\d+$' -or
    @($originalManifest.extensionPack).Count -ne 1 -or [string]$originalManifest.extensionPack[0] -cne 'openai.codex-audio' -or
    "$($audioManifest.publisher).$($audioManifest.name)" -cne 'openai.codex-audio' -or $audioVersion -cne $originalVersion) {
    throw 'Selected official Codex and audio must have matching versions and the expected extension-pack entry.'
}
$typescript = Resolve-File -Path $TypeScriptPath -Name 'TypeScriptPath'
$state = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\', '/')
$fixturePrefix = $fixture + [IO.Path]::DirectorySeparatorChar
if ($UseFreshState -and -not $state.StartsWith($fixturePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'UseFreshState requires StateRoot to be inside the new FixtureRoot.'
}
$ordinaryCodexHome = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex')).TrimEnd('\', '/')
if ($state -ieq $ordinaryCodexHome -or $state.StartsWith($ordinaryCodexHome + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'StateRoot must not use ordinary Codex state.'
}
$codeCommand = Get-Command $CodePath -CommandType Application -ErrorAction Stop | Select-Object -First 1
$code = $codeCommand.Source
if (-not $code) { throw "CodePath did not resolve to an executable: $CodePath" }

$logDirectory = Join-Path $projectRoot 'artifacts/logs/same-window-validation'
$logPath = Join-Path $logDirectory "same-window-$stamp.log"
$namespaceLog = Join-Path $logDirectory "namespace-$stamp.log"
$resultPath = Join-Path $fixture 'host-result.json'
$standaloneResultPath = Join-Path $fixture 'standalone-host-result.json'
$summaryPath = Join-Path $fixture 'check-result.json'
$userData = Join-Path $fixture 'user-data'
$standaloneUserData = Join-Path $fixture 'standalone-user-data'
$coexistenceUserData = Join-Path $fixture 'coexistence-user-data'
$fixtureOrdinaryHome = Join-Path $fixture 'original-state'
$extensions = Join-Path $fixture 'extensions'
$workspace = Join-Path $fixture 'workspace'
New-Item -ItemType Directory -Path $logDirectory, (Join-Path $userData 'User'), `
    (Join-Path $standaloneUserData 'User'), (Join-Path $coexistenceUserData 'User'), $fixtureOrdinaryHome, $extensions, $workspace -Force | Out-Null

$exitCodes = [ordered]@{ initialInventory = $null; hostInstall = $null; finalInventory = $null; namespace = $null; standaloneHost = $null; host = $null }
$sourceBefore = Get-DirectoryState -Path $originalSource
$audioBefore = Get-DirectoryState -Path $audioSource
$originalFixture = Join-Path $extensions (Split-Path $originalSource -Leaf)
$audioFixture = Join-Path $extensions (Split-Path $audioSource -Leaf)
$runtimeConfigOverride = $null
try {
    & robocopy.exe $originalSource $originalFixture /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "Pristine original fixture copy failed with exit code $LASTEXITCODE." }
    $global:LASTEXITCODE = 0
    $fixtureOriginalBefore = Get-DirectoryState -Path $originalFixture
    if ($fixtureOriginalBefore.sha256 -cne $sourceBefore.sha256) { throw 'Pristine original fixture copy hash differed from its source.' }
    & robocopy.exe $audioSource $audioFixture /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "Official audio dependency fixture copy failed with exit code $LASTEXITCODE." }
    $global:LASTEXITCODE = 0
    $fixtureAudioBefore = Get-DirectoryState -Path $audioFixture
    if ($fixtureAudioBefore.sha256 -cne $audioBefore.sha256) { throw 'Official audio dependency fixture hash differed from its source.' }

    $initial = @(& $code --user-data-dir $userData --extensions-dir $extensions --list-extensions --show-versions 2>&1)
    $exitCodes.initialInventory = $LASTEXITCODE
    @($initial) | Set-Content -LiteralPath $logPath -Encoding utf8NoBOM
    if ($exitCodes.initialInventory -ne 0 -or $initial -notcontains "openai.chatgpt@$originalVersion" -or
        $initial -notcontains "openai.codex-audio@$audioVersion") {
        throw "Initial fixture inventory did not contain selected official Codex and audio dependency (exit $($exitCodes.initialInventory))."
    }

    $hostInstall = @(& $code --user-data-dir $userData --extensions-dir $extensions --install-extension $hostVsix 2>&1)
    $exitCodes.hostInstall = $LASTEXITCODE
    @($hostInstall) | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM
    if ($exitCodes.hostInstall -ne 0) { throw "Independent host VSIX install failed with exit code $($exitCodes.hostInstall)." }

    $inventory = @(& $code --user-data-dir $userData --extensions-dir $extensions --list-extensions --show-versions 2>&1)
    $exitCodes.finalInventory = $LASTEXITCODE
    @($inventory) | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM
    if ($inventory -notcontains "openai.chatgpt@$originalVersion" -or $inventory -notcontains "openai.codex-audio@$audioVersion") {
        throw "Final fixture inventory omitted selected official Codex or audio dependency (exit $($exitCodes.finalInventory))."
    }
    if (@($inventory | Where-Object { $_ -match '^azrael-ex-local\.azrael-ex@' }).Count -ne 0) { throw 'Final fixture inventory contained the retired companion extension.' }
    if ($exitCodes.finalInventory -ne 0) { throw "Final fixture inventory failed with exit code $($exitCodes.finalInventory)." }
    $hostInventory = @($inventory | Where-Object { $_ -match '^azrael-ex-local\.azrael@((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))$' })
    if ($hostInventory.Count -ne 1) { throw "Expected one independently versioned azrael host inventory entry, found $($hostInventory.Count)." }
    $hostVersion = ([regex]::Match($hostInventory[0], '^azrael-ex-local\.azrael@(.+)$')).Groups[1].Value
    foreach ($component in $hostVersion.Split('.')) {
        [long]$numericComponent = 0
        if (-not [long]::TryParse($component, [ref]$numericComponent) -or $numericComponent -gt 9007199254740991) {
            throw 'Host inventory version components must be safe integers.'
        }
    }

    $installedHost = Find-InstalledExtension -ExtensionsDir $extensions -Id 'azrael-ex-local.azrael' -Version $hostVersion
    $namespaceOutput = @(& node (Join-Path $PSScriptRoot 'test-independent-namespace.cjs') $uiSource $installedHost $typescript 2>&1)
    $exitCodes.namespace = $LASTEXITCODE
    @($namespaceOutput) | Set-Content -LiteralPath $namespaceLog -Encoding utf8NoBOM
    if ($exitCodes.namespace -ne 0) { throw "Independent namespace targeted contract failed with exit code $($exitCodes.namespace)." }

    $runtimeConfigPath = Join-Path $installedHost 'out/azrael-runtime.json'
    $runtimeConfigBeforeText = Get-Content -LiteralPath $runtimeConfigPath -Raw
    $runtimeConfigBefore = $runtimeConfigBeforeText | ConvertFrom-Json -AsHashtable
    $runtimeConfigBeforeHash = (Get-FileHash -LiteralPath $runtimeConfigPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $runtimeConfigOverride = [ordered]@{
        applied = $false; path = $runtimeConfigPath; changedField = $null
        beforeSha256 = $runtimeConfigBeforeHash; afterSha256 = $runtimeConfigBeforeHash
        beforeCodexHome = [string]$runtimeConfigBefore['codexHome']; afterCodexHome = [string]$runtimeConfigBefore['codexHome']
        engineUnchanged = $true; bridgeUnchanged = $true
    }
    $packagedState = [IO.Path]::GetFullPath([string]$runtimeConfigBefore['codexHome']).TrimEnd('\', '/')
    if (-not ($packagedState -ieq $state) -and -not $UseFreshState) {
        throw 'StateRoot differs from the packaged runtime. Pass UseFreshState with a fixture-owned StateRoot for an explicit test-only config override.'
    }
    if (-not ($packagedState -ieq $state)) {
        $runtimeConfigAfter = [ordered]@{}
        foreach ($key in $runtimeConfigBefore.Keys) { $runtimeConfigAfter[$key] = $runtimeConfigBefore[$key] }
        $runtimeConfigAfter['codexHome'] = $state
        $runtimeConfigAfter | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $runtimeConfigPath -Encoding utf8NoBOM
        $verifiedConfig = Get-Content -LiteralPath $runtimeConfigPath -Raw | ConvertFrom-Json -AsHashtable
        $changedKeys = @($runtimeConfigBefore.Keys | Where-Object { [string]$runtimeConfigBefore[$_] -cne [string]$verifiedConfig[$_] })
        if ($changedKeys.Count -ne 1 -or $changedKeys[0] -cne 'codexHome') { throw 'Test runtime config override changed fields other than codexHome.' }
        if ([string]$verifiedConfig['engine'] -cne [string]$runtimeConfigBefore['engine'] -or [string]$verifiedConfig['bridge'] -cne [string]$runtimeConfigBefore['bridge']) {
            throw 'Test runtime config override changed the engine pair.'
        }
        $runtimeConfigOverride.applied = $true
        $runtimeConfigOverride.changedField = 'codexHome'
        $runtimeConfigOverride.afterSha256 = (Get-FileHash -LiteralPath $runtimeConfigPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $runtimeConfigOverride.afterCodexHome = [string]$verifiedConfig['codexHome']
    }
    New-Item -ItemType Directory -Path $state -Force | Out-Null

    $runner = Join-Path $fixture 'test-runner-extension'
    New-Item -ItemType Directory -Path $runner | Out-Null
    [ordered]@{
        name = 'same-window-host-check'; publisher = 'azrael-validation'; version = '0.0.0'
        engines = [ordered]@{ vscode = '^1.96.2' }; main = './extension.cjs'; activationEvents = @('*')
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $runner 'package.json') -Encoding utf8NoBOM
    @'
const vscode = require("vscode");
exports.activate = async function () {
  try { await require("./independent-vscode-host-check.cjs").run(); }
  finally { await vscode.commands.executeCommand("workbench.action.closeWindow"); }
};
exports.deactivate = function () {};
'@ | Set-Content -LiteralPath (Join-Path $runner 'extension.cjs') -Encoding utf8NoBOM
    $runnerTest = Join-Path $runner 'independent-vscode-host-check.cjs'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'independent-vscode-host-check.cjs') -Destination $runnerTest

    $savedEnvironment = @{}
    foreach ($entry in Get-ChildItem Env:) {
        if ($entry.Name -ceq 'CODEX_HOME' -or $entry.Name.StartsWith('AZRAEL_', [StringComparison]::Ordinal) -or $entry.Name.StartsWith('SAME_WINDOW_', [StringComparison]::Ordinal)) {
            $savedEnvironment[$entry.Name] = $entry.Value
            Remove-Item -LiteralPath "Env:$($entry.Name)"
        }
    }
    try {
        $env:CODEX_HOME = $fixtureOrdinaryHome
        $env:SAME_WINDOW_CHECK_ROOT = $fixture
        $env:SAME_WINDOW_EXPECTED_STATE_ROOT = $state
        $env:SAME_WINDOW_EXPECTED_ORDINARY_HOME = $fixtureOrdinaryHome
        $env:SAME_WINDOW_EXPECTED_HOST_VERSION = $hostVersion
        $env:SAME_WINDOW_EXPECTED_ORIGINAL_VERSION = $originalVersion
        # Only the test runner is a development extension. The original and
        # integrated host activate as installed, without proposed-API elevation.
        $env:SAME_WINDOW_CHECK_MODE = 'standalone'
        # The generated test workspace is owned by this fixture. Test normal trusted
        # activation without changing trust settings in any user profile.
        $standaloneOutput = @(& $code --disable-updates --disable-workspace-trust --user-data-dir $standaloneUserData --extensions-dir $extensions --new-window --wait --skip-welcome --skip-release-notes `
            --disable-extension 'openai.chatgpt' --extensionDevelopmentPath $runner $workspace 2>&1)
        $exitCodes.standaloneHost = $LASTEXITCODE
        @($standaloneOutput) | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM
        if ($exitCodes.standaloneHost -ne 0) { throw "Standalone integrated-host check failed with exit code $($exitCodes.standaloneHost)." }
        if (-not (Test-Path -LiteralPath $standaloneResultPath -PathType Leaf)) { throw 'Standalone host result was not written.' }
        $standaloneResult = Get-Content -LiteralPath $standaloneResultPath -Raw | ConvertFrom-Json -AsHashtable
        if ($standaloneResult['passed'] -ne $true) { throw "Standalone host result failed: $($standaloneResult['error'])" }

        $env:SAME_WINDOW_CHECK_MODE = 'coexistence'
        $hostOutput = @(& $code --disable-updates --disable-workspace-trust --user-data-dir $coexistenceUserData --extensions-dir $extensions --new-window --wait --skip-welcome --skip-release-notes `
            --extensionDevelopmentPath $runner $workspace 2>&1)
        $exitCodes.host = $LASTEXITCODE
        @($hostOutput) | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM
    } finally {
        Remove-Item Env:SAME_WINDOW_CHECK_ROOT -ErrorAction SilentlyContinue
        Remove-Item Env:SAME_WINDOW_EXPECTED_STATE_ROOT -ErrorAction SilentlyContinue
        Remove-Item Env:SAME_WINDOW_EXPECTED_ORDINARY_HOME -ErrorAction SilentlyContinue
        Remove-Item Env:SAME_WINDOW_EXPECTED_HOST_VERSION -ErrorAction SilentlyContinue
        Remove-Item Env:SAME_WINDOW_EXPECTED_ORIGINAL_VERSION -ErrorAction SilentlyContinue
        Remove-Item Env:SAME_WINDOW_CHECK_MODE -ErrorAction SilentlyContinue
        Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
        foreach ($entry in $savedEnvironment.GetEnumerator()) { Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value }
    }
    if ($exitCodes.host -ne 0) { throw "Same-window VS Code extension-host check failed with exit code $($exitCodes.host)." }
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not (Test-Path -LiteralPath $resultPath -PathType Leaf) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
    if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) { throw 'Same-window host result was not written.' }
    $hostResult = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json -AsHashtable
    if ($hostResult['passed'] -ne $true) { throw "Same-window host result failed: $($hostResult['error'])" }

    $sourceAfter = Get-DirectoryState -Path $originalSource
    $fixtureOriginalAfter = Get-DirectoryState -Path $originalFixture
    if ($sourceAfter.sha256 -cne $sourceBefore.sha256 -or $sourceAfter.fileCount -ne $sourceBefore.fileCount -or $sourceAfter.bytes -ne $sourceBefore.bytes -or
        $fixtureOriginalAfter.sha256 -cne $fixtureOriginalBefore.sha256 -or $fixtureOriginalAfter.fileCount -ne $fixtureOriginalBefore.fileCount -or $fixtureOriginalAfter.bytes -ne $fixtureOriginalBefore.bytes) {
        throw 'Actual host validation changed original Codex files.'
    }
    $summary = [ordered]@{
        passed = $true; fixtureRoot = $fixture; standaloneHostResult = $standaloneResultPath; hostResult = $resultPath; log = $logPath; namespaceLog = $namespaceLog
        exitCodes = $exitCodes; inventory = $inventory; useFreshState = [bool]$UseFreshState
        uiSourcePath = $uiSource; officialVersions = [ordered]@{ codex = $originalVersion; audio = $audioVersion }
        hostPackage = [ordered]@{ vsix = $hostVsix; sha256 = $hostVsixSha256; version = $hostVersion; installedPath = $installedHost }
        runtimeConfigOverride = $runtimeConfigOverride
        originalSource = [ordered]@{ before = $sourceBefore; after = $sourceAfter; unchanged = $true }
        originalFixture = [ordered]@{ before = $fixtureOriginalBefore; after = $fixtureOriginalAfter; unchanged = $true }
        loginPerformed = $false; modelRequestPerformed = $false; newThreadPerformed = $false; testObjectMutationPerformed = $false
    }
    $summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summaryPath -Encoding utf8NoBOM
    [pscustomobject]$summary
    $global:LASTEXITCODE = 0
} catch {
    $failure = $_
    if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) { $failure.Exception.ToString() | Set-Content -LiteralPath $logPath -Encoding utf8NoBOM }
    $failureResult = [ordered]@{
        passed = $false; fixtureRoot = $fixture; log = $logPath; namespaceLog = $namespaceLog; exitCodes = $exitCodes; useFreshState = [bool]$UseFreshState
        hostPackage = [ordered]@{ vsix = $hostVsix; sha256 = $hostVsixSha256 }; runtimeConfigOverride = $runtimeConfigOverride
        uiSourcePath = $uiSource; officialVersions = [ordered]@{ codex = $originalVersion; audio = $audioVersion }
        error = $failure.Exception.Message; loginPerformed = $false; modelRequestPerformed = $false; newThreadPerformed = $false; testObjectMutationPerformed = $false
    }
    $failureResult | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summaryPath -Encoding utf8NoBOM
    throw
}
