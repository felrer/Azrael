param(
    [ValidateSet('debug', 'release')][string]$Configuration = 'release',
    [switch]$Test
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'native/window-control/Cargo.toml'
$sourceDirectory = Join-Path $projectRoot 'native/window-control'
$fingerprintCli = Join-Path $PSScriptRoot 'window-control-runtime.cjs'
$logDirectory = Join-Path $projectRoot 'artifacts/logs/window-control-native'
$targetDirectory = Join-Path $projectRoot 'artifacts/build/window-control-native/target'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$operation = if ($Test) { 'test' } else { 'build' }
$logPath = Join-Path $logDirectory "$operation-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff').log"
$cargoArguments = @($operation, '--locked', '--manifest-path', $manifestPath, '--target-dir', $targetDirectory)
if ($Configuration -eq 'release') { $cargoArguments += '--release' }
$sourceBeforeJson = & node $fingerprintCli fingerprint --source $sourceDirectory
if ($LASTEXITCODE -ne 0) { throw 'Native source fingerprint failed before build.' }
$sourceBefore = ($sourceBeforeJson | ConvertFrom-Json).sourceSha256
if ($sourceBefore -notmatch '^[a-fA-F0-9]{64}$') { throw 'Native source fingerprint returned an invalid SHA256.' }
& cargo @cargoArguments *> $logPath
$buildExit = $LASTEXITCODE
if ($buildExit -ne 0) {
    Get-Content -LiteralPath $logPath -Tail 50
    throw "Window-control $operation failed (exit $buildExit). Full log: $logPath"
}
Write-Output "Window-control $operation succeeded (exit $buildExit). Log: $logPath"
$sourceAfterJson = & node $fingerprintCli fingerprint --source $sourceDirectory
if ($LASTEXITCODE -ne 0) { throw 'Native source fingerprint failed after build.' }
$sourceAfter = ($sourceAfterJson | ConvertFrom-Json).sourceSha256
if ($sourceBefore -cne $sourceAfter) { throw 'Native source changed during build; executable is not eligible for packaging.' }
if (-not $Test) {
    $executablePath = Join-Path $targetDirectory "$Configuration/azrael-window-control.exe"
    $receiptPath = Join-Path $targetDirectory "$Configuration/azrael-window-control-build.json"
    $receipt = [ordered]@{ schema = 1; sourceSha256 = $sourceAfter; executableSha256 = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash.ToLowerInvariant() }
    [System.IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
    Write-Output $executablePath
}
