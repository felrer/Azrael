#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..'),
    [string]$CurrentSourceRoot,
    [string]$TargetDirectory,
    [string[]]$ProtectedPaths = @(),
    [switch]$PrepareTarget,
    [switch]$Apply,
    [string]$ReportPath
)
$ErrorActionPreference = 'Stop'

function Assert-NoReparseAncestor([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (([IO.Directory]::Exists($cursor) -or [IO.File]::Exists($cursor)) -and
            ([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Reparse point in path: $cursor"
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
}
function Test-InProject([string]$Path) {
    return $Path.StartsWith($script:project + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}
function Normalize-CachePath([string]$Path) {
    if ($Path.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) { $Path = '\\' + $Path.Substring(8) }
    elseif ($Path.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase)) { $Path = $Path.Substring(4) }
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw 'Cache and protected paths must be absolute.' }
    return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}
function Test-PathWithin([string]$Path, [string]$Parent) {
    return $Path -ieq $Parent -or $Path.StartsWith($Parent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}
function Get-ProtectionReason([string]$Target) {
    foreach ($protected in $script:protected) {
        if ((Test-PathWithin $Target $protected) -or (Test-PathWithin $protected $Target)) { return "Protected path overlaps cache: $protected" }
    }
    return $null
}
function Test-KnownCargoCache([string]$Target) {
    Assert-NoReparseAncestor $Target
    # An alternate target must not itself be a source checkout.
    if ([IO.File]::Exists((Join-Path $Target 'Cargo.toml')) -or (Test-Path -LiteralPath (Join-Path $Target '.git'))) { return $false }
    foreach ($indicator in @('debug', 'release', '.rustc_info.json')) {
        $path = Join-Path $Target $indicator
        Assert-NoReparseAncestor $path
        if (($indicator -eq '.rustc_info.json' -and [IO.File]::Exists($path)) -or
            ($indicator -ne '.rustc_info.json' -and [IO.Directory]::Exists($path))) { return $true }
    }
    return $false
}
function Get-WorkspaceVersion([string]$SourceRoot) {
    $manifest = Join-Path $SourceRoot 'codex-rs/Cargo.toml'
    Assert-NoReparseAncestor $manifest
    if (-not [IO.File]::Exists($manifest)) { return $null }
    $inWorkspacePackage = $false
    foreach ($line in [IO.File]::ReadAllLines($manifest)) {
        if ($line -match '^\s*\[([^\]]+)\]\s*(?:#.*)?$') {
            $inWorkspacePackage = $Matches[1] -ceq 'workspace.package'
        } elseif ($inWorkspacePackage -and $line -match '^\s*version\s*=\s*["'']([^"'']+)["'']\s*(?:#.*)?$') {
            try { return [System.Management.Automation.SemanticVersion]::Parse($Matches[1]) } catch { return $null }
        }
    }
    return $null
}
function Remove-CacheEntry([string]$Path) {
    if (-not (Test-InProject ([IO.Path]::GetFullPath($Path)))) { throw 'Cache escapes ProjectRoot.' }
    Assert-NoReparseAncestor $Path
    # PowerShell 7's filesystem provider unlinks nested junctions/symlinks without
    # following them; Force also handles readonly files. Fixture regression verifies
    # these semantics and long paths. Avoid ancestor metadata queries per cache file.
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
}
function Get-CacheMarkerVersion([string]$Target) {
    $marker = Join-Path $Target 'azrael-cache-version.json'
    Assert-NoReparseAncestor $marker
    if (-not [IO.File]::Exists($marker)) { return $null }
    try {
        $data = [IO.File]::ReadAllText($marker) | ConvertFrom-Json
        return [System.Management.Automation.SemanticVersion]::Parse([string]$data.engineVersion)
    } catch { throw 'Invalid engine cache version marker; target preserved.' }
}
function Get-ProcessBlockReason([string[]]$Targets, [object[]]$ProcessSnapshot) {
    $processes = if ($null -eq $ProcessSnapshot) { @(Get-CimInstance Win32_Process -ErrorAction Stop) } else { $ProcessSnapshot }
    $blockers = @($processes | Where-Object {
        if ($_.Name -match '^(cargo|rustc|link|MSBuild)(\.exe)?$') { return $true }
        if ($_.ExecutablePath) {
            $executable = Normalize-CachePath $_.ExecutablePath
            foreach ($target in $Targets) {
                if (Test-PathWithin $executable $target) { return $true }
            }
        }
        if ($_.CommandLine) {
            $command = $_.CommandLine.Replace('\\?\UNC\', '\\').Replace('\\?\', '').Replace('/', '\')
            foreach ($target in $Targets) {
                # Match an actual path argument (including --option=path), never a
                # substring in a sibling path such as target-backup.
                $pattern = '(?i)(?:^|[\s"''=])' + [regex]::Escape($target) + '(?=$|[\\\s"''])'
                if ([regex]::IsMatch($command, $pattern)) { return $true }
            }
        }
        return $false
    })
    if ($blockers.Count) { return 'Running process: ' + (($blockers | ForEach-Object { "$($_.Name) ($($_.ProcessId))" }) -join ', ') }
    return $null
}

$report = [ordered]@{ projectRoot = $null; currentVersion = $null; apply = [bool]$Apply; status = 'preview'; candidates = @(); errors = @() }
try {
    $script:project = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $report.projectRoot = $project
    Assert-NoReparseAncestor $project
    if (-not [IO.Directory]::Exists($project)) { throw 'ProjectRoot must be an existing directory.' }
    if (-not $CurrentSourceRoot) { $CurrentSourceRoot = Join-Path $project 'engine' }
    $currentRoot = [IO.Path]::GetFullPath($CurrentSourceRoot)
    if (-not (Test-InProject $currentRoot)) { throw 'CurrentSourceRoot must be inside ProjectRoot.' }
    $current = Get-WorkspaceVersion $currentRoot
    if ($null -eq $current) { throw 'Current engine workspace.package version is unknown; no caches selected.' }
    $report.currentVersion = $current.ToString()
    $script:protected = @($ProtectedPaths | ForEach-Object { Normalize-CachePath $_ })
    if (-not $PrepareTarget) {
        $script:protected += Normalize-CachePath (Join-Path $project 'engine/codex-rs/target')
        $script:protected += Normalize-CachePath (Join-Path $currentRoot 'codex-rs/target')
        if ($TargetDirectory) { $script:protected += Normalize-CachePath $TargetDirectory }
    }
    $roots = [Collections.Generic.List[string]]::new()
    $roots.Add((Join-Path $project 'upstream/codex'))
    $roots.Add((Join-Path $project 'engine'))
    foreach ($relative in @('artifacts/worktrees', 'artifacts/source-snapshots')) {
        $container = Join-Path $project $relative
        Assert-NoReparseAncestor $container
        if ([IO.Directory]::Exists($container)) {
            foreach ($directory in [IO.Directory]::EnumerateDirectories($container)) {
                if ([IO.File]::GetAttributes($directory) -band [IO.FileAttributes]::ReparsePoint) {
                    if ($PrepareTarget) { continue }
                    $report.candidates += [ordered]@{ sourceRoot = $directory; path = (Join-Path $directory 'codex-rs/target'); version = $null; status = 'rejected'; reason = 'Source root is a reparse point.' }
                } else { $roots.Add($directory) }
            }
        }
    }
    if ($PrepareTarget) {
        if (-not $TargetDirectory) { $TargetDirectory = Join-Path $currentRoot 'codex-rs/target' }
        if (-not [IO.Path]::IsPathFullyQualified($TargetDirectory)) { throw 'TargetDirectory must be absolute.' }
        $target = [IO.Path]::GetFullPath($TargetDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
        $candidate = [ordered]@{ sourceRoot = $currentRoot; path = $target; version = $null; status = 'unmanaged'; reason = $null }
        $report.candidates += $candidate
        if ($target -ieq $project) { throw 'ProjectRoot cannot be an engine cache target.' }
        if (Test-InProject $target) {
            Assert-NoReparseAncestor $target
            # CurrentSourceRoot was already verified inside the project with a valid manifest.
            # Preparation supports custom source roots without expanding retirement enumeration.
            $sourceTarget = $target -ieq [IO.Path]::GetFullPath((Join-Path $currentRoot 'codex-rs/target'))
            foreach ($root in $roots) {
                if ($target -ieq [IO.Path]::GetFullPath((Join-Path $root 'codex-rs/target')) -and $null -ne (Get-WorkspaceVersion $root)) { $sourceTarget = $true; break }
            }
            $relative = [IO.Path]::GetRelativePath($project, $target).Replace('\', '/')
            $buildTarget = $relative -match '^artifacts/build/[^/]+$'
            if (-not $sourceTarget -and -not $buildTarget) { throw 'Target is not a bounded engine cache location.' }
            $marker = Join-Path $target 'azrael-cache-version.json'
            Assert-NoReparseAncestor $marker
            $previous = Get-CacheMarkerVersion $target
            if ($null -ne $previous) {
                $candidate.version = $previous.ToString()
            } elseif ($buildTarget -and [IO.Directory]::Exists($target)) {
                $candidate.reason = 'Existing custom build target has no registered engine cache marker.'
            }
            if ($sourceTarget -or $null -ne $previous -or -not [IO.Directory]::Exists($target)) {
                $candidate.status = if ($null -ne $previous -and $previous -ne $current) { 'selected-reset' } else { 'selected-prepare' }
                if ($Apply) {
                    $reason = Get-ProcessBlockReason @($target)
                    if ($reason) { $candidate.status = 'blocked'; $candidate.reason = $reason; $report.status = 'blocked' }
                    else {
                        if ($null -ne $previous -and $previous -ne $current -and (Get-ProtectionReason $target)) { throw (Get-ProtectionReason $target) }
                        if ($null -ne $previous -and $previous -ne $current) { Remove-CacheEntry $target }
                        Assert-NoReparseAncestor $target
                        [IO.Directory]::CreateDirectory($target) | Out-Null
                        [IO.File]::WriteAllText($marker, (@{ engineVersion = $current.ToString() } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
                        $candidate.status = 'prepared'
                        $report.status = 'completed'
                    }
                }
            }
        }
    } else {
    foreach ($root in $roots) {
        $target = [IO.Path]::GetFullPath((Join-Path $root 'codex-rs/target'))
        $candidate = [ordered]@{ sourceRoot = $root; path = $target; version = $null; status = 'missing'; reason = $null }
        try {
            if (-not (Test-InProject $target)) { throw 'Cache escapes ProjectRoot.' }
            Assert-NoReparseAncestor $target
            if (-not [IO.Directory]::Exists($target)) { continue }
            $version = Get-WorkspaceVersion $root
            $candidate.version = if ($null -ne $version) { $version.ToString() } else { $null }
            if ($root -ine $currentRoot -and (Test-KnownCargoCache $target)) {
                $candidate['kind'] = 'cargo-target'
                $candidate.status = 'selected'
            } else {
                $candidate.status = if ($null -eq $version) { 'preserved-unknown' } elseif ($version -lt $current) { 'selected' } else { 'preserved-current-or-newer' }
            }
        } catch { $candidate.status = 'rejected'; $candidate.reason = $_.Exception.Message }
        $report.candidates += $candidate
    }
    # Immediate registered caches and bounded Cargo target names are eligible.
    $buildContainer = Join-Path $project 'artifacts/build'
    Assert-NoReparseAncestor $buildContainer
    if ([IO.Directory]::Exists($buildContainer)) {
        foreach ($target in [IO.Directory]::EnumerateDirectories($buildContainer)) {
            $candidate = [ordered]@{ sourceRoot = $null; path = $target; version = $null; status = 'unmanaged'; reason = $null }
            try {
                if (-not (Test-InProject $target)) { throw 'Cache escapes ProjectRoot.' }
                Assert-NoReparseAncestor $target
                if ([IO.Path]::GetFileName($target) -like '*rust-target' -and (Test-KnownCargoCache $target)) {
                    $candidate['kind'] = 'cargo-target'
                    $candidate.status = 'selected'
                } else {
                    $version = Get-CacheMarkerVersion $target
                    if ($null -ne $version) {
                        $candidate.version = $version.ToString()
                        $candidate.status = if ($version -lt $current) { 'selected' } else { 'preserved-current-or-newer' }
                    }
                }
            } catch { $candidate.status = 'rejected'; $candidate.reason = $_.Exception.Message }
            $report.candidates += $candidate
        }
        $preservedContainer = Join-Path $buildContainer 'worktree-preserved-caches'
        Assert-NoReparseAncestor $preservedContainer
        if ([IO.Directory]::Exists($preservedContainer)) {
            foreach ($entry in [IO.Directory]::EnumerateDirectories($preservedContainer)) {
                $target = Join-Path $entry 'codex-rs/target'
                $candidate = [ordered]@{ sourceRoot = $null; path = $target; version = $null; status = 'unmanaged'; reason = $null; kind = 'cargo-target' }
                try {
                    Assert-NoReparseAncestor $target
                    if ([IO.Directory]::Exists($target) -and (Test-KnownCargoCache $target)) { $candidate.status = 'selected' }
                } catch { $candidate.status = 'rejected'; $candidate.reason = $_.Exception.Message }
                $report.candidates += $candidate
            }
        }
    }
    foreach ($candidate in $report.candidates) {
        if ($candidate.status -eq 'selected') {
            $reason = Get-ProtectionReason $candidate.path
            if ($reason) { $candidate.status = 'preserved-protected'; $candidate.reason = $reason }
        }
    }
    $selected = @($report.candidates | Where-Object { $_.status -eq 'selected' })
    if ($selected.Count) {
        # Query once before any mutation. Failure to inspect processes blocks cleanup.
        $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
        $reason = Get-ProcessBlockReason @() $processes
        if ($reason) {
            foreach ($candidate in $selected) { $candidate.status = 'blocked'; $candidate.reason = $reason }
            $report.status = 'blocked'
        } else {
            if ($Apply) { $report.status = 'completed' }
            foreach ($candidate in $selected) {
                try {
                    $reason = Get-ProcessBlockReason @($candidate.path) $processes
                    if ($reason) { $candidate.status = 'preserved-running'; $candidate.reason = $reason; continue }
                    if (-not $Apply) { continue }
                    Assert-NoReparseAncestor $candidate.path
                    $reason = Get-ProtectionReason $candidate.path
                    if ($reason) { throw $reason }
                    $latestProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop)
                    $reason = Get-ProcessBlockReason @() $latestProcesses
                    if ($reason) {
                        foreach ($remaining in $selected | Where-Object status -eq 'selected') { $remaining.status = 'blocked'; $remaining.reason = $reason }
                        $report.status = 'blocked'
                        break
                    }
                    $reason = Get-ProcessBlockReason @($candidate.path) $latestProcesses
                    if ($reason) { $candidate.status = 'preserved-running'; $candidate.reason = $reason; continue }
                    # Revalidate version immediately before deleting a cache.
                    if ($candidate.kind -eq 'cargo-target') {
                        if (-not (Test-KnownCargoCache $candidate.path)) { throw 'Cargo cache indicators changed; cache preserved.' }
                    } else {
                        $version = if ($candidate.sourceRoot) { Get-WorkspaceVersion $candidate.sourceRoot } else { Get-CacheMarkerVersion $candidate.path }
                        if ($null -eq $version -or $version -ge $current) { throw 'Cache version changed; cache preserved.' }
                    }
                    Remove-CacheEntry $candidate.path
                    $candidate.status = 'removed'
                } catch { $candidate.status = 'failed'; $candidate.reason = $_.Exception.Message; $report.status = 'warning' }
            }
        }
    } elseif ($Apply) { $report.status = 'completed' }
    }
} catch {
    $report.status = 'blocked'
    $report.errors += $_.Exception.Message
    foreach ($candidate in $report.candidates) {
        if ($candidate.status -like 'selected*' -or ($PrepareTarget -and $candidate.status -eq 'unmanaged')) { $candidate.status = 'blocked'; $candidate.reason = $_.Exception.Message }
    }
}
$json = $report | ConvertTo-Json -Depth 6
if ($ReportPath) {
    try {
        $outputPath = [IO.Path]::GetFullPath($ReportPath)
        Assert-NoReparseAncestor $outputPath
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
        [IO.File]::WriteAllText($outputPath, $json, [Text.UTF8Encoding]::new($false))
    } catch {
        $report.errors += "Report write failed: $($_.Exception.Message)"
        $report.status = 'warning'
        $json = $report | ConvertTo-Json -Depth 6
    }
}
Write-Output $json
# Preparation failure must stop compilation; retirement stays advisory after packaging.
if ($PrepareTarget -and $Apply -and $report.status -in @('blocked', 'warning')) { exit 1 }
exit 0
