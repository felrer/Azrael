#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$FixtureRoot = (Join-Path $PSScriptRoot '../artifacts/verification/independent-azrael-tests'),
    [string]$LogDirectory = (Join-Path $PSScriptRoot '../artifacts/logs/independent-azrael'),
    [string]$ExternalInstallFixtureRoot = (Join-Path ([IO.Path]::GetTempPath()) 'independent-azrael-tests'),
    [string]$SourceDeploymentReceipt = (Join-Path $PSScriptRoot '../artifacts/deployments/existing-vscode.json'),
    [string]$ReleaseDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Assert-Equal([object]$Expected, [object]$Actual, [string]$Message) {
    if ($Expected -cne $Actual) { throw "$Message Expected=[$Expected] Actual=[$Actual]" }
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Get-OptionalSha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '<missing>' }
    return Get-Sha256 $Path
}

function Invoke-ExpectedFailure([scriptblock]$Action, [string]$Pattern) {
    try {
        & $Action
    }
    catch {
        if ($_.Exception.Message -notmatch $Pattern) {
            throw "Expected failure matching [$Pattern], received: $($_.Exception.Message)"
        }
        return $_.Exception.Message
    }
    throw "Expected failure matching [$Pattern], but the command succeeded."
}

function Copy-ContractFile([string]$SourceRoot, [string]$DestinationRoot, [string]$RelativePath) {
    $source = Join-Path $SourceRoot $RelativePath
    Assert-True (Test-Path -LiteralPath $source -PathType Leaf) "Missing fixture source: $source"
    $destination = Join-Path $DestinationRoot $RelativePath
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}

function New-RestoreFixture([string]$Name, [pscustomobject]$Source) {
    $root = Join-Path $script:RunRoot $Name
    $extensions = Join-Path $root 'extensions'
    $official = Join-Path $extensions 'openai.chatgpt-26.908.40401-win32-x64'
    $companion = Join-Path $extensions 'azrael-ex-local.azrael-ex-0.1.0'
    $unrelated = Join-Path $extensions 'fixture.unrelated-7.8.9'
    $original = Join-Path $root 'pristine-original'
    $deployment = Join-Path $root 'deployment'
    $preparedOfficial = Join-Path $deployment 'package/staging/openai.chatgpt-26.908.40401-win32-x64'
    $previousFiles = Join-Path $deployment 'previous-files'
    New-Item -ItemType Directory -Path $official, $companion, $unrelated, $original, $preparedOfficial, $previousFiles -Force | Out-Null

    $originalFiles = @(
        'package.json',
        'out/extension.js',
        'webview/assets/app-initial-1e5ee25fb4ec.js',
        'webview/assets/app-initial-a190b16fc630.js'
    )
    $addedFiles = @(
        'out/azrael-runtime.cjs',
        'out/azrael-runtime.json',
        '.azrael-official-ui.json',
        '.azrael-profile-menu.json',
        '.azrael-startup-notices.json'
    )
    foreach ($relative in $originalFiles) {
        Copy-ContractFile $Source.Original $original $relative
        Copy-ContractFile $Source.Patched $preparedOfficial $relative
        Copy-ContractFile $Source.Patched $official $relative
    }
    foreach ($relative in $addedFiles) {
        Copy-ContractFile $Source.Patched $preparedOfficial $relative
        Copy-ContractFile $Source.Patched $official $relative
    }

    foreach ($runtimePath in @((Join-Path $preparedOfficial 'out/azrael-runtime.json'), (Join-Path $official 'out/azrael-runtime.json'))) {
        $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json -AsHashtable
        $runtime.originalExtension = $original
        $runtime | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $runtimePath -Encoding utf8NoBOM
    }
    # Both runtime receipts must remain byte-identical for the recognized-patch guard.
    Copy-Item -LiteralPath (Join-Path $preparedOfficial 'out/azrael-runtime.json') -Destination (Join-Path $official 'out/azrael-runtime.json') -Force

    [ordered]@{ OfficialExtension = $preparedOfficial } | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $deployment 'package/prepared.json') -Encoding utf8NoBOM
    [ordered]@{ name = 'azrael-ex'; publisher = 'azrael-ex-local'; version = '0.1.0' } | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $companion 'package.json') -Encoding utf8NoBOM
    [ordered]@{ name = 'unrelated'; publisher = 'fixture'; version = '7.8.9' } | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $unrelated 'package.json') -Encoding utf8NoBOM
    $registry = @(
        [ordered]@{ identifier = [ordered]@{ id = 'openai.chatgpt' }; version = '26.908.40401'; location = [ordered]@{ path = $official }; metadata = [ordered]@{ pinned = $true; keep = 'official-metadata' } },
        [ordered]@{ identifier = [ordered]@{ id = 'azrael-ex-local.azrael-ex' }; version = '0.1.0'; location = [ordered]@{ path = $companion }; metadata = [ordered]@{ source = 'vsix' } },
        [ordered]@{ identifier = [ordered]@{ id = 'fixture.unrelated' }; version = '7.8.9'; location = [ordered]@{ path = $unrelated }; metadata = [ordered]@{ keep = 'unrelated-metadata' } }
    )
    ConvertTo-Json -InputObject $registry -Depth 20 | Set-Content -LiteralPath (Join-Path $extensions 'extensions.json') -Encoding utf8NoBOM
    $receipt = Join-Path $root 'deployment-receipt.json'
    [ordered]@{ extensionsDir = $extensions; userDataDir = (Join-Path $root 'user-data'); previousFiles = $previousFiles; companionVsix = 'fixture.vsix' } |
        ConvertTo-Json | Set-Content -LiteralPath $receipt -Encoding utf8NoBOM

    return [pscustomobject]@{
        Root = $root; Extensions = $extensions; Official = $official; Companion = $companion; Unrelated = $unrelated
        Original = $original; PreparedOfficial = $preparedOfficial; Receipt = $receipt
        OriginalFiles = $originalFiles; AddedFiles = $addedFiles
    }
}

function Test-Restoration([pscustomobject]$Source) {
    $restoreScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'restore-original-codex.ps1')).Path
    $fixture = New-RestoreFixture 'restore-success' $Source
    $output = @(& $restoreScript -DeploymentReceipt $fixture.Receipt -CodePath $script:MockCode 2>&1)
    Assert-Equal 0 $LASTEXITCODE 'Restoration failed.'
    foreach ($relative in $fixture.OriginalFiles) {
        Assert-Equal (Get-Sha256 (Join-Path $fixture.Original $relative)) (Get-Sha256 (Join-Path $fixture.Official $relative)) "Original hash was not restored: $relative"
    }
    foreach ($relative in $fixture.AddedFiles) {
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $fixture.Official $relative))) "Azrael-only file remains: $relative"
    }
    Assert-True (-not (Test-Path -LiteralPath $fixture.Companion)) 'Ordinary companion directory remains after restoration.'
    Assert-True (Test-Path -LiteralPath $fixture.Unrelated -PathType Container) 'Unrelated extension directory was removed.'
    $afterRegistry = @(Get-Content -LiteralPath (Join-Path $fixture.Extensions 'extensions.json') -Raw | ConvertFrom-Json)
    $unrelated = @($afterRegistry | Where-Object { $_.identifier.id -ceq 'fixture.unrelated' })
    Assert-Equal 1 $unrelated.Count 'Unrelated registry entry was not retained exactly once.'
    Assert-Equal 'unrelated-metadata' $unrelated[0].metadata.keep 'Unrelated registry metadata changed.'
    $official = @($afterRegistry | Where-Object { $_.identifier.id -ceq 'openai.chatgpt' })
    Assert-Equal 1 $official.Count 'Official registry entry count changed.'
    Assert-True (-not $official[0].metadata.PSObject.Properties['pinned']) 'Official update pin remains after restoration.'
    Assert-True (@(Get-ChildItem -LiteralPath (Split-Path $fixture.Receipt -Parent) -Directory -Filter 'restore-*').Count -eq 1) 'Restoration backup was not retained.'

    $refusal = New-RestoreFixture 'restore-refusal' $Source
    Add-Content -LiteralPath (Join-Path $refusal.Official 'package.json') -Value "`nunknown-edit" -Encoding utf8NoBOM
    $before = @{}
    foreach ($relative in @($refusal.OriginalFiles) + @($refusal.AddedFiles)) {
        $path = Join-Path $refusal.Official $relative
        $before[$relative] = if (Test-Path -LiteralPath $path) { Get-Sha256 $path } else { $null }
    }
    $registryBefore = Get-Sha256 (Join-Path $refusal.Extensions 'extensions.json')
    $message = Invoke-ExpectedFailure { & $restoreScript -DeploymentReceipt $refusal.Receipt -CodePath $script:MockCode } 'Unrecognized installed change; no files restored: package.json'
    foreach ($relative in $before.Keys) {
        $path = Join-Path $refusal.Official $relative
        Assert-True (Test-Path -LiteralPath $path) "Refusal removed a file before failing: $relative"
        Assert-Equal $before[$relative] (Get-Sha256 $path) "Refusal wrote a file before failing: $relative"
    }
    Assert-Equal $registryBefore (Get-Sha256 (Join-Path $refusal.Extensions 'extensions.json')) 'Refusal changed the registry.'
    Assert-True (Test-Path -LiteralPath $refusal.Companion -PathType Container) 'Refusal removed companion extension.'
    Assert-Equal 0 @(Get-ChildItem -LiteralPath (Split-Path $refusal.Receipt -Parent) -Directory -Filter 'restore-*').Count 'Refusal created a restoration backup before validation completed.'
    return [ordered]@{ passed = $true; successFixture = $fixture.Root; refusalFixture = $refusal.Root; refusal = $message }
}

function Test-IsolatedInstallation([pscustomobject]$Source, [string]$Release) {
    $installer = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'install-isolated-vscode.ps1')).Path
    $router = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'install-azrael.ps1')).Path
    $launcher = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'launch-installed-azrael.ps1')).Path
    $root = $script:ExternalRunRoot
    $installRoot = Join-Path $root 'private-vscode'
    $stateRoot = Join-Path $root 'native-state'
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $ordinaryFiles = @(
        (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.vscode/extensions/extensions.json'),
        (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Code/User/settings.json'),
        (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex/config.toml')
    )
    $ordinaryBefore = @{}
    foreach ($path in $ordinaryFiles) { $ordinaryBefore[$path] = Get-OptionalSha256 $path }

    $oldDefaultMessage = Invoke-ExpectedFailure {
        & $router -Target Existing -ReleaseDirectory $Release -InstallRoot $installRoot -WorkspacePath $script:ProjectRoot -StateRoot $stateRoot -CodePath $script:MockCodeCmd -SourceExtensionPath $Source.Original -NoLaunch -UpdateDesktopShortcut:$false
    } 'Existing-profile installation is no longer supported'
    Assert-True (-not (Test-Path -LiteralPath $installRoot)) 'Rejected existing-profile route wrote the install root.'

    $relativeMessage = Invoke-ExpectedFailure {
        & $installer -ReleaseDirectory $Release -InstallRoot 'relative-install' -WorkspacePath $script:ProjectRoot -StateRoot $stateRoot -CodePath $script:MockCodeCmd -SourceExtensionPath $Source.Original -PrepareOnly -UpdateDesktopShortcut:$false
    } 'Path must be absolute'
    $collisionMessage = Invoke-ExpectedFailure {
        & $installer -ReleaseDirectory $Release -InstallRoot $script:ProjectRoot -WorkspacePath $script:ProjectRoot -StateRoot $stateRoot -CodePath $script:MockCodeCmd -SourceExtensionPath $Source.Original -PrepareOnly -UpdateDesktopShortcut:$false
    } 'collides with repository root'
    $driveRootMessage = Invoke-ExpectedFailure {
        & $installer -ReleaseDirectory $Release -InstallRoot ([IO.Path]::GetPathRoot($script:ProjectRoot)) -WorkspacePath $script:ProjectRoot -StateRoot $stateRoot -CodePath $script:MockCodeCmd -SourceExtensionPath $Source.Original -PrepareOnly -UpdateDesktopShortcut:$false
    } 'collides with'

    $prepared = & $installer -ReleaseDirectory $Release -InstallRoot $installRoot -WorkspacePath $script:ProjectRoot -StateRoot $stateRoot `
        -CodePath $script:MockCodeCmd -SourceExtensionPath $Source.Original -OriginalExtensionPath $Source.Original -PrepareOnly -UpdateDesktopShortcut:$false
    Assert-Equal 0 $LASTEXITCODE 'PrepareOnly failed.'
    Assert-True ($prepared.Prepared -eq $true -and $prepared.Installed -eq $false) 'PrepareOnly result flags are incorrect.'
    Assert-True (Test-Path -LiteralPath $prepared.PreparedOfficialExtension -PathType Container) 'PrepareOnly did not create a prepared official extension.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $prepared.GenerationPath 'installation.json'))) 'PrepareOnly wrote an installation manifest.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $installRoot 'current.json'))) 'PrepareOnly advanced current selection.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $installRoot 'user-data'))) 'PrepareOnly created the persistent editor profile.'

    $first = & $installer -ReleaseDirectory $Release -InstallRoot $installRoot -WorkspacePath $script:ProjectRoot -StateRoot $stateRoot `
        -CodePath $script:MockCodeCmd -SourceExtensionPath $Source.Original -OriginalExtensionPath $Source.Original -NoLaunch -UpdateDesktopShortcut:$false
    Assert-Equal 0 $LASTEXITCODE 'First isolated installation failed.'
    Assert-True ($first.Installed -eq $true -and $first.Launched -eq $false) 'First installation result flags are incorrect.'
    $firstManifest = Get-Content -LiteralPath $first.ManifestPath -Raw | ConvertFrom-Json
    Assert-Equal (Join-Path $installRoot 'user-data') $firstManifest.userDataDir 'Installation did not select the persistent private profile.'
    Assert-True ($firstManifest.extensionsDir.StartsWith((Join-Path $installRoot 'installations'), [StringComparison]::OrdinalIgnoreCase)) 'Extension directory is outside immutable generations.'
    Assert-True (-not $stateRoot.StartsWith((Join-Path ([Environment]::GetFolderPath('UserProfile')) '.azrael-ex'), [StringComparison]::OrdinalIgnoreCase)) 'Fixture installation targeted ordinary azrael account/session state.'
    $settingsPath = Join-Path $firstManifest.userDataDir 'User/settings.json'
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    Assert-Equal $false $settings.'extensions.autoUpdate' 'Private profile did not disable automatic extension updates.'
    Assert-Equal $false $settings.'extensions.autoCheckUpdates' 'Private profile did not disable extension update checks.'
    $privateRegistry = @(Get-Content -LiteralPath (Join-Path $firstManifest.extensionsDir 'extensions.json') -Raw | ConvertFrom-Json)
    foreach ($requiredId in @('openai.chatgpt', 'azrael-ex-local.azrael-ex')) {
        $entry = @($privateRegistry | Where-Object { $_.identifier.id -ceq $requiredId })
        Assert-Equal 1 $entry.Count "Private registry is missing $requiredId."
        Assert-True ($entry[0].metadata.pinned -eq $true) "Private registry did not pin $requiredId."
    }
    Add-Content -LiteralPath $settingsPath -Value "`n " -Encoding utf8NoBOM
    $settingsBeforeSecondInstall = Get-Sha256 $settingsPath

    Start-Sleep -Milliseconds 5
    $second = & $installer -ReleaseDirectory $Release -InstallRoot $installRoot -WorkspacePath $script:ProjectRoot -StateRoot $stateRoot `
        -CodePath $script:MockCodeCmd -SourceExtensionPath $Source.Original -OriginalExtensionPath $Source.Original -NoLaunch -UpdateDesktopShortcut:$false
    Assert-Equal 0 $LASTEXITCODE 'Second isolated installation failed.'
    $secondManifest = Get-Content -LiteralPath $second.ManifestPath -Raw | ConvertFrom-Json
    Assert-Equal $firstManifest.userDataDir $secondManifest.userDataDir 'Install generations do not share the persistent private editor profile.'
    Assert-Equal $settingsBeforeSecondInstall (Get-Sha256 $settingsPath) 'A later generation overwrote persistent private profile settings.'
    Assert-True (-not $firstManifest.extensionsDir.Equals($secondManifest.extensionsDir, [StringComparison]::OrdinalIgnoreCase)) 'Install generations reused an extension directory.'
    Assert-True (Test-Path -LiteralPath $firstManifest.extensionsDir -PathType Container) 'A prior immutable extension generation was removed.'
    $current = Get-Content -LiteralPath $second.CurrentSelection -Raw | ConvertFrom-Json
    Assert-Equal $second.ManifestPath $current.manifestPath 'Current selection does not identify the latest completed generation.'

    $currentBeforeFailure = Get-Sha256 $second.CurrentSelection
    $env:MOCK_CODE_FAIL_INSTALL = '1'
    try {
        $failureMessage = Invoke-ExpectedFailure {
            & $installer -ReleaseDirectory $Release -InstallRoot $installRoot -WorkspacePath $script:ProjectRoot -StateRoot $stateRoot `
                -CodePath $script:MockCodeCmd -SourceExtensionPath $Source.Original -OriginalExtensionPath $Source.Original -NoLaunch -UpdateDesktopShortcut:$false
        } 'Companion VSIX installation failed'
    }
    finally {
        Remove-Item Env:MOCK_CODE_FAIL_INSTALL -ErrorAction SilentlyContinue
    }
    Assert-Equal $currentBeforeFailure (Get-Sha256 $second.CurrentSelection) 'A failed generation advanced current selection.'

    $previousCodexHome = $env:CODEX_HOME
    $previousAzraelSentinel = $env:AZRAEL_TEST_SENTINEL
    try {
        $env:CODEX_HOME = 'fixture-caller-codex-home'
        $env:AZRAEL_TEST_SENTINEL = 'fixture-caller-azrael'
        & $launcher -ManifestPath $second.ManifestPath
        Assert-Equal 0 $LASTEXITCODE 'Installed launcher failed.'
        Assert-Equal 'fixture-caller-codex-home' $env:CODEX_HOME 'Launcher did not restore caller CODEX_HOME.'
        Assert-Equal 'fixture-caller-azrael' $env:AZRAEL_TEST_SENTINEL 'Launcher did not restore caller AZRAEL_* state.'
    }
    finally {
        if ($null -eq $previousCodexHome) { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue } else { $env:CODEX_HOME = $previousCodexHome }
        if ($null -eq $previousAzraelSentinel) { Remove-Item Env:AZRAEL_TEST_SENTINEL -ErrorAction SilentlyContinue } else { $env:AZRAEL_TEST_SENTINEL = $previousAzraelSentinel }
    }
    $launchRecord = Get-Content -LiteralPath $script:MockLaunchRecord -Raw | ConvertFrom-Json
    Assert-Equal $secondManifest.userDataDir $launchRecord.userDataDir 'Launcher omitted or changed --user-data-dir.'
    Assert-Equal $secondManifest.extensionsDir $launchRecord.extensionsDir 'Launcher omitted or changed --extensions-dir.'
    Assert-Equal $secondManifest.workspacePath $launchRecord.workspacePath 'Launcher did not open the recorded workspace.'
    Assert-True (-not $launchRecord.codexHomePresent) 'Launcher leaked caller CODEX_HOME to VS Code.'
    Assert-True (-not $launchRecord.azraelVariablesPresent) 'Launcher leaked caller AZRAEL_* variables to VS Code.'

    $launchRecordBeforeRefusal = Get-Sha256 $script:MockLaunchRecord
    function Get-CimInstance {
        param([string]$ClassName, [string]$Filter, [object]$ErrorAction)
        return [pscustomobject]@{
            CommandLine = '"code.exe" --user-data-dir "' + $secondManifest.userDataDir + '" --extensions-dir "' + $firstManifest.extensionsDir + '" --new-window'
        }
    }
    try {
        $runningHostRefusal = Invoke-ExpectedFailure { & $launcher -ManifestPath $second.ManifestPath } 'updated while an older azrael window is still open'
    }
    finally {
        Remove-Item Function:Get-CimInstance -ErrorAction SilentlyContinue
    }
    Assert-Equal $launchRecordBeforeRefusal (Get-Sha256 $script:MockLaunchRecord) 'Running-host refusal launched VS Code.'
    function Get-CimInstance {
        param([string]$ClassName, [string]$Filter, [object]$ErrorAction)
        return [pscustomobject]@{ CommandLine = '"code.exe" --user-data-dir "' + $secondManifest.userDataDir + '" --new-window' }
    }
    try {
        $missingExtensionHostRefusal = Invoke-ExpectedFailure { & $launcher -ManifestPath $second.ManifestPath } 'updated while an older azrael window is still open'
    }
    finally {
        Remove-Item Function:Get-CimInstance -ErrorAction SilentlyContinue
    }
    Assert-Equal $launchRecordBeforeRefusal (Get-Sha256 $script:MockLaunchRecord) 'Missing-extensions-dir host refusal launched VS Code.'
    foreach ($path in $ordinaryFiles) {
        Assert-Equal $ordinaryBefore[$path] (Get-OptionalSha256 $path) "Isolated fixture changed ordinary data: $path"
    }

    return [ordered]@{
        passed = $true; root = $root; prepareGeneration = $prepared.GenerationPath; firstManifest = $first.ManifestPath
        secondManifest = $second.ManifestPath; currentSelection = $second.CurrentSelection; failure = $failureMessage
        relativeRefusal = $relativeMessage; collisionRefusal = $collisionMessage; driveRootRefusal = $driveRootMessage
        oldDefaultRefusal = $oldDefaultMessage; runningHostRefusal = $runningHostRefusal; missingExtensionHostRefusal = $missingExtensionHostRefusal
    }
}

$fixtureBase = [IO.Path]::GetFullPath($FixtureRoot)
$logBase = [IO.Path]::GetFullPath($LogDirectory)
New-Item -ItemType Directory -Path $fixtureBase, $logBase -Force | Out-Null
$script:RunRoot = Join-Path $fixtureBase ('run-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $script:RunRoot | Out-Null
$externalBase = [IO.Path]::GetFullPath($ExternalInstallFixtureRoot)
New-Item -ItemType Directory -Path $externalBase -Force | Out-Null
$script:ExternalRunRoot = Join-Path $externalBase (Split-Path $script:RunRoot -Leaf)
$logPath = Join-Path $logBase ((Split-Path $script:RunRoot -Leaf) + '.log')
$resultPath = Join-Path $script:RunRoot 'result.json'
$script:MockCode = Join-Path $script:RunRoot 'mock-code.ps1'
$script:MockCodeCmd = Join-Path $script:RunRoot 'code.cmd'
$script:MockLaunchRecord = Join-Path $script:RunRoot 'mock-launch.json'
$script:ProjectRoot = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path

@'
#requires -Version 7.0
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
$extensionsIndex = [Array]::IndexOf($Arguments, '--extensions-dir')
if ($extensionsIndex -lt 0 -or $extensionsIndex + 1 -ge $Arguments.Count) { throw 'Mock code requires --extensions-dir.' }
$extensions = $Arguments[$extensionsIndex + 1]
Add-Content -LiteralPath (Join-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) 'mock-code-arguments.jsonl') -Value (ConvertTo-Json -Compress -InputObject $Arguments)
if ($Arguments -contains '--list-extensions') {
    foreach ($directory in Get-ChildItem -LiteralPath $extensions -Directory) {
        $manifestPath = Join-Path $directory.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $manifestPath)) { continue }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ($manifest.publisher -and $manifest.name -and $manifest.version) { "$($manifest.publisher).$($manifest.name)@$($manifest.version)" }
    }
    exit 0
}
$uninstallIndex = [Array]::IndexOf($Arguments, '--uninstall-extension')
if ($uninstallIndex -ge 0) {
    $id = $Arguments[$uninstallIndex + 1]
    foreach ($directory in Get-ChildItem -LiteralPath $extensions -Directory) {
        $manifestPath = Join-Path $directory.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $manifestPath)) { continue }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ("$($manifest.publisher).$($manifest.name)" -ceq $id) { Remove-Item -LiteralPath $directory.FullName -Recurse }
    }
    $registryPath = Join-Path $extensions 'extensions.json'
    if (Test-Path -LiteralPath $registryPath) {
        $registry = @(Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json | Where-Object { $_.identifier.id -cne $id })
        ConvertTo-Json -InputObject $registry -Depth 20 | Set-Content -LiteralPath $registryPath -Encoding utf8NoBOM
    }
    exit 0
}
throw "Unsupported mock code arguments: $($Arguments -join ' ')"
'@ | Set-Content -LiteralPath $script:MockCode -Encoding utf8NoBOM

@'
@echo off
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mock-code-application.ps1" %*
exit /b %ERRORLEVEL%
'@ | Set-Content -LiteralPath $script:MockCodeCmd -Encoding ascii

@'
#requires -Version 7.0
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
$extensionsIndex = [Array]::IndexOf($Arguments, '--extensions-dir')
$userDataIndex = [Array]::IndexOf($Arguments, '--user-data-dir')
if ($extensionsIndex -lt 0 -or $userDataIndex -lt 0) { throw 'Mock application requires private editor and extension paths.' }
$extensions = $Arguments[$extensionsIndex + 1]
$userData = $Arguments[$userDataIndex + 1]
Add-Content -LiteralPath (Join-Path $PSScriptRoot 'mock-application-arguments.jsonl') -Value (ConvertTo-Json -Compress -InputObject $Arguments)
$installIndex = [Array]::IndexOf($Arguments, '--install-extension')
if ($installIndex -ge 0) {
    if ($env:MOCK_CODE_FAIL_INSTALL -eq '1') { exit 23 }
    $destination = Join-Path $extensions 'azrael-ex-local.azrael-ex-0.1.0'
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    [ordered]@{ name = 'azrael-ex'; publisher = 'azrael-ex-local'; version = '0.1.0' } | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $destination 'package.json') -Encoding utf8NoBOM
    $officialDirectory = Get-ChildItem -LiteralPath $extensions -Directory | Where-Object { $_.Name -like 'openai.chatgpt-*' } | Select-Object -First 1
    $registry = @(
        [ordered]@{ identifier = [ordered]@{ id = 'openai.chatgpt' }; version = '26.908.40401'; location = [ordered]@{ path = $officialDirectory.FullName }; metadata = [ordered]@{ source = 'fixture' } },
        [ordered]@{ identifier = [ordered]@{ id = 'azrael-ex-local.azrael-ex' }; version = '0.1.0'; location = [ordered]@{ path = $destination }; metadata = [ordered]@{ source = 'vsix' } }
    )
    ConvertTo-Json -InputObject $registry -Depth 20 | Set-Content -LiteralPath (Join-Path $extensions 'extensions.json') -Encoding utf8NoBOM
    exit 0
}
if ($Arguments -contains '--list-extensions') {
    foreach ($directory in Get-ChildItem -LiteralPath $extensions -Directory) {
        $manifestPath = Join-Path $directory.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $manifestPath)) { continue }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ($manifest.publisher -and $manifest.name -and $manifest.version) { "$($manifest.publisher).$($manifest.name)@$($manifest.version)" }
    }
    exit 0
}
if ($Arguments -contains '--new-window') {
    $azraelNames = @(Get-ChildItem Env: | Where-Object { $_.Name -like 'AZRAEL_*' } | Select-Object -ExpandProperty Name)
    [ordered]@{
        userDataDir = $userData
        extensionsDir = $extensions
        workspacePath = $Arguments[-1]
        codexHomePresent = $null -ne $env:CODEX_HOME
        azraelVariablesPresent = $azraelNames.Count -gt 0
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'mock-launch.json') -Encoding utf8NoBOM
    exit 0
}
throw "Unsupported mock application arguments: $($Arguments -join ' ')"
'@ | Set-Content -LiteralPath (Join-Path $script:RunRoot 'mock-code-application.ps1') -Encoding utf8NoBOM

try {
    $sourceReceipt = Get-Content -LiteralPath (Resolve-Path -LiteralPath $SourceDeploymentReceipt) -Raw | ConvertFrom-Json
    $sourceDeployment = Split-Path $sourceReceipt.previousFiles -Parent
    $sourcePrepared = Get-Content -LiteralPath (Join-Path $sourceDeployment 'package/prepared.json') -Raw | ConvertFrom-Json
    $sourceRuntime = Get-Content -LiteralPath (Join-Path $sourcePrepared.OfficialExtension 'out/azrael-runtime.json') -Raw | ConvertFrom-Json
    $source = [pscustomobject]@{ Patched = (Resolve-Path -LiteralPath $sourcePrepared.OfficialExtension).Path; Original = (Resolve-Path -LiteralPath $sourceRuntime.originalExtension).Path }
    if (-not $ReleaseDirectory) {
        $latest = Get-Content -LiteralPath (Join-Path $script:ProjectRoot 'artifacts/latest.json') -Raw | ConvertFrom-Json
        $ReleaseDirectory = $latest.releaseDirectory
    }
    $release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
    $restoration = Test-Restoration $source
    $installation = Test-IsolatedInstallation $source $release
    $result = [ordered]@{ passed = $true; restoration = $restoration; installation = $installation; fixtureRoot = $script:RunRoot; log = $logPath; loginPerformed = $false; modelRequestPerformed = $false }
    $result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resultPath -Encoding utf8NoBOM
    $result | ConvertTo-Json -Depth 20 | Tee-Object -FilePath $logPath
    $global:LASTEXITCODE = 0
}
catch {
    $_.Exception.ToString() | Set-Content -LiteralPath $logPath -Encoding utf8NoBOM
    throw
}
