[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$EnginePath,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$TestRoot,
    [string]$OfficialExtensionPath = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.vscode/extensions/openai.chatgpt-26.908.40401-win32-x64')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Condition {
    param([Parameter(Mandatory = $true)][bool]$Condition, [Parameter(Mandatory = $true)][string]$Message)
    if (-not $Condition) { throw $Message }
}

function Invoke-ExpectedFailure {
    param([scriptblock]$Action, [string]$MessagePattern, [string]$Behavior)
    try { & $Action }
    catch {
        if ($_.Exception.Message -notmatch $MessagePattern) {
            throw "$Behavior failed for an unexpected reason: $($_.Exception.Message)"
        }
        return $_.Exception.Message
    }
    throw "$Behavior unexpectedly succeeded."
}

if (-not [IO.Path]::IsPathFullyQualified($TestRoot)) { throw 'TestRoot must be an absolute path.' }
$testPath = [IO.Path]::GetFullPath($TestRoot)
if (Test-Path -LiteralPath $testPath) { throw "TestRoot must be a new path: $testPath" }
New-Item -ItemType Directory -Path $testPath | Out-Null

$resultsPath = Join-Path $testPath 'check-launcher-results.json'
$results = [System.Collections.Generic.List[object]]::new()
$engine = (Resolve-Path -LiteralPath $EnginePath).Path
$source = (Resolve-Path -LiteralPath $OfficialExtensionPath).Path
$launcher = Join-Path $PSScriptRoot 'start-azrael.ps1'
$preparer = Join-Path $PSScriptRoot 'prepare-official-ui.ps1'
$workspace = Split-Path $PSScriptRoot -Parent
$bridge = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../upstream/codex/codex-rs/target/debug/azrael-bridge.exe')).Path
$sourcePackage = Join-Path $source 'package.json'
$sourceScript = Join-Path $source 'webview/assets/app-initial-1e5ee25fb4ec.js'
$sourcePackageHash = (Get-FileHash -LiteralPath $sourcePackage -Algorithm SHA256).Hash
$sourceScriptHash = (Get-FileHash -LiteralPath $sourceScript -Algorithm SHA256).Hash

$baselineHome = Join-Path $testPath 'baseline-version-home'
New-Item -ItemType Directory -Path $baselineHome | Out-Null
$baselinePreviousRoot = $env:CODEX_HOME
try {
    $env:CODEX_HOME = $baselineHome
    $baselineVersion = & $engine --version
    if ($LASTEXITCODE -ne 0) { throw "Baseline engine version probe failed with exit code $LASTEXITCODE." }
}
finally { $env:CODEX_HOME = $baselinePreviousRoot }

try {
    $state = Join-Path $testPath 'state'
    $baseSettingsPath = Join-Path $state 'azrael/vscode/User/settings.json'
    New-Item -ItemType Directory -Path (Split-Path $baseSettingsPath -Parent) | Out-Null
    [ordered]@{ 'launcherCheck.baseSentinel' = 'preserved-base-setting' } | ConvertTo-Json | Set-Content -LiteralPath $baseSettingsPath -Encoding utf8NoBOM
    $first = & $launcher -EnginePath $engine -BridgePath $bridge -OfficialExtensionPath $source -StateRoot $state -WorkspacePath $workspace -InstanceId 'repeat' -PrepareOnly
    $settingsPath = [string]$first.Settings
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json -AsHashtable
    Assert-Condition ($settings['chatgpt.cliExecutable'] -ceq $engine) 'Prepared settings did not select the engine.'
    Assert-Condition ($settings['azrael-ex.bridgeExecutable'] -ceq $bridge) 'Prepared settings did not select the companion bridge.'
    Assert-Condition ($settings['launcherCheck.baseSentinel'] -ceq 'preserved-base-setting') 'Prepared instance did not preserve prior base settings.'

    $brandedPackage = Join-Path $first.OfficialExtension 'package.json'
    $brandedScript = Join-Path $first.OfficialExtension 'webview/assets/app-initial-1e5ee25fb4ec.js'
    $brandedManifest = Get-Content -LiteralPath $brandedPackage -Raw | ConvertFrom-Json -AsHashtable
    $labels = @(
        $brandedManifest['contributes']['viewsContainers']['activitybar'][0]['title'],
        $brandedManifest['contributes']['viewsContainers']['secondarySidebar'][0]['title'],
        $brandedManifest['contributes']['views']['codexViewContainer'][0]['name'],
        $brandedManifest['contributes']['views']['codexSecondaryViewContainer'][0]['name']
    )
    Assert-Condition (@($labels | Where-Object { $_ -cne 'azrael' }).Count -eq 0) 'The four official manifest labels were not branded azrael.'
    $brandedScriptText = [IO.File]::ReadAllText($brandedScript)
    Assert-Condition (([regex]::Matches($brandedScriptText, [regex]::Escape('jv=`azrael`'))).Count -eq 1) 'The branded appName token is missing or non-unique.'
    Assert-Condition (([regex]::Matches($brandedScriptText, [regex]::Escape('jv=`Codex`'))).Count -eq 0) 'The original appName token remains in the branded asset.'
    Assert-Condition ((Get-FileHash -LiteralPath $sourcePackage -Algorithm SHA256).Hash -ceq $sourcePackageHash) 'Branding changed the installed package.json.'
    Assert-Condition ((Get-FileHash -LiteralPath $sourceScript -Algorithm SHA256).Hash -ceq $sourceScriptHash) 'Branding changed the installed webview asset.'
    $results.Add([pscustomobject]@{ Behavior = 'Pinned local branding with installed source untouched'; Passed = $true })

    $sentinel = "preserve-$([guid]::NewGuid())"
    $settings['launcherCheck.sentinel'] = $sentinel
    $settings | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $settingsPath -Encoding utf8NoBOM
    $beforeRepeat = [IO.File]::ReadAllBytes($settingsPath)
    $second = & $launcher -EnginePath $engine -BridgePath $bridge -OfficialExtensionPath $source -StateRoot $state -WorkspacePath $workspace -InstanceId 'repeat' -PrepareOnly
    Assert-Condition ([Linq.Enumerable]::SequenceEqual[byte]($beforeRepeat, [IO.File]::ReadAllBytes($settingsPath))) 'Repeated preparation changed complete settings.'
    Assert-Condition ([bool]$second.OfficialExtension) 'Repeated preparation did not return the branded extension.'
    Assert-Condition ((Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json -AsHashtable)['launcherCheck.sentinel'] -ceq $sentinel) 'Repeated preparation lost the existing setting.'
    $results.Add([pscustomobject]@{ Behavior = 'Idempotent branding and settings preservation'; Passed = $true })

    $brandedScriptBackup = Join-Path $testPath 'branded-script.backup'
    Copy-Item -LiteralPath $brandedScript -Destination $brandedScriptBackup
    try {
        Add-Content -LiteralPath $brandedScript -Value ' ' -NoNewline
        $tamperMessage = Invoke-ExpectedFailure -Behavior 'Branded copy hash mismatch refusal' -MessagePattern 'Branded webview asset hash mismatch' -Action {
            & $preparer -SourceExtensionPath $source -ExtensionsDir $first.ExtensionsDir | Out-Null
        }
        $results.Add([pscustomobject]@{ Behavior = 'Branded copy hash mismatch refusal'; Passed = $true; Detail = $tamperMessage })
    }
    finally {
        Copy-Item -LiteralPath $brandedScriptBackup -Destination $brandedScript -Force
    }

    $other = & $launcher -EnginePath $engine -BridgePath $bridge -OfficialExtensionPath $source -StateRoot $state -WorkspacePath $workspace -InstanceId 'other' -PrepareOnly
    Assert-Condition ($other.EditorRoot -cne $first.EditorRoot) 'Distinct instance IDs reused a user-data directory.'
    Assert-Condition ($other.ExtensionsDir -ceq $first.ExtensionsDir) 'Instances did not share the dedicated branded extensions directory.'
    $results.Add([pscustomobject]@{ Behavior = 'Distinct per-instance user data'; Passed = $true })

    $badSource = Join-Path $testPath 'bad-source'
    New-Item -ItemType Directory -Path $badSource | Out-Null
    Copy-Item -LiteralPath $sourcePackage -Destination (Join-Path $badSource 'package.json')
    Add-Content -LiteralPath (Join-Path $badSource 'package.json') -Value ' ' -NoNewline
    $hashMessage = Invoke-ExpectedFailure -Behavior 'Official source hash mismatch refusal' -MessagePattern 'Official package.json hash mismatch' -Action {
        & $preparer -SourceExtensionPath $badSource -ExtensionsDir (Join-Path $testPath 'bad-source-destination') | Out-Null
    }
    $results.Add([pscustomobject]@{ Behavior = 'Official source hash mismatch refusal'; Passed = $true; Detail = $hashMessage })

    $unknownRoot = Join-Path $testPath 'unknown-extensions'
    $unknownDestination = Join-Path $unknownRoot 'openai.chatgpt-26.908.40401-win32-x64'
    New-Item -ItemType Directory -Path $unknownDestination | Out-Null
    $unknownMessage = Invoke-ExpectedFailure -Behavior 'Unknown destination refusal' -MessagePattern 'Refusing to overwrite an unknown official-extension destination' -Action {
        & $preparer -SourceExtensionPath $source -ExtensionsDir $unknownRoot | Out-Null
    }
    $results.Add([pscustomobject]@{ Behavior = 'Unknown destination refusal'; Passed = $true; Detail = $unknownMessage })

    $relativeMessage = Invoke-ExpectedFailure -Behavior 'Relative StateRoot refusal' -MessagePattern 'StateRoot must be an absolute path' -Action {
        & $launcher -EnginePath $engine -StateRoot 'relative-launcher-state' -WorkspacePath $workspace -PrepareOnly | Out-Null
    }
    $results.Add([pscustomobject]@{ Behavior = 'Relative StateRoot refusal'; Passed = $true; Detail = $relativeMessage })

    $ordinaryState = Join-Path ([Environment]::GetFolderPath('UserProfile')) ".codex/launcher-check-$([guid]::NewGuid())"
    $ordinaryMessage = Invoke-ExpectedFailure -Behavior 'Ordinary Codex descendant refusal' -MessagePattern 'not the ordinary Codex directory' -Action {
        & $launcher -EnginePath $engine -StateRoot $ordinaryState -WorkspacePath $workspace -PrepareOnly | Out-Null
    }
    Assert-Condition (-not (Test-Path -LiteralPath $ordinaryState)) 'Ordinary Codex refusal created state.'
    $results.Add([pscustomobject]@{ Behavior = 'Ordinary Codex descendant refusal'; Passed = $true; Detail = $ordinaryMessage })

    $relativeSocketMessage = Invoke-ExpectedFailure -Behavior 'Relative ManagementSocket refusal' -MessagePattern 'ManagementSocket must be an absolute per-instance socket path' -Action {
        & $launcher -EnginePath $engine -StateRoot $state -WorkspacePath $workspace -ManagementSocket 'relative.sock' -PrepareOnly | Out-Null
    }
    $results.Add([pscustomobject]@{ Behavior = 'Relative ManagementSocket refusal'; Passed = $true; Detail = $relativeSocketMessage })

    $wrongEngine = Join-Path $testPath 'wrong-version.cmd'
    @('@echo off', 'echo codex-cli launcher-check-deliberate-mismatch', 'exit /b 0') | Set-Content -LiteralPath $wrongEngine -Encoding ascii
    $wrongMessage = Invoke-ExpectedFailure -Behavior 'Engine version mismatch refusal' -MessagePattern 'Engine version mismatch' -Action {
        & $launcher -EnginePath $wrongEngine -BridgePath $bridge -StateRoot (Join-Path $testPath 'wrong-version-state') -WorkspacePath $workspace -PrepareOnly | Out-Null
    }
    $results.Add([pscustomobject]@{ Behavior = 'Engine version mismatch refusal'; Passed = $true; Detail = $wrongMessage })

    $conflict = & $launcher -EnginePath $engine -BridgePath $bridge -OfficialExtensionPath $source -StateRoot $state -WorkspacePath $workspace -InstanceId 'conflict' -PrepareOnly
    [ordered]@{ 'chatgpt.cliExecutable' = (Join-Path $testPath 'different.exe') } | ConvertTo-Json | Set-Content -LiteralPath $conflict.Settings -Encoding utf8NoBOM
    $conflictBefore = [IO.File]::ReadAllBytes($conflict.Settings)
    $conflictMessage = Invoke-ExpectedFailure -Behavior 'Existing settings conflict refusal' -MessagePattern 'already select a different engine' -Action {
        & $launcher -EnginePath $engine -BridgePath $bridge -OfficialExtensionPath $source -StateRoot $state -WorkspacePath $workspace -InstanceId 'conflict' -PrepareOnly | Out-Null
    }
    Assert-Condition ([Linq.Enumerable]::SequenceEqual[byte]($conflictBefore, [IO.File]::ReadAllBytes($conflict.Settings))) 'Settings conflict refusal changed the file.'
    $results.Add([pscustomobject]@{ Behavior = 'Existing settings conflict refusal'; Passed = $true; Detail = $conflictMessage })

    $existingUpdateMessage = Invoke-ExpectedFailure -Behavior 'Existing instance update refusal' -MessagePattern 'already select a different engine' -Action {
        & $launcher -EnginePath $engine -BridgePath $bridge -OfficialExtensionPath $source -StateRoot $state -WorkspacePath $workspace -InstanceId 'conflict' -UpdateEnginePair -PrepareOnly | Out-Null
    }
    Assert-Condition ([Linq.Enumerable]::SequenceEqual[byte]($conflictBefore, [IO.File]::ReadAllBytes($conflict.Settings))) 'UpdateEnginePair changed an existing instance settings file.'
    $results.Add([pscustomobject]@{ Behavior = 'Engine-pair update restricted to new instance settings'; Passed = $true; Detail = $existingUpdateMessage })

    $baseBeforeUpdateTest = [IO.File]::ReadAllBytes($baseSettingsPath)
    try {
        $oldEngine = Join-Path $testPath 'old-version/codex.exe'
        $oldBridge = Join-Path $testPath 'old-version/azrael-bridge.exe'
        [ordered]@{
            'chatgpt.cliExecutable' = $oldEngine
            'azrael-ex.bridgeExecutable' = $oldBridge
            'chatgpt.openOnStartup' = $true
            'launcherCheck.updateSentinel' = 'preserve-me'
        } | ConvertTo-Json | Set-Content -LiteralPath $baseSettingsPath -Encoding utf8NoBOM
        $mismatchedBaseBytes = [IO.File]::ReadAllBytes($baseSettingsPath)

        $baseRefusal = Invoke-ExpectedFailure -Behavior 'Base engine-pair mismatch refusal' -MessagePattern 'already select a different engine' -Action {
            & $launcher -EnginePath $engine -BridgePath $bridge -OfficialExtensionPath $source -StateRoot $state -WorkspacePath $workspace -InstanceId 'update-refused' -PrepareOnly | Out-Null
        }
        Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $state 'azrael/vscode-instances/update-refused/User/settings.json'))) 'Default mismatch refusal created new instance settings.'
        Assert-Condition ([Linq.Enumerable]::SequenceEqual[byte]($mismatchedBaseBytes, [IO.File]::ReadAllBytes($baseSettingsPath))) 'Default mismatch refusal changed base settings.'

        $updated = & $launcher -EnginePath $engine -BridgePath $bridge -OfficialExtensionPath $source -StateRoot $state -WorkspacePath $workspace -InstanceId 'update-authorized' -UpdateEnginePair -PrepareOnly
        $updatedSettings = Get-Content -LiteralPath $updated.Settings -Raw | ConvertFrom-Json -AsHashtable
        Assert-Condition ($updatedSettings['chatgpt.cliExecutable'] -ceq $engine) 'UpdateEnginePair did not replace the engine in new instance settings.'
        Assert-Condition ($updatedSettings['azrael-ex.bridgeExecutable'] -ceq $bridge) 'UpdateEnginePair did not replace the bridge in new instance settings.'
        Assert-Condition ($updatedSettings['chatgpt.openOnStartup'] -eq $true) 'UpdateEnginePair did not preserve an unrelated official preference.'
        Assert-Condition ($updatedSettings['launcherCheck.updateSentinel'] -ceq 'preserve-me') 'UpdateEnginePair did not preserve an unrelated base setting.'
        Assert-Condition ([Linq.Enumerable]::SequenceEqual[byte]($mismatchedBaseBytes, [IO.File]::ReadAllBytes($baseSettingsPath))) 'UpdateEnginePair changed the original base settings file.'
        $results.Add([pscustomobject]@{ Behavior = 'Opt-in engine-pair replacement in new instance settings'; Passed = $true; Detail = $baseRefusal })
    }
    finally {
        [IO.File]::WriteAllBytes($baseSettingsPath, $baseBeforeUpdateTest)
    }

    $global:AzraelLauncherCheckMockContext = @{ ExpectedState = [IO.Path]::GetFullPath($state); Calls = [System.Collections.Generic.List[object]]::new() }
    function Invoke-AzraelLauncherMockCode {
        if ($env:CODEX_HOME -cne $global:AzraelLauncherCheckMockContext.ExpectedState) { throw 'Mock received an unexpected CODEX_HOME.' }
        if (-not [IO.Path]::IsPathFullyQualified($env:AZRAEL_EX_MANAGEMENT_SOCKET)) { throw 'Mock received no absolute management socket.' }
        $global:AzraelLauncherCheckMockContext.Calls.Add([pscustomobject]@{ Args = @($args); Socket = $env:AZRAEL_EX_MANAGEMENT_SOCKET })
        if ($args -contains '--install-extension') { $global:LASTEXITCODE = 0; return }
        if ($args -contains '--list-extensions') { $global:LASTEXITCODE = 0; return 'openai.chatgpt@26.908.40401' }
        $global:LASTEXITCODE = 37
    }

    $callerRoot = $env:CODEX_HOME
    $callerSocket = $env:AZRAEL_EX_MANAGEMENT_SOCKET
    try {
        $env:CODEX_HOME = Join-Path $testPath 'caller-home'
        $env:AZRAEL_EX_MANAGEMENT_SOCKET = Join-Path $testPath 'caller.sock'
        $explicitSocket = Join-Path $testPath 'explicit.sock'
        $explicitMessage = Invoke-ExpectedFailure -Behavior 'Explicit socket launch failure' -MessagePattern 'VS Code launch failed with exit code 37' -Action {
            & $launcher -EnginePath $engine -BridgePath $bridge -OfficialExtensionPath $source -StateRoot $state -WorkspacePath $workspace -InstanceId 'explicit' -CodePath 'Invoke-AzraelLauncherMockCode' -ManagementSocket $explicitSocket | Out-Null
        }
        Assert-Condition ($global:AzraelLauncherCheckMockContext.Calls.Count -eq 2) 'Explicit launch did not make list and launch calls.'
        Assert-Condition (@($global:AzraelLauncherCheckMockContext.Calls | Where-Object Socket -cne $explicitSocket).Count -eq 0) 'Explicit socket was not passed to every child call.'
        Assert-Condition ($env:CODEX_HOME -ceq (Join-Path $testPath 'caller-home')) 'Caller CODEX_HOME was not restored.'
        Assert-Condition ($env:AZRAEL_EX_MANAGEMENT_SOCKET -ceq (Join-Path $testPath 'caller.sock')) 'Caller socket was not restored.'
        $results.Add([pscustomobject]@{ Behavior = 'Explicit child socket and caller environment restoration'; Passed = $true; Detail = $explicitMessage })

        $global:AzraelLauncherCheckMockContext.Calls.Clear()
        foreach ($id in @('default-one', 'default-two')) {
            Invoke-ExpectedFailure -Behavior "Default socket launch $id" -MessagePattern 'VS Code launch failed with exit code 37' -Action {
                & $launcher -EnginePath $engine -BridgePath $bridge -OfficialExtensionPath $source -StateRoot $state -WorkspacePath $workspace -InstanceId $id -CodePath 'Invoke-AzraelLauncherMockCode' | Out-Null
            } | Out-Null
        }
        Assert-Condition ($global:AzraelLauncherCheckMockContext.Calls.Count -eq 4) 'Default launches did not make two calls each.'
        $defaultSockets = @($global:AzraelLauncherCheckMockContext.Calls | Select-Object -ExpandProperty Socket -Unique)
        Assert-Condition ($defaultSockets.Count -eq 2) 'Separate launched instances reused the default management socket.'
        $userData = @($global:AzraelLauncherCheckMockContext.Calls | ForEach-Object { $i = [Array]::IndexOf($_.Args, '--user-data-dir'); $_.Args[$i + 1] } | Select-Object -Unique)
        Assert-Condition ($userData.Count -eq 2) 'Separate launched instances reused the user-data directory.'
        $results.Add([pscustomobject]@{ Behavior = 'Unique default socket and user data per launched editor'; Passed = $true })

        $dummyVsix = Join-Path $testPath 'azrael-ex.vsix'
        New-Item -ItemType File -Path $dummyVsix | Out-Null
        $global:AzraelLauncherCheckMockContext.Calls.Clear()
        $vsixMessage = Invoke-ExpectedFailure -Behavior 'Companion VSIX launch failure' -MessagePattern 'VS Code launch failed with exit code 37' -Action {
            & $launcher -EnginePath $engine -BridgePath $bridge -OfficialExtensionPath $source -StateRoot $state -WorkspacePath $workspace -InstanceId 'with-vsix' -CodePath 'Invoke-AzraelLauncherMockCode' -CompanionVsixPath $dummyVsix | Out-Null
        }
        Assert-Condition ($global:AzraelLauncherCheckMockContext.Calls.Count -eq 3) 'Companion launch did not install, list, then launch.'
        Assert-Condition ($global:AzraelLauncherCheckMockContext.Calls[0].Args -contains '--install-extension') 'Companion VSIX was not installed before launch.'
        $results.Add([pscustomobject]@{ Behavior = 'Optional absolute companion VSIX install'; Passed = $true; Detail = $vsixMessage })
    }
    finally {
        $env:CODEX_HOME = $callerRoot
        $env:AZRAEL_EX_MANAGEMENT_SOCKET = $callerSocket
        Remove-Variable -Name AzraelLauncherCheckMockContext -Scope Global -ErrorAction SilentlyContinue
    }

    [pscustomobject]@{ Engine = $engine; BaselineVersion = "$baselineVersion"; TestRoot = $testPath; Passed = $true; Results = $results } |
        ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultsPath -Encoding utf8NoBOM
    [pscustomobject]@{ Passed = $true; Engine = $engine; Version = "$baselineVersion"; TestRoot = $testPath; Results = $results.Count; Artifact = $resultsPath }
}
catch {
    [pscustomobject]@{ Engine = $engine; BaselineVersion = "$baselineVersion"; TestRoot = $testPath; Passed = $false; Results = $results; Error = $_.Exception.Message } |
        ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultsPath -Encoding utf8NoBOM
    throw
}
