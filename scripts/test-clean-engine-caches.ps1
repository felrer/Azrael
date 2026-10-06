#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixture = Join-Path $project ('artifacts/verification/engine-cache-cleanup-' + [guid]::NewGuid().ToString('N'))
$external = Join-Path $fixture 'external'
$sandbox = Join-Path $fixture 'project'
$cleaner = Join-Path $PSScriptRoot 'clean-engine-caches.ps1'
$links = [Collections.Generic.List[string]]::new()
$global:EngineCacheFixtureProcesses = @()
$global:EngineCacheFixtureInspectionFails = $false
$global:EngineCacheFixtureBeforeInspection = $null
# Process inspection is deterministic and never terminates a real user process.
function Get-CimInstance {
    param($ClassName, $ErrorAction)
    if ($global:EngineCacheFixtureInspectionFails) { throw 'Fixture process inspection unavailable' }
    if ($global:EngineCacheFixtureBeforeInspection) { & $global:EngineCacheFixtureBeforeInspection }
    $global:EngineCacheFixtureProcesses
}
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Source([string]$Relative, [string]$Version) {
    $root = Join-Path $sandbox $Relative
    [IO.Directory]::CreateDirectory((Join-Path $root 'codex-rs/target')) | Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $root '.git')) | Out-Null
    $manifest = "[package]`nversion = '9.0.0'`n[workspace.package]`nversion = '$Version'`n"
    [IO.File]::WriteAllText((Join-Path $root 'codex-rs/Cargo.toml'), $manifest)
    [IO.File]::WriteAllText((Join-Path $root 'codex-rs/target/cache.txt'), 'cache')
    return $root
}
function Run([switch]$Apply, [string]$Target, [switch]$Prepare, [string]$Root = $sandbox, [string]$Report, [string]$CurrentSource, [string[]]$Protected = @()) {
    $arguments = @{ ProjectRoot = $Root; Apply = [bool]$Apply }
    $arguments.ProtectedPaths = $Protected
    if ($Target) { $arguments.TargetDirectory = $Target }
    if ($Prepare) { $arguments.PrepareTarget = $true }
    if ($Report) { $arguments.ReportPath = $Report }
    if ($CurrentSource) { $arguments.CurrentSourceRoot = $CurrentSource }
    return (& $cleaner @arguments | ConvertFrom-Json)
}
function Junction([string]$Path, [string]$Destination) {
    New-Item -ItemType Junction -Path $Path -Target $Destination | Out-Null
    $links.Add($Path)
}
try {
    $current = Source 'engine' '2.0.0'
    $old = Source 'upstream/codex' '1.9.0'
    $equal = Source 'artifacts/worktrees/equal' '2.0.0'
    $new = Source 'artifacts/source-snapshots/new' '3.0.0'
    $unknown = Source 'artifacts/worktrees/unknown' 'invalid'
    $pre = Source 'artifacts/source-snapshots/prerelease' '2.0.0-rc.1'
    $unknownManifest = Join-Path $unknown 'codex-rs/Cargo.toml'
    [IO.File]::WriteAllText($unknownManifest, "[package]`nversion = '0.1.0'`n")
    [IO.Directory]::CreateDirectory($external) | Out-Null
    $sentinel = Join-Path $external 'sentinel.txt'
    [IO.File]::WriteAllText($sentinel, 'external survives')
    foreach ($primitive in @('powershell', 'dotnet')) {
        $nativeSucceeded = $true
        $probe = Join-Path $fixture ('primitive-' + $primitive)
        $probeLong = Join-Path $probe ('long-segment/' * 24)
        [IO.Directory]::CreateDirectory($probeLong) | Out-Null
        [IO.File]::WriteAllText((Join-Path $probeLong 'long.txt'), 'long cache')
        Junction (Join-Path $probe 'nested-junction') $external
        try {
            $symbolicLink = Join-Path $probe 'nested-symlink'
            New-Item -ItemType SymbolicLink -Path $symbolicLink -Target $external -ErrorAction Stop | Out-Null
            $links.Add($symbolicLink)
            Write-Output "INFO: $primitive directory symlink fixture created"
        } catch { Write-Output "LIMITATION: $primitive directory symlink creation unavailable: $($_.Exception.Message)" }
        if ($primitive -eq 'powershell') {
            $readOnlyFile = Join-Path $probe 'readonly.txt'
            [IO.File]::WriteAllText($readOnlyFile, 'readonly cache')
            [IO.File]::SetAttributes($readOnlyFile, [IO.FileAttributes]::ReadOnly)
            Remove-Item -LiteralPath $probe -Recurse -Force -ErrorAction Stop
        } else {
            try { [IO.Directory]::Delete($probe, $true) }
            catch {
                $nativeSucceeded = $false
                Write-Output "INFO: .NET recursive delete unavailable for this link fixture: $($_.Exception.Message)"
                # The PowerShell primitive was independently verified above.
                Remove-Item -LiteralPath $probe -Recurse -Force -ErrorAction Stop
            }
        }
        Assert (-not (Test-Path -LiteralPath $probe)) "$primitive did not remove fixture"
        Assert ([IO.File]::ReadAllText($sentinel) -eq 'external survives') "$primitive followed a nested link"
        if ($nativeSucceeded) {
            Write-Output "PASS: $primitive recursive primitive preserves external sentinel and supports long paths"
        } else {
            Write-Output 'PASS: rejected .NET candidate safely cleaned using the verified PowerShell primitive'
        }
    }
    Junction (Join-Path $old 'codex-rs/target/external-link') $external
    [IO.File]::SetAttributes((Join-Path $old 'codex-rs/target/cache.txt'), [IO.FileAttributes]::ReadOnly)
    Junction (Join-Path $sandbox 'artifacts/worktrees/escaped') $external
    $long = Join-Path $old ('codex-rs/target/' + ('long-segment/' * 24))
    [IO.Directory]::CreateDirectory($long) | Out-Null
    [IO.File]::WriteAllText((Join-Path $long 'long.txt'), 'long cache')
    $preview = Run
    Assert ($preview.status -eq 'preview') 'Expected preview'
    Assert ((@($preview.candidates | Where-Object status -eq selected)).Count -eq 2) 'Only older and prerelease caches selected'
    Assert (Test-Path -LiteralPath (Join-Path $old 'codex-rs/target/cache.txt')) 'Preview mutated cache'
    Write-Output 'PASS: preview, workspace-only version, semver prerelease, bounded root enumeration'

    foreach ($name in @('cargo.exe', 'rustc.exe', 'link.exe', 'MSBuild.exe')) {
        $global:EngineCacheFixtureProcesses = @([pscustomobject]@{ Name = $name; ProcessId = 42; ExecutablePath = 'C:\tools\build.exe' })
        $blocked = Run -Apply
        Assert ($blocked.status -eq 'blocked') "Running $name did not block"
        Assert (Test-Path -LiteralPath (Join-Path $old 'codex-rs/target')) 'Blocked cleanup mutated target'
    }
    $global:EngineCacheFixtureProcesses = @([pscustomobject]@{ Name = 'engine.exe'; ProcessId = 43; ExecutablePath = (Join-Path $old 'codex-rs/target/debug/engine.exe') })
    $runningSource = Run -Apply
    Assert (@($runningSource.candidates | Where-Object { $_.path -eq (Join-Path $old 'codex-rs/target') -and $_.status -eq 'preserved-running' }).Count -eq 1) 'Selected-cache executable did not preserve its cache'
    $global:EngineCacheFixtureProcesses = @()
    $global:EngineCacheFixtureInspectionFails = $true
    Assert ((Run -Apply).status -eq 'blocked') 'Failed process inspection did not block'
    $global:EngineCacheFixtureInspectionFails = $false
    Write-Output 'PASS: build process names and selected-cache executable block mutation'

    $reportFile = Join-Path $fixture 'report.json'
    $result = Run -Apply -Report $reportFile
    Assert ($result.status -eq 'completed') 'Apply failed'
    Assert (-not (Test-Path -LiteralPath (Join-Path $old 'codex-rs/target'))) 'Older cache retained'
    Assert (-not (Test-Path -LiteralPath (Join-Path $pre 'codex-rs/target'))) 'Prerelease cache retained'
    foreach ($root in @($current, $equal, $new, $unknown)) {
        Assert (Test-Path -LiteralPath (Join-Path $root 'codex-rs/target/cache.txt')) 'Current/newer/unknown removed'
    }
    Assert (Test-Path -LiteralPath (Join-Path $old '.git')) 'Source git removed'
    Assert (Test-Path -LiteralPath (Join-Path $old 'codex-rs/Cargo.toml')) 'Source manifest removed'
    Assert ([IO.File]::ReadAllText($sentinel) -eq 'external survives') 'Nested junction traversed'
    Assert ((Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json).status -eq 'completed') 'Report JSON mismatch'
    Write-Output 'PASS: older removed; source/current/newer/unknown preserved; nested junction sentinel and long paths'

    $alias = Join-Path $fixture 'alias'
    Junction $alias $sandbox
    Assert ((Run -Root $alias -Apply).status -eq 'blocked') 'Reparse project accepted'
    Junction (Join-Path $sandbox 'upstream/codex/codex-rs/target') $external
    Assert ((@((Run -Apply).candidates | Where-Object status -eq rejected)).Count -ge 2) 'Reparse cache/source accepted'
    Assert (Test-Path -LiteralPath $sentinel) 'Escaping junction sentinel removed'
    Write-Output 'PASS: project ancestor, source root, and target junction rejection'

    $target = Join-Path $current 'codex-rs/target'
    $prepared = Run -Target $target -Prepare -Apply
    Assert ($prepared.candidates[0].status -eq 'prepared') ('Unmarked source cache not adopted: ' + ($prepared | ConvertTo-Json -Depth 6 -Compress))
    Assert (Test-Path -LiteralPath (Join-Path $target 'cache.txt')) 'Adoption purged migration cache'
    Assert ((Run -Target $target -Prepare -Apply).candidates[0].status -eq 'prepared') 'Equal marker not preserved'
    Assert (Test-Path -LiteralPath (Join-Path $target 'cache.txt')) 'Equal marker purged cache'
    [IO.File]::WriteAllText((Join-Path $current 'codex-rs/Cargo.toml'), "[workspace.package]`nversion = '2.1.0'`n")
    $preview = Run -Target $target -Prepare
    Assert ($preview.candidates[0].status -eq 'selected-reset') 'Version switch preview missing reset'
    Assert (Test-Path -LiteralPath (Join-Path $target 'cache.txt')) 'Prepare preview mutated cache'
    $global:EngineCacheFixtureProcesses = @([pscustomobject]@{ Name = 'cargo.exe'; ProcessId = 44; ExecutablePath = 'C:\tools\cargo.exe' })
    Assert ((Run -Target $target -Prepare -Apply).status -eq 'blocked') 'Busy preparation not blocked'
    Assert (Test-Path -LiteralPath (Join-Path $target 'cache.txt')) 'Busy preparation mutated cache'
    $global:EngineCacheFixtureProcesses = @()
    $prepared = Run -Target $target -Prepare -Apply
    Assert ($prepared.candidates[0].status -eq 'prepared') 'Version switch reset failed'
    Assert (-not (Test-Path -LiteralPath (Join-Path $target 'cache.txt'))) 'Stale in-place outputs survived'
    Assert ((Get-Content -LiteralPath (Join-Path $target 'azrael-cache-version.json') -Raw | ConvertFrom-Json).engineVersion -eq '2.1.0') 'Marker not updated'
    [IO.File]::WriteAllText((Join-Path $target 'azrael-cache-version.json'), 'malformed')
    Assert ((Run -Target $target -Prepare -Apply).status -eq 'blocked') 'Malformed marker accepted'
    $childJson = & pwsh -NoProfile -File $cleaner -ProjectRoot $sandbox -TargetDirectory $target -PrepareTarget -Apply
    Assert ($LASTEXITCODE -eq 1) 'Child preparation refusal must exit 1'
    Assert (($childJson | ConvertFrom-Json).status -eq 'blocked') 'Child preparation refusal report missing'
    $childJson = & pwsh -NoProfile -File $cleaner -ProjectRoot $sandbox -TargetDirectory $target -PrepareTarget
    Assert ($LASTEXITCODE -eq 0) 'Preview refusal should remain advisory'
    foreach ($bad in @($sandbox, $current, (Join-Path $sandbox 'arbitrary'))) {
        Assert ((Run -Target $bad -Prepare -Apply).status -eq 'blocked') 'Unsafe prepare target accepted'
    }
    Assert ((Run -Target $external -Prepare -Apply).candidates[0].status -eq 'unmanaged') 'Outside target managed'
    $buildTarget = Join-Path $sandbox 'artifacts/build/cache'
    Assert ((Run -Target $buildTarget -Prepare -Apply).candidates[0].status -eq 'prepared') 'New build cache not registered'
    [IO.File]::WriteAllText((Join-Path $buildTarget 'stale.txt'), 'stale')
    [IO.File]::WriteAllText((Join-Path $buildTarget 'azrael-cache-version.json'), '{"engineVersion":"1.0.0"}')
    Assert ((Run -Target $buildTarget -Prepare -Apply).candidates[0].status -eq 'prepared') 'Registered build cache reset failed'
    Assert (-not (Test-Path -LiteralPath (Join-Path $buildTarget 'stale.txt'))) 'Registered build cache stale survived'
    $unmarked = Join-Path $sandbox 'artifacts/build/unmarked'
    [IO.Directory]::CreateDirectory($unmarked) | Out-Null
    Assert ((Run -Target $unmarked -Prepare -Apply).candidates[0].status -eq 'unmanaged') 'Existing unmarked build target adopted'
    $customSource = Source 'artifacts/engine-custom' '2.1.0'
    $customTarget = Join-Path $customSource 'codex-rs/target'
    Assert ((Run -Target $customTarget -Prepare -CurrentSource $customSource -Apply).candidates[0].status -eq 'prepared') 'Verified custom CurrentSourceRoot target refused'
    Assert (Test-Path -LiteralPath (Join-Path $customTarget 'cache.txt')) 'Custom source migration cache purged'
    [IO.File]::WriteAllText((Join-Path $customSource 'codex-rs/Cargo.toml'), "[workspace.package]`nversion = '1.0.0'`n")
    $oldBuild = Join-Path $sandbox 'artifacts/build/old-cache'
    $newBuild = Join-Path $sandbox 'artifacts/build/new-cache'
    $invalidBuild = Join-Path $sandbox 'artifacts/build/invalid-cache'
    foreach ($directory in @($oldBuild, $newBuild, $invalidBuild)) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
    [IO.File]::WriteAllText((Join-Path $oldBuild 'azrael-cache-version.json'), '{"engineVersion":"2.0.0"}')
    [IO.File]::WriteAllText((Join-Path $newBuild 'azrael-cache-version.json'), '{"engineVersion":"3.0.0"}')
    [IO.File]::WriteAllText((Join-Path $invalidBuild 'azrael-cache-version.json'), 'invalid')
    [IO.File]::WriteAllText((Join-Path $oldBuild 'stale.txt'), 'stale')
    Junction (Join-Path $oldBuild 'external-link') $external
    $buildPreview = Run
    Assert ((@($buildPreview.candidates | Where-Object { $_.path -eq $oldBuild -and $_.status -eq 'selected' })).Count -eq 1) 'Old registered build cache not selected'
    Assert (Test-Path -LiteralPath (Join-Path $oldBuild 'stale.txt')) 'Build-cache preview mutated target'
    $buildRetirement = Run -Apply
    Assert (-not (Test-Path -LiteralPath $oldBuild)) 'Old registered build cache retained'
    foreach ($directory in @($buildTarget, $newBuild, $invalidBuild, $unmarked)) {
        Assert (Test-Path -LiteralPath $directory) 'Equal/newer/invalid/unmanaged build cache removed'
    }
    Assert (Test-Path -LiteralPath (Join-Path $customTarget 'cache.txt')) 'Retirement expanded into arbitrary source roots'
    Assert (Test-Path -LiteralPath $sentinel) 'Registered-cache nested junction traversed'
    Write-Output 'PASS: custom CurrentSourceRoot preparation; registered older build-cache retirement; current/newer/unmanaged/invalid preservation'
    $performanceTarget = Join-Path $sandbox 'artifacts/build/performance-cache'
    [IO.Directory]::CreateDirectory($performanceTarget) | Out-Null
    [IO.File]::WriteAllText((Join-Path $performanceTarget 'azrael-cache-version.json'), '{"engineVersion":"1.0.0"}')
    for ($index = 0; $index -lt 5000; $index++) {
        [IO.File]::WriteAllText((Join-Path $performanceTarget ("cache-$index.txt")), 'small cache')
    }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $performanceResult = Run -Apply
    $timer.Stop()
    Assert (-not (Test-Path -LiteralPath $performanceTarget)) 'Performance cache not removed'
    Assert ($timer.Elapsed.TotalSeconds -lt 60) "5000-file cleanup exceeded 60s: $($timer.Elapsed.TotalSeconds)s"
    Write-Output ('PASS: 5000-file cleanup in {0:F3}s (60s regression limit)' -f $timer.Elapsed.TotalSeconds)
    $alternate = Join-Path $sandbox 'artifacts/build/c1609-rust-target'
    $alternateTwo = Join-Path $sandbox 'artifacts/build/codex-0160-rust-target'
    $preserved = Join-Path $sandbox 'artifacts/build/worktree-preserved-caches/previous/codex-rs/target'
    $protectedCache = Join-Path $sandbox 'artifacts/build/protected-rust-target'
    $activeCache = Join-Path $sandbox 'artifacts/build/active-rust-target'
    $unknownCache = Join-Path $sandbox 'artifacts/build/unknown-output'
    $sourceCache = Join-Path $sandbox 'artifacts/build/source-rust-target'
    $emptyCache = Join-Path $sandbox 'artifacts/build/empty-rust-target'
    foreach ($directory in @($alternate, $alternateTwo, $preserved, $protectedCache, $activeCache, $unknownCache, $sourceCache)) {
        [IO.Directory]::CreateDirectory((Join-Path $directory 'debug')) | Out-Null
        [IO.File]::WriteAllText((Join-Path $directory 'debug/cache.txt'), 'cache')
    }
    [IO.Directory]::CreateDirectory($emptyCache) | Out-Null
    [IO.File]::WriteAllText((Join-Path $sourceCache 'Cargo.toml'), '[workspace]')
    # Even current/newer or malformed markers cannot make an unused known target
    # reusable; its active and explicit path protections decide retention.
    [IO.File]::WriteAllText((Join-Path $alternateTwo 'azrael-cache-version.json'), '{"engineVersion":"99.0.0"}')
    [IO.File]::WriteAllText((Join-Path $preserved 'azrael-cache-version.json'), 'invalid')
    [IO.File]::WriteAllText((Join-Path $target 'azrael-cache-version.json'), '{"engineVersion":"1.0.0"}')
    $cachePreview = Run -Protected @((Join-Path $protectedCache 'debug/cache.txt'))
    foreach ($directory in @($alternate, $alternateTwo, $preserved)) {
        Assert (@($cachePreview.candidates | Where-Object { $_.path -eq $directory -and $_.status -eq 'selected' }).Count -eq 1) 'Known unused Cargo target not discovered'
        Assert (Test-Path -LiteralPath $directory) 'Preview removed Cargo cache'
    }
    Assert (@($cachePreview.candidates | Where-Object { $_.path -eq $target -and $_.status -eq 'preserved-current-or-newer' }).Count -eq 1) 'Current source target not preserved despite stale marker'
    Assert (@($cachePreview.candidates | Where-Object { $_.path -eq $protectedCache -and $_.status -eq 'preserved-protected' }).Count -eq 1) 'Protected child did not protect cache ancestor'
    $ancestorPreview = Run -Protected @((Join-Path $sandbox 'artifacts/build'))
    Assert (@($ancestorPreview.candidates | Where-Object status -eq selected).Count -eq 0) 'Protected ancestor did not protect caches'
    $activePreview = Run -Target $activeCache
    Assert (@($activePreview.candidates | Where-Object { $_.path -eq $activeCache -and $_.status -eq 'preserved-protected' }).Count -eq 1) 'Explicit active target not protected'
    Assert (@($activePreview.candidates | Where-Object { $_.path -eq $target -and $_.status -like 'preserved-*' }).Count -eq 1) 'Explicit alternate target stopped primary target preservation'
    foreach ($command in @(
        ('runner.exe "' + (Join-Path $alternate 'debug/cache.txt') + '"'),
        ('runner.exe --target-dir="\\?\' + $alternate + '"'),
        ('runner.exe --target-dir=' + $alternate.Replace('\', '/'))
    )) {
        $global:EngineCacheFixtureProcesses = @([pscustomobject]@{ Name = 'runner.exe'; ProcessId = 80; ExecutablePath = 'C:\tools\runner.exe'; CommandLine = $command })
        Assert (@((Run).candidates | Where-Object { $_.path -eq $alternate -and $_.status -eq 'preserved-running' }).Count -eq 1) 'Command-line cache path did not protect cache'
        Assert (Test-Path -LiteralPath $alternate) 'Referenced cache removed'
    }
    $global:EngineCacheFixtureProcesses = @([pscustomobject]@{ Name = 'runner.exe'; ProcessId = 81; ExecutablePath = ('\\?\' + (Join-Path $alternate 'debug/runner.exe')); CommandLine = $null })
    $mixedRetirement = Run -Apply -Target $activeCache -Protected @($protectedCache)
    Assert (@($mixedRetirement.candidates | Where-Object { $_.path -eq $alternate -and $_.status -eq 'preserved-running' }).Count -eq 1) 'Extended executable path did not protect cache'
    Assert (Test-Path -LiteralPath $alternate) 'Live alternate cache removed'
    Assert (-not (Test-Path -LiteralPath $alternateTwo)) 'Live alternate incorrectly blocked unused alternate cleanup'
    Assert (-not (Test-Path -LiteralPath $preserved)) 'Live alternate incorrectly blocked preserved-cache cleanup'
    Assert ((Test-Path -LiteralPath $activeCache) -and (Test-Path -LiteralPath $target)) 'Alternate active or reusable primary cache removed'
    $global:EngineCacheFixtureProcesses = @([pscustomobject]@{ Name = 'runner.exe'; ProcessId = 82; ExecutablePath = 'C:\tools\runner.exe'; CommandLine = ('runner.exe "' + $alternate + '-backup\debug\cache.txt"') })
    $boundaryResult = Run -Apply -Target $activeCache -Protected @($protectedCache)
    Assert ($boundaryResult.status -eq 'completed') 'Sibling path incorrectly blocked cache cleanup'
    foreach ($directory in @($alternate, $alternateTwo, $preserved)) { Assert (-not (Test-Path -LiteralPath $directory)) 'Unused alternate/preserved target retained' }
    foreach ($directory in @($activeCache, $protectedCache, $unknownCache, $sourceCache, $emptyCache, $target)) {
        Assert (Test-Path -LiteralPath $directory) 'Active/protected/current/source/unknown cache removed'
    }
    $global:EngineCacheFixtureProcesses = @()
    [IO.Directory]::CreateDirectory($alternate) | Out-Null
    [IO.File]::WriteAllText((Join-Path $alternate '.rustc_info.json'), '{}')
    $global:EngineCacheFixtureInspectionCount = 0
    $global:EngineCacheFixtureBeforeInspection = {
        $global:EngineCacheFixtureInspectionCount++
        if ($global:EngineCacheFixtureInspectionCount -eq 2) {
            $global:EngineCacheFixtureProcesses = @([pscustomobject]@{ Name = 'runner.exe'; ProcessId = 83; ExecutablePath = 'C:\tools\runner.exe'; CommandLine = ('runner.exe "' + $alternate + '"') })
        }
    }
    $lateProcess = Run -Apply -Target $activeCache -Protected @($protectedCache)
    Assert (@($lateProcess.candidates | Where-Object { $_.path -eq $alternate -and $_.status -eq 'preserved-running' }).Count -eq 1 -and (Test-Path -LiteralPath $alternate)) 'Process starting before deletion did not preserve cache'
    $global:EngineCacheFixtureBeforeInspection = $null
    $global:EngineCacheFixtureProcesses = @()
    [IO.Directory]::CreateDirectory((Join-Path $alternateTwo 'debug')) | Out-Null
    $global:EngineCacheFixtureInspectionCount = 0
    $global:EngineCacheFixtureBeforeInspection = {
        $global:EngineCacheFixtureInspectionCount++
        if ($global:EngineCacheFixtureInspectionCount -eq 2) {
            $global:EngineCacheFixtureProcesses = @([pscustomobject]@{ Name = 'cargo.exe'; ProcessId = 84; ExecutablePath = 'C:\tools\cargo.exe'; CommandLine = 'cargo.exe build' })
        }
    }
    $lateBuild = Run -Apply -Target $activeCache -Protected @($protectedCache)
    Assert ($lateBuild.status -eq 'blocked') 'Compilation beginning before deletion did not block remaining cleanup'
    foreach ($directory in @($alternate, $alternateTwo)) {
        Assert (Test-Path -LiteralPath $directory) 'Late compilation guard removed a remaining cache'
        Assert (@($lateBuild.candidates | Where-Object { $_.path -eq $directory -and $_.status -eq 'blocked' }).Count -eq 1) 'Late compilation guard did not block all remaining candidates'
    }
    $global:EngineCacheFixtureBeforeInspection = $null
    $global:EngineCacheFixtureProcesses = @()
    $global:EngineCacheFixtureInspectionCount = 0
    $global:EngineCacheFixtureBeforeInspection = {
        $global:EngineCacheFixtureInspectionCount++
        if ($global:EngineCacheFixtureInspectionCount -eq 2) { Remove-Item -LiteralPath (Join-Path $alternate '.rustc_info.json') }
    }
    $lateChange = Run -Apply -Target $activeCache -Protected @($protectedCache)
    Assert ($lateChange.status -eq 'warning' -and (Test-Path -LiteralPath $alternate)) 'Disappearing Cargo indicators did not preserve cache'
    $global:EngineCacheFixtureBeforeInspection = $null
    $escapeCache = Join-Path $sandbox 'artifacts/build/escape-rust-target'
    Junction $escapeCache $external
    $escapePreview = Run -Target $activeCache -Protected @($protectedCache)
    Assert (@($escapePreview.candidates | Where-Object { $_.path -eq $escapeCache -and $_.status -eq 'rejected' }).Count -eq 1) 'Cargo target junction not rejected'
    $traversal = Join-Path $sandbox 'artifacts/build/../../../external'
    Assert ((Run -Apply -Protected @($traversal)).status -eq 'completed') 'Absolute protective traversal should be normalized safely'
    Assert (Test-Path -LiteralPath $sentinel) 'Traversal or Cargo junction removed external data'
    Assert ((Run -Apply -Protected @('relative/path')).status -eq 'blocked') 'Relative protection accepted'
    Write-Output 'PASS: unmarked/nested Cargo caches; primary and alternate active protections; one live cache preserves only itself; command-line and extended paths; sibling boundaries; late process/indicator revalidation; unknown/source/junction/traversal safety'
    $selectedSnapshot = Source 'artifacts/source-snapshots/selected-current' '3.0.0'
    $unusedSnapshot = Source 'artifacts/source-snapshots/unused-equal' '3.0.0'
    $unusedNewer = Source 'artifacts/worktrees/unused-newer' '4.0.0'
    $explicitSnapshot = Source 'artifacts/source-snapshots/explicit-target' '3.0.0'
    foreach ($root in @($selectedSnapshot, $unusedSnapshot, $unusedNewer, $explicitSnapshot)) {
        [IO.Directory]::CreateDirectory((Join-Path $root 'codex-rs/target/debug')) | Out-Null
    }
    $snapshotResult = Run -Apply -CurrentSource $selectedSnapshot -Target (Join-Path $explicitSnapshot 'codex-rs/target')
    Assert ($snapshotResult.status -eq 'completed') 'Unused source-target cleanup failed'
    foreach ($root in @($unusedSnapshot, $unusedNewer)) {
        Assert (-not (Test-Path -LiteralPath (Join-Path $root 'codex-rs/target'))) 'Unused same/newer-version source cache retained'
        Assert (Test-Path -LiteralPath (Join-Path $root 'codex-rs/Cargo.toml')) 'Source-cache cleanup removed source manifest'
        Assert (Test-Path -LiteralPath (Join-Path $root '.git')) 'Source-cache cleanup removed source git'
        Assert (@($snapshotResult.candidates | Where-Object { $_.path -eq (Join-Path $root 'codex-rs/target') -and $_.kind -eq 'cargo-target' -and $_.status -eq 'removed' }).Count -eq 1) 'Known source cache was not retired as Cargo target'
    }
    foreach ($root in @($current, $selectedSnapshot, $explicitSnapshot)) {
        Assert (Test-Path -LiteralPath (Join-Path $root 'codex-rs/target')) 'Primary/current-source/explicit snapshot target removed'
    }
    Assert (@($snapshotResult.candidates | Where-Object { $_.path -eq $target -and $_.status -eq 'preserved-protected' }).Count -eq 1) 'Snapshot build did not protect older reusable primary target'
    Assert (Test-Path -LiteralPath (Join-Path $unknown 'codex-rs/target/cache.txt')) 'Unknown source-cache content removed'
    Assert (Test-Path -LiteralPath (Join-Path $new 'codex-rs/target/cache.txt')) 'Unrecognized equal-version cache content removed'
    Write-Output 'PASS: unused same/newer-version snapshot/worktree Cargo targets removed; primary/current-source/explicit targets and source/unknown content preserved'
    $null = & pwsh -NoProfile -File $cleaner -ProjectRoot $sandbox -CurrentSourceRoot (Join-Path $sandbox 'missing') -Apply
    Assert ($LASTEXITCODE -eq 0) 'Retirement refusal must not fail successful packaging'
    Write-Output 'PASS: marker migration, equal-version retention, in-place switch, prepare preview, malformed/refused/unmanaged targets'
} finally {
    Remove-Variable -Name EngineCacheFixtureProcesses, EngineCacheFixtureInspectionFails, EngineCacheFixtureBeforeInspection, EngineCacheFixtureInspectionCount -Scope Global -ErrorAction SilentlyContinue
    foreach ($link in $links) {
        if ([IO.Directory]::Exists($link)) {
            Assert (([IO.File]::GetAttributes($link) -band [IO.FileAttributes]::ReparsePoint) -ne 0) 'Fixture link changed unexpectedly'
            [IO.Directory]::Delete($link, $false)
        }
    }
    $resolved = [IO.Path]::GetFullPath($fixture)
    $allowed = [IO.Path]::GetFullPath((Join-Path $project 'artifacts/verification')) + [IO.Path]::DirectorySeparatorChar
    Assert ($resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved) -like 'engine-cache-cleanup-*') 'Fixture cleanup escaped verification root'
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
exit 0
