[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Url,
    [string]$ConfigurationPath = (Join-Path $PSScriptRoot 'configuration.json'),
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$configuration = Get-Content -LiteralPath $ConfigurationPath -Raw | ConvertFrom-Json
if ($configuration.schema -ne 1 -or $configuration.owner -cne 'azrael-ex-local.azrael') {
    throw 'Unknown Azrael session protocol configuration.'
}
foreach ($configuredPath in @($configuration.codePath, $configuration.parserPath)) {
    if (-not [IO.Path]::IsPathFullyQualified($configuredPath) -or
        -not (Test-Path -LiteralPath $configuredPath -PathType Leaf)) {
        throw 'Azrael session protocol requires its recorded executable and parser.'
    }
}
if ((Get-FileHash -LiteralPath $configuration.parserPath -Algorithm SHA256).Hash -ine $configuration.parserSha256) {
    throw 'Azrael session URL parser differs from the installation receipt.'
}

# Reuse VS Code's bundled Node runtime without changing the parent environment.
$parseInfo = [Diagnostics.ProcessStartInfo]::new($configuration.codePath)
$parseInfo.UseShellExecute = $false
$parseInfo.CreateNoWindow = $true
$parseInfo.RedirectStandardOutput = $true
$parseInfo.RedirectStandardError = $true
$parseInfo.Environment['ELECTRON_RUN_AS_NODE'] = '1'
$parseInfo.ArgumentList.Add($configuration.parserPath)
$parseInfo.ArgumentList.Add($Url)
$parser = [Diagnostics.Process]::Start($parseInfo)
try {
    $output = $parser.StandardOutput.ReadToEndAsync()
    $errors = $parser.StandardError.ReadToEndAsync()
    if (-not $parser.WaitForExit(10000)) {
        $parser.Kill($true)
        throw 'Azrael session URL validation timed out.'
    }
    if ($parser.ExitCode -ne 0) { throw 'Invalid Azrael session link.' }
    $parsed = $output.GetAwaiter().GetResult() | ConvertFrom-Json
    $target = [Uri]$parsed.vscodeUrl
    if ($target.Scheme -cne 'vscode' -or $target.Host -cne 'azrael-ex-local.azrael' -or
        -not $target.AbsolutePath.StartsWith('/local/')) {
        throw 'Azrael session parser returned an unexpected destination.'
    }
} finally {
    $parser.Dispose()
}
if ($ValidateOnly) { $parsed.vscodeUrl; return }

$openInfo = [Diagnostics.ProcessStartInfo]::new($configuration.codePath)
$openInfo.UseShellExecute = $false
$openInfo.ArgumentList.Add('--open-url')
$openInfo.ArgumentList.Add('--')
$openInfo.ArgumentList.Add($parsed.vscodeUrl)
$openInfo.Environment.Remove('ELECTRON_RUN_AS_NODE') | Out-Null
$opened = [Diagnostics.Process]::Start($openInfo)
$opened.Dispose()
