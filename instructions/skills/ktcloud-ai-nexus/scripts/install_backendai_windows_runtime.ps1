[CmdletBinding()]
param([switch]$InstallPython)

$ErrorActionPreference = 'Stop'
$clientVersion = '25.5.2'
$pythonSeries = '3.12'
$stateRoot = Join-Path $env:LOCALAPPDATA 'ktcloud-ai-nexus'
$runtimeRoot = Join-Path $stateRoot "client-tools\$clientVersion\windows-login"
$runtimePython = Join-Path $runtimeRoot 'Scripts\python.exe'
$manifestPath = Join-Path (Split-Path $runtimeRoot -Parent) 'windows-login-runtime.json'
$requirementsPath = Join-Path $PSScriptRoot "windows-login-requirements-$clientVersion.txt"

function Get-Python312 {
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($null -eq $launcher) {
        return $null
    }
    $path = & $launcher.Source -3.12 -c 'import sys; print(sys.executable)' 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($path -join ''))) {
        return $null
    }
    return ($path -join '').Trim()
}

if (-not (Test-Path -LiteralPath $requirementsPath -PathType Leaf)) {
    throw "고정 Windows 로그인 requirements를 찾지 못했습니다: $requirementsPath"
}

$basePython = Get-Python312
if ($null -eq $basePython -and $InstallPython) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($null -eq $winget) {
        throw 'Python 3.12가 없고 winget도 사용할 수 없습니다. Python 3.12 x64를 사용자 범위로 설치하십시오.'
    }
    & $winget.Source install --id Python.Python.3.12 -e --scope user --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.12 winget 설치가 종료 코드 $LASTEXITCODE 로 실패했습니다."
    }
    $basePython = Get-Python312
}
if ($null -eq $basePython) {
    throw "Python 3.12가 필요합니다. '& `"$PSCommandPath`" -InstallPython'으로 사용자 범위 설치까지 수행하십시오."
}

if (-not (Test-Path -LiteralPath $runtimePython -PathType Leaf)) {
    New-Item -ItemType Directory -Path (Split-Path $runtimeRoot -Parent) -Force | Out-Null
    & $basePython -m venv $runtimeRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Backend.AI Windows 로그인 venv 생성이 종료 코드 $LASTEXITCODE 로 실패했습니다."
    }
}

& $runtimePython -m pip install --disable-pip-version-check --quiet --no-deps --upgrade -r $requirementsPath
if ($LASTEXITCODE -ne 0) {
    throw "고정 Windows 로그인 패키지 설치가 종료 코드 $LASTEXITCODE 로 실패했습니다."
}

& $runtimePython -c "import importlib.metadata as m; from ai.backend.client.config import APIConfig, local_state_path; from ai.backend.client.session import Session; assert m.version('backend.ai-client') == '$clientVersion'; print('Backend.AI Windows login runtime import check passed.')"
if ($LASTEXITCODE -ne 0) {
    throw 'Backend.AI Windows 로그인 런타임 import 검증에 실패했습니다.'
}

$pythonVersion = (& $runtimePython -c 'import platform; print(platform.python_version())').Trim()
[ordered]@{
    installed_at = [DateTimeOffset]::Now.ToString('o')
    purpose = 'Backend.AI session login and legacy Windows CLI only'
    python_version = $pythonVersion
    client_version = $clientVersion
    python_path = $runtimePython
    requirements_sha256 = (Get-FileHash -LiteralPath $requirementsPath -Algorithm SHA256).Hash.ToLowerInvariant()
    intentionally_omitted = @(
        'etcd-client-py (server-side etcd client; Windows wheel unavailable; not imported by login/session CLI paths)'
        'pyroscope-io (profiling integration; required release unavailable; not imported by login/session CLI paths)'
    )
} | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Host "Backend.AI Windows login runtime ready: Python $pythonVersion / client $clientVersion"
Write-Host "Manifest: $manifestPath"
