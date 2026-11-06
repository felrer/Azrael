. (Join-Path $PSScriptRoot 'build-module-cache.ps1')

function Get-WindowControlSharedTarget([string]$CacheProjectRoot) {
    if (-not $CacheProjectRoot -or -not [IO.Path]::IsPathFullyQualified($CacheProjectRoot)) { throw 'CacheProjectRoot must be an absolute owner path.' }
    $owner = Assert-BuildCachePath $CacheProjectRoot $CacheProjectRoot
    if (-not (Test-Path -LiteralPath $owner -PathType Container)) { throw 'Window-control cache owner must be an existing directory.' }
    Assert-BuildCachePath (Join-Path $owner 'artifacts/cache/window-control-native/target') $owner
}

function Assert-WindowControlCacheStopped($Handle) {
    if (-not $IsWindows) { throw 'Interrupted window-control cache retry requires Windows process inspection.' }
    # A released lease proves only the PowerShell owner stopped. Cargo descendants
    # may outlive it; unreadable process evidence must not authorize a retry.
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    foreach ($process in $processes) {
        if ($process.ProcessId -eq $PID) { continue }
        $compiler = $process.Name -match '^(cargo|rustc|rustdoc|rustup|cl|link|lld-link|clang|clang-cl|gcc|cc)(\.exe)?$'
        if ($compiler) {
            # Compiler arguments can use relative output paths, so an unrelated
            # target cannot reliably be established from Win32_Process alone.
            throw "Compiler process $($process.ProcessId) prevents interrupted window-control cache retry."
        }
        if ($process.Name -ieq 'azrael-window-control.exe' -and -not $process.ExecutablePath) {
            throw "Unreadable window-control process $($process.ProcessId) prevents cache retry."
        }
        foreach ($value in @($process.ExecutablePath, $process.CommandLine)) {
            if ($value -and ([string]$value).IndexOf($Handle.Target, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                throw "Process $($process.ProcessId) still references the window-control cache target."
            }
        }
    }
}

function Open-WindowControlSharedCache([string]$ProjectRoot, [string]$CacheProjectRoot) {
    $target = Get-WindowControlSharedTarget $CacheProjectRoot
    $owner = Assert-BuildCachePath $CacheProjectRoot $CacheProjectRoot
    if (-not [IO.Path]::IsPathFullyQualified($ProjectRoot)) { throw 'Window-control source project must be absolute.' }
    $project = Assert-BuildCachePath $ProjectRoot $owner
    if (-not (Test-Path -LiteralPath $project -PathType Container)) { throw 'Window-control source project must exist inside its cache owner.' }
    $root = Assert-BuildCachePath ([IO.Path]::GetDirectoryName($target)) $owner
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $lockPath = Assert-BuildCachePath (Join-Path $root '.lock') $root
    try { $lease = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { throw 'Another window-control build or cache operation holds the shared target lease.' }
    $handle = @{Owner=$owner;Project=$project;Root=$root;Target=$target;Lease=$lease;LifecycleId='run:window-control-shared-target';MarkerPath=(Join-Path $target 'owner.json');Closed=$false;CanReuse=$false}
    try {
        $idHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($handle.LifecycleId))).ToLowerInvariant()
        $recordPath = Assert-BuildCachePath (Join-Path $owner "artifacts/maintenance/lifecycles/$idHash.json") $owner
        $record = $null
        if (Test-Path -LiteralPath $recordPath) {
            $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
            if ($record.schema -ne 1 -or $record.id -cne $handle.LifecycleId -or $record.kind -cne 'run' -or $record.owner -cne 'window-control-build-cache' -or @($record.members).Count -ne 1 -or $record.members[0].role -cne 'cache-entry' -or $record.members[0].path -ine $target -or $record.members[0].generated -ne $true -or $record.members[0].protection_known -ne $true) { throw 'Unexpected window-control lifecycle ownership or membership.' }
            if ($record.producer -or $record.cleanup_recovery -or $record.state -cnotin @('pending','failed','complete')) { throw 'Closed, recovered or unknown window-control producer requires owner reconciliation.' }
            if ($record.state -ceq 'complete' -and $record.membership_complete -ne $true) { throw 'Incomplete window-control lifecycle cannot be reused.' }
        }
        if (Test-Path -LiteralPath $target) {
            if (-not $record) { throw 'Unregistered window-control target requires ownership review; legacy targets are never claimed.' }
            $markerPath = Assert-BuildCachePath $handle.MarkerPath $target
            $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
            if ($marker.schema -ne 1 -or $marker.owner -cne 'window-control-build-cache' -or $marker.lifecycleId -cne $handle.LifecycleId -or $marker.target -ine $target -or $marker.projectRoot -ine $owner) { throw 'Unexpected window-control cache ownership marker.' }
            $handle.CanReuse = $record.state -ceq 'complete'
        } elseif ($record) {
            # A disappeared registered target may have been removed by a cleanup
            # owner. Ordinary builds cannot silently recreate that generation.
            throw 'Registered window-control target is missing; owner reconciliation required.'
        }
        if ($record -and $record.state -cne 'complete') { Assert-WindowControlCacheStopped $handle }
        $null = Register-ArtifactLifecycle -ProjectRoot $owner -Id $handle.LifecycleId -Kind run -Owner 'window-control-build-cache' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members @{'cache-entry'=$target}
        [IO.Directory]::CreateDirectory($target) | Out-Null
        Assert-BuildCachePath $handle.MarkerPath $target | Out-Null
        if (-not (Test-Path -LiteralPath $handle.MarkerPath)) {
            $marker = @{schema=1;owner='window-control-build-cache';lifecycleId=$handle.LifecycleId;target=$target;projectRoot=$owner}
            [IO.File]::WriteAllText($handle.MarkerPath, ($marker | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
        }
        return $handle
    } catch { $lease.Dispose(); throw }
}

function Complete-WindowControlSharedCache($Handle) {
    if ($Handle.Closed -or -not $Handle.Lease -or -not $Handle.Lease.CanWrite) { throw 'Window-control cache completion requires its active lease.' }
    Assert-BuildCachePath $Handle.Target $Handle.Owner | Out-Null
    $null = Register-ArtifactLifecycle -ProjectRoot $Handle.Owner -Id $Handle.LifecycleId -Kind run -Owner 'window-control-build-cache' -Generated -ProtectionKnown -State complete -MembershipComplete $true -Members @{'cache-entry'=$Handle.Target}
    $Handle.Closed = $true
}

function Fail-WindowControlSharedCache($Handle) {
    if ($Handle.Closed -or -not $Handle.Lease -or -not $Handle.Lease.CanWrite) { throw 'Window-control cache failure recording requires its active lease.' }
    $null = Register-ArtifactLifecycle -ProjectRoot $Handle.Owner -Id $Handle.LifecycleId -Kind run -Owner 'window-control-build-cache' -Generated -ProtectionKnown -State failed -MembershipComplete $false -Members @{'cache-entry'=$Handle.Target}
    $Handle.Closed = $true
}
