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
# Process inspection is deterministic and never terminates a real user process.
function Get-CimInstance {
    param($ClassName, $ErrorAction)
    if ($global:EngineCacheFixtureInspectionFails) { throw 'Fixture process inspection unavailable' }
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
function Run([switch]$Apply, [string]$Target, [switch]$Prepare, [string]$Root = $sandbox, [string]$Report, [string]$CurrentSource) {
    $arguments = @{ ProjectRoot = $Root; Apply = [bool]$Apply }
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
    Assert ((Run -Apply).status -eq 'blocked') 'Selected-cache executable did not block'
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
    $null = & pwsh -NoProfile -File $cleaner -ProjectRoot $sandbox -CurrentSourceRoot (Join-Path $sandbox 'missing') -Apply
    Assert ($LASTEXITCODE -eq 0) 'Retirement refusal must not fail successful packaging'
    Write-Output 'PASS: marker migration, equal-version retention, in-place switch, prepare preview, malformed/refused/unmanaged targets'
} finally {
    Remove-Variable -Name EngineCacheFixtureProcesses, EngineCacheFixtureInspectionFails -Scope Global -ErrorAction SilentlyContinue
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
