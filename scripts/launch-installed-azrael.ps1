#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ManifestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$manifestFile = (Resolve-Path -LiteralPath $ManifestPath).Path
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json -AsHashtable
if ($manifest['schema'] -ne 1) { throw 'Unsupported azrael installation manifest schema.' }

$requiredPaths = @('codePath', 'userDataDir', 'extensionsDir', 'workspacePath', 'stateRoot', 'releaseDirectory')
foreach ($key in $requiredPaths) {
    $value = $manifest[$key]
    if ($value -isnot [string] -or -not [IO.Path]::IsPathFullyQualified($value)) {
        throw "Invalid absolute path '$key' in azrael installation manifest."
    }
}
foreach ($key in @('codePath', 'extensionsDir', 'workspacePath', 'releaseDirectory')) {
    if (-not (Test-Path -LiteralPath $manifest[$key])) { throw "Missing azrael installation path '$key': $($manifest[$key])" }
}
if ([IO.Path]::GetFileName($manifest['codePath']) -ine 'code.cmd') { throw 'Installed azrael codePath must identify code.cmd.' }

function Get-CommandLineOption {
    param([Parameter(Mandatory)][string]$CommandLine, [Parameter(Mandatory)][string]$Name)
    $pattern = '(?i)(?:^|\s)--' + [regex]::Escape($Name) + '(?:=|\s+)(?:"([^"]+)"|''([^'']+)''|(\S+))'
    $match = [regex]::Match($CommandLine, $pattern)
    if (-not $match.Success) { return $null }
    foreach ($index in 1..3) {
        if ($match.Groups[$index].Success) { return $match.Groups[$index].Value }
    }
    return $null
}

$requestedUserData = [IO.Path]::GetFullPath($manifest['userDataDir']).TrimEnd('\', '/')
$requestedExtensions = [IO.Path]::GetFullPath($manifest['extensionsDir']).TrimEnd('\', '/')
$codeProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'Code.exe'" -ErrorAction Stop)
foreach ($process in $codeProcesses) {
    if (-not $process.CommandLine -or $process.CommandLine -match '(?i)(?:^|\s)--type(?:=|\s)') { continue }
    $runningUserDataOption = Get-CommandLineOption -CommandLine $process.CommandLine -Name 'user-data-dir'
    $runningExtensionsOption = Get-CommandLineOption -CommandLine $process.CommandLine -Name 'extensions-dir'
    if (-not $runningUserDataOption) { continue }
    $runningUserData = [IO.Path]::GetFullPath($runningUserDataOption).TrimEnd('\', '/')
    $runningExtensions = if ($runningExtensionsOption) { [IO.Path]::GetFullPath($runningExtensionsOption).TrimEnd('\', '/') } else { $null }
    if ($runningUserData -ieq $requestedUserData -and $runningExtensions -ine $requestedExtensions) {
        throw 'The azrael installation was updated while an older azrael window is still open. Finish current work and close all azrael windows, then reopen the azrael shortcut. No process was stopped.'
    }
}

$savedEnvironment = [ordered]@{}
$environmentNames = @(Get-ChildItem Env: | Where-Object { $_.Name -eq 'CODEX_HOME' -or $_.Name -like 'AZRAEL_*' } | Select-Object -ExpandProperty Name)
foreach ($name in $environmentNames) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    Remove-Item -LiteralPath "Env:$name"
}
try {
    & $manifest['codePath'] --user-data-dir $manifest['userDataDir'] --extensions-dir $manifest['extensionsDir'] --new-window $manifest['workspacePath']
    if ($LASTEXITCODE -ne 0) { throw "VS Code launch failed with exit code $LASTEXITCODE." }
}
finally {
    foreach ($name in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
}
$global:LASTEXITCODE = 0
