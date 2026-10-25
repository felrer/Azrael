[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
function Test-AbsoluteStatePath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or -not [IO.Path]::IsPathRooted($Value)) { return $false }
    if ($env:OS -eq 'Windows_NT' -and
        ($Value -match '^[A-Za-z]:(?![\\/])' -or $Value -match '^[\\/](?![\\/])')) { return $false }
    return $true
}
$skillRoot = & (Join-Path $PSScriptRoot 'resolve_canonical_root.ps1')
if (Test-Path Env:AZRAEL_KTCLOUD_STATE_ROOT) {
    $chosen = $env:AZRAEL_KTCLOUD_STATE_ROOT
    if (-not (Test-AbsoluteStatePath $chosen) -or
        -not (Test-Path -LiteralPath $chosen -PathType Container)) {
        throw 'AZRAEL_KTCLOUD_STATE_ROOT must name an available absolute directory; no fallback is used.'
    }
    (Resolve-Path -LiteralPath $chosen).Path
    return
}
$skillsRoot = Split-Path -Parent $skillRoot
$instructionsRoot = Split-Path -Parent $skillsRoot
if ((Split-Path -Leaf $skillsRoot) -eq 'skills' -and
    (Split-Path -Leaf $instructionsRoot) -eq 'instructions' -and
    (Test-Path -LiteralPath (Join-Path $instructionsRoot 'azrael-environment.json') -PathType Leaf)) {
    Join-Path $instructionsRoot '.private/ktcloud-ai-nexus/state'
    return
}
$azraelHome = $env:CODEX_HOME
if ([string]::IsNullOrWhiteSpace($azraelHome)) { $azraelHome = Join-Path $env:USERPROFILE '.azrael-ex' }
if (-not (Test-AbsoluteStatePath $azraelHome)) { throw 'CODEX_HOME must be absolute.' }
Join-Path $azraelHome 'azrael/skills/ktcloud-ai-nexus/state'
