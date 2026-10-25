[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^(trinity|abydos|arius[1-9][0-9]*)$')]
    [string]$Account,

    [ValidateSet('Auto', 'Windows', 'Linux')]
    [string]$Runtime = 'Auto',

    [ValidateRange(1, 3600)]
    [int]$TimeoutSeconds,

    [ValidateRange(0, 2)]
    [int]$MaxRetries = 2,

    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$CliArguments
)

$ErrorActionPreference = 'Stop'
if ($null -eq $CliArguments -or $CliArguments.Count -eq 0) {
    throw 'Backend.AI CLI 인수를 지정하십시오. 예: -Account abydos -- session list'
}

$normalizedArguments = @($CliArguments | Where-Object { $_ -ne '--' } | ForEach-Object { $_.Trim().ToLowerInvariant() -split '\s+' })
$sensitiveSequence = @('admin', 'keypair', 'info')
$sensitiveCursor = 0
foreach ($argument in $normalizedArguments) {
    if ($argument -eq $sensitiveSequence[$sensitiveCursor]) {
        $sensitiveCursor++
    }
    if ($sensitiveCursor -eq $sensitiveSequence.Count) {
        throw "legacy 'admin keypair info'는 민감한 keypair 정보를 노출할 수 있어 실행하지 않습니다. 'v2 my resource-allocation keypair-usage'를 사용하십시오."
    }
}

# Only exact leading command tokens can opt into query supervision.
$readPaths = @(
    'session list', 'session info', 'session status-history', 'image list',
    'vfolder list', 'vfolder info', 'v2 my session search',
    'v2 session get', 'v2 my resource-allocation keypair-usage', 'v2 config show', 'v2 resource-allocation resource-group-usage',
    'v2 runtime-variant-preset search', 'v2 vfolder my-search', 'v2 vfolder project-search'
)
$queryTokens = @($CliArguments | Where-Object { $_ -ne '--' } | ForEach-Object { $_.ToLowerInvariant() })
$isSupervisedRead = $false
foreach ($path in $readPaths) {
    $parts = $path.Split(' ')
    if ($queryTokens.Count -ge $parts.Count -and (($queryTokens[0..($parts.Count - 1)] -join ' ') -eq $path)) {
        $isSupervisedRead = $true
        break
    }
}
if (-not $isSupervisedRead -and ($PSBoundParameters.ContainsKey('TimeoutSeconds') -or $PSBoundParameters.ContainsKey('MaxRetries'))) {
    throw 'TimeoutSeconds and MaxRetries are allowed only for explicitly allowlisted read-only queries; mutation and SSH/SCP remain foreground commands.'
}
$queryGuard = Join-Path $PSScriptRoot 'ktcloud_cli_query_guard.py'
$queryOptions = @('--account', $Account, '--retries', [string]$MaxRetries, '--cli-count', [string]$CliArguments.Count)
if ($PSBoundParameters.ContainsKey('TimeoutSeconds')) { $queryOptions += @('--timeout', [string]$TimeoutSeconds) }
$endpoint = 'https://www.ainexus.ktcloud.com'
$stateDirectory = Join-Path $env:LOCALAPPDATA 'ktcloud-ai-nexus'
$backendStateRoot = Join-Path (Join-Path $stateDirectory 'backend-state') $Account
$cookiePath = Join-Path $backendStateRoot 'Lablup\backend.ai\cookie.dat'
$runnerPath = Join-Path $PSScriptRoot 'ktcloud_cli_runner.py'
$linuxDistro = 'ktcloud-ubuntu-24.04'
$linuxClientPath = Join-Path $stateDirectory 'client-tools\26.7.0\linux-x86_64\backendai-client-fat-linux-x86_64'
$linuxClientSha256 = 'DBDC8938A7D7174BB8551EF5499A84A63B24F5D786BC7173A96ACAFE6A6F5429'

function Get-BackendAiPython {
    $resolver = Join-Path $PSScriptRoot 'resolve_backendai_windows_python.ps1'
    if (-not (Test-Path -LiteralPath $resolver -PathType Leaf)) {
        throw "Backend.AI Windows 로그인 런타임 resolver를 찾지 못했습니다: $resolver"
    }
    & $resolver
}

if (-not (Test-Path -LiteralPath $cookiePath -PathType Leaf)) {
    throw "[$Account] 격리 로그인 쿠키가 없습니다. 먼저 ktcloud_login.ps1 -Account $Account 를 실행하십시오."
}

$effectiveRuntime = $Runtime
if ($Runtime -eq 'Auto' -and -not [string]::IsNullOrWhiteSpace($env:KTCLOUD_BACKEND_RUNTIME)) {
    $requestedRuntime = $env:KTCLOUD_BACKEND_RUNTIME.Trim()
    if ($requestedRuntime -notin @('Auto', 'Windows', 'Linux')) {
        throw "KTCLOUD_BACKEND_RUNTIME은 Auto, Windows 또는 Linux여야 합니다: $requestedRuntime"
    }
    $effectiveRuntime = $requestedRuntime
}
$commandTokens = @(
    $CliArguments |
        Where-Object { $_ -ne '--' } |
        ForEach-Object { $_.Trim() -split '\s+' } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)
$isV2Command = $commandTokens.Count -gt 0 -and $commandTokens[0].ToLowerInvariant() -eq 'v2'
if ($effectiveRuntime -eq 'Auto') {
    $effectiveRuntime = if ($isV2Command) { 'Linux' } else { 'Windows' }
}
if ($effectiveRuntime -eq 'Linux' -and -not $isV2Command) {
    throw 'Linux runtime은 v2 명령에만 사용할 수 있습니다. legacy session/SSH/SCP는 Windows runtime을 사용하십시오.'
}

if ($effectiveRuntime -eq 'Linux') {
    if (-not (Test-Path -LiteralPath $linuxClientPath -PathType Leaf)) {
        throw "공식 Backend.AI Linux client를 찾지 못했습니다: $linuxClientPath"
    }
    $actualHash = (Get-FileHash -LiteralPath $linuxClientPath -Algorithm SHA256).Hash
    if ($actualHash -ne $linuxClientSha256) {
        throw "Backend.AI Linux client SHA-256이 승인된 26.7.0 release와 다릅니다: $actualHash"
    }
    $installedDistros = @(
        & wsl.exe --list --quiet 2>$null |
            ForEach-Object { $_ -replace "`0", '' } |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
    if ($LASTEXITCODE -ne 0 -or $linuxDistro -notin $installedDistros) {
        throw "Backend.AI v2용 Ubuntu WSL2 배포판을 찾지 못했습니다: $linuxDistro"
    }

    function Convert-ToWslPath {
        param([Parameter(Mandatory)][string]$WindowsPath)

        $resolved = [IO.Path]::GetFullPath($WindowsPath)
        if ($resolved -notmatch '^([A-Za-z]):\\(.*)$') {
            throw "WSL drvfs에서 참조할 수 없는 Windows 경로입니다: $resolved"
        }
        $drive = $Matches[1].ToLowerInvariant()
        $relative = $Matches[2] -replace '\\', '/'
        "/mnt/$drive/$relative"
    }

    function Protect-SensitiveCliOutput {
        process {
            $line = [string]$_
            $line = $line -replace '(?i)("?(?:access|secret)[_-]?key"?\s*[:=]\s*)"[^"]*"', '$1"[redacted]"'
            $line = $line -replace '(?i)(\b(?:access|secret)[_-]?key\b\s*[:=]\s*)(?!\(not set\))\S+', '$1[redacted]'
            $line
        }
    }

    $linuxBinary = Convert-ToWslPath -WindowsPath $linuxClientPath
    $linuxXdgStateRoot = Convert-ToWslPath -WindowsPath (Join-Path $backendStateRoot 'Lablup')
    $linuxBackendStatePath = Convert-ToWslPath -WindowsPath (Split-Path $cookiePath -Parent)
    $linuxV2Home = "/var/lib/ktcloud-ai-nexus/$Account"
    $linuxV2SessionLink = "$linuxV2Home/.backend.ai/session"
    $resolvedSessionLink = & wsl.exe -d $linuxDistro -- readlink -f $linuxV2SessionLink
    if ($LASTEXITCODE -ne 0 -or $resolvedSessionLink.Trim() -ne $linuxBackendStatePath) {
        throw "[$Account] v2 HOME의 session link가 격리된 Windows cookie 원본을 가리키지 않습니다: $linuxV2SessionLink"
    }
    $linuxWorkingDirectory = Convert-ToWslPath -WindowsPath (Get-Location).Path
    $linuxCommand = @('wsl.exe', '-d', $linuxDistro, '--cd', $linuxWorkingDirectory, '--', 'env',
        "HOME=$linuxV2Home", "BACKEND_ENDPOINT=$endpoint", 'BACKEND_ENDPOINT_TYPE=session',
        "XDG_STATE_HOME=$linuxXdgStateRoot", "KTCLOUD_BACKEND_STATE_PATH=$linuxBackendStatePath", $linuxBinary) + $CliArguments
    if ($isSupervisedRead) {
        $backendPython = Get-BackendAiPython
        & $backendPython $queryGuard @queryOptions --runtime Linux -- @linuxCommand | Protect-SensitiveCliOutput
    } else {
        & wsl.exe @($linuxCommand | Select-Object -Skip 1) | Protect-SensitiveCliOutput
    }
    $cliExitCode = $LASTEXITCODE
} else {
    $backendPython = Get-BackendAiPython
    if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
        throw "계정 격리 CLI runner를 찾지 못했습니다: $runnerPath"
    }

    $previousEndpoint = $env:BACKEND_ENDPOINT
    $previousEndpointType = $env:BACKEND_ENDPOINT_TYPE
    $previousStatePath = $env:KTCLOUD_BACKEND_STATE_PATH
    $previousAccount = $env:KTCLOUD_ACCOUNT
    try {
        $env:BACKEND_ENDPOINT = $endpoint
        $env:BACKEND_ENDPOINT_TYPE = 'session'
        $env:KTCLOUD_ACCOUNT = $Account
        $env:KTCLOUD_BACKEND_STATE_PATH = Split-Path $cookiePath -Parent
        if ($isSupervisedRead) {
            $windowsCommand = @($backendPython, $runnerPath) + $CliArguments
            & $backendPython $queryGuard @queryOptions --runtime Windows -- @windowsCommand
        } else {
            & $backendPython $runnerPath @CliArguments
        }
        $cliExitCode = $LASTEXITCODE
    } finally {
        $env:BACKEND_ENDPOINT = $previousEndpoint
        $env:BACKEND_ENDPOINT_TYPE = $previousEndpointType
        $env:KTCLOUD_ACCOUNT = $previousAccount
        $env:KTCLOUD_BACKEND_STATE_PATH = $previousStatePath
    }
}

$global:LASTEXITCODE = $cliExitCode
if ($cliExitCode -ne 0) {
    Write-Error -ErrorAction Continue "[$Account] Backend.AI CLI가 종료 코드 $cliExitCode 로 실패했습니다."
}
