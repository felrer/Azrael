[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
$canonicalRoot = & (Join-Path $PSScriptRoot 'resolve_canonical_root.ps1')
$destinationPath = [IO.Path]::GetFullPath($Destination)
$canonicalPrefix = $canonicalRoot.TrimEnd('\') + '\'
$destinationPrefix = $destinationPath.TrimEnd('\') + '\'

if ($destinationPrefix.StartsWith($canonicalPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    $canonicalPrefix.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'portable export destination은 canonical skill 내부나 그 상위 경로일 수 없습니다.'
}

if (Test-Path -LiteralPath $destinationPath) {
    if (-not (Test-Path -LiteralPath $destinationPath -PathType Container)) {
        throw "destination이 directory가 아닙니다: $destinationPath"
    }
    if (Get-ChildItem -LiteralPath $destinationPath -Force | Select-Object -First 1) {
        throw "destination directory가 비어 있지 않습니다: $destinationPath"
    }
} else {
    New-Item -ItemType Directory -Path $destinationPath | Out-Null
}

Copy-Item -LiteralPath (Join-Path $canonicalRoot 'SKILL.md') -Destination $destinationPath

foreach ($directory in @('agents', 'references', 'scripts')) {
    New-Item -ItemType Directory -Path (Join-Path $destinationPath $directory) | Out-Null
}

Get-ChildItem -LiteralPath (Join-Path $canonicalRoot 'agents') -File -Filter '*.yaml' |
    Copy-Item -Destination (Join-Path $destinationPath 'agents')
Get-ChildItem -LiteralPath (Join-Path $canonicalRoot 'references') -File -Filter '*.md' |
    Copy-Item -Destination (Join-Path $destinationPath 'references')

foreach ($name in @(
    'export_portable_skill.ps1',
    'ktcloud_cli.ps1',
    'ktcloud_cli_query_guard.py',
    'ktcloud_query.ps1',
    'ktcloud_login.ps1',
    'resolve_canonical_root.ps1',
    'resolve_state_root.ps1',
    'resolve_backendai_windows_python.ps1',
    'install_backendai_windows_runtime.ps1',
    'windows-login-requirements-25.5.2.txt',
    'ktcloud_cli_login.py',
    'ktcloud_cli_runner.py',
    'install_backendai_v2_runtime.ps1',
    'test_ktcloud_cli_runtime.ps1',
    'validate_session_records.py'
)) {
    Copy-Item -LiteralPath (Join-Path $canonicalRoot "scripts\$name") -Destination (Join-Path $destinationPath 'scripts')
}

if (Test-Path -LiteralPath (Join-Path $destinationPath 'state')) {
    throw 'portable export에 state directory가 포함되었습니다.'
}

[pscustomobject]@{
    Source = $canonicalRoot
    Destination = $destinationPath
    Included = @('SKILL.md', 'agents/*.yaml', 'references/*.md', 'approved scripts')
    Excluded = @('state', 'other tests', 'caches', 'credentials', 'cookies', 'login state', 'private keys')
}
