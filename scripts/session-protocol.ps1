Set-StrictMode -Version Latest

function Get-AzraelSessionProtocolCommand {
    param([Parameter(Mandatory)][string]$PowerShellPath, [Parameter(Mandatory)][string]$LauncherPath)
    foreach ($argument in @($PowerShellPath, $LauncherPath)) {
        if (-not [IO.Path]::IsPathFullyQualified($argument) -or $argument.Contains('"') -or $argument.Contains("`r") -or $argument.Contains("`n")) {
            throw 'Protocol launch paths must be absolute and cannot contain quotes or newlines.'
        }
    }
    '"' + $PowerShellPath + '" -NoLogo -NoProfile -WindowStyle Hidden -File "' + $LauncherPath + '" -Url "%1"'
}

function Install-AzraelSessionProtocol {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$CodePath,
        [Parameter(Mandatory)][string]$ParserPath,
        [Parameter(Mandatory)][string]$ReceiptDirectory,
        [string]$LauncherSource = (Join-Path $PSScriptRoot 'open-azrael-session-link.ps1')
    )
    $owner = 'azrael-ex-local.azrael'
    $keyPath = 'HKCU:\Software\Classes\azrael'
    $previous = $null
    if (Test-Path -LiteralPath $keyPath) {
        $key = Get-Item -LiteralPath $keyPath
        if ($key.GetValue('AzraelOwner') -cne $owner) { throw 'The azrael protocol is registered to another owner.' }
        $previous = $key.GetValue('AzraelReceipt')
        if (-not $previous -or -not (Test-Path -LiteralPath $previous -PathType Leaf)) {
            throw 'Existing Azrael protocol registration has no recovery receipt.'
        }
        $previousConfiguration = Get-Content -LiteralPath $previous -Raw | ConvertFrom-Json
        $registeredCommand = (Get-Item -LiteralPath (Join-Path $keyPath 'shell\open\command')).GetValue('')
        if ($previousConfiguration.schema -ne 1 -or $previousConfiguration.owner -cne $owner -or
            $registeredCommand -cne $previousConfiguration.command) {
            throw 'Existing protocol registration differs from its recovery receipt.'
        }
    }
    foreach ($inputPath in @($CodePath, $ParserPath, $LauncherSource)) {
        if (-not [IO.Path]::IsPathFullyQualified($inputPath) -or -not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
            throw 'Session protocol installation requires absolute existing input files.'
        }
    }
    $directory = Join-Path $ReceiptDirectory 'session-protocol'
    if (Test-Path -LiteralPath $directory) { throw 'Session protocol receipt directory already exists.' }
    $null = New-Item -ItemType Directory -Path $directory
    $launcherPath = Join-Path $directory 'open-azrael-session-link.ps1'
    Copy-Item -LiteralPath $LauncherSource -Destination $launcherPath
    $command = Get-AzraelSessionProtocolCommand -PowerShellPath (Join-Path $PSHOME 'pwsh.exe') -LauncherPath $launcherPath
    $receiptPath = Join-Path $directory 'configuration.json'
    $receipt = [ordered]@{
        schema = 1; owner = $owner; codePath = $CodePath; parserPath = $ParserPath
        parserSha256 = (Get-FileHash -LiteralPath $ParserPath -Algorithm SHA256).Hash.ToLowerInvariant()
        command = $command; previousReceipt = $previous
    }
    $receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
    try {
        $null = New-Item -Path $keyPath -Force
        $null = New-ItemProperty -LiteralPath $keyPath -Name 'AzraelOwner' -Value $owner -PropertyType String -Force
        $null = New-ItemProperty -LiteralPath $keyPath -Name 'AzraelReceipt' -Value $receiptPath -PropertyType String -Force
        Set-Item -LiteralPath $keyPath -Value 'URL:Azrael session'
        $null = New-ItemProperty -LiteralPath $keyPath -Name 'URL Protocol' -Value '' -PropertyType String -Force
        $commandKey = Join-Path $keyPath 'shell\open\command'
        $null = New-Item -Path $commandKey -Force
        Set-Item -LiteralPath $commandKey -Value $command
    } catch {
        Restore-AzraelSessionProtocol -ReceiptPath $receiptPath
        throw
    }
    [pscustomobject]@{ Registered = $true; ReceiptPath = $receiptPath; PreviousReceipt = $previous }
}

function Restore-AzraelSessionProtocol {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ReceiptPath)
    $receipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json
    if ($receipt.schema -ne 1 -or $receipt.owner -cne 'azrael-ex-local.azrael') { throw 'Unknown protocol recovery receipt.' }
    $keyPath = 'HKCU:\Software\Classes\azrael'
    if (-not (Test-Path -LiteralPath $keyPath)) { return }
    $key = Get-Item -LiteralPath $keyPath
    if ($key.GetValue('AzraelOwner') -cne $receipt.owner -or $key.GetValue('AzraelReceipt') -cne $ReceiptPath) {
        throw 'Protocol ownership changed; refusing to restore another registration.'
    }
    if ($receipt.previousReceipt) {
        $previous = Get-Content -LiteralPath $receipt.previousReceipt -Raw | ConvertFrom-Json
        if ($previous.schema -ne 1 -or $previous.owner -cne $receipt.owner) { throw 'Unknown previous protocol receipt.' }
        Set-Item -LiteralPath (Join-Path $keyPath 'shell\open\command') -Value $previous.command
        Set-ItemProperty -LiteralPath $keyPath -Name 'AzraelReceipt' -Value $receipt.previousReceipt
    } else {
        # Only the fixed current-user protocol key is removed, after owner checks.
        Remove-Item -LiteralPath 'HKCU:\Software\Classes\azrael' -Recurse
    }
}
