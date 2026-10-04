#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..'),
    [string]$CurrentSourceRoot,
    [string]$TargetDirectory,
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
function Get-ProcessBlockReason([string[]]$Targets) {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $blockers = @($processes | Where-Object {
        if ($_.Name -match '^(cargo|rustc|link|MSBuild)(\.exe)?$') { return $true }
        if ($_.ExecutablePath) {
            foreach ($target in $Targets) {
                if ($_.ExecutablePath.StartsWith($target + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { return $true }
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
            $candidate.status = if ($null -eq $version) { 'preserved-unknown' } elseif ($version -lt $current) { 'selected' } else { 'preserved-current-or-newer' }
        } catch { $candidate.status = 'rejected'; $candidate.reason = $_.Exception.Message }
        $report.candidates += $candidate
    }
    # Only registered immediate build-cache directories are eligible; ordinary build
    # outputs without a valid version marker remain unmanaged.
    $buildContainer = Join-Path $project 'artifacts/build'
    Assert-NoReparseAncestor $buildContainer
    if ([IO.Directory]::Exists($buildContainer)) {
        foreach ($target in [IO.Directory]::EnumerateDirectories($buildContainer)) {
            $candidate = [ordered]@{ sourceRoot = $null; path = $target; version = $null; status = 'unmanaged'; reason = $null }
            try {
                if (-not (Test-InProject $target)) { throw 'Cache escapes ProjectRoot.' }
                Assert-NoReparseAncestor $target
                $version = Get-CacheMarkerVersion $target
                if ($null -ne $version) {
                    $candidate.version = $version.ToString()
                    $candidate.status = if ($version -lt $current) { 'selected' } else { 'preserved-current-or-newer' }
                }
            } catch { $candidate.status = 'rejected'; $candidate.reason = $_.Exception.Message }
            $report.candidates += $candidate
        }
    }
    $selected = @($report.candidates | Where-Object { $_.status -eq 'selected' })
    if ($Apply -and $selected.Count) {
        # Query once before any mutation. Failure to inspect processes blocks cleanup.
        $reason = Get-ProcessBlockReason @($selected | ForEach-Object { $_.path })
        if ($reason) {
            foreach ($candidate in $selected) { $candidate.status = 'blocked'; $candidate.reason = $reason }
            $report.status = 'blocked'
        } else {
            $report.status = 'completed'
            foreach ($candidate in $selected) {
                try {
                    Assert-NoReparseAncestor $candidate.path
                    # Revalidate version immediately before deleting a cache.
                    $version = if ($candidate.sourceRoot) { Get-WorkspaceVersion $candidate.sourceRoot } else { Get-CacheMarkerVersion $candidate.path }
                    if ($null -eq $version -or $version -ge $current) { throw 'Cache version changed; cache preserved.' }
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
