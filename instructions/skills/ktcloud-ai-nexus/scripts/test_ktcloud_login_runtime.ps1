[CmdletBinding()]
param(
    [switch]$Live,
    [ValidatePattern('^(trinity|abydos|arius[1-9][0-9]*)$')]
    [string[]]$Account = @('trinity', 'abydos')
)

$ErrorActionPreference = 'Stop'
$resolver = Join-Path $PSScriptRoot 'resolve_backendai_windows_python.ps1'
$login = Join-Path $PSScriptRoot 'ktcloud_login.ps1'
$cli = Join-Path $PSScriptRoot 'ktcloud_cli.ps1'
$manifest = Join-Path $env:LOCALAPPDATA 'ktcloud-ai-nexus\client-tools\25.5.2\windows-login-runtime.json'

if (-not (Test-Path -LiteralPath $resolver -PathType Leaf)) { throw 'Windows runtime resolver is missing.' }
$python = & $resolver
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw 'Resolved Windows Python is missing.' }
& $python -c "import importlib.metadata as m; from ai.backend.client.session import Session; assert m.version('backend.ai-client') == '25.5.2'"
if ($LASTEXITCODE -ne 0) { throw 'Windows runtime import smoke test failed.' }
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw 'Windows runtime manifest is missing.' }

if ($Live) {
    foreach ($name in $Account) {
        & $login -Account $name
        if ($LASTEXITCODE -ne 0) { throw "[$name] live login failed." }
        & $cli -Account $name -- v2 my session search --limit 1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "[$name] authenticated v2 query failed." }
    }
}

Write-Host 'ktcloud Windows login runtime checks passed.'
