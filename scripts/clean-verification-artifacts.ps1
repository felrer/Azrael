#requires -Version 7.4
[CmdletBinding()]
param(
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..'),
    [string[]]$ProtectedPaths = @(),
    [string]$FixtureRoot,
    [switch]$IncludeDiagnosedFixtures,
    [switch]$Apply,
    [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
function Normalize-Path([string]$Path) {
    $Path = $Path.Replace('/', '\')
    if ($Path.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) { $Path = '\\' + $Path.Substring(8) }
    elseif ($Path.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase)) { $Path = $Path.Substring(4) }
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw "Absolute path required: $Path" }
    [IO.Path]::GetFullPath($Path).TrimEnd('\')
}
function Test-Within([string]$Path, [string]$Parent) {
    $Path -ieq $Parent -or $Path.StartsWith($Parent + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Assert-Unlinked([string]$Path) {
    for ($cursor = $Path; $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Linked path or ancestor: $cursor" }
    }
}
function Read-Json([string]$Path) {
    Assert-Unlinked $Path
    Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable
}
function Get-Processes { @(Get-CimInstance Win32_Process -ErrorAction Stop) }
function Get-ProcessReason([string]$Path, [object[]]$Processes) {
    foreach ($proc in $Processes) {
        if ($proc.ExecutablePath -and (Test-Within (Normalize-Path $proc.ExecutablePath) $Path)) { return "Active executable: $($proc.ProcessId)" }
        if ($proc.CommandLine) {
            $command = $proc.CommandLine.Replace('/', '\').Replace('\\?\UNC\', '\\').Replace('\\?\', '')
            if ([regex]::IsMatch($command, '(?i)(?:^|[\s"''=])' + [regex]::Escape($Path) + '(?=$|[\\\s"''])')) { return "Active command path: $($proc.ProcessId)" }
        }
    }
}
function Get-Protected([string]$Path) {
    foreach ($item in $script:protected) {
        if ((Test-Within $Path $item) -or (Test-Within $item $Path)) { return "Protected reference: $item" }
    }
}
function Add-References($Data) {
    foreach ($key in @('fixtureRoot','stateRoot','extensionsDir','userDataDir','hostExtension','hostVsix','acceptanceResult')) {
        if ($Data[$key]) { $script:protected += Normalize-Path ([string]$Data[$key]) }
    }
}
function Archive-Evidence([string]$Path) {
    $destination = Join-Path $evidence ([IO.Path]::GetFileName($Path))
    Assert-Unlinked $destination
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    $saved = @()
    # Only top-level result/receipt/report files are evidence. Never walk state,
    # extension payloads, auth or session stores. Limit each compact record to 2 MiB.
    foreach ($file in Get-ChildItem -LiteralPath $Path -File -Force) {
        if ($file.Name -in @('check-result.json','verification.json') -and $file.Length -gt 2MB) { throw 'Required result exceeds compact evidence limit; fixture preserved.' }
        if ($file.Name -notmatch '(?i)^(check-result|host-result|standalone-host-result|verification|[a-z0-9_-]*(?:receipt|report|result))\.(json|txt)$' -or
            $file.Name -match '(?i)auth|session|token|credential' -or $file.Length -gt 2MB) { continue }
        Assert-Unlinked $file.FullName
        if ($file.Extension -ieq '.json') { $null = Read-Json $file.FullName }
        $target = Join-Path $destination $file.Name
        Assert-Unlinked $target
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
        $saved += $target
    }
    if ($IncludeDiagnosedFixtures) {
        $receipt = Join-Path $destination 'cleanup-receipt.json'
        Assert-Unlinked $receipt
        @{ fixtureRoot = $Path; diagnosed = $true; archivedUtc = [DateTime]::UtcNow.ToString('o'); resultFiles = @($saved | ForEach-Object { [IO.Path]::GetFileName($_) }) } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receipt -Encoding utf8NoBOM
        $saved += $receipt
    }
    if (-not $saved.Count) { throw 'No compact result evidence to preserve.' }
    return $saved
}
$report = [ordered]@{ projectRoot = $null; apply = [bool]$Apply; includeDiagnosedFixtures = [bool]$IncludeDiagnosedFixtures; status = 'preview'; candidates = @(); errors = @() }
try {
    $project = Normalize-Path $ProjectRoot
    $root = Join-Path $project 'artifacts/verification'
    $evidence = Join-Path $project 'artifacts/logs/verification-evidence'
    $report.projectRoot = $project
    Assert-Unlinked $root
    Assert-Unlinked $evidence
    $script:protected = @($ProtectedPaths | ForEach-Object { Normalize-Path $_ })
    $deployments = Join-Path $project 'artifacts/deployments'
    Assert-Unlinked $deployments
    $receipts = @()
    if (Test-Path -LiteralPath $deployments) {
        foreach ($directory in Get-ChildItem -LiteralPath $deployments -Directory -Force) {
            Assert-Unlinked $directory.FullName
            $receiptPath = Join-Path $directory.FullName 'deployment.json'
            if (Test-Path -LiteralPath $receiptPath) {
                $data = Read-Json $receiptPath
                if ($data.status -eq 'installed-reload-required' -and $data.hostInstalled -eq $true) { $receipts += @{ path = $receiptPath; data = $data; time = (Get-Item -LiteralPath $receiptPath).LastWriteTimeUtc } }
            }
        }
    }
    foreach ($receipt in @($receipts | Sort-Object time -Descending | Select-Object -First 2)) {
        Add-References $receipt.data
        $logsRoot = Join-Path $project 'artifacts/logs'
        Assert-Unlinked $logsRoot
        foreach ($directory in Get-ChildItem -LiteralPath $logsRoot -Directory -Force -ErrorAction Stop) {
            Assert-Unlinked $directory.FullName
            $metricsPath = Join-Path $directory.FullName 'deployment-metrics.json'
            if (-not (Test-Path -LiteralPath $metricsPath)) { continue }
            $metrics = Read-Json $metricsPath
            if ($metrics.packageDirectory -ine $receipt.data.packageDirectory) { continue }
            # Once acceptance evidence has been archived, fixtureRoot is historical
            # provenance rather than a live dependency of the installed package.
            if ($metrics.acceptanceResult -and (Test-Within (Normalize-Path $metrics.acceptanceResult) $root)) { Add-References $metrics }
        }
    }
    $processes = Get-Processes
    $targets = if ($FixtureRoot) { @(Normalize-Path $FixtureRoot) } elseif (Test-Path -LiteralPath $root) { @(Get-ChildItem -LiteralPath $root -Directory -Force | ForEach-Object FullName) } else { @() }
    foreach ($target in $targets) {
        $candidate = [ordered]@{ path = $target; status = 'retained'; reason = $null; archived = @(); acceptanceResult = $null }
        $report.candidates += $candidate
        try {
            $transactionRoot = Normalize-Path (Join-Path $root 'computer-use-integration/config-transaction-fixture')
            $ownedTransaction = $FixtureRoot -and $IncludeDiagnosedFixtures -and [IO.Path]::GetDirectoryName($target) -ieq $transactionRoot -and [IO.Path]::GetFileName($target) -cmatch '^run-[0-9]+$'
            $packageRoot = [IO.Path]::GetDirectoryName($target)
            $deploymentRoot = [IO.Path]::GetDirectoryName($packageRoot)
            $ownedPackageStage = $FixtureRoot -and $IncludeDiagnosedFixtures -and [IO.Path]::GetFileName($packageRoot) -ceq 'package' -and [IO.Path]::GetDirectoryName($deploymentRoot) -ieq $deployments -and [IO.Path]::GetFileName($deploymentRoot) -cmatch '^deploy-[A-Za-z0-9_.-]+$' -and [IO.Path]::GetFileName($target) -cmatch '^stage-[0-9a-f]{32}$'
            if (-not $ownedPackageStage -and ($target -ieq $root -or -not (Test-Within $target $root) -or ([IO.Path]::GetDirectoryName($target) -ine $root -and -not $ownedTransaction))) { throw 'Fixture must be an immediate verification child, an explicitly selected diagnosed config transaction run, or a diagnosed deployment package stage.' }
            if ($ownedPackageStage) {
                Assert-Unlinked $deploymentRoot
                $deploymentReceipt = Join-Path $deploymentRoot 'deployment.json'
                if (Test-Path -LiteralPath $deploymentReceipt) {
                    $deployment = Read-Json $deploymentReceipt
                    if ($deployment.hostInstalled -eq $true) { throw 'Installed deployment package stage is protected.' }
                }
            }
            Assert-Unlinked $target
            if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw 'Fixture does not exist.' }
            $resultPath = Join-Path $target 'check-result.json'
            $accountPath = Join-Path $target 'verification.json'
            if (Test-Path -LiteralPath $resultPath) {
                $result = Read-Json $resultPath
                $stages = @('initialInventory','hostInstall','finalInventory','namespace','standaloneHost','host')
                if (-not $IncludeDiagnosedFixtures -and ($result.passed -isnot [bool] -or -not $result.passed -or -not $result.exitCodes -or @($stages | Where-Object { -not $result.exitCodes.ContainsKey($_) -or $result.exitCodes[$_] -isnot [long] -and $result.exitCodes[$_] -isnot [int] -or $result.exitCodes[$_] -ne 0 }).Count -or $result.exitCodes.Count -ne 6)) { throw 'Failed or incomplete host fixture; retain until diagnosis.' }
            } elseif (Test-Path -LiteralPath $accountPath) {
                $result = Read-Json $accountPath
                if (-not $IncludeDiagnosedFixtures -and ($result.status -cne 'passed' -or $result.route -cne 'account-controls' -or $result.modelRequests -ne 0 -or $result.usageCreditConsumeRequests -ne 0)) { throw 'Failed or incomplete account fixture; retain until diagnosis.' }
            } elseif (-not $IncludeDiagnosedFixtures) { throw 'Unknown or incomplete fixture; retain until diagnosis.' }
            $reason = Get-Protected $target
            if (-not $reason) { $reason = Get-ProcessReason $target $processes }
            if ($reason) { $candidate.reason = $reason; continue }
            $candidate.status = 'selected'
            if ($Apply) {
                # Reinspect immediately before archival/deletion; failure preserves payload.
                Assert-Unlinked $target
                $reason = Get-ProcessReason $target (Get-Processes)
                if ($reason) { $candidate.status = 'retained'; $candidate.reason = $reason; continue }
                $candidate.archived = @(Archive-Evidence $target)
                $candidate.acceptanceResult = $candidate.archived | Where-Object { [IO.Path]::GetFileName($_) -ieq 'check-result.json' } | Select-Object -First 1
                Assert-Unlinked $target
                # Native PowerShell 7 removal unlinks nested junctions without walking
                # their targets. Candidate and every ancestor have been rejected if linked.
                Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
                $candidate.status = 'deleted'
            }
        } catch { $candidate.status = 'retained'; $candidate.reason = $_.Exception.Message }
    }
    if ($Apply) { $report.status = 'completed' }
} catch { $report.status = 'blocked'; $report.errors += $_.Exception.Message }
if ($ReportPath) {
    $reportFile = Normalize-Path $ReportPath
    Assert-Unlinked $reportFile
    New-Item -ItemType Directory -Path (Split-Path $reportFile -Parent) -Force | Out-Null
    $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $reportFile -Encoding utf8NoBOM
}
[pscustomobject]$report
