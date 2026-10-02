# Shared by the release build and bounded wrapper validation. Dot-sourcing has
# no side effects; callers supply a metrics context and log directory.
function New-BuildMetrics {
    param([Parameter(Mandatory)][string]$Path)
    $metrics = [pscustomobject]@{
        Path = $Path
        Timer = [Diagnostics.Stopwatch]::StartNew()
        Status = 'running'
        Stages = [Collections.Generic.List[object]]::new()
    }
    Write-BuildMetrics $metrics
    return $metrics
}

function Write-BuildMetrics {
    param([Parameter(Mandatory)]$Metrics)
    # Metrics are advisory. A filesystem/serialization failure must never
    # replace a command's exit or the original packaging exception.
    try {
        $stages = @($Metrics.Stages | ForEach-Object {
            $record = [ordered]@{
                name = $_.Name
                elapsedMs = [long]$_.Timer.ElapsedMilliseconds
                status = $_.Status
            }
            if ($null -ne $_.ExitCode) { $record.exitCode = $_.ExitCode }
            if ($_.LogPath) { $record.logPath = $_.LogPath }
            $record
        })
        [ordered]@{
            schema = 1
            stages = $stages
            elapsedMs = [long]$Metrics.Timer.ElapsedMilliseconds
            status = $Metrics.Status
        } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Metrics.Path -Encoding utf8NoBOM -ErrorAction Stop
    } catch {
        # Even an unavailable warning stream must not interfere with the build.
        try { Write-Warning "Could not write build metrics '$($Metrics.Path)': $($_.Exception.Message)" -WarningAction Continue } catch { }
    }
}

function Start-BuildStage {
    param([Parameter(Mandatory)]$Metrics, [Parameter(Mandatory)][string]$Name, [string]$LogPath)
    $stage = [pscustomobject]@{
        Name = $Name; Timer = [Diagnostics.Stopwatch]::StartNew()
        Status = 'running'; ExitCode = $null; LogPath = $LogPath
    }
    $Metrics.Stages.Add($stage)
    Write-BuildMetrics $Metrics
    return $stage
}

function Complete-BuildStage {
    param([Parameter(Mandatory)]$Metrics, [Parameter(Mandatory)]$Stage,
        [ValidateSet('success', 'failed')][string]$Status = 'success', [Nullable[int]]$ExitCode)
    $Stage.Timer.Stop()
    $Stage.Status = $Status
    if ($null -ne $ExitCode) { $Stage.ExitCode = $ExitCode }
    Write-BuildMetrics $Metrics
}

function Complete-BuildMetrics {
    param([Parameter(Mandatory)]$Metrics, [ValidateSet('success', 'failed')][string]$Status)
    foreach ($stage in $Metrics.Stages) {
        if ($stage.Status -eq 'running') {
            $stage.Timer.Stop()
            $stage.Status = $Status
        }
    }
    $Metrics.Timer.Stop()
    $Metrics.Status = $Status
    Write-BuildMetrics $Metrics
}

function Invoke-BuildCommand {
    param([Parameter(Mandatory)][string]$Executable, [string[]]$CommandArguments,
        [Parameter(Mandatory)][string]$LogName,
        [string]$LogDirectory = $script:logDirectory, $Metrics = $script:buildMetrics,
        [int]$MaximumSuccessExitCode = 0, [switch]$CaptureOutput)
    $logPath = Join-Path $LogDirectory $LogName
    $stage = Start-BuildStage $Metrics ('command:' + $LogName) $logPath
    $commandExit = $null
    try {
        Write-Host "Running $Executable; log: $logPath"
        # Read the native exit ourselves, including robocopy's 0..7 contract.
        $PSNativeCommandUseErrorActionPreference = $false
        $global:LASTEXITCODE = 0
        & $Executable @CommandArguments *> $logPath
        $commandExit = $LASTEXITCODE
        if ($commandExit -lt 0 -or $commandExit -gt $MaximumSuccessExitCode) {
            throw "$Executable failed with exit code $commandExit. See $logPath"
        }
        Complete-BuildStage $Metrics $stage -ExitCode $commandExit
        if ($CaptureOutput) { Get-Content -LiteralPath $logPath -Raw }
    } catch {
        $failure = $_
        try { $failure | Out-String | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM -ErrorAction Stop } catch { }
        Complete-BuildStage $Metrics $stage -Status failed -ExitCode $commandExit
        throw $failure
    }
}

function Invoke-BuildScript {
    param([Parameter(Mandatory)][string]$ScriptPath, [hashtable]$Parameters,
        [Parameter(Mandatory)][string]$LogName,
        [string]$LogDirectory = $script:logDirectory, $Metrics = $script:buildMetrics)
    $logPath = Join-Path $LogDirectory $LogName
    $stage = Start-BuildStage $Metrics ('script:' + $LogName) $logPath
    $commandExit = $null
    try {
        $ErrorActionPreference = 'Stop'
        # Stop on a native failure *inside* the package, even if a later native
        # command would succeed and replace LASTEXITCODE.
        $PSNativeCommandUseErrorActionPreference = $true
        $global:LASTEXITCODE = 0
        & $ScriptPath @Parameters *> $logPath
        $commandExit = $LASTEXITCODE
        if ($commandExit -ne 0) { throw "$ScriptPath failed with exit code $commandExit. See $logPath" }
        Complete-BuildStage $Metrics $stage -ExitCode $commandExit
    } catch {
        $failure = $_
        if ($_.Exception -is [Management.Automation.NativeCommandExitException]) {
            $commandExit = $_.Exception.ExitCode
        } elseif ($LASTEXITCODE -ne 0) { $commandExit = $LASTEXITCODE }
        try { $failure | Out-String | Add-Content -LiteralPath $logPath -Encoding utf8NoBOM -ErrorAction Stop } catch { }
        Complete-BuildStage $Metrics $stage -Status failed -ExitCode $commandExit
        throw $failure
    }
}
