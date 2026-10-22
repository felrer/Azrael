#requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'verification-state.ps1')

# Invoke the real helper against absent absolute paths; never start a product
# process or create state, profiles, sockets or fixture directories.
$driveRoot = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($PSScriptRoot))
$prefix = Join-Path $driveRoot ('azv-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '-')
function New-BoundaryState([int]$SocketBytes, [string]$Text) {
    $base = $prefix + $Text
    $socket = Join-Path $base 'ipc/aaaaaaaaaaaaaaaaaaaa.sock'
    $padding = $SocketBytes - [Text.Encoding]::UTF8.GetByteCount($socket)
    if ($padding -lt 0) { throw 'Test prefix exceeds requested boundary.' }
    $base + ('a' * $padding)
}

foreach ($text in @('', '한글')) {
    foreach ($length in @(107, 108)) {
        $state = New-BoundaryState -SocketBytes $length -Text $text
        $socket = Join-Path $state 'ipc/aaaaaaaaaaaaaaaaaaaa.sock'
        if ([Text.Encoding]::UTF8.GetByteCount($socket) -ne $length) { throw 'Invalid test boundary.' }
        if (Test-Path -LiteralPath $state) { throw "Test state already exists: $state" }
        $message = $null
        try { Assert-AzraelVerificationStatePath -StateRoot $state } catch { $message = $_.Exception.Message }
        $expectReject = $IsWindows -and $length -eq 108
        if ($expectReject) {
            if (-not $message -or $message -notlike '*108 UTF-8 bytes; maximum is 107*' -or $message -notlike '*shorter fresh FixtureRoot/StateRoot*') {
                throw "Missing actionable boundary rejection: $message"
            }
        } elseif ($message) { throw "Valid state rejected: $message" }
        if (Test-Path -LiteralPath $state) { throw "Preflight created state: $state" }
        "PASS: text='$text', socketBytes=$length, rejected=$expectReject, state absent"
    }
}

if ($IsWindows) {
    # A missing VSIX must never be resolved when state already exceeds the limit.
    $fixture = $prefix + 'fixture'
    $invalidState = New-BoundaryState -SocketBytes 108 -Text '한글'
    $message = $null
    try {
        & (Join-Path $PSScriptRoot 'check-independent-vscode.ps1') -HostVsixPath (Join-Path $fixture 'missing.vsix') -FixtureRoot $fixture -StateRoot $invalidState
    } catch { $message = $_.Exception.Message }
    if (-not $message -or $message -notlike '*108 UTF-8 bytes; maximum is 107*') { throw "Host check did not preflight before source resolution: $message" }
    if ((Test-Path -LiteralPath $fixture) -or (Test-Path -LiteralPath $invalidState)) { throw 'Rejected host check created fixture/state.' }
    'PASS: host checker rejected before resolving missing package; no fixture/state created or product started'
} else {
    'PASS: non-Windows helper preserves paths at both boundaries; native Windows rejection is unverified on this host'
}
