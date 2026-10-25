[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$skillRoot = Split-Path -Parent $PSScriptRoot
$visited = @{}
while ($true) {
    if ($visited.ContainsKey($skillRoot)) { throw 'Skill directory link cycle.' }
    $visited[$skillRoot] = $true
    $item = Get-Item -LiteralPath $skillRoot
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { break }
    $target = @($item.Target)[0]
    if ([string]::IsNullOrWhiteSpace($target)) { throw 'Cannot resolve loaded skill directory link.' }
    if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path $item.Parent.FullName $target }
    $skillRoot = [IO.Path]::GetFullPath($target)
}
foreach ($relative in @('SKILL.md', 'references', 'scripts/ktcloud_cli.ps1')) {
    if (-not (Test-Path -LiteralPath (Join-Path $skillRoot $relative))) { throw "Loaded skill layout is incomplete: $relative" }
}
(Resolve-Path -LiteralPath $skillRoot).Path
