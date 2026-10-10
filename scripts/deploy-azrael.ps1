#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]*$')][string]$ReleaseName,
    [string]$SourceRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'engine'),
    [string]$EngineTargetDirectory,
    [switch]$SkipEngineBuild,
    [string]$EngineDirectory,
    [string]$CodeModeHostPath,
    [string]$ComputerUseRuntimeDirectory,
    [string]$ComputerUsePluginDirectory,
    [string]$CompanionVsixPath,
    [string]$TypeScriptPath,
    [string]$UiSourcePath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/upstream-ui/26.1007.21434'),
    [string]$OriginalExtensionPath = (Join-Path $env:USERPROFILE '.vscode/extensions/openai.chatgpt-26.1007.21434-win32-x64'),
    [string]$OriginalAudioPath = (Join-Path $env:USERPROFILE '.vscode/extensions/openai.codex-audio-26.1007.21434'),
    [string]$CodePath = 'code.cmd',
    [string]$StateRoot = (Join-Path $env:USERPROFILE '.azrael-ex'),
    [string]$SourceCodexHome = (Join-Path $env:USERPROFILE '.codex'),
    [string]$WorkspacePath = (Split-Path $PSScriptRoot -Parent),
    [string]$ExtensionsDir = (Join-Path $env:USERPROFILE '.vscode/extensions'),
    [string]$UserDataDir,
    [switch]$VerifyOnly,
    [switch]$SkipCodexEnvironmentSnapshot,
    [switch]$FullRegression,
    [string[]]$ChangedPath,
    [switch]$VerifyAccountControls
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$UiSourcePath = [IO.Path]::GetFullPath($UiSourcePath)
$project = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$run = "deploy-$ReleaseName"
$logs = Join-Path $project "artifacts/logs/$run"
$release = Join-Path $project "artifacts/releases/$ReleaseName"
$package = Join-Path $project "artifacts/deployments/$run/package"
$fixture = Join-Path $project "artifacts/verification/$run"
$accountControlsState = Join-Path $project "artifacts/verification/account-controls-$ReleaseName"
$runPaths = @($logs, $release, (Join-Path $project "artifacts/logs/$ReleaseName"), (Split-Path $package -Parent), $fixture)
if ($VerifyAccountControls) { $runPaths += $accountControlsState }
foreach ($path in $runPaths) {
    if (Test-Path -LiteralPath $path) { throw "Run path already exists: $path. Use a new ReleaseName." }
}
if ($CompanionVsixPath -and -not $TypeScriptPath) { throw 'CompanionVsixPath requires the explicit TypeScriptPath from its pinned build staging.' }
if ($EngineDirectory -and -not $SkipEngineBuild) { throw 'EngineDirectory requires SkipEngineBuild.' }
if ($SkipEngineBuild -and (-not $EngineDirectory -or $CodeModeHostPath)) { throw 'SkipEngineBuild requires EngineDirectory and cannot select CodeModeHostPath.' }
if (-not $SkipEngineBuild -and -not $CodeModeHostPath) { throw 'A full build requires CodeModeHostPath.' }
if ($EngineTargetDirectory -and $SkipEngineBuild) { throw 'EngineTargetDirectory requires a full engine build.' }
if ($EngineTargetDirectory -and -not [IO.Path]::IsPathFullyQualified($EngineTargetDirectory)) { throw 'EngineTargetDirectory must be an absolute cache path.' }
if ($FullRegression -and $ChangedPath) { throw 'ChangedPath cannot be combined with FullRegression.' }
New-Item -ItemType Directory -Path $logs | Out-Null
$timer = [Diagnostics.Stopwatch]::StartNew()
$children = [Collections.Generic.List[object]]::new()
$metrics = [ordered]@{ schema = 1; releaseName = $ReleaseName; startedUtc = [DateTime]::UtcNow.ToString('o'); status = 'running'; verifyOnly = [bool]$VerifyOnly; releaseDirectory = $release; packageDirectory = $package; fixtureRoot = $fixture; stages = @(); inputChecks = @(); engineTargetDirectory = $EngineTargetDirectory; wallTimeMs = 0 }
$pwsh = (Get-Process -Id $PID).Path

function Get-ProjectSnapshot {
    param([string]$Phase)
    $checkTimer = [Diagnostics.Stopwatch]::StartNew()
    $report = Join-Path $logs "inputs-$Phase.json"
    $stdout = Join-Path $logs "inputs-$Phase.stdout.log"
    $stderr = Join-Path $logs "inputs-$Phase.stderr.log"
    & (Get-Command node -CommandType Application).Source (Join-Path $PSScriptRoot 'deployment-input-snapshot.cjs') $project $report 1> $stdout 2> $stderr
    $checkExit = $LASTEXITCODE
    $record = [ordered]@{ phase = $Phase; exitCode = $checkExit; durationMs = $checkTimer.Elapsed.TotalMilliseconds; report = $report }
    $metrics.inputChecks += $record
    if ($checkExit -ne 0) { throw "Project input snapshot failed ($checkExit). See $stderr" }
    $snapshot = Get-Content -LiteralPath $stdout -Raw | ConvertFrom-Json
    $record.fileCount = $snapshot.fileCount
    $record.bytes = $snapshot.bytes
    $record.sha256 = $snapshot.sha256
    $snapshot.sha256
}
function Assert-ProjectSnapshot {
    param([string]$Phase)
    if ((Get-ProjectSnapshot $Phase) -cne $script:inputSnapshot) { throw 'Project inputs changed during deployment. Use a new ReleaseName after source edits stop.' }
}
function Start-OwnedCommand {
    param([string]$Name, [string]$Executable, [string[]]$Arguments)
    $info = [Diagnostics.ProcessStartInfo]::new($Executable)
    $info.WorkingDirectory = $project
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($arg in $Arguments) { $info.ArgumentList.Add($arg) }
    $record = [ordered]@{ name = $Name; executable = $Executable; arguments = $Arguments; startedUtc = [DateTime]::UtcNow.ToString('o'); durationMs = 0; exitCode = $null; terminated = $false; stdout = (Join-Path $logs "$Name.stdout.log"); stderr = (Join-Path $logs "$Name.stderr.log") }
    $metrics.stages += $record
    $out = [IO.File]::Create($record.stdout)
    $err = [IO.File]::Create($record.stderr)
    try { $proc = [Diagnostics.Process]::Start($info) } catch { $out.Dispose(); $err.Dispose(); $record.startError = $_.Exception.Message; throw }
    $child = [pscustomobject]@{ Process = $proc; Record = $record; Timer = [Diagnostics.Stopwatch]::StartNew(); Out = $out; Err = $err; OutTask = $proc.StandardOutput.BaseStream.CopyToAsync($out); ErrTask = $proc.StandardError.BaseStream.CopyToAsync($err); Completed = $false }
    $children.Add($child)
    return $child
}
function Complete-OwnedCommand {
    param($Child)
    if ($Child.Completed) { return }
    $Child.Process.WaitForExit()
    try { $Child.OutTask.GetAwaiter().GetResult(); $Child.ErrTask.GetAwaiter().GetResult() } finally { $Child.Out.Dispose(); $Child.Err.Dispose() }
    $Child.Record.exitCode = $Child.Process.ExitCode
    $Child.Record.durationMs = $Child.Timer.Elapsed.TotalMilliseconds
    $Child.Completed = $true
}
function Wait-OwnedCommands {
    param([object[]]$Commands)
    while (@($Commands | Where-Object { -not $_.Completed }).Count) {
        foreach ($child in $Commands) {
            if (-not $child.Completed -and $child.Process.HasExited) {
                Complete-OwnedCommand $child
                if ($child.Record.exitCode -ne 0) { throw "$($child.Record.name) failed with exit code $($child.Record.exitCode). See $($child.Record.stderr) and $($child.Record.stdout)." }
            }
        }
        if (@($Commands | Where-Object { -not $_.Completed }).Count) { Start-Sleep -Milliseconds 100 }
    }
}
function Invoke-Stage {
    param([string]$Name, [string]$Script, [string[]]$Arguments)
    $child = Start-OwnedCommand $Name $pwsh (@('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot $Script)) + $Arguments)
    Wait-OwnedCommands @($child)
}
function Assert-Package {
    if ((Get-FileHash -LiteralPath $preparedPath).Hash -cne $script:preparedHash) { throw 'Prepared package metadata changed after preparation.' }
    if ((Get-FileHash -LiteralPath $prepared.HostVsix).Hash -ine $prepared.HostSha256) { throw 'Prepared package SHA-256 mismatch.' }
    $preservationBuild = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json
    $preservationConfig = [ordered]@{
        projectRoot = $project; uiRoot = $UiSourcePath; engineSourceRoot = [string]$preservationBuild.engineSourceRoot
        engineDirectory = (Join-Path $release 'engine'); area = 'ui'; typeScriptPath = $TypeScriptPath
        outputDirectory = (Join-Path $logs 'package-preservation')
        receiptPath = $prepared.PreservationReceipt; reportPath = $prepared.PreservationReport
        packagePath = $prepared.HostVsix; bindingPath = $prepared.PreservationBinding
    }
    if ($prepared.PSObject.Properties['PreservationFeatureIds']) {
        $preservationConfig.featureIds = @($prepared.PreservationFeatureIds)
    }
    $preservationConfigPath = Join-Path $logs 'package-preservation-inputs.json'
    $preservationConfig | ConvertTo-Json | Set-Content -LiteralPath $preservationConfigPath -Encoding utf8NoBOM
    & node (Join-Path $PSScriptRoot 'feature-preservation.cjs') verify --config $preservationConfigPath *> (Join-Path $logs 'package-preservation.log')
    if ($LASTEXITCODE -ne 0) { throw 'Package feature preservation verification failed. See package-preservation.log.' }
    $archive = [IO.Compression.ZipFile]::OpenRead($prepared.HostVsix)
    try {
        $entry = $archive.GetEntry('extension/package.json')
        if (-not $entry) { throw 'Prepared package manifest is missing.' }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ([string]$manifest.version -cne [string]$prepared.HostVersion) { throw 'Prepared package version mismatch.' }
    } finally { $archive.Dispose() }
}
try {
    $script:inputSnapshot = Get-ProjectSnapshot 'initial'
    $metrics.projectInputSha256 = $inputSnapshot
    $buildArgs = @('-ReleaseName', $ReleaseName, '-SourceRoot', $SourceRoot)
    if ($EngineTargetDirectory) { $buildArgs += @('-EngineTargetDirectory', $EngineTargetDirectory) }
    if ($ComputerUseRuntimeDirectory) { $buildArgs += @('-ComputerUseRuntimeDirectory', $ComputerUseRuntimeDirectory) }
    if ($ComputerUsePluginDirectory) { $buildArgs += @('-ComputerUsePluginDirectory', $ComputerUsePluginDirectory) }
    if ($SkipEngineBuild) { $buildArgs += @('-SkipEngineBuild', '-EngineDirectory', $EngineDirectory) } else { $buildArgs += @('-CodeModeHostPath', $CodeModeHostPath) }
    if ($CompanionVsixPath) { $buildArgs += @('-CompanionVsixPath', $CompanionVsixPath) }
    $sourceTestArgs = @((Join-Path $PSScriptRoot 'test-project.cjs'))
    if ($FullRegression) { $sourceTestArgs += @('--area', 'current', '--area', 'standalone') }
    else {
        $sourceTestArgs += '--changed-only'
        foreach ($path in $ChangedPath) { $sourceTestArgs += @('--changed', $path) }
    }
    $sourceTestArgs += @('--log-directory', (Join-Path $logs 'source-tests'))
    $metrics.testScope = $(if ($FullRegression) { 'full' } else { 'changed' })
    $metrics.changedPaths = @($ChangedPath)
    $sourceTests = Start-OwnedCommand 'source-tests' (Get-Command node -CommandType Application).Source $sourceTestArgs
    $build = Start-OwnedCommand 'build' $pwsh (@('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'build-azrael.ps1')) + $buildArgs)
    Wait-OwnedCommands @($sourceTests, $build)
    Assert-ProjectSnapshot 'post-build'
    $preservationBuild = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json
    $enginePreservationConfig = [ordered]@{
        projectRoot = $project; engineSourceRoot = [string]$preservationBuild.engineSourceRoot
        engineDirectory = (Join-Path $release 'engine'); outputDirectory = (Join-Path $logs 'engine-preservation'); area = 'engine'
        reuseNativeChecks = -not [bool]$FullRegression
    }
    if (-not $FullRegression) {
        $enginePreservationConfig.featureIds = @('engine.provider-context', 'engine.recovery', 'engine.accepted-input')
    }
    $enginePreservationConfigPath = Join-Path $logs 'engine-preservation-inputs.json'
    $enginePreservationConfig | ConvertTo-Json | Set-Content -LiteralPath $enginePreservationConfigPath -Encoding utf8NoBOM
    $enginePreservation = Start-OwnedCommand 'engine-preservation' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'feature-preservation.cjs'), 'run', '--config', $enginePreservationConfigPath)
    Wait-OwnedCommands @($enginePreservation)
    $enginePreservationResult = Get-Content -LiteralPath $enginePreservation.Record.stdout -Raw | ConvertFrom-Json
    $enginePreservationConfig.receiptPath = [string]$enginePreservationResult.receiptPath
    $enginePreservationConfig | ConvertTo-Json | Set-Content -LiteralPath $enginePreservationConfigPath -Encoding utf8NoBOM
    if ($VerifyAccountControls) {
        $enginePath = Join-Path $release 'engine/codex.exe'
        $bridgePath = Join-Path $release 'engine/azrael-bridge.exe'
        $socketPath = Join-Path $accountControlsState 'socket/a.sock'
        if ([Text.Encoding]::UTF8.GetByteCount($socketPath) -gt 100) {
            $socketPath = Join-Path ([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) "ac-$([guid]::NewGuid().ToString('N'))/a.sock"
        }
        if ([Text.Encoding]::UTF8.GetByteCount($socketPath) -gt 100) { throw 'Account controls socket path exceeds the Windows AF_UNIX limit.' }
        if (Test-Path -LiteralPath (Split-Path $socketPath -Parent)) { throw 'Account controls socket directory already exists.' }
        $reportPath = Join-Path $accountControlsState 'verification.json'
        $metrics.accountControls = [ordered]@{ status = 'running'; verification = $reportPath; stateRoot = $accountControlsState; socket = $socketPath; engine = $enginePath; bridge = $bridgePath; engineSha256 = (Get-FileHash -LiteralPath $enginePath).Hash; bridgeSha256 = (Get-FileHash -LiteralPath $bridgePath).Hash }
        $accountCheck = Start-OwnedCommand 'account-controls' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'check-accounts.mjs'), $enginePath, $bridgePath, $accountControlsState, $socketPath, '--account-controls-only')
        Wait-OwnedCommands @($accountCheck)
        $accountReport = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
        if ($accountReport.status -cne 'passed' -or $accountReport.route -cne 'account-controls' -or
            -not [IO.Path]::IsPathFullyQualified($accountReport.engine) -or [IO.Path]::GetFullPath($accountReport.engine) -ine $enginePath -or
            -not [IO.Path]::IsPathFullyQualified($accountReport.bridge) -or [IO.Path]::GetFullPath($accountReport.bridge) -ine $bridgePath -or
            ($accountReport.modelRequests -isnot [long] -and $accountReport.modelRequests -isnot [int]) -or $accountReport.modelRequests -ne 0 -or
            ($accountReport.usageCreditConsumeRequests -isnot [long] -and $accountReport.usageCreditConsumeRequests -isnot [int]) -or $accountReport.usageCreditConsumeRequests -ne 0) {
            throw 'Account controls verification status, route, binary identity, or request counts mismatch.'
        }
        if ((Get-FileHash -LiteralPath $enginePath).Hash -cne $metrics.accountControls.engineSha256 -or (Get-FileHash -LiteralPath $bridgePath).Hash -cne $metrics.accountControls.bridgeSha256) { throw 'Account controls binaries changed during verification.' }
        $metrics.accountControls.status = 'passed'
    }
    if (-not $TypeScriptPath) {
        if ($preservationBuild.PSObject.Properties['moduleBuild'] -and $preservationBuild.moduleBuild.PSObject.Properties['typeScriptPath']) {
            $TypeScriptPath = $preservationBuild.moduleBuild.typeScriptPath
        }
        if (-not $TypeScriptPath) { $TypeScriptPath = Join-Path $project "artifacts/build/$ReleaseName/companion/node_modules/typescript/lib/typescript.js" }
    }
    $TypeScriptPath = (Resolve-Path -LiteralPath $TypeScriptPath).Path
    $prepareArgs = @('-ReleaseDirectory', $release, '-OutputDirectory', $package, '-StateRoot', $StateRoot, '-SourceCodexHome', $SourceCodexHome, '-SourceExtensionPath', $UiSourcePath, '-TypeScriptPath', $TypeScriptPath)
    if ($SkipCodexEnvironmentSnapshot) { $prepareArgs += '-SkipCodexEnvironmentSnapshot' }
    if (-not $FullRegression) { $prepareArgs += '-ChangedOnlyTests' }
    Invoke-Stage 'prepare' 'prepare-independent-vscode.ps1' $prepareArgs
    $preparedPath = Join-Path $package 'independent-prepared.json'
    $prepared = Get-Content -LiteralPath $preparedPath -Raw | ConvertFrom-Json
    if ([IO.Path]::GetFullPath($prepared.ReleaseDirectory) -ine $release -or [IO.Path]::GetFullPath($prepared.HostVsix) -ine (Join-Path $package 'azrael-host.vsix')) { throw 'Preparation returned a different release or package path.' }
    $script:preparedHash = (Get-FileHash -LiteralPath $preparedPath).Hash
    Assert-Package
    Invoke-Stage 'acceptance' 'check-independent-vscode.ps1' @('-HostVsixPath', $prepared.HostVsix, '-FixtureRoot', $fixture, '-StateRoot', (Join-Path $fixture 'state'), '-UseFreshState', '-TypeScriptPath', $TypeScriptPath, '-UiSourcePath', $UiSourcePath, '-OriginalExtensionPath', $OriginalExtensionPath, '-OriginalAudioPath', $OriginalAudioPath, '-CodePath', $CodePath)
    $acceptancePath = Join-Path $fixture 'check-result.json'
    $acceptance = Get-Content -LiteralPath $acceptancePath -Raw | ConvertFrom-Json
    $stages = @('initialInventory', 'hostInstall', 'finalInventory', 'namespace', 'standaloneHost', 'host')
    if ($acceptance.passed -isnot [bool] -or $acceptance.passed -cne $true -or @($acceptance.exitCodes.PSObject.Properties).Count -ne 6) { throw 'Host acceptance did not pass all six stages.' }
    foreach ($stage in $stages) {
        $value = $acceptance.exitCodes.PSObject.Properties[$stage]
        if ($null -eq $value -or $null -eq $value.Value -or $value.Value -isnot [long] -and $value.Value -isnot [int] -or $value.Value -ne 0) { throw "Host acceptance stage failed or missing: $stage" }
    }
    if ($acceptance.useFreshState -isnot [bool] -or $acceptance.useFreshState -cne $true -or [IO.Path]::GetFullPath($acceptance.hostPackage.vsix) -ine $prepared.HostVsix -or $acceptance.hostPackage.sha256 -ine $prepared.HostSha256 -or [string]$acceptance.hostPackage.version -cne [string]$prepared.HostVersion) { throw 'Host acceptance package identity or fresh state mismatch.' }
    Assert-Package
    Assert-ProjectSnapshot 'pre-install'
    $engineRecheck = Start-OwnedCommand 'engine-preservation-recheck' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'feature-preservation.cjs'), 'verify-receipt', '--config', $enginePreservationConfigPath)
    Wait-OwnedCommands @($engineRecheck)
    $metrics.acceptanceResult = $acceptancePath
    $metrics.hostPackage = @{ vsix = $prepared.HostVsix; sha256 = $prepared.HostSha256; version = $prepared.HostVersion }
    if (-not $VerifyOnly) {
        $installArgs = @{ ReleaseDirectory = $release; PreparedPackageDirectory = $package; StateRoot = $StateRoot; SourceCodexHome = $SourceCodexHome; WorkspacePath = $WorkspacePath; ExtensionsDir = $ExtensionsDir; CodePath = $CodePath; NoLaunch = $true; SkipCodexEnvironmentSnapshot = [bool]$SkipCodexEnvironmentSnapshot }
        if ($UserDataDir) { $installArgs.UserDataDir = $UserDataDir }
        $argsPath = Join-Path $logs 'install-arguments.json'
        $installArgs | ConvertTo-Json | Set-Content -LiteralPath $argsPath -Encoding utf8NoBOM
        $resultPath = Join-Path $logs 'install-result.json'
        $wrapper = Join-Path $logs 'invoke-install.ps1'
        @'
param([string]$Script, [string]$ArgumentsPath, [string]$ResultPath)
$ErrorActionPreference = 'Stop'
$arguments = Get-Content -LiteralPath $ArgumentsPath -Raw | ConvertFrom-Json -AsHashtable
$global:LASTEXITCODE = 0
$result = @(& $Script @arguments)
$installExitCode = $global:LASTEXITCODE
$result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ResultPath -Encoding utf8NoBOM
if ($installExitCode -ne 0) {
    [Console]::Error.WriteLine("Installer returned exit code $installExitCode.")
    exit $installExitCode
}
'@ | Set-Content -LiteralPath $wrapper -Encoding utf8NoBOM
        $metrics.installation = [ordered]@{ status = 'started'; resultPath = $resultPath; receipt = $null }
        $install = Start-OwnedCommand 'install' $pwsh @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $wrapper, '-Script', (Join-Path $PSScriptRoot 'install-azrael.ps1'), '-ArgumentsPath', $argsPath, '-ResultPath', $resultPath)
        Wait-OwnedCommands @($install)
        if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) { throw 'Installer result was not recorded.' }
        $metrics.installResult = $resultPath
        # The owning installer returns the exact retained receipt path in its result.
        $metrics.installerResult = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
        $installedResults = @($metrics.installerResult | Where-Object { $null -ne $_ -and $null -ne $_.PSObject.Properties['Installed'] })
        if ($installedResults.Count -ne 1) { throw 'Installer did not return one successful installation result.' }
        $installed = $installedResults[0]
        if ($installed.Installed -isnot [bool] -or $installed.Installed -cne $true -or $installed.ReloadRequired -isnot [bool] -or $installed.ReloadRequired -cne $true -or
            $installed.Launched -isnot [bool] -or $installed.Launched -cne $false -or
            [IO.Path]::GetFullPath($installed.ReleaseDirectory) -ine $release -or [IO.Path]::GetFullPath($installed.HostVsix) -ine $prepared.HostVsix) {
            throw 'Installer result does not confirm installation of the tested release/package with reload required and no launch.'
        }
        if (-not [IO.Path]::IsPathFullyQualified($installed.Receipt) -or -not (Test-Path -LiteralPath $installed.Receipt -PathType Leaf)) { throw 'Installer receipt is missing or its path is not absolute.' }
        $metrics.installation.receipt = [IO.Path]::GetFullPath($installed.Receipt)
        $receipt = Get-Content -LiteralPath $metrics.installation.receipt -Raw | ConvertFrom-Json
        if ($receipt.status -cne 'installed-reload-required' -or $receipt.hostInstalled -isnot [bool] -or $receipt.hostInstalled -cne $true -or
            $receipt.reloadRequired -isnot [bool] -or $receipt.reloadRequired -cne $true -or
            [IO.Path]::GetFullPath($receipt.releaseDirectory) -ine $release -or [IO.Path]::GetFullPath($receipt.packageDirectory) -ine $package -or
            [IO.Path]::GetFullPath($receipt.hostVsix) -ine $prepared.HostVsix -or [string]$receipt.hostVersion -cne [string]$prepared.HostVersion) {
            throw 'Installer receipt does not confirm installation of the tested release/package/version.'
        }
        $metrics.installation.status = 'verified'
    }
    $metrics.status = if ($VerifyOnly) { 'verified' } else { 'installed' }
} catch {
    if ($metrics.Contains('accountControls') -and $metrics.accountControls.status -cne 'passed') { $metrics.accountControls.status = 'failed' }
    $metrics.status = if ($metrics.Contains('installation')) { $metrics.installation.status = 'failed'; 'installation-failed' } else { 'failed' }
    $metrics.error = $_.Exception.Message
    throw
} finally {
    foreach ($child in $children) {
        try {
            if (-not $child.Completed) {
                if (-not $child.Process.HasExited) { $child.Record.terminated = $true; $child.Process.Kill($true) }
                Complete-OwnedCommand $child
            }
        } finally { $child.Process.Dispose() }
    }
    $metrics.wallTimeMs = $timer.Elapsed.TotalMilliseconds
    $metrics | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $logs 'deployment-metrics.json') -Encoding utf8NoBOM
    if ($metrics.status -in @('verified', 'installed') -and @($metrics.stages | Where-Object { $null -eq $_.exitCode -or $_.exitCode -ne 0 -or $_.terminated }).Count -eq 0) {
        try {
            # Publish the durable acceptance reference before the cleaner inspects
            # installed/previous deployment dependencies. All children are disposed.
            $archivedAcceptance = Join-Path $project "artifacts/logs/verification-evidence/$run/check-result.json"
            for ($cursor = $archivedAcceptance; $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
                if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Linked acceptance archive path: $cursor" }
            }
            New-Item -ItemType Directory -Path (Split-Path $archivedAcceptance -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $acceptancePath -Destination $archivedAcceptance -Force
            $acceptancePath = $archivedAcceptance
            $metrics.acceptanceResult = $archivedAcceptance
            $metrics | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $logs 'deployment-metrics.json') -Encoding utf8NoBOM
            $metrics.verificationCleanup = & (Join-Path $PSScriptRoot 'clean-verification-artifacts.ps1') -ProjectRoot $project -FixtureRoot $fixture -Apply -ReportPath (Join-Path $logs 'verification-cleanup.json')
            if ($VerifyAccountControls) {
                $metrics.accountControlsCleanup = & (Join-Path $PSScriptRoot 'clean-verification-artifacts.ps1') -ProjectRoot $project -FixtureRoot $accountControlsState -Apply -ReportPath (Join-Path $logs 'account-controls-cleanup.json')
                $accountCandidate = @($metrics.accountControlsCleanup.candidates | Where-Object status -eq 'deleted')
                if ($accountCandidate.Count -eq 1) { $metrics.accountControls.verification = Join-Path $project "artifacts/logs/verification-evidence/account-controls-$ReleaseName/verification.json" }
            }
        } catch { $metrics.verificationCleanup = @{ status = 'blocked'; reason = $_.Exception.Message; fixtureRoot = $fixture } }
        $metrics | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $logs 'deployment-metrics.json') -Encoding utf8NoBOM
    }
}
[pscustomobject]@{ Status = $metrics.status; ReleaseDirectory = $release; PreparedPackageDirectory = $package; AcceptanceResult = $acceptancePath; Metrics = (Join-Path $logs 'deployment-metrics.json') }
