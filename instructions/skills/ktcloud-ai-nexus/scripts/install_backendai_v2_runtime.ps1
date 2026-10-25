[CmdletBinding()]
param(
    [ValidatePattern('^(trinity|abydos|arius[1-9][0-9]*)$')]
    [string[]]$Account = @('trinity', 'abydos')
)

$ErrorActionPreference = 'Stop'
$distroName = 'ktcloud-ubuntu-24.04'
$clientVersion = '26.7.0'
$clientUrl = 'https://github.com/lablup/backend.ai/releases/download/26.7.0/backendai-client-fat-linux-x86_64'
$clientSha256 = 'DBDC8938A7D7174BB8551EF5499A84A63B24F5D786BC7173A96ACAFE6A6F5429'
$rootfsUrl = 'https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz'
$rootfsSha256 = '2A790896740B14D637DBDC583CCE1BA081AC53B9E9CDB46DC09A2F73ABBD9934'
$stateRoot = Join-Path $env:LOCALAPPDATA 'ktcloud-ai-nexus'
$downloadsRoot = Join-Path $stateRoot 'downloads'
$clientRoot = Join-Path $stateRoot 'client-tools\26.7.0\linux-x86_64'
$distroRoot = Join-Path $stateRoot 'wsl\ubuntu-24.04'
$clientPath = Join-Path $clientRoot 'backendai-client-fat-linux-x86_64'
$rootfsPath = Join-Path $downloadsRoot 'ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz'
$manifestPath = Join-Path (Split-Path $clientRoot -Parent) 'runtime-manifest.json'

function Assert-ApprovedFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Sha256
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }
    $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($actualHash -ne $Sha256) {
        throw "승인된 SHA-256과 다른 기존 파일을 덮어쓰지 않습니다: $Path ($actualHash)"
    }
    return $true
}

function Get-ApprovedDownload {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$Destination,
        [Parameter(Mandatory)][string]$Sha256
    )

    if (Assert-ApprovedFile -Path $Destination -Sha256 $Sha256) {
        return
    }
    $temporaryPath = "$Destination.download"
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
        $temporaryHash = (Get-FileHash -LiteralPath $temporaryPath -Algorithm SHA256).Hash
        if ($temporaryHash -ne $Sha256) {
            throw "불완전하거나 검증되지 않은 download 파일이 있습니다. 자동 삭제하지 않습니다: $temporaryPath"
        }
    } else {
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $temporaryPath
    }
    if (-not (Assert-ApprovedFile -Path $temporaryPath -Sha256 $Sha256)) {
        throw "download 파일 검증에 실패했습니다: $temporaryPath"
    }
    Move-Item -LiteralPath $temporaryPath -Destination $Destination
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

foreach ($directory in @($downloadsRoot, $clientRoot, $distroRoot)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
Get-ApprovedDownload -Url $rootfsUrl -Destination $rootfsPath -Sha256 $rootfsSha256
Get-ApprovedDownload -Url $clientUrl -Destination $clientPath -Sha256 $clientSha256

$installedDistros = @(
    & wsl.exe --list --quiet 2>$null |
        ForEach-Object { $_ -replace "`0", '' } |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ }
)
if ($distroName -notin $installedDistros) {
    & wsl.exe --import $distroName $distroRoot $rootfsPath --version 2
    if ($LASTEXITCODE -ne 0) {
        throw "Ubuntu WSL2 import가 실패했습니다: $distroName"
    }
}

$linuxClientPath = Convert-ToWslPath -WindowsPath $clientPath
& wsl.exe -d $distroName -- chmod 0755 $linuxClientPath
if ($LASTEXITCODE -ne 0) {
    throw 'Backend.AI Linux client 실행 권한 설정에 실패했습니다.'
}
$reportedVersion = & wsl.exe -d $distroName -- $linuxClientPath --version
if ($LASTEXITCODE -ne 0 -or ($reportedVersion -join "`n") -notmatch 'backend\.ai-client\s+26\.7\.0') {
    throw "Backend.AI Linux client reported version이 26.7.0이 아닙니다: $($reportedVersion -join '; ')"
}

foreach ($name in $Account) {
    $cookieDirectory = Join-Path $stateRoot "backend-state\$name\Lablup\backend.ai"
    $cookiePath = Join-Path $cookieDirectory 'cookie.dat'
    if (-not (Test-Path -LiteralPath $cookiePath -PathType Leaf)) {
        throw "[$name] 기존 격리 로그인 cookie가 없습니다. cookie 복사나 재인증은 수행하지 않았습니다."
    }
    $linuxCookieDirectory = Convert-ToWslPath -WindowsPath $cookieDirectory
    $linuxHome = "/var/lib/ktcloud-ai-nexus/$name"
    $linuxConfigDirectory = "$linuxHome/.backend.ai"
    $linuxSessionLink = "$linuxConfigDirectory/session"
    & wsl.exe -d $distroName -- mkdir -p $linuxConfigDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "[$name] v2 HOME 준비에 실패했습니다."
    }
    & wsl.exe -d $distroName -- test -e $linuxSessionLink
    $linkExists = $LASTEXITCODE -eq 0
    if (-not $linkExists) {
        & wsl.exe -d $distroName -- ln -s $linuxCookieDirectory $linuxSessionLink
        if ($LASTEXITCODE -ne 0) {
            throw "[$name] Windows cookie 원본을 가리키는 session link 생성에 실패했습니다."
        }
    }
    $resolvedLink = & wsl.exe -d $distroName -- readlink -f $linuxSessionLink
    if ($LASTEXITCODE -ne 0 -or $resolvedLink.Trim() -ne $linuxCookieDirectory) {
        throw "[$name] 기존 session link가 예상 cookie 원본과 다릅니다. 자동 변경하지 않습니다."
    }
}

[ordered]@{
    installed_at = [DateTimeOffset]::Now.ToString('o')
    distro = $distroName
    ubuntu = '24.04 LTS'
    client_version = $clientVersion
    client_url = $clientUrl
    client_sha256 = $clientSha256.ToLowerInvariant()
    rootfs_url = $rootfsUrl
    rootfs_sha256 = $rootfsSha256.ToLowerInvariant()
    cookie_mode = 'per-account WSL HOME symlink to original Windows state; no cookie copy'
} | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Host "Backend.AI v2 Linux runtime ready: $distroName / client $clientVersion"
Write-Host "Manifest: $manifestPath"
