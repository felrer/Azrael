function Assert-AzraelVerificationStatePath {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$StateRoot)

    # The Windows codex-uds AF_UNIX address reserves one byte for the terminator.
    # Bound the versioned endpoint: 20 lowercase Base32 characters plus .sock.
    # Keep this host-verification preflight separate from product path selection.
    if (-not $IsWindows) { return }
    $state = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\', '/')
    $socketPath = Join-Path $state 'ipc/aaaaaaaaaaaaaaaaaaaa.sock'
    $byteLength = [Text.Encoding]::UTF8.GetByteCount($socketPath)
    if ($byteLength -ge 108) {
        throw "Windows app-server control socket path is $byteLength UTF-8 bytes; maximum is 107: $socketPath. Use a shorter fresh FixtureRoot/StateRoot, or a shorter checkout path for deployment fixtures. No verification state has been created."
    }
}
