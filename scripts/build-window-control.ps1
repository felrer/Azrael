param(
    [ValidateSet('debug', 'release')][string]$Configuration = 'release',
    [switch]$Test,
    [switch]$Rebuild,
    [string]$TargetDirectory,
    [string]$LogDirectory
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'native/window-control/Cargo.toml'
$sourceDirectory = Join-Path $projectRoot 'native/window-control'
$fingerprintCli = Join-Path $PSScriptRoot 'window-control-runtime.cjs'
$windowNativeLogs = if ($LogDirectory) { [System.IO.Path]::GetFullPath($LogDirectory) } else { Join-Path $projectRoot 'artifacts/logs/window-control-native' }
$windowNativeTarget = if ($TargetDirectory) { [System.IO.Path]::GetFullPath($TargetDirectory) } else { Join-Path $projectRoot 'artifacts/build/window-control-native/target' }
New-Item -ItemType Directory -Force -Path $windowNativeLogs | Out-Null
$operation = if ($Test) { 'test' } else { 'build' }
$logPath = Join-Path $windowNativeLogs "$operation-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff').log"
$cargoArguments = @($operation, '--locked', '--manifest-path', $manifestPath, '--target-dir', $windowNativeTarget)
if ($Configuration -eq 'release') { $cargoArguments += '--release' }
$sourceBeforeJson = & node $fingerprintCli fingerprint --source $sourceDirectory
if ($LASTEXITCODE -ne 0) { throw 'Native source fingerprint failed before build.' }
$sourceBefore = ($sourceBeforeJson | ConvertFrom-Json).sourceSha256
if ($sourceBefore -notmatch '^[a-fA-F0-9]{64}$') { throw 'Native source fingerprint returned an invalid SHA256.' }
$cacheInputs = @((Get-FileHash -LiteralPath $PSCommandPath).Hash, (& rustc --version), $Configuration, $env:RUSTFLAGS, $env:CARGO_ENCODED_RUSTFLAGS, $env:RUSTC_WRAPPER, $env:RUSTUP_TOOLCHAIN) -join "|"
$executablePath = Join-Path $windowNativeTarget "$Configuration/azrael-window-control.exe"
$receiptPath = Join-Path $windowNativeTarget "$Configuration/azrael-window-control-build.json"
if (-not $Test -and -not $Rebuild -and (Test-Path $receiptPath) -and (Test-Path $executablePath)) {
    try {
        $cached=Get-Content $receiptPath -Raw|ConvertFrom-Json
        if ($cached.sourceSha256 -ceq $sourceBefore -and $cached.buildInputs -ceq $cacheInputs -and $cached.executableSha256 -ieq (Get-FileHash $executablePath).Hash) {
            Write-Output "Window-control reused verified executable: $executablePath"
            $global:LASTEXITCODE=0
            return
        }
    } catch { }
}
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
    $executablePath = Join-Path $windowNativeTarget "$Configuration/azrael-window-control.exe"
    $receiptPath = Join-Path $windowNativeTarget "$Configuration/azrael-window-control-build.json"
    $receipt = [ordered]@{ schema = 1; buildInputs = $cacheInputs; sourceSha256 = $sourceAfter; executableSha256 = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash.ToLowerInvariant() }
    [System.IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
    Write-Output $executablePath
}
