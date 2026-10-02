#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$DeploymentReceipt = (Join-Path $PSScriptRoot '../artifacts/deployments/existing-vscode.json'),
    [string]$CodePath = 'code.cmd',
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$receiptPath = (Resolve-Path -LiteralPath $DeploymentReceipt).Path
$deployment = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
$target = (Resolve-Path -LiteralPath $deployment.extensionsDir).Path
$official = Join-Path $target 'openai.chatgpt-26.908.40401-win32-x64'
$deploymentFolder = Split-Path $deployment.previousFiles -Parent
$prepared = Get-Content -LiteralPath (Join-Path $deploymentFolder 'package/prepared.json') -Raw | ConvertFrom-Json
$runtimePath = Join-Path $prepared.OfficialExtension 'out/azrael-runtime.json'
$runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
$original = (Resolve-Path -LiteralPath $runtime.originalExtension).Path
$originalHashes = @{
    'package.json' = '0DBA4A6ADBF9241788E7B0F8D5032F3536E5DF177FBA1D7E0150254ADAC4C1AE'
    'out/extension.js' = '820691C93BE40E73F0929B633CDDC694B41775050CD72283FABA283E53941F4F'
    'webview/assets/app-initial-1e5ee25fb4ec.js' = '0D3E38DBAC570FEFA5A0B0ECEC3522308DF74AA7B1FE538E1EA2490489347DD9'
    'webview/assets/app-initial-a190b16fc630.js' = '50B1A443400BA2F7AC0BE53C56536A3E145BCCFFF0E2F456F100850133A01683'
}
$added = @('out/azrael-runtime.cjs', 'out/azrael-runtime.json', '.azrael-official-ui.json', '.azrael-profile-menu.json', '.azrael-startup-notices.json')
$files = @($originalHashes.Keys) + $added
foreach ($relative in $originalHashes.Keys) {
    if ((Get-FileHash -LiteralPath (Join-Path $original $relative)).Hash -cne $originalHashes[$relative]) { throw "Pristine backup mismatch: $relative" }
}
# Accept only the recorded patch or an already-restored file, never later edits.
foreach ($relative in $files) {
    $current = Join-Path $official $relative
    if (-not (Test-Path -LiteralPath $current)) {
        if ($relative -in $added) { continue }
        throw "Installed file missing: $relative"
    }
    $hash = (Get-FileHash -LiteralPath $current).Hash
    if ($originalHashes.ContainsKey($relative) -and $hash -ceq $originalHashes[$relative]) { continue }
    $recorded = Join-Path $prepared.OfficialExtension $relative
    if (-not (Test-Path -LiteralPath $recorded) -or $hash -cne (Get-FileHash -LiteralPath $recorded).Hash) {
        throw "Unrecognized installed change; no files restored: $relative"
    }
}
$codeArgs = @('--extensions-dir', $target)
if ($deployment.userDataDir) { $codeArgs += @('--user-data-dir', $deployment.userDataDir) }
$inventory = @(& $CodePath @codeArgs --list-extensions --show-versions)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect ordinary extension inventory.' }
if ($PrepareOnly) {
    [pscustomobject]@{ Validated = $true; OfficialExtension = $official; Original = $original; Files = $files }
    return
}
$backup = Join-Path (Split-Path $receiptPath -Parent) ('restore-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backup | Out-Null
foreach ($relative in $files) {
    $current = Join-Path $official $relative
    if (Test-Path -LiteralPath $current) {
        $saved = Join-Path $backup $relative
        New-Item -ItemType Directory -Path (Split-Path $saved -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $current -Destination $saved
    }
}
$registryPath = Join-Path $target 'extensions.json'
if (Test-Path -LiteralPath $registryPath) { Copy-Item -LiteralPath $registryPath -Destination (Join-Path $backup 'extensions-before.json') }
$result = [ordered]@{ status = 'backed-up'; officialExtension = $official; original = $original; backup = $backup; deploymentReceipt = $receiptPath; companionVsix = $deployment.companionVsix }
$resultPath = Join-Path $backup 'restoration.json'
$result | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding utf8NoBOM
foreach ($relative in $originalHashes.Keys) { Copy-Item -LiteralPath (Join-Path $original $relative) -Destination (Join-Path $official $relative) -Force }
foreach ($relative in $added) {
    $current = Join-Path $official $relative
    if (Test-Path -LiteralPath $current) { Remove-Item -LiteralPath $current }
}
if ($inventory -contains 'azrael-ex-local.azrael-ex@0.1.0') {
    & $CodePath @codeArgs --uninstall-extension azrael-ex-local.azrael-ex | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Companion uninstall failed; restoration backup: $backup" }
}
if (Test-Path -LiteralPath $registryPath) {
    $registry = @(Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json -AsHashtable)
    foreach ($entry in $registry) {
        if ($entry.identifier.id -eq 'openai.chatgpt' -and $entry.metadata) { $entry.metadata.Remove('pinned') | Out-Null }
    }
    $tempRegistry = Join-Path $target ('.azrael-restore-' + [guid]::NewGuid().ToString('N') + '.json')
    ConvertTo-Json -InputObject $registry -Depth 100 | Set-Content -LiteralPath $tempRegistry -Encoding utf8NoBOM
    [IO.File]::Move($tempRegistry, $registryPath, $true)
}
foreach ($relative in $originalHashes.Keys) {
    if ((Get-FileHash -LiteralPath (Join-Path $official $relative)).Hash -cne $originalHashes[$relative]) { throw "Restored hash mismatch: $relative" }
}
$after = @(& $CodePath @codeArgs --list-extensions --show-versions)
if ($LASTEXITCODE -ne 0) { throw 'Post-restoration inventory failed.' }
foreach ($extension in $inventory) {
    if ($extension -notlike 'azrael-ex-local.azrael-ex@*' -and $after -notcontains $extension) { throw "Unrelated extension changed: $extension" }
}
if (@($after | Where-Object { $_ -like 'azrael-ex-local.azrael-ex@*' }).Count) { throw 'Ordinary companion remains installed.' }
$result.status = 'restored-reload-required'
$result | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding utf8NoBOM
[pscustomobject]$result
$global:LASTEXITCODE = 0
