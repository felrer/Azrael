[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$StateRoot
)

$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathFullyQualified($Executable) -or -not [IO.Path]::IsPathFullyQualified($StateRoot)) {
    throw 'Devin executable and state root must be absolute paths.'
}
$devinExecutable = (Resolve-Path -LiteralPath $Executable).Path
$devinRoot = Join-Path $StateRoot 'azrael/devin'
New-Item -ItemType Directory -Path $devinRoot -Force | Out-Null
$catalogPath = Join-Path $devinRoot 'catalog.json'
# This marker enables the pinned official picker. The fork bypasses static
# catalog replacement for this exact path and keeps OpenAI online refresh.
if (-not (Test-Path -LiteralPath $catalogPath)) {
    $catalogSource = Join-Path $PSScriptRoot 'devin-catalog.json'
    if (-not (Test-Path -LiteralPath $catalogSource -PathType Leaf)) {
        $catalogSource = Join-Path $PSScriptRoot '../upstream/codex/codex-rs/models-manager/models.json'
    }
    Copy-Item -LiteralPath $catalogSource -Destination $catalogPath
}
$configPath = Join-Path $StateRoot 'config.toml'
$configText = if (Test-Path -LiteralPath $configPath) { [IO.File]::ReadAllText($configPath) } else { '' }
if ($configText -notmatch '(?m)^\s*model_catalog_json\s*=') {
    $catalogValue = $catalogPath.Replace('\', '/') | ConvertTo-Json -Compress
    $temporaryConfig = Join-Path $StateRoot ('config-devin-' + [guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($temporaryConfig, "model_catalog_json = $catalogValue`n" + $configText)
    [IO.File]::Move($temporaryConfig, $configPath, $true)
}
$devinExecutable
