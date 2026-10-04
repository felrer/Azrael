#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$SourceState = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.azrael-ex'),
    [Parameter(Mandatory)][string]$Destination
)

$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathFullyQualified($SourceState) -or -not [IO.Path]::IsPathFullyQualified($Destination) -or
    (Test-Path -LiteralPath $Destination)) { throw 'SourceState must be absolute and Destination must be a new absolute path.' }
$source = (Resolve-Path -LiteralPath $SourceState).Path
$destination = [IO.Path]::GetFullPath($Destination)
if ($destination -ieq $source -or $destination.StartsWith($source.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Fixture destination must be outside the source state.'
}
$ordinary = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex')).TrimEnd('\', '/')
if ($source -ieq $ordinary -or $source.StartsWith($ordinary + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Do not copy ordinary Codex state as Azrael state.'
}
$project = Split-Path $PSScriptRoot -Parent
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $project 'artifacts/releases')).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$active = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -in @('codex.exe', 'azrael-bridge.exe') -and $_.ExecutablePath -and
    $_.ExecutablePath.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)
})
if ($active.Count) { throw "Azrael release engines are still active ($($active.Count)); close the Azrael windows before copying state." }

function Get-Fingerprint {
    param([string]$Root)
    $records = @(Get-ChildItem -LiteralPath $Root -File -Recurse -Force | Sort-Object FullName | ForEach-Object {
        $relative = [IO.Path]::GetRelativePath($Root, $_.FullName).Replace('\', '/')
        "$relative`t$($_.Length)`t$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
    })
    $bytes = [Text.Encoding]::UTF8.GetBytes(($records -join "`n"))
    [pscustomobject]@{
        FileCount = $records.Count
        Sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
    }
}
$before = Get-Fingerprint -Root $source
$links = @(Get-ChildItem -LiteralPath $source -Recurse -Force -Attributes ReparsePoint)
if ($links.Count) { throw 'Azrael state contains links; resolve them before making a fixture.' }
New-Item -ItemType Directory -Path $destination | Out-Null
Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $destination -Recurse -Force
$after = Get-Fingerprint -Root $source
$copy = Get-Fingerprint -Root $destination
if ($before.FileCount -ne $after.FileCount -or $before.Sha256 -cne $after.Sha256 -or
    $before.FileCount -ne $copy.FileCount -or $before.Sha256 -cne $copy.Sha256) {
    throw 'Azrael state changed during copying or the fixture differs from its source.'
}
[ordered]@{
    schema = 1; source = $source; fixture = $destination
    capturedAt = [DateTimeOffset]::UtcNow.ToString('o')
    fileCount = $copy.FileCount; sha256 = $copy.Sha256
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path $destination -Parent) ((Split-Path $destination -Leaf) + '.snapshot.json')) -Encoding utf8NoBOM
[pscustomobject]@{ Fixture = $destination; FileCount = $copy.FileCount; Sha256 = $copy.Sha256 }
$global:LASTEXITCODE = 0
