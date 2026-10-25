[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$clientVersion = '25.5.2'
$stateRoot = Join-Path $env:LOCALAPPDATA 'ktcloud-ai-nexus'
$managedPython = Join-Path $stateRoot "client-tools\$clientVersion\windows-login\Scripts\python.exe"
$installer = Join-Path $PSScriptRoot 'install_backendai_windows_runtime.ps1'

function Test-BackendAiPython {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }
    & $Path -c "import importlib.metadata as m; from ai.backend.client.config import APIConfig, local_state_path; from ai.backend.client.session import Session; assert m.version('backend.ai-client') == '$clientVersion'" 2>$null
    return $LASTEXITCODE -eq 0
}

if (-not [string]::IsNullOrWhiteSpace($env:KTCLOUD_BACKEND_PYTHON)) {
    $override = [IO.Path]::GetFullPath($env:KTCLOUD_BACKEND_PYTHON)
    if (-not (Test-BackendAiPython -Path $override)) {
        throw "KTCLOUD_BACKEND_PYTHON이 승인된 Backend.AI client $clientVersion 로그인 런타임이 아닙니다: $override"
    }
    return $override
}

if (Test-BackendAiPython -Path $managedPython) {
    return $managedPython
}

throw "관리형 Backend.AI Windows 로그인 런타임이 없거나 손상되었습니다. '& `"$installer`"'로 설치 또는 복구하십시오."
