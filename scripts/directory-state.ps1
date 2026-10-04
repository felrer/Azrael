# Keep enumeration and ordering in PowerShell to preserve its culture-sensitive
# Sort-Object behavior. Node hashes the ordered files with bounded concurrency.
$script:AzraelDirectoryStateNodeScript = Join-Path $PSScriptRoot 'directory-state.cjs'

function Get-AzraelDirectoryState {
    param([Parameter(Mandatory)][string]$Path)
    $root = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Directory state root does not exist: $Path" }
    $files = @(Get-ChildItem -LiteralPath $root -File -Recurse -Force -ErrorAction Stop | Sort-Object { [IO.Path]::GetRelativePath($root, $_.FullName) })
    $relativePaths = @($files | ForEach-Object { [IO.Path]::GetRelativePath($root, $_.FullName) })
    $manifest = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($manifest, (ConvertTo-Json -InputObject $relativePaths -Compress), [Text.UTF8Encoding]::new($false))
        $output = & node $script:AzraelDirectoryStateNodeScript $root $manifest
        if ($LASTEXITCODE -ne 0) { throw "Directory state hashing failed for $Path (node exit $LASTEXITCODE)." }
        $state = ($output -join "`n") | ConvertFrom-Json -AsHashtable -ErrorAction Stop
        [ordered]@{ path = $Path; sha256 = $state.sha256; fileCount = $state.fileCount; bytes = $state.bytes }
    } finally {
        Remove-Item -LiteralPath $manifest -Force -ErrorAction Stop
    }
}
