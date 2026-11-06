#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string] $ManifestPath, [switch] $ValidateOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ControlContract.ps1')

# This entry point runs only in an already-administrative external terminal.
# It never elevates, runs build commands, cancels sessions, or terminates processes.
$manifestFile = Assert-LocalPath $ManifestPath
$manifestStream = [IO.FileStream]::new($manifestFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    $reader = [IO.StreamReader]::new($manifestStream, [Text.Encoding]::UTF8, $true, 4096, $true)
    try { $m = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    Assert-ExactFields $m @('schema', 'nonce', 'runRoot', 'instanceName', 'maxDurationSeconds', 'minFreeBytes')
    if (($m.schema -isnot [long] -and $m.schema -isnot [int]) -or $m.schema -ne 1 -or $m.nonce -isnot [string] -or $m.runRoot -isnot [string] -or $m.instanceName -isnot [string] -or $m.nonce -cnotmatch '^[a-f0-9]{64}$' -or $m.instanceName -cnotmatch '^ET01-[a-f0-9]{16}$') { throw 'Invalid manifest identity' }
    if (($m.maxDurationSeconds -isnot [long] -and $m.maxDurationSeconds -isnot [int]) -or $m.maxDurationSeconds -lt 60 -or $m.maxDurationSeconds -gt 86400) { throw 'Duration must be integer 60..86400 seconds' }
    if (($m.minFreeBytes -isnot [long] -and $m.minFreeBytes -isnot [int]) -or $m.minFreeBytes -lt 1073741824) { throw 'Disk floor must be integer >= 1GiB' }
    $runRoot = Assert-LocalPath $m.runRoot
    if ($manifestFile -cne (Join-Path $runRoot 'inputs/control.json')) { throw 'Manifest must be at registered runRoot/inputs/control.json' }
    foreach ($part in @('inputs', 'outputs', 'reports', 'logs', 'temporary')) {
        $dir = Assert-LocalPath (Join-Path $runRoot $part)
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) { throw "Caller must prepare registered directory: $dir" }
    }
    $profile = Assert-LocalPath (Join-Path $runRoot 'inputs/CacheIO.wprp')
    # Compare profile semantics to the maintained fixed profile; no caller-supplied provider or stack additions.
    [xml] $expectedProfile = @'
<?xml version="1.0" encoding="utf-8"?>
<WindowsPerformanceRecorder Version="1.0" Author="Azrael"><Profiles>
<SystemCollector Id="CacheSystemCollector" Name="ET01 Cache File IO"><BufferSize Value="1024"/><Buffers Value="128"/></SystemCollector>
<SystemProvider Id="CacheSystemProvider"><Keywords><Keyword Value="ProcessThread"/><Keyword Value="Loader"/><Keyword Value="FileIO"/><Keyword Value="FileIOInit"/></Keywords></SystemProvider>
<Profile Id="CacheIO.Verbose.File" Name="CacheIO" Description="Process lineage and file operations without stack collection" LoggingMode="File" DetailLevel="Verbose"><Collectors><SystemCollectorId Value="CacheSystemCollector"><SystemProviderId Value="CacheSystemProvider"/></SystemCollectorId></Collectors></Profile>
</Profiles></WindowsPerformanceRecorder>
'@
    [xml] $actualProfile = Get-Content -LiteralPath $profile -Raw
    if ($expectedProfile.OuterXml -cne $actualProfile.OuterXml) { throw 'Only the fixed accepted ProcessThread/Loader/FileIO/FileIOInit profile is allowed' }
    $wpr = Join-Path $env:SystemRoot 'System32/wpr.exe'
    if (-not (Test-Path -LiteralPath $wpr -PathType Leaf)) { throw 'Installed WPR missing' }
    $resultPath = Join-Path $runRoot 'reports/capture-result.json'
    $etlPath = Join-Path $runRoot 'outputs/build.etl'
    foreach ($p in @($resultPath, $etlPath, (Join-Path $runRoot 'reports/armed-ready.json'), (Join-Path $runRoot 'reports/recording-ready.json'), (Join-Path $runRoot 'logs/wpr-start.json'), (Join-Path $runRoot 'logs/wpr-status.json'), (Join-Path $runRoot 'logs/wpr-stop.json'))) {
        if (Test-Path -LiteralPath $p) { throw "No overwrite/rerun: $p" }
    }
    if ($ValidateOnly) { [pscustomobject]@{ schema = 1; valid = $true; runRoot = $runRoot; instanceName = $m.instanceName } | ConvertTo-Json; return }
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Use an already-administrative external PowerShell 7 terminal; this helper does not elevate' }
    $claim = [IO.FileStream]::new((Join-Path $runRoot 'reports/capture-claim.json'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    $claim.Dispose()
    $selfStart = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
    $result = [ordered]@{ schema = 1; nonce = $m.nonce; runRoot = $runRoot; instanceName = $m.instanceName; helperPid = $PID; helperStartedAt = $selfStart; completed = $false; status = 'armed'; startExitCode = $null; stopExitCode = $null; startRequestedAt = $null; recordingReadyAt = $null; stopRequestedAt = $null; stoppedAt = $null; etlPath = $etlPath; etlSha256 = $null; error = $null; commands = @() }
    $recording = $false
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($runRoot))
    function Invoke-FixedWpr([ValidateSet('start','stop','status')][string] $Operation) {
        $argv = switch ($Operation) {
            'start' { @('-start', ($profile + '!CacheIO'), '-filemode', '-recordtempto', (Join-Path $runRoot 'temporary'), '-instancename', $m.instanceName) }
            'stop' { @('-stop', $etlPath, 'ET-01 bounded cache observation', '-skipPdbGen', '-instancename', $m.instanceName) }
            'status' { @('-status', '-instancename', $m.instanceName) }
        }
        $psi = [Diagnostics.ProcessStartInfo]::new($wpr)
        $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
        foreach ($a in $argv) { $psi.ArgumentList.Add($a) }
        $proc = [Diagnostics.Process]::new(); $proc.StartInfo = $psi
        $started = [DateTime]::UtcNow.ToString('o')
        if (-not $proc.Start()) { throw 'WPR process did not start' }
        $commandPid = $proc.Id
        $stdout = $proc.StandardOutput.ReadToEndAsync(); $stderr = $proc.StandardError.ReadToEndAsync()
        $commandWatch = [Diagnostics.Stopwatch]::StartNew()
        while (-not $proc.WaitForExit(500)) {
            if ($commandWatch.Elapsed.TotalSeconds -ge 600) {
                $pending = [ordered]@{ operation = $Operation; pid = $commandPid; startedAt = $started; stoppedAt = $null; exitCode = $null; argv = $argv; status = 'termination-unconfirmed'; reason = 'Fixed WPR operation exceeded 600 seconds; no forced stop or duplicate command' }
                $result.commands += $pending
                Write-NewJson (Join-Path $runRoot "logs/wpr-$Operation.json") $pending
                throw "WPR $Operation process $commandPid termination unconfirmed; external recovery required"
            }
        }
        $entry = [ordered]@{ operation = $Operation; pid = $commandPid; startedAt = $started; stoppedAt = [DateTime]::UtcNow.ToString('o'); exitCode = $proc.ExitCode; argv = $argv; stdout = $stdout.GetAwaiter().GetResult(); stderr = $stderr.GetAwaiter().GetResult() }
        $result.commands += $entry
        if ($Operation -eq 'start') { $result.startExitCode = $entry.exitCode; if ($entry.exitCode -eq 0) { $script:recording = $true } }
        if ($Operation -eq 'stop') { $result.stopExitCode = $entry.exitCode; if ($entry.exitCode -eq 0) { $script:recording = $false } }
        Write-NewJson (Join-Path $runRoot "logs/wpr-$Operation.json") $entry
        $proc.Dispose()
        return $entry.exitCode
    }
    function Read-FixedRequest([string] $Command) {
        $path = Join-Path $runRoot "inputs/$Command-request.json"
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
        $null = Assert-LocalPath $path
        $value = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        Assert-ControlRequest $value $m.nonce $Command
        return $true
    }
    try {
        Write-NewJson (Join-Path $runRoot 'reports/armed-ready.json') @{ schema = 1; nonce = $m.nonce; helperPid = $PID; helperStartedAt = $selfStart; armedAt = [DateTime]::UtcNow.ToString('o'); instanceName = $m.instanceName }
        while (-not (Read-FixedRequest 'start')) {
            if ($watch.Elapsed.TotalSeconds -ge $m.maxDurationSeconds -or $drive.AvailableFreeSpace -lt $m.minFreeBytes) { throw 'Watchdog before start: duration or free disk floor' }
            Start-Sleep -Milliseconds 500
        }
        $result.startRequestedAt = [DateTime]::UtcNow.ToString('o')
        $result.startExitCode = Invoke-FixedWpr 'start'
        if ($result.startExitCode -ne 0) { throw "WPR start failed: $($result.startExitCode)" }
        $recording = $true
        $statusExit = Invoke-FixedWpr 'status'
        if ($statusExit -ne 0) { throw "Own WPR status failed: $statusExit" }
        $result.recordingReadyAt = [DateTime]::UtcNow.ToString('o')
        $result.status = 'recording'
        Write-NewJson (Join-Path $runRoot 'reports/recording-ready.json') @{ schema = 1; nonce = $m.nonce; helperPid = $PID; helperStartedAt = $selfStart; instanceName = $m.instanceName; recordingReadyAt = $result.recordingReadyAt; startExitCode = $result.startExitCode; statusExitCode = $statusExit }
        while (-not (Read-FixedRequest 'stop')) {
            if ($watch.Elapsed.TotalSeconds -ge $m.maxDurationSeconds -or $drive.AvailableFreeSpace -lt $m.minFreeBytes) { throw 'Watchdog during capture: duration or free disk floor; trace incomplete' }
            Start-Sleep -Milliseconds 500
        }
        $result.stopRequestedAt = [DateTime]::UtcNow.ToString('o')
        $result.status = 'stop-requested'
    } catch { $result.error = $_.Exception.ToString(); $result.status = 'incomplete' }
    finally {
        if ($recording) {
            try {
                $result.stopExitCode = Invoke-FixedWpr 'stop'
                $result.stoppedAt = [DateTime]::UtcNow.ToString('o')
                if ($result.stopExitCode -eq 0 -and (Test-Path -LiteralPath $etlPath -PathType Leaf)) {
                    $recording = $false
                    $result.etlSha256 = (Get-FileHash -LiteralPath $etlPath -Algorithm SHA256).Hash.ToLowerInvariant()
                    if ($null -eq $result.error -and $null -ne $result.stopRequestedAt) { $result.completed = $true; $result.status = 'completed' }
                } else { $result.error = "WPR stop failed; own recording termination unconfirmed: $($result.stopExitCode)"; $result.status = 'incomplete' }
            } catch { $result.error = $_.Exception.ToString(); $result.status = 'incomplete' }
        }
        Write-NewJson $resultPath $result
    }
    if (-not $result.completed) { throw "Capture incomplete. Read $resultPath" }
} finally { $manifestStream.Dispose() }
