#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$ReleaseDirectory,
    [Parameter(Mandatory)][string]$FixtureRoot,
    [string]$CodePath = 'code.cmd',
    [string]$OfficialExtensionPath = 'C:\Users\felre\.vscode\extensions\openai.chatgpt-26.908.40401-win32-x64',
    [string]$ExtensionsDir = (Join-Path $env:USERPROFILE '.vscode/extensions'),
    [switch]$InstalledOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-AbsoluteFile([string]$Path, [string]$Name) {
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw "$Name must be absolute." }
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "$Name is not a file: $resolved" }
    return $resolved
}

function Wait-HostResult([string]$Path, [int]$TimeoutMilliseconds = 45000) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $Path -PathType Leaf) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "Host check wrote no result within $TimeoutMilliseconds ms: $Path"
}

if (-not [IO.Path]::IsPathFullyQualified($FixtureRoot)) { throw 'FixtureRoot must be absolute.' }
$fixture = [IO.Path]::GetFullPath($FixtureRoot)
if (Test-Path -LiteralPath $fixture) { throw "FixtureRoot must be new: $fixture" }
$officialSource = (Resolve-Path -LiteralPath $OfficialExtensionPath).Path
$codeCommand = Get-Command $CodePath -ErrorAction Stop
$code = $codeCommand.Source
if (-not $code) { throw "CodePath did not resolve: $CodePath" }
$installer = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'install-existing-vscode.ps1')).Path
$testModule = Resolve-AbsoluteFile (Join-Path $PSScriptRoot 'existing-vscode-host-check.cjs') 'Host test module'
$workspace = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path

$userData = Join-Path $fixture 'user-data'
$extensions = Join-Path $fixture 'extensions'
$logDirectory = Join-Path $workspace 'artifacts/logs/ordinary-vscode'
$logPath = Join-Path $logDirectory ("$([IO.Path]::GetFileName($fixture))-check.log")
$resultPath = Join-Path $fixture 'host-result.json'
New-Item -ItemType Directory -Path (Join-Path $userData 'User'), $extensions, $logDirectory -Force | Out-Null

if ($InstalledOnly) {
    $installedExtensions = (Resolve-Path -LiteralPath $ExtensionsDir).Path
    $officialInstalled = $officialSource
    $companionInstalled = @(Get-ChildItem -LiteralPath $installedExtensions -Directory | Where-Object {
        $manifestPath = Join-Path $_.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $manifestPath)) { return $false }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        return $manifest.publisher -ceq 'azrael-ex-local' -and $manifest.name -ceq 'azrael-ex' -and $manifest.version -ceq '0.1.0'
    })
    if ($companionInstalled.Count -ne 1) { throw "Expected one installed companion 0.1.0, found $($companionInstalled.Count)." }
    '{ "extensions.autoUpdate": true }' | Set-Content -LiteralPath (Join-Path $userData 'User/settings.json') -Encoding utf8NoBOM
    $runner = Join-Path $fixture 'test-runner-extension'
    New-Item -ItemType Directory -Path $runner | Out-Null
    [ordered]@{ name = 'ordinary-host-check'; publisher = 'azrael-ex-local'; version = '0.0.0'; engines = [ordered]@{ vscode = '*' }; main = './extension.cjs' } |
        ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $runner 'package.json') -Encoding utf8NoBOM
    'exports.activate = function () {}; exports.deactivate = function () {};' | Set-Content -LiteralPath (Join-Path $runner 'extension.cjs') -Encoding utf8NoBOM
    $runnerTestModule = Join-Path $runner 'existing-vscode-host-check.cjs'
    Copy-Item -LiteralPath $testModule -Destination $runnerTestModule

    $savedEnvironment = @{}
    foreach ($entry in Get-ChildItem Env:) {
        if ($entry.Name -ceq 'CODEX_HOME' -or $entry.Name.StartsWith('AZRAEL_', [StringComparison]::Ordinal)) {
            $savedEnvironment[$entry.Name] = $entry.Value
            Remove-Item -LiteralPath "Env:$($entry.Name)"
        }
    }
    $previousCheckRoot = $env:ORDINARY_VSCODE_CHECK_ROOT
    try {
        $env:ORDINARY_VSCODE_CHECK_ROOT = $fixture
        $hostOutput = @(& $code --user-data-dir $userData --extensions-dir $installedExtensions --new-window --skip-welcome --skip-release-notes `
            --extensionDevelopmentPath $officialInstalled --extensionDevelopmentPath $companionInstalled[0].FullName `
            --extensionDevelopmentPath $runner --extensionTestsPath $runnerTestModule $workspace 2>&1)
        $hostExit = $LASTEXITCODE
        @($hostOutput) | Set-Content -LiteralPath $logPath -Encoding utf8NoBOM
    }
    finally {
        if ($null -eq $previousCheckRoot) { Remove-Item Env:ORDINARY_VSCODE_CHECK_ROOT -ErrorAction SilentlyContinue } else { $env:ORDINARY_VSCODE_CHECK_ROOT = $previousCheckRoot }
        foreach ($entry in $savedEnvironment.GetEnumerator()) { Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value }
    }
    if ($hostExit -ne 0) { throw "Installed ordinary VS Code host check failed with exit code $hostExit. See $logPath" }
    Wait-HostResult -Path $resultPath
    $hostResult = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json -AsHashtable
    if ($hostResult['passed'] -ne $true) { throw "Installed host check failed: $($hostResult['error'])" }

    $pinEvidence = $null
    $metadataPath = Join-Path $installedExtensions 'extensions.json'
    if (Test-Path -LiteralPath $metadataPath) {
        $officialMetadata = @(Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json | Where-Object { $_.identifier.id -ceq 'openai.chatgpt' })
        if ($officialMetadata.Count -eq 1) {
            $metadata = $officialMetadata[0].metadata
            $pinEvidence = [ordered]@{
                pinned = if ($metadata.PSObject.Properties['pinned']) { $metadata.pinned } else { $null }
                isPinned = if ($metadata.PSObject.Properties['isPinned']) { $metadata.isPinned } else { $null }
                source = if ($metadata.PSObject.Properties['source']) { $metadata.source } else { $null }
            }
        }
    }
    $summary = [ordered]@{ passed = $true; installedOnly = $true; official = $officialInstalled; companion = $companionInstalled[0].FullName; pinEvidence = $pinEvidence; hostResult = $resultPath; log = $logPath; loginPerformed = $false; modelRequestPerformed = $false }
    $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $fixture 'check-result.json') -Encoding utf8NoBOM
    [pscustomobject]$summary
    $global:LASTEXITCODE = 0
    return
}

if (-not $ReleaseDirectory) { throw 'ReleaseDirectory is required unless InstalledOnly is used.' }
$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path

try {
    # JSONC intentionally exercises comments, trailing commas and unrelated values.
    $settingsPath = Join-Path $userData 'User/settings.json'
    @'
{
  // fixture preference that deployment must preserve byte-for-byte
  "editor.fontSize": 17,
  "extensions.autoUpdate": true,
}
'@ | Set-Content -LiteralPath $settingsPath -Encoding utf8NoBOM -NoNewline
    $settingsBefore = [IO.File]::ReadAllBytes($settingsPath)

    $officialDestination = Join-Path $extensions 'openai.chatgpt-26.908.40401-win32-x64'
    & robocopy.exe $officialSource $officialDestination /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "Pinned official fixture copy failed with exit code $LASTEXITCODE." }
    $global:LASTEXITCODE = 0

    $unrelatedDirectory = Join-Path $extensions 'fixture.unrelated-1.2.3'
    New-Item -ItemType Directory -Path $unrelatedDirectory | Out-Null
    [ordered]@{
        name = 'unrelated'; publisher = 'fixture'; version = '1.2.3'; engines = [ordered]@{ vscode = '*' }; main = './extension.cjs'
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $unrelatedDirectory 'package.json') -Encoding utf8NoBOM
    'exports.activate = function () {}; exports.deactivate = function () {};' | Set-Content -LiteralPath (Join-Path $unrelatedDirectory 'extension.cjs') -Encoding utf8NoBOM

    $before = @(& $code --user-data-dir $userData --extensions-dir $extensions --list-extensions --show-versions 2>&1)
    $beforeExit = $LASTEXITCODE
    @($before) | Set-Content -LiteralPath $logPath -Encoding utf8NoBOM
    if ($beforeExit -ne 0 -or $before -notcontains 'openai.chatgpt@26.908.40401' -or $before -notcontains 'fixture.unrelated@1.2.3') {
        throw "Fixture inventory setup failed with exit code $beforeExit. See $logPath"
    }

    $installOutput = @(& $installer -ReleaseDirectory $release -StateRoot (Join-Path $fixture 'state') -CodePath $code -UserDataDir $userData -ExtensionsDir $extensions -NoLaunch 2>&1)
    $installExit = $LASTEXITCODE
    @($installOutput) | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM
    if ($installExit -ne 0) { throw "Fixture existing-VSCode installer failed with exit code $installExit. See $logPath" }
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($settingsPath)) -cne [Convert]::ToBase64String($settingsBefore)) { throw 'Installer changed unrelated JSONC settings.' }

    $after = @(& $code --user-data-dir $userData --extensions-dir $extensions --list-extensions --show-versions 2>&1)
    $afterExit = $LASTEXITCODE
    @($after) | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM
    if ($afterExit -ne 0) { throw "Post-install fixture inventory failed with exit code $afterExit." }
    foreach ($entry in $before) { if ($after -notcontains $entry) { throw "Installer removed or changed an existing extension: $entry" } }
    if ($after -notcontains 'fixture.unrelated@1.2.3') { throw 'Unrelated fixture extension was not preserved.' }
    if ($after -notmatch '^azrael-ex-local\.azrael-ex@') { throw 'Installed companion was not listed.' }

    $metadataPath = Join-Path $extensions 'extensions.json'
    $metadata = @(Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json)
    $officialMetadata = @($metadata | Where-Object { $_.identifier.id -ceq 'openai.chatgpt' })
    if ($officialMetadata.Count -ne 1) { throw "Expected one official extensions.json entry, found $($officialMetadata.Count)." }
    $pin = $officialMetadata[0].metadata
    $pinnedValue = if ($pin.PSObject.Properties['pinned']) { $pin.pinned } else { $null }
    $isPinnedValue = if ($pin.PSObject.Properties['isPinned']) { $pin.isPinned } else { $null }
    $sourceValue = if ($pin.PSObject.Properties['source']) { $pin.source } else { $null }
    $pinned = $pinnedValue -eq $true -or $isPinnedValue -eq $true
    $userVsix = $sourceValue -in @('vsix', 'user')
    if (-not ($pinned -or $userVsix)) {
        throw "VSIX-installed official extension is not pinned: pinned=$pinnedValue, isPinned=$isPinnedValue, source=$sourceValue."
    }

    $officialInstalled = @(Get-ChildItem -LiteralPath $extensions -Directory | Where-Object {
        $manifestPath = Join-Path $_.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $manifestPath)) { return $false }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        return $manifest.publisher -ceq 'openai' -and $manifest.name -ceq 'chatgpt' -and $manifest.version -ceq '26.908.40401'
    })
    $companionInstalled = @(Get-ChildItem -LiteralPath $extensions -Directory | Where-Object {
        $manifestPath = Join-Path $_.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $manifestPath)) { return $false }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        return $manifest.publisher -ceq 'azrael-ex-local' -and $manifest.name -ceq 'azrael-ex'
    })
    if ($officialInstalled.Count -ne 1 -or $companionInstalled.Count -ne 1) { throw 'Could not uniquely resolve installed fixture extensions.' }

    $runtimeConfig = Get-Content -LiteralPath (Join-Path $officialInstalled[0].FullName 'out/azrael-runtime.json') -Raw | ConvertFrom-Json
    $redirectOutput = Join-Path $fixture 'isolated-source-redirect'
    $redirect = & (Join-Path $PSScriptRoot 'prepare-official-ui.ps1') -SourceExtensionPath $officialInstalled[0].FullName -ExtensionsDir $redirectOutput
    if (-not ([IO.Path]::GetFullPath($redirect.Source) -ieq [IO.Path]::GetFullPath($runtimeConfig.originalExtension))) {
        throw 'Isolated official preparation did not redirect the patched ordinary installation to its pristine source.'
    }

    $runner = Join-Path $fixture 'test-runner-extension'
    New-Item -ItemType Directory -Path $runner | Out-Null
    [ordered]@{ name = 'ordinary-host-check'; publisher = 'azrael-ex-local'; version = '0.0.0'; engines = [ordered]@{ vscode = '*' }; main = './extension.cjs' } |
        ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $runner 'package.json') -Encoding utf8NoBOM
    'exports.activate = function () {}; exports.deactivate = function () {};' | Set-Content -LiteralPath (Join-Path $runner 'extension.cjs') -Encoding utf8NoBOM
    $runnerTestModule = Join-Path $runner 'existing-vscode-host-check.cjs'
    Copy-Item -LiteralPath $testModule -Destination $runnerTestModule

    $savedEnvironment = @{}
    foreach ($entry in Get-ChildItem Env:) {
        if ($entry.Name -ceq 'CODEX_HOME' -or $entry.Name.StartsWith('AZRAEL_', [StringComparison]::Ordinal)) {
            $savedEnvironment[$entry.Name] = $entry.Value
            Remove-Item -LiteralPath "Env:$($entry.Name)"
        }
    }
    $previousCheckRoot = $env:ORDINARY_VSCODE_CHECK_ROOT
    try {
        $env:ORDINARY_VSCODE_CHECK_ROOT = $fixture
        $hostOutput = @(& $code --user-data-dir $userData --extensions-dir $extensions --new-window --skip-welcome --skip-release-notes `
            --extensionDevelopmentPath $officialInstalled[0].FullName --extensionDevelopmentPath $companionInstalled[0].FullName `
            --extensionDevelopmentPath $runner --extensionTestsPath $runnerTestModule $workspace 2>&1)
        $hostExit = $LASTEXITCODE
        @($hostOutput) | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM
    }
    finally {
        if ($null -eq $previousCheckRoot) { Remove-Item Env:ORDINARY_VSCODE_CHECK_ROOT -ErrorAction SilentlyContinue } else { $env:ORDINARY_VSCODE_CHECK_ROOT = $previousCheckRoot }
        foreach ($entry in $savedEnvironment.GetEnumerator()) { Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value }
    }
    if ($hostExit -ne 0) { throw "Ordinary VS Code extension-host check failed with exit code $hostExit. See $logPath" }
    Wait-HostResult -Path $resultPath
    $hostResult = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json -AsHashtable
    if ($hostResult['passed'] -ne $true) { throw "Host check failed: $($hostResult['error'])" }

    $summary = [ordered]@{
        passed = $true; fixtureRoot = $fixture; settingsPreserved = $true; unrelatedExtensionPreserved = $true
        officialPinned = $pinned; officialSource = $sourceValue; automaticExtensionUpdatesDisabled = $false; isolatedSourceRedirected = $true
        hostResult = $resultPath; log = $logPath; loginPerformed = $false; modelRequestPerformed = $false
    }
    $summaryPath = Join-Path $fixture 'check-result.json'
    $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryPath -Encoding utf8NoBOM
    [pscustomobject]$summary
    $global:LASTEXITCODE = 0
}
catch {
    if (-not (Test-Path -LiteralPath $logPath)) { $_.Exception.ToString() | Set-Content -LiteralPath $logPath -Encoding utf8NoBOM }
    throw
}
