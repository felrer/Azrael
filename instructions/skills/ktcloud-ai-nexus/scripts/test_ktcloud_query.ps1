$ErrorActionPreference = 'Stop'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('ktcloud-query-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ktcloud_query.ps1') -Destination $temporary
    @'
param([string]$Account, [int]$TimeoutSeconds, [int]$MaxRetries, [string[]]$CliArguments)
[pscustomobject]@{ Account=$Account; Arguments=$CliArguments; Timeout=$TimeoutSeconds; Retries=$MaxRetries } | ConvertTo-Json -Compress
$global:LASTEXITCODE = 0
'@ | Set-Content -LiteralPath (Join-Path $temporary 'ktcloud_cli.ps1') -Encoding UTF8
    $query = Join-Path $temporary 'ktcloud_query.ps1'
    $uuid = '00000000-0000-0000-0000-000000000001'
    $cases = @(
        @{ Options=@{Query='SessionState';SessionId=$uuid}; Expected=@('v2','session','get',$uuid) },
        @{ Options=@{Query='SessionDetails';SessionId=$uuid}; Expected=@('session','info',$uuid) },
        @{ Options=@{Query='SessionSearch';Limit=7}; Expected=@('v2','my','session','search','--limit','7') },
        @{ Options=@{Query='Images'}; Expected=@('image','list') },
        @{ Options=@{Query='UserResources'}; Expected=@('v2','my','resource-allocation','keypair-usage') }
    )
    foreach ($case in $cases) {
        $options = $case.Options
        $actual = & $query -Account abydos @options -TimeoutSeconds 12 -MaxRetries 0 | ConvertFrom-Json
        if (($actual.Arguments -join '|') -ne ($case.Expected -join '|') -or $actual.Timeout -ne 12 -or $actual.Retries -ne 0) {
            throw "Incorrect query dispatch: $($options.Query)"
        }
    }
    $folder = 'a"b\c'
    $actual = & $query -Account abydos -Query Vfolders -FolderName $folder | ConvertFrom-Json
    $expectedFilter = 'name == ' + (ConvertTo-Json -InputObject $folder -Compress)
    if ($actual.Arguments.Count -ne 4 -or $actual.Arguments[3] -ne $expectedFilter) {
        throw 'Folder filter argument lost quoting.'
    }
    foreach ($invalid in @(
        @{ Query='SessionState' },
        @{ Query='SessionDetails'; SessionId=[guid]::Empty },
        @{ Query='Images'; SessionId=$uuid },
        @{ Query='Images'; FolderName='felrer' },
        @{ Query='Images'; Limit=3 }
    )) {
        $blocked = $false
        try { & $query -Account abydos @invalid | Out-Null } catch { $blocked = $true }
        if (-not $blocked) { throw 'Invalid query parameters reached the CLI.' }
    }
    Write-Host 'ktcloud query dispatch: 11 checks passed.'
} finally {
    $resolved = [IO.Path]::GetFullPath($temporary)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path $resolved -Leaf) -notmatch '^ktcloud-query-test-[0-9a-f]{32}$') {
        throw 'Refusing cleanup outside this test temporary directory.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
