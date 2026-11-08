#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$HostVsixPath,
    [string]$StateRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.azrael-ex'),
    [switch]$UseFreshState,
    [string]$CodePath = 'code.cmd',
    [string]$FixtureRoot,
    [string]$ParentLifecycleId,
    [switch]$VerifyInstructions
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
. (Join-Path $PSScriptRoot 'artifact-lifecycle.ps1')
$runId = [guid]::NewGuid().ToString('N')
$runRoot = Join-Path $projectRoot "artifacts/tasks/check-independent-vscode/runs/$runId"
$lifecycleId = "run:check-independent-vscode:$runId"
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
if (-not $FixtureRoot) { $FixtureRoot = Join-Path $projectRoot "artifacts/tasks/check-independent-vscode/runs/$runId/temporary" }
if (-not [IO.Path]::IsPathFullyQualified($FixtureRoot)) { throw 'FixtureRoot must be an absolute path.' }
$fixture = [IO.Path]::GetFullPath($FixtureRoot).TrimEnd('\', '/')
if (Test-Path -LiteralPath $fixture) { throw "FixtureRoot must be a new path: $fixture" }
. (Join-Path $PSScriptRoot 'verification-state.ps1')
$state = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\', '/')
Assert-AzraelVerificationStatePath -StateRoot $state

function Resolve-File {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Name)
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw "$Name must be absolute." }
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) { throw "$Name must be a file: $Path" }
    $resolved.Path
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

$parentLifecycle = $null
$ownershipCheck = @(& node -e 'const path=require("node:path"),{catalog}=require(process.argv[1]);const root=process.argv[2],fixture=process.argv[3],parentId=process.argv[4],runRoot=process.argv[5],inside=(a,b)=>{const r=path.relative(a,b);return !r||(!path.isAbsolute(r)&&r!==".."&&!r.startsWith(".."+path.sep))};const records=catalog(root);if(parentId!=="none"){const parent=records.find(r=>r.id===parentId);if(!parent||parent.state!=="pending"||!parent.members.some(m=>inside(m.path,fixture)))throw Error("Parent lifecycle must own planned fixture");process.stdout.write(JSON.stringify(parent));}else{for(const d of [runRoot,fixture]){if(!inside(path.join(root,"artifacts"),d)||d===path.join(root,"artifacts"))throw Error("Output outside artifacts");if(records.some(r=>r.members.some(m=>inside(m.path,d)||inside(d,m.path))))throw Error("Output already claimed");}process.stdout.write("null");}' (Join-Path $PSScriptRoot 'artifact-lifecycle.cjs') $projectRoot $fixture $(if ($ParentLifecycleId) { $ParentLifecycleId } else { 'none' }) $runRoot 2>&1)
if ($LASTEXITCODE -ne 0) { throw ($ownershipCheck -join "`n") }
$parentLifecycle = ($ownershipCheck -join "`n") | ConvertFrom-Json
if ($parentLifecycle) { $lifecycleId = $ParentLifecycleId; $runRoot = $fixture }
$logDirectory = Join-Path $runRoot 'logs'
$lifecycleMembers = [ordered]@{run=$runRoot;fixture=$fixture;logs=$logDirectory}
if (-not $parentLifecycle) { $null = Register-ArtifactLifecycle -ProjectRoot $projectRoot -Id $lifecycleId -Kind run -Owner 'check-independent-vscode' -State pending -MembershipComplete $false -Members $lifecycleMembers }
$lifecycleSucceeded = $false
$logPath = Join-Path $logDirectory "same-window-$stamp.log"
$resultPath = Join-Path $fixture 'host-result.json'
$summaryPath = Join-Path $fixture 'check-result.json'
$userData = Join-Path $fixture 'user-data'
$fixtureOrdinaryHome = Join-Path $fixture 'original-state'
$extensions = Join-Path $fixture 'extensions'
$workspace = Join-Path $fixture 'workspace'
New-Item -ItemType Directory -Path $logDirectory, (Join-Path $userData 'User'), $fixtureOrdinaryHome, $extensions, $workspace -Force | Out-Null

$exitCodes = [ordered]@{ initialInventory = $null; hostInstall = $null; finalInventory = $null; host = $null }
$runtimeConfigOverride = $null
try {
    $initial = @(& $code --user-data-dir $userData --extensions-dir $extensions --list-extensions --show-versions 2>&1)
    $exitCodes.initialInventory = $LASTEXITCODE
    @($initial) | Set-Content -LiteralPath $logPath -Encoding utf8NoBOM
    if ($exitCodes.initialInventory -ne 0 -or @($initial | Where-Object { $_ -match '^openai\.(chatgpt|codex-audio)@' -or $_ -match '^azrael-ex-local\.azrael@' }).Count) {
        throw "Initial fixture inventory was not an empty host profile (exit $($exitCodes.initialInventory))."
    }

    $hostInstall = @(& $code --user-data-dir $userData --extensions-dir $extensions --install-extension $hostVsix 2>&1)
    $exitCodes.hostInstall = $LASTEXITCODE
    @($hostInstall) | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM
    if ($exitCodes.hostInstall -ne 0) { throw "Independent host VSIX install failed with exit code $($exitCodes.hostInstall)." }

    $inventory = @(& $code --user-data-dir $userData --extensions-dir $extensions --list-extensions --show-versions 2>&1)
    $exitCodes.finalInventory = $LASTEXITCODE
    @($inventory) | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM
    if (@($inventory | Where-Object { $_ -match '^openai\.(chatgpt|codex-audio)@' }).Count) { throw 'Standalone fixture unexpectedly contained official Codex or audio.' }
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
    # Static namespace/transform regressions belong to preparation preservation.
    # This boundary certifies the exact VSIX by installing and activating it.

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
        $env:SAME_WINDOW_VERIFY_INSTRUCTIONS = if ($VerifyInstructions) { '1' } else { '0' }
        # Only the test runner is a development extension; Azrael is installed normally.
        $hostOutput = @(& $code --disable-updates --disable-workspace-trust --user-data-dir $userData --extensions-dir $extensions --new-window --wait --skip-welcome --skip-release-notes `
            --extensionDevelopmentPath $runner $workspace 2>&1)
        $exitCodes.host = $LASTEXITCODE
        @($hostOutput) | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM
    } finally {
        Remove-Item Env:SAME_WINDOW_CHECK_ROOT -ErrorAction SilentlyContinue
        Remove-Item Env:SAME_WINDOW_EXPECTED_STATE_ROOT -ErrorAction SilentlyContinue
        Remove-Item Env:SAME_WINDOW_EXPECTED_ORDINARY_HOME -ErrorAction SilentlyContinue
        Remove-Item Env:SAME_WINDOW_EXPECTED_HOST_VERSION -ErrorAction SilentlyContinue
        Remove-Item Env:SAME_WINDOW_VERIFY_INSTRUCTIONS -ErrorAction SilentlyContinue
        Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
        foreach ($entry in $savedEnvironment.GetEnumerator()) { Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value }
    }
    if ($exitCodes.host -ne 0) { throw "Same-window VS Code extension-host check failed with exit code $($exitCodes.host)." }
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not (Test-Path -LiteralPath $resultPath -PathType Leaf) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
    if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) { throw 'Same-window host result was not written.' }
    $hostResult = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json -AsHashtable
    if ($hostResult['passed'] -ne $true) { throw "Same-window host result failed: $($hostResult['error'])" }

    if ($hostResult.mode -cne 'standalone' -or $hostResult.instructionsVerified -isnot [bool] -or $hostResult.instructionsVerified -ne [bool]$VerifyInstructions) { throw 'Host result mode or Instructions scope mismatch.' }
    $summary = [ordered]@{
        passed = $true; lifecycleId = $lifecycleId; runRoot = $runRoot; fixtureRoot = $fixture; hostResult = $resultPath; log = $logPath
        hostMode = 'standalone'; standaloneVerified = $true; instructionsVerified = [bool]$VerifyInstructions
        exitCodes = $exitCodes; inventory = $inventory; useFreshState = [bool]$UseFreshState
        hostPackage = [ordered]@{ vsix = $hostVsix; sha256 = $hostVsixSha256; version = $hostVersion; installedPath = $installedHost }
        runtimeConfigOverride = $runtimeConfigOverride
        loginPerformed = $false; modelRequestPerformed = $false; newThreadPerformed = $false; testObjectMutationPerformed = $false
    }
    $summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summaryPath -Encoding utf8NoBOM
    [pscustomobject]$summary
    $lifecycleSucceeded = $true
    $global:LASTEXITCODE = 0
} catch {
    $failure = $_
    if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) { $failure.Exception.ToString() | Set-Content -LiteralPath $logPath -Encoding utf8NoBOM }
    $failureResult = [ordered]@{
        passed = $false; lifecycleId = $lifecycleId; runRoot = $runRoot; fixtureRoot = $fixture; log = $logPath; exitCodes = $exitCodes; useFreshState = [bool]$UseFreshState
        hostMode = 'standalone'; standaloneVerified = $false; instructionsVerified = $false
        hostPackage = [ordered]@{ vsix = $hostVsix; sha256 = $hostVsixSha256 }; runtimeConfigOverride = $runtimeConfigOverride
        error = $failure.Exception.Message; loginPerformed = $false; modelRequestPerformed = $false; newThreadPerformed = $false; testObjectMutationPerformed = $false
    }
    $failureResult | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summaryPath -Encoding utf8NoBOM
    throw
}

finally {
    $producerStopped = $false
    try {
        $ownedProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($userData) })
        $producerStopped = $ownedProcesses.Count -eq 0
    } catch { $producerStopped = $false }
    $stateResult = if (-not $producerStopped) { 'pending' } elseif ($lifecycleSucceeded) { 'complete' } else { 'failed' }
    if (-not $parentLifecycle) { $null = Register-ArtifactLifecycle -ProjectRoot $projectRoot -Id $lifecycleId -Kind run -Owner 'check-independent-vscode' -State $stateResult -MembershipComplete ($lifecycleSucceeded -and $producerStopped) -Members $lifecycleMembers }
    if (-not $producerStopped) { throw 'Owned verification process exit remains unconfirmed; artifacts remain pending.' }
}
