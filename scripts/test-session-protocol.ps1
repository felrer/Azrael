Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'session-protocol.ps1')

function Assert-ProtocolTest([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Assert-ProtocolThrows([scriptblock]$Action) {
    $failed = $false
    try { & $Action | Out-Null } catch { $failed = $true }
    Assert-ProtocolTest $failed 'Expected validation to reject the input.'
}

$command = Get-AzraelSessionProtocolCommand -PowerShellPath 'C:\Program Files\PowerShell\7\pwsh.exe' -LauncherPath 'C:\Azrael Data\open-link.ps1'
Assert-ProtocolTest ($command -ceq '"C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo -NoProfile -WindowStyle Hidden -File "C:\Azrael Data\open-link.ps1" -Url "%1"') 'Registry command lost quoting or hidden-window arguments.'
Assert-ProtocolThrows { Get-AzraelSessionProtocolCommand -PowerShellPath 'relative.exe' -LauncherPath 'C:\open.ps1' }
Assert-ProtocolThrows { Get-AzraelSessionProtocolCommand -PowerShellPath 'C:\pwsh.exe' -LauncherPath 'C:\bad"path.ps1' }

foreach ($script in @('session-protocol.ps1', 'open-azrael-session-link.ps1', 'install-independent-vscode.ps1')) {
    $parseErrors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $script), [ref]$null, [ref]$parseErrors)
    Assert-ProtocolTest ($parseErrors.Count -eq 0) "PowerShell syntax errors in $script."
}
$installerAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'install-independent-vscode.ps1'), [ref]$null, [ref]$null)
$protocolCalls = @($installerAst.FindAll({ param($node)
    $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Install-AzraelSessionProtocol'
}, $true))
Assert-ProtocolTest ($protocolCalls.Count -eq 1) 'The installer must wire the external session protocol exactly once.'
$profileGuard = $protocolCalls[0].Parent
while ($profileGuard -and $profileGuard -isnot [Management.Automation.Language.IfStatementAst]) { $profileGuard = $profileGuard.Parent }
Assert-ProtocolTest ($profileGuard -and $profileGuard.Clauses[0].Item1.Extent.Text.Contains('-not $UserDataDir')) 'Protocol registration must remain inside the ordinary-profile guard.'

# No registry writes or editor launches: run only the recorded parser path.
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('azrael-protocol-test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $temporary
try {
    $parserPath = Join-Path $PSScriptRoot 'session-links.cjs'
    $codePaths = @((Get-Command node -CommandType Application).Source)
    $installedCode = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/Code.exe'
    if (Test-Path -LiteralPath $installedCode -PathType Leaf) { $codePaths += $installedCode }
    $configurationPath = Join-Path $temporary 'configuration.json'
    $uuid = '01a100fc-8e6d-7c31-ae5f-06ae53016b54'
    foreach ($codePath in $codePaths) {
        $configuration = [ordered]@{
            schema = 1; owner = 'azrael-ex-local.azrael'; codePath = $codePath; parserPath = $parserPath
            parserSha256 = (Get-FileHash -LiteralPath $parserPath -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        $configuration | ConvertTo-Json | Set-Content -LiteralPath $configurationPath -Encoding utf8
        $result = & (Join-Path $PSScriptRoot 'open-azrael-session-link.ps1') -Url "azrael://threads/$uuid" -ConfigurationPath $configurationPath -ValidateOnly
        Assert-ProtocolTest ($result -ceq "vscode://azrael-ex-local.azrael/local/$uuid") 'Protocol URL did not translate to the native local route.'
        Assert-ProtocolThrows { & (Join-Path $PSScriptRoot 'open-azrael-session-link.ps1') -Url "codex://threads/$uuid" -ConfigurationPath $configurationPath -ValidateOnly }
        Assert-ProtocolThrows { & (Join-Path $PSScriptRoot 'open-azrael-session-link.ps1') -Url 'azrael://threads/not-a-uuid' -ConfigurationPath $configurationPath -ValidateOnly }
        Write-Output "Validated URL handoff using $codePath"
    }
    $configuration.parserSha256 = '0' * 64
    $configuration | ConvertTo-Json | Set-Content -LiteralPath $configurationPath -Encoding utf8
    Assert-ProtocolThrows { & (Join-Path $PSScriptRoot 'open-azrael-session-link.ps1') -Url "azrael://threads/$uuid" -ConfigurationPath $configurationPath -ValidateOnly }

    # Exercise the real registration functions against an in-memory registry.
    $script:protocolRegistry = @{}
    # Keep the filesystem calls native while intercepting every registry mutation.
    function Test-Path {
        param([string]$LiteralPath, $PathType)
        if ($LiteralPath.StartsWith('HKCU:')) { return $script:protocolRegistry.ContainsKey($LiteralPath) }
        if ($PathType) { return Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType }
        Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath
    }
    function Get-Item {
        param([string]$LiteralPath)
        if (-not $LiteralPath.StartsWith('HKCU:')) { return Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath }
        $registryObject = [pscustomobject]@{ Values = $script:protocolRegistry[$LiteralPath] }
        $registryObject | Add-Member -MemberType ScriptMethod -Name GetValue -Value { param($Name) $this.Values[$Name] }
        $registryObject
    }
    function New-Item {
        param([string]$Path, [string]$ItemType, [switch]$Force)
        if ($Path.StartsWith('HKCU:')) { if (-not $script:protocolRegistry.ContainsKey($Path)) { $script:protocolRegistry[$Path] = @{} }; return }
        Microsoft.PowerShell.Management\New-Item -Path $Path -ItemType $ItemType -Force:$Force
    }
    function Set-Item {
        param([string]$LiteralPath, $Value)
        if (-not $LiteralPath.StartsWith('HKCU:')) { throw 'Unexpected Set-Item in registry test.' }
        $script:protocolRegistry[$LiteralPath][''] = $Value
    }
    function New-ItemProperty {
        param([string]$LiteralPath, [string]$Name, $Value, [string]$PropertyType, [switch]$Force)
        $script:protocolRegistry[$LiteralPath][$Name] = $Value
    }
    function Set-ItemProperty {
        param([string]$LiteralPath, [string]$Name, $Value)
        $script:protocolRegistry[$LiteralPath][$Name] = $Value
    }
    function Remove-Item {
        param([string]$LiteralPath, [switch]$Recurse, [switch]$Force)
        if ($LiteralPath.StartsWith('HKCU:')) {
            foreach ($key in @($script:protocolRegistry.Keys)) {
                if ($key -eq $LiteralPath -or $key.StartsWith($LiteralPath + '\')) { $script:protocolRegistry.Remove($key) }
            }
            return
        }
        Microsoft.PowerShell.Management\Remove-Item -LiteralPath $LiteralPath -Recurse:$Recurse -Force:$Force
    }
    $protocolKey = 'HKCU:\Software\Classes\azrael'
    $script:protocolRegistry[$protocolKey] = @{ AzraelOwner = 'some-other-app' }
    Assert-ProtocolThrows { Install-AzraelSessionProtocol -CodePath $codePaths[0] -ParserPath $parserPath -ReceiptDirectory $temporary }
    Assert-ProtocolTest ($script:protocolRegistry[$protocolKey].AzraelOwner -ceq 'some-other-app') 'Registration replaced another owner.'
    $script:protocolRegistry.Clear()
    $firstDirectory = Join-Path $temporary 'first'
    $null = New-Item -ItemType Directory -Path $firstDirectory
    $first = Install-AzraelSessionProtocol -CodePath $codePaths[0] -ParserPath $parserPath -ReceiptDirectory $firstDirectory
    Assert-ProtocolTest ($script:protocolRegistry[$protocolKey].AzraelOwner -ceq 'azrael-ex-local.azrael') 'Registration owner missing.'
    $secondDirectory = Join-Path $temporary 'second'
    $null = New-Item -ItemType Directory -Path $secondDirectory
    $second = Install-AzraelSessionProtocol -CodePath $codePaths[0] -ParserPath $parserPath -ReceiptDirectory $secondDirectory
    Assert-ProtocolTest ($second.PreviousReceipt -ceq $first.ReceiptPath) 'Update lost previous registration.'
    Restore-AzraelSessionProtocol -ReceiptPath $second.ReceiptPath
    Assert-ProtocolTest ($script:protocolRegistry[$protocolKey].AzraelReceipt -ceq $first.ReceiptPath) 'Recovery did not restore previous receipt.'
    Restore-AzraelSessionProtocol -ReceiptPath $first.ReceiptPath
    Assert-ProtocolTest ($script:protocolRegistry.Count -eq 0) 'First-install recovery left registry entries.'
} finally {
    $fullTemporary = [IO.Path]::GetFullPath($temporary)
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $fullTemporary.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup escaped the temporary directory.' }
    Remove-Item -LiteralPath $fullTemporary -Recurse -Force
}
Write-Output 'Session protocol command, syntax, parser handoff and rejection checks passed; registry unchanged.'
