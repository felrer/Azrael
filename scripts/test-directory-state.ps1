param([string]$BenchmarkPath = (Join-Path $PSScriptRoot '..\docs'), [string]$BenchmarkOutput)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'directory-state.ps1')

# Frozen legacy digest reference, independent of installer/checker wrappers.
# Original functions were also compared directly before wrapper integration.
function Get-LegacyDirectoryState {
    param([Parameter(Mandatory)][string]$Path)
    $hash = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        $files = @(Get-ChildItem -LiteralPath $Path -File -Recurse -Force | Sort-Object { [IO.Path]::GetRelativePath($Path, $_.FullName) })
        [long]$bytes = 0
        foreach ($file in $files) {
            $relative = [IO.Path]::GetRelativePath($Path, $file.FullName).Replace('\', '/')
            $fileHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            $hash.AppendData([Text.Encoding]::UTF8.GetBytes("$relative`0$($file.Length)`0$fileHash`n"))
            $bytes += $file.Length
        }
        [ordered]@{ path = $Path; sha256 = [Convert]::ToHexString($hash.GetHashAndReset()).ToLowerInvariant(); fileCount = $files.Count; bytes = $bytes }
    } finally { $hash.Dispose() }
}
function Assert-StateEqual($Expected, $Actual) {
    foreach ($key in @('path', 'sha256', 'fileCount', 'bytes')) {
        if ($Expected[$key] -cne $Actual[$key]) { throw "State mismatch for ${key}: expected $($Expected[$key]), got $($Actual[$key])" }
    }
}
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('azrael-directory-state-ps-test-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture) | Out-Null
try {
    Assert-StateEqual (Get-LegacyDirectoryState -Path $fixture) (Get-AzraelDirectoryState -Path $fixture)
    foreach ($relative in @('A.txt', 'a-2.txt', 'z.txt', 'é.txt', 'É-2.txt', '한글.txt', '中文.txt', '.hidden', 'nested\Case.txt')) {
        $full = Join-Path $fixture $relative
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($full)) | Out-Null
        [IO.File]::WriteAllBytes($full, [byte[]]@(0, 255, 10, 13, 42))
    }
    foreach ($culture in @('en-US', 'ko-KR', 'tr-TR')) {
        $previousCulture = [Threading.Thread]::CurrentThread.CurrentCulture
        try {
            [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo($culture)
            $actual = Get-AzraelDirectoryState -Path $fixture
            Assert-StateEqual (Get-LegacyDirectoryState -Path $fixture) $actual
            Write-Output "PASS: exact legacy digest equality under $culture (Unicode/case/nested/hidden/binary files)"
        } finally { [Threading.Thread]::CurrentThread.CurrentCulture = $previousCulture }
    }
    $root = [IO.Path]::GetFullPath($BenchmarkPath)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $old = Get-LegacyDirectoryState -Path $root
    $timer.Stop()
    $legacyMs = $timer.Elapsed.TotalMilliseconds
    $timer.Restart()
    $new = Get-AzraelDirectoryState -Path $root
    $timer.Stop()
    Assert-StateEqual $old $new
    $benchmark = [ordered]@{ path = $root; fileCount = $new.fileCount; bytes = $new.bytes; sha256 = $new.sha256; legacyMs = $legacyMs; nodeMs = $timer.Elapsed.TotalMilliseconds; digestEqual = $true }
    if ($BenchmarkOutput) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($BenchmarkOutput), ($benchmark | ConvertTo-Json), [Text.UTF8Encoding]::new($false)) }
    Write-Output ('PASS: real-directory digest equality; benchmark ' + ($benchmark | ConvertTo-Json -Compress))
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'azrael-directory-state-ps-test-*') { throw 'Fixture cleanup path validation failed.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
