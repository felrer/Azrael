[CmdletBinding()]
param([switch]$Live)

$ErrorActionPreference = 'Stop'
$wrapper = Join-Path $PSScriptRoot 'ktcloud_cli.ps1'
$installer = Join-Path $PSScriptRoot 'install_backendai_v2_runtime.ps1'
$clientPath = Join-Path $env:LOCALAPPDATA 'ktcloud-ai-nexus\client-tools\26.7.0\linux-x86_64\backendai-client-fat-linux-x86_64'
$approvedHash = 'DBDC8938A7D7174BB8551EF5499A84A63B24F5D786BC7173A96ACAFE6A6F5429'
$distro = 'ktcloud-ubuntu-24.04'

function Assert-True {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

function Convert-ToWslPath {
    param([Parameter(Mandatory)][string]$WindowsPath)
    $resolved = [IO.Path]::GetFullPath($WindowsPath)
    if ($resolved -notmatch '^([A-Za-z]):\\(.*)$') {
        throw "unsupported Windows path: $resolved"
    }
    $drive = $Matches[1].ToLowerInvariant()
    $relative = $Matches[2] -replace '\\', '/'
    "/mnt/$drive/$relative"
}

Assert-True (Test-Path -LiteralPath $wrapper -PathType Leaf) 'canonical CLI wrapper is missing'
Assert-True (Test-Path -LiteralPath $installer -PathType Leaf) 'v2 runtime installer is missing'
Assert-True (Test-Path -LiteralPath $clientPath -PathType Leaf) 'Linux fat client is missing'
Assert-True ((Get-FileHash -LiteralPath $clientPath -Algorithm SHA256).Hash -eq $approvedHash) 'Linux fat client hash mismatch'

$linuxClient = Convert-ToWslPath -WindowsPath $clientPath
$reportedVersion = & wsl.exe -d $distro -- $linuxClient --version
Assert-True ($LASTEXITCODE -eq 0) 'Linux fat client --version failed'
Assert-True (($reportedVersion -join "`n") -match 'backend\.ai-client\s+26\.7\.0') 'Linux fat client version mismatch'

foreach ($name in @('trinity', 'abydos')) {
    $expected = Convert-ToWslPath -WindowsPath (Join-Path $env:LOCALAPPDATA "ktcloud-ai-nexus\backend-state\$name\Lablup\backend.ai")
    $actual = & wsl.exe -d $distro -- readlink -f "/var/lib/ktcloud-ai-nexus/$name/.backend.ai/session"
    Assert-True ($LASTEXITCODE -eq 0 -and $actual.Trim() -eq $expected) "[$name] isolated session link mismatch"
}

$sensitiveBlocked = $false
try {
    & $wrapper -Account abydos -- admin keypair info 2>$null
} catch {
    $sensitiveBlocked = $_.Exception.Message -match '민감한 keypair'
}
Assert-True $sensitiveBlocked 'legacy sensitive command guard regressed'

$legacyLinuxBlocked = $false
try {
    & $wrapper -Account abydos -Runtime Linux -- session list 2>$null
} catch {
    $legacyLinuxBlocked = $_.Exception.Message -match 'v2 명령에만'
}
Assert-True $legacyLinuxBlocked 'Linux runtime accepted a legacy command'

if ($Live) {
    $savedEndpoint = $env:BACKEND_ENDPOINT
    $savedEndpointType = $env:BACKEND_ENDPOINT_TYPE
    $savedStatePath = $env:KTCLOUD_BACKEND_STATE_PATH
    foreach ($name in @('trinity', 'abydos')) {
        & $wrapper -Account $name -- v2 config show | Out-Null
        Assert-True ($LASTEXITCODE -eq 0) "[$name] v2 config query failed"
        & $wrapper -Account $name -- v2 my resource-allocation keypair-usage | Out-Null
        Assert-True ($LASTEXITCODE -eq 0) "[$name] v2 authenticated query failed"
    }
    $sessionOutput = & $wrapper -Account abydos -- v2 my session search --limit 1 | Out-String
    Assert-True ($LASTEXITCODE -eq 0) '[abydos] v2 session query failed'
    Assert-True ($sessionOutput -notmatch '(?i)"(?:access|secret)[_-]?key"\s*:\s*"(?!\[redacted\])') 'v2 output leaked key material'
    Assert-True ($env:BACKEND_ENDPOINT -eq $savedEndpoint) 'BACKEND_ENDPOINT leaked into caller environment'
    Assert-True ($env:BACKEND_ENDPOINT_TYPE -eq $savedEndpointType) 'BACKEND_ENDPOINT_TYPE leaked into caller environment'
    Assert-True ($env:KTCLOUD_BACKEND_STATE_PATH -eq $savedStatePath) 'state path leaked into caller environment'
}

Write-Host 'ktcloud CLI runtime checks passed.'
