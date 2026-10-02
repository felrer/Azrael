#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]*$')][string]$ReleaseName,
    [string]$SourceRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/worktrees/azrael-0.159.3'),
    [switch]$SkipEngineBuild,
    [string]$EngineDirectory,
    [string]$CodeModeHostPath,
    [string]$CompanionVsixPath,
    [string]$TypeScriptPath,
    [string]$UiSourcePath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/upstream-ui/26.928.31416'),
    [string]$OriginalExtensionPath = (Join-Path $env:USERPROFILE '.vscode/extensions/openai.chatgpt-26.928.31416-win32-x64'),
    [string]$OriginalAudioPath = (Join-Path $env:USERPROFILE '.vscode/extensions/openai.codex-audio-26.928.31416'),
    [string]$CodePath = 'code.cmd',
    [string]$StateRoot = (Join-Path $env:USERPROFILE '.azrael-ex'),
    [string]$SourceCodexHome = (Join-Path $env:USERPROFILE '.codex'),
    [string]$WorkspacePath = (Split-Path $PSScriptRoot -Parent),
    [string]$ExtensionsDir = (Join-Path $env:USERPROFILE '.vscode/extensions'),
    [string]$UserDataDir,
    [switch]$VerifyOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$run = "deploy-$ReleaseName"
$logs = Join-Path $project "artifacts/logs/$run"
$release = Join-Path $project "artifacts/releases/$ReleaseName"
$package = Join-Path $project "artifacts/deployments/$run/package"
$fixture = Join-Path $project "artifacts/verification/$run"
foreach ($path in @($logs, $release, (Join-Path $project "artifacts/logs/$ReleaseName"), (Split-Path $package -Parent), $fixture)) {
    if (Test-Path -LiteralPath $path) { throw "Run path already exists: $path. Use a new ReleaseName." }
}
if ($CompanionVsixPath -and -not $TypeScriptPath) { throw 'CompanionVsixPath requires the explicit TypeScriptPath from its pinned build staging.' }
if ($EngineDirectory -and -not $SkipEngineBuild) { throw 'EngineDirectory requires SkipEngineBuild.' }
if ($SkipEngineBuild -and (-not $EngineDirectory -or $CodeModeHostPath)) { throw 'SkipEngineBuild requires EngineDirectory and cannot select CodeModeHostPath.' }
if (-not $SkipEngineBuild -and -not $CodeModeHostPath) { throw 'A full build requires CodeModeHostPath.' }
New-Item -ItemType Directory -Path $logs | Out-Null
$timer = [Diagnostics.Stopwatch]::StartNew()
$children = [Collections.Generic.List[object]]::new()
$metrics = [ordered]@{ schema = 1; releaseName = $ReleaseName; startedUtc = [DateTime]::UtcNow.ToString('o'); status = 'running'; verifyOnly = [bool]$VerifyOnly; releaseDirectory = $release; packageDirectory = $package; fixtureRoot = $fixture; stages = @(); wallTimeMs = 0 }
$pwsh = (Get-Process -Id $PID).Path

function Get-ProjectSnapshot {
    param([string]$Directory = $project)
    $info = [Diagnostics.ProcessStartInfo]::new('git')
    $info.WorkingDirectory = $Directory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    foreach ($arg in @('ls-files', '--cached', '--others', '--exclude-standard', '-z')) { $info.ArgumentList.Add($arg) }
    $proc = [Diagnostics.Process]::Start($info)
    try {
        $errors = $proc.StandardError.ReadToEndAsync()
        $output = $proc.StandardOutput.ReadToEnd()
        $proc.WaitForExit()
        if ($proc.ExitCode -ne 0) { throw "Project input inventory failed ($($proc.ExitCode)): $($errors.GetAwaiter().GetResult())" }
    } finally { $proc.Dispose() }
    $inventory = foreach ($relative in @($output.Split([char]0, [StringSplitOptions]::RemoveEmptyEntries) | Sort-Object -Unique -CaseSensitive)) {
        $path = Join-Path $Directory $relative
        $hash = if (Test-Path -LiteralPath $path -PathType Leaf) {
            (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        } elseif (Test-Path -LiteralPath $path -PathType Container) {
            # ls-files emits directories for gitlinks. Include their actual worktree
            # contents; an uninitialized gitlink cannot establish a content snapshot.
            if (-not (Test-Path -LiteralPath (Join-Path $path '.git'))) { throw "Project gitlink is not initialized: $path" }
            Get-ProjectSnapshot -Directory $path
        } else { 'deleted' }
        [ordered]@{ path = $relative; sha256 = $hash }
    }
    $json = ConvertTo-Json -InputObject @($inventory) -Depth 4 -Compress
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($json)))
}
function Assert-ProjectSnapshot {
    if ((Get-ProjectSnapshot) -cne $script:inputSnapshot) { throw 'Project inputs changed during deployment. Use a new ReleaseName after source edits stop.' }
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
    $script:inputSnapshot = Get-ProjectSnapshot
    $metrics.projectInputSha256 = $inputSnapshot
    $buildArgs = @('-ReleaseName', $ReleaseName, '-SourceRoot', $SourceRoot)
    if ($SkipEngineBuild) { $buildArgs += @('-SkipEngineBuild', '-EngineDirectory', $EngineDirectory) } else { $buildArgs += @('-CodeModeHostPath', $CodeModeHostPath) }
    if ($CompanionVsixPath) { $buildArgs += @('-CompanionVsixPath', $CompanionVsixPath) }
    $sourceTests = Start-OwnedCommand 'source-tests' (Get-Command node -CommandType Application).Source @((Join-Path $PSScriptRoot 'test-project.cjs'), '--area', 'current', '--area', 'standalone', '--log-directory', (Join-Path $logs 'source-tests'))
    $build = Start-OwnedCommand 'build' $pwsh (@('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'build-azrael.ps1')) + $buildArgs)
    Wait-OwnedCommands @($sourceTests, $build)
    Assert-ProjectSnapshot
    if (-not $TypeScriptPath) { $TypeScriptPath = Join-Path $project "artifacts/build/$ReleaseName/companion/node_modules/typescript/lib/typescript.js" }
    $TypeScriptPath = (Resolve-Path -LiteralPath $TypeScriptPath).Path
    Invoke-Stage 'prepare' 'prepare-independent-vscode.ps1' @('-ReleaseDirectory', $release, '-OutputDirectory', $package, '-StateRoot', $StateRoot, '-SourceCodexHome', $SourceCodexHome, '-SourceExtensionPath', $UiSourcePath, '-TypeScriptPath', $TypeScriptPath)
    $preparedPath = Join-Path $package 'independent-prepared.json'
    $prepared = Get-Content -LiteralPath $preparedPath -Raw | ConvertFrom-Json
    if ([IO.Path]::GetFullPath($prepared.ReleaseDirectory) -ine $release -or [IO.Path]::GetFullPath($prepared.HostVsix) -ine (Join-Path $package 'azrael-host.vsix')) { throw 'Preparation returned a different release or package path.' }
    $script:preparedHash = (Get-FileHash -LiteralPath $preparedPath).Hash
    Assert-Package
    Assert-ProjectSnapshot
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
    Assert-ProjectSnapshot
    $metrics.acceptanceResult = $acceptancePath
    $metrics.hostPackage = @{ vsix = $prepared.HostVsix; sha256 = $prepared.HostSha256; version = $prepared.HostVersion }
    if (-not $VerifyOnly) {
        $installArgs = @{ ReleaseDirectory = $release; PreparedPackageDirectory = $package; StateRoot = $StateRoot; SourceCodexHome = $SourceCodexHome; WorkspacePath = $WorkspacePath; ExtensionsDir = $ExtensionsDir; CodePath = $CodePath; NoLaunch = $true }
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
}
[pscustomobject]@{ Status = $metrics.status; ReleaseDirectory = $release; PreparedPackageDirectory = $package; AcceptanceResult = $acceptancePath; Metrics = (Join-Path $logs 'deployment-metrics.json') }
