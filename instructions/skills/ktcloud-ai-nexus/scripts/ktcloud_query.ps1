[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^(trinity|abydos|arius[1-9][0-9]*)$')]
    [string]$Account,

    [Parameter(Mandatory)]
    [ValidateSet('SessionState', 'SessionDetails', 'SessionSearch', 'Images', 'Vfolders', 'UserResources')]
    [string]$Query,

    [guid]$SessionId,
    [string]$FolderName,
    [ValidateRange(1, 100)]
    [int]$Limit = 20,
    [ValidateRange(1, 600)]
    [int]$TimeoutSeconds,
    [ValidateRange(0, 2)]
    [int]$MaxRetries = 2
)

$ErrorActionPreference = 'Stop'
$hasSession = $PSBoundParameters.ContainsKey('SessionId')
$hasFolder = $PSBoundParameters.ContainsKey('FolderName')
if ($Query -in @('SessionState', 'SessionDetails')) {
    if (-not $hasSession -or $SessionId -eq [guid]::Empty) {
        throw "$Query requires a nonempty -SessionId UUID."
    }
} elseif ($hasSession) {
    throw '-SessionId is only supported for SessionState or SessionDetails.'
}
if ($hasFolder -and ($Query -ne 'Vfolders' -or [string]::IsNullOrWhiteSpace($FolderName))) {
    throw '-FolderName requires Query Vfolders and a nonempty name.'
}
if ($PSBoundParameters.ContainsKey('Limit') -and $Query -ne 'SessionSearch') {
    throw '-Limit is only supported for SessionSearch.'
}

$cli = switch ($Query) {
    'SessionState' { @('v2', 'session', 'get', $SessionId.ToString()) }
    'SessionDetails' { @('session', 'info', $SessionId.ToString()) }
    'SessionSearch' { @('v2', 'my', 'session', 'search', '--limit', [string]$Limit) }
    'Images' { @('image', 'list') }
    'Vfolders' {
        if ($hasFolder) {
            # JSON quoting preserves quotes/backslashes inside a literal filter value.
            $literal = ConvertTo-Json -InputObject $FolderName -Compress
            @('vfolder', 'list', '--filter', "name == $literal")
        } else {
            @('vfolder', 'list')
        }
    }
    'UserResources' { @('v2', 'my', 'resource-allocation', 'keypair-usage') }
}
$parameters = @{ Account = $Account; MaxRetries = $MaxRetries }
if ($PSBoundParameters.ContainsKey('TimeoutSeconds')) {
    $parameters.TimeoutSeconds = $TimeoutSeconds
}
# Explicit contracts: Images returns images, not runtime presets; SessionSearch
# returns one limited page, not proof of complete history. No SDK DTO patches.
& (Join-Path $PSScriptRoot 'ktcloud_cli.ps1') @parameters -CliArguments $cli
