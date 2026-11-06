Set-StrictMode -Version Latest
function Assert-ExactFields($Value, [string[]] $Fields) {
    if ($null -eq $Value -or $Value -isnot [pscustomobject]) { throw 'JSON object required' }
    $actual = @($Value.PSObject.Properties.Name)
    if (@(Compare-Object $actual $Fields -CaseSensitive).Count -ne 0) { throw 'Unexpected or missing JSON fields' }
}
function Assert-ControlRequest($Value, [string] $Nonce, [string] $Command) {
    Assert-ExactFields $Value @('schema', 'nonce', 'command')
    if ($Value.schema -isnot [long] -and $Value.schema -isnot [int]) { throw 'Integer schema required' }
    if ($Value.schema -ne 1 -or $Value.nonce -isnot [string] -or $Value.command -isnot [string] -or $Value.nonce -cne $Nonce -or $Value.command -cne $Command) { throw 'Invalid schema, nonce or fixed command' }
}
function Assert-LocalPath([string] $Path) {
    if (-not [IO.Path]::IsPathFullyQualified($Path) -or $Path.StartsWith('\\')) { throw 'Absolute local path required' }
    $resolved = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($Path))
    $cursor = $resolved
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if (((Get-Item -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse boundary: $cursor" }
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    return $resolved
}
function Write-NewJson([string] $Path, $Value) {
    $stream = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 16))
        $stream.Write($bytes); $stream.Flush($true)
    } finally { $stream.Dispose() }
}
