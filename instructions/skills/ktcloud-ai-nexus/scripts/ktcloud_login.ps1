[CmdletBinding(DefaultParameterSetName = 'Login')]
param(
    [Parameter(ParameterSetName = 'Setup', Mandatory = $true)]
    [switch]$Setup,

    [Parameter(ParameterSetName = 'SetupAll', Mandatory = $true)]
    [switch]$SetupAll,

    [Parameter(ParameterSetName = 'Remove', Mandatory = $true)]
    [switch]$Remove,

    [Parameter(ParameterSetName = 'Status', Mandatory = $true)]
    [switch]$Status,

    [Parameter(ParameterSetName = 'List', Mandatory = $true)]
    [switch]$List,

    [Parameter(ParameterSetName = 'MigrateLegacy', Mandatory = $true)]
    [switch]$MigrateLegacy,

    [Parameter(ParameterSetName = 'Login', Mandatory = $true)]
    [Parameter(ParameterSetName = 'Setup', Mandatory = $true)]
    [Parameter(ParameterSetName = 'Remove', Mandatory = $true)]
    [Parameter(ParameterSetName = 'MigrateLegacy', Mandatory = $true)]
    [Parameter(ParameterSetName = 'Status')]
    [ValidatePattern('^(trinity|abydos|arius[1-9][0-9]*)$')]
    [string]$Account,

    [Parameter(ParameterSetName = 'Setup')]
    [string]$UserId
)

$ErrorActionPreference = 'Stop'
$endpoint = 'https://www.ainexus.ktcloud.com'
$accountDefinitions = [ordered]@{
    trinity = [ordered]@{ MaxGpu = 4; Description = 'GPU 최대 4개 계정' }
    abydos  = [ordered]@{ MaxGpu = 1; Description = 'GPU 최대 1개 계정' }
}
$stateDirectory = Join-Path $env:LOCALAPPDATA 'ktcloud-ai-nexus'
$accountsDirectory = Join-Path $stateDirectory 'accounts'
$backendStatesDirectory = Join-Path $stateDirectory 'backend-state'
$legacyCredentialPath = Join-Path $stateDirectory 'credential.clixml'
$helperPath = Join-Path $PSScriptRoot 'ktcloud_cli_login.py'

function Get-AccountCredentialPath {
    param([Parameter(Mandatory)][string]$Name)

    Join-Path (Join-Path $accountsDirectory $Name) 'credential.clixml'
}

function Get-AccountBackendStateRoot {
    param([Parameter(Mandatory)][string]$Name)

    Join-Path $backendStatesDirectory $Name
}

function Get-AccountCookiePath {
    param([Parameter(Mandatory)][string]$Name)

    $backendStateRoot = Get-AccountBackendStateRoot -Name $Name
    Join-Path $backendStateRoot 'Lablup\backend.ai\cookie.dat'
}

function Get-AccountLoginStatePath {
    param([Parameter(Mandatory)][string]$Name)

    Join-Path (Join-Path $accountsDirectory $Name) 'login-state.json'
}

function Get-AccountDefinition {
    param([Parameter(Mandatory)][string]$Name)

    if ($accountDefinitions.Contains($Name)) {
        return $accountDefinitions[$Name]
    }
    [ordered]@{ MaxGpu = $null; Description = '실시간 자원 할당량을 확인할 추가 계정' }
}

function Get-BackendAiPython {
    $resolver = Join-Path $PSScriptRoot 'resolve_backendai_windows_python.ps1'
    if (-not (Test-Path -LiteralPath $resolver -PathType Leaf)) {
        throw "Backend.AI Windows 로그인 런타임 resolver를 찾지 못했습니다: $resolver"
    }
    & $resolver
}

function Show-AccountStatus {
    param([Parameter(Mandatory)][string]$Name)

    $definition = Get-AccountDefinition -Name $Name
    $credentialPath = Get-AccountCredentialPath -Name $Name
    $registered = Test-Path -LiteralPath $credentialPath -PathType Leaf
    $backendStateRoot = Get-AccountBackendStateRoot -Name $Name
    $authenticated = Test-Path -LiteralPath (Get-AccountCookiePath -Name $Name) -PathType Leaf

    [pscustomobject]@{
        Account = $Name
        MaxGpu = $definition.MaxGpu
        Registered = $registered
        Authenticated = $authenticated
        StateRoot = $backendStateRoot
    }
}

if ($List -or ($Status -and [string]::IsNullOrWhiteSpace($Account))) {
    $registeredNames = @(
        if (Test-Path -LiteralPath $accountsDirectory -PathType Container) {
            Get-ChildItem -LiteralPath $accountsDirectory -Directory |
                Where-Object { $_.Name -match '^(trinity|abydos|arius[1-9][0-9]*)$' } |
                ForEach-Object { $_.Name }
        }
    )
    foreach ($name in @($accountDefinitions.Keys + $registeredNames | Select-Object -Unique)) {
        Show-AccountStatus -Name $name
    }
    exit 0
}

if ($Status) {
    Show-AccountStatus -Name $Account
    exit 0
}

if ($SetupAll) {
    foreach ($name in $accountDefinitions.Keys) {
        Write-Host "`n[$name] $($accountDefinitions[$name].Description) 자격 증명을 등록합니다."
        $setupUserId = Read-Host "kt cloud AI Nexus 사용자 ID ($name)"
        if ([string]::IsNullOrWhiteSpace($setupUserId)) {
            throw "[$name] 사용자 ID는 비워 둘 수 없습니다."
        }
        $setupPassword = Read-Host "kt cloud AI Nexus 비밀번호 ($name)" -AsSecureString
        $setupCredential = [System.Management.Automation.PSCredential]::new(
            $setupUserId.Trim(),
            $setupPassword
        )
        $setupPath = Get-AccountCredentialPath -Name $name
        New-Item -ItemType Directory -Path (Split-Path $setupPath -Parent) -Force | Out-Null
        $setupCredential | Export-Clixml -LiteralPath $setupPath -Force
        Write-Host "[$name] 암호화 자격 증명을 등록했습니다."
    }
    Write-Host "`n두 계정 등록을 완료했습니다. 창을 닫아도 됩니다."
    exit 0
}

$credentialPath = Get-AccountCredentialPath -Name $Account

if ($Setup) {
    if ([string]::IsNullOrWhiteSpace($UserId)) {
        $UserId = Read-Host "kt cloud AI Nexus 사용자 ID ($Account)"
    }
    if ([string]::IsNullOrWhiteSpace($UserId)) {
        throw '사용자 ID는 비워 둘 수 없습니다.'
    }

    $securePassword = Read-Host "kt cloud AI Nexus 비밀번호 ($Account)" -AsSecureString
    $credential = [System.Management.Automation.PSCredential]::new($UserId.Trim(), $securePassword)
    $accountDirectory = Split-Path $credentialPath -Parent
    New-Item -ItemType Directory -Path $accountDirectory -Force | Out-Null
    $credential | Export-Clixml -LiteralPath $credentialPath -Force
    Write-Host "[$Account] 암호화 자격 증명을 등록했습니다."
    Write-Host '현재 Windows 사용자와 현재 PC에서만 복호화할 수 있습니다.'
    exit 0
}

if ($MigrateLegacy) {
    if (-not (Test-Path -LiteralPath $legacyCredentialPath -PathType Leaf)) {
        throw "이관할 기존 자격 증명이 없습니다: $legacyCredentialPath"
    }
    if (Test-Path -LiteralPath $credentialPath -PathType Leaf) {
        throw "[$Account] 자격 증명이 이미 등록되어 있습니다. 기존 값을 덮어쓰지 않았습니다."
    }

    $legacyCredential = Import-Clixml -LiteralPath $legacyCredentialPath
    $accountDirectory = Split-Path $credentialPath -Parent
    New-Item -ItemType Directory -Path $accountDirectory -Force | Out-Null
    $legacyCredential | Export-Clixml -LiteralPath $credentialPath -Force
    Write-Host "기존 자격 증명을 [$Account] 계정으로 복사했습니다."
    Write-Host "검증 전까지 기존 파일을 유지합니다: $legacyCredentialPath"
    exit 0
}

if ($Remove) {
    if (Test-Path -LiteralPath $credentialPath -PathType Leaf) {
        Remove-Item -LiteralPath $credentialPath -Force
        Write-Host "[$Account] 저장 자격 증명을 삭제했습니다."
    } else {
        Write-Host "[$Account] 삭제할 자격 증명이 없습니다."
    }
    $backendStateRoot = Get-AccountBackendStateRoot -Name $Account
    if (Test-Path -LiteralPath $backendStateRoot -PathType Container) {
        $resolvedState = (Resolve-Path -LiteralPath $backendStateRoot).Path
        $resolvedParent = (Resolve-Path -LiteralPath $backendStatesDirectory).Path
        if (Split-Path $resolvedState -Parent -ne $resolvedParent) {
            throw "[$Account] 예상하지 못한 Backend.AI 상태 경로입니다: $resolvedState"
        }
        Remove-Item -LiteralPath $resolvedState -Recurse -Force
        Write-Host "[$Account] 격리된 Backend.AI 쿠키 상태를 삭제했습니다."
    }
    $loginStatePath = Get-AccountLoginStatePath -Name $Account
    if (Test-Path -LiteralPath $loginStatePath -PathType Leaf) {
        Remove-Item -LiteralPath $loginStatePath -Force
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) {
    throw "[$Account] 자격 증명이 없습니다. 먼저 '& `"$PSCommandPath`" -Setup -Account $Account'을 실행하십시오."
}
if (-not (Test-Path -LiteralPath $helperPath -PathType Leaf)) {
    throw "로그인 helper를 찾지 못했습니다: $helperPath"
}

$storedCredential = Import-Clixml -LiteralPath $credentialPath
$bstr = [IntPtr]::Zero
$plainPassword = $null
$process = $null

try {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storedCredential.Password)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $loginInput = @{
        account = $Account
        user_id = $storedCredential.UserName
        password = $plainPassword
        state_path = Split-Path (Get-AccountCookiePath -Name $Account) -Parent
    } | ConvertTo-Json -Compress

    $pythonPath = Get-BackendAiPython
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $pythonPath
    $startInfo.Arguments = '"' + $helperPath.Replace('"', '\"') + '"'
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    # Match the PowerShell writer and Python reader, including non-ASCII credentials.
    $startInfo.StandardInputEncoding = [System.Text.UTF8Encoding]::new($false)
    $startInfo.EnvironmentVariables['PYTHONIOENCODING'] = 'utf-8'
    $backendStateRoot = Get-AccountBackendStateRoot -Name $Account
    New-Item -ItemType Directory -Path $backendStateRoot -Force | Out-Null
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw '로그인 helper 프로세스를 시작하지 못했습니다.'
    }
    $process.StandardInput.WriteLine($loginInput)
    $process.StandardInput.Close()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "[$Account] kt cloud CLI 로그인이 실패했습니다 (종료 코드 $($process.ExitCode))."
    }

    $loginStatePath = Get-AccountLoginStatePath -Name $Account
    New-Item -ItemType Directory -Path (Split-Path $loginStatePath -Parent) -Force | Out-Null
    [ordered]@{
        account = $Account
        username = $storedCredential.UserName
        max_gpu = (Get-AccountDefinition -Name $Account).MaxGpu
        endpoint = $endpoint
        backend_state_root = $backendStateRoot
        logged_in_at = [DateTimeOffset]::Now.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $loginStatePath -Encoding utf8
    $maxGpu = (Get-AccountDefinition -Name $Account).MaxGpu
    if ($null -eq $maxGpu) {
        Write-Host "격리 로그인 완료: $Account (GPU 한도는 실시간 자원 조회 필요)"
    } else {
        Write-Host "격리 로그인 완료: $Account (GPU 최대 $maxGpu개)"
    }
    Write-Host "CLI 상태 루트: $backendStateRoot"
} finally {
    if ($null -ne $process) {
        $process.Dispose()
    }
    if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    $plainPassword = $null
    $loginInput = $null
    $storedCredential = $null
}
