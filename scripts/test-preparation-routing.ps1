#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$PreparedPackageDirectory = (Join-Path $PSScriptRoot '../artifacts/deployments/independent-20261001-134502-769/package'),
    [string]$ReleaseDirectory = (Join-Path $PSScriptRoot '../artifacts/releases/pdf_chrome_20261001_v3')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$package = [IO.Path]::GetFullPath($PreparedPackageDirectory)
$release = [IO.Path]::GetFullPath($ReleaseDirectory)
$manifest = Get-Content -LiteralPath (Join-Path $package 'independent-prepared.json') -Raw | ConvertFrom-Json
$missingRoot = Join-Path ([IO.Path]::GetTempPath()) ('azrael-preparation-routing-absent-' + [guid]::NewGuid().ToString('N'))
$missingCode = Join-Path $missingRoot 'code.cmd'
$missingExtensions = Join-Path $missingRoot 'extensions'
if (Test-Path -LiteralPath $missingRoot) { throw 'The deliberately nonexistent test path already exists.' }
$result = & (Join-Path $PSScriptRoot 'install-independent-vscode.ps1') -PrepareOnly -PreparedPackageDirectory $package -ReleaseDirectory $release -StateRoot $manifest.StateRoot -SkipCodexEnvironmentSnapshot -CodePath $missingCode -ExtensionsDir $missingExtensions
if (-not $result.Prepared -or $result.Installed) { throw 'Pure preparation must return Prepared=true and Installed=false.' }
$receipt = Get-Content -LiteralPath $result.Receipt -Raw | ConvertFrom-Json
if ($receipt.profileAccessed -ne $false -or $receipt.hostInstalled -ne $false -or $receipt.status -ne 'prepared') { throw 'Preparation receipt must show success without profile access or installation.' }
if (Test-Path -LiteralPath $missingRoot) { throw 'Pure preparation created the nonexistent CLI/profile test path.' }
[pscustomobject]@{ Result = 'PASS'; Prepared = $result.Prepared; Installed = $result.Installed; ProfileAccessed = $receipt.profileAccessed; Receipt = $result.Receipt; MissingExtensionsDirectoryCreated = $false }
