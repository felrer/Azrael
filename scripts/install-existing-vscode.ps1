#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$ReleaseDirectory,
    [string]$WorkspacePath = (Split-Path $PSScriptRoot -Parent),
    [string]$StateRoot = (Join-Path $env:USERPROFILE '.azrael-ex'),
    [string]$CodePath = 'code.cmd',
    [string]$UserDataDir,
    [string]$ExtensionsDir = (Join-Path $env:USERPROFILE '.vscode/extensions'),
    [string]$DevinExecutable,
    [switch]$NoLaunch = $true
)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
# Retained only by the legacy host regression fixture. Product installation is
# isolated; ordinary extension directories must never be patched again.
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $project 'artifacts/verification')).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
foreach ($fixturePath in @($ExtensionsDir, $UserDataDir)) {
    if (-not $fixturePath -or -not [IO.Path]::IsPathFullyQualified($fixturePath) -or -not [IO.Path]::GetFullPath($fixturePath).StartsWith($fixtureRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Ordinary VS Code deployment is retired. Use install-azrael.ps1 for a separate azrael installation. This legacy entry point accepts only artifacts/verification fixtures.'
    }
}
if (-not $ReleaseDirectory) { $ReleaseDirectory = (Get-Content (Join-Path $project 'artifacts/latest.json') -Raw | ConvertFrom-Json).releaseDirectory }
$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$target = (Resolve-Path -LiteralPath $ExtensionsDir).Path
$codeArgs = @('--extensions-dir', $target)
if ($UserDataDir) { $codeArgs += @('--user-data-dir', [IO.Path]::GetFullPath($UserDataDir)) }
$inventory = @(& $CodePath @codeArgs --list-extensions --show-versions)
if ($LASTEXITCODE -ne 0) { throw 'Could not read existing VS Code extension inventory.' }
if ($inventory -notcontains 'openai.chatgpt@26.908.40401') { throw 'Existing VS Code must contain pinned Codex 26.908.40401. No extensions changed.' }
$official = Join-Path $target 'openai.chatgpt-26.908.40401-win32-x64'
if (-not (Test-Path -LiteralPath $official)) { throw 'Pinned Windows x64 installation was not found.' }
$deploymentRoot = Join-Path $project 'artifacts/deployments'
$destination = Join-Path $deploymentRoot (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$inventory | Set-Content (Join-Path $destination 'extensions-before.txt') -Encoding utf8NoBOM

# Retain a pristine input for future updates after the installed copy is patched.
# The official preparation script independently validates the pinned hashes.
$source = $official
$original = Join-Path $deploymentRoot 'original-official-26.908.40401'
if (Test-Path (Join-Path $official 'out/azrael-runtime.cjs')) {
    if (-not (Test-Path -LiteralPath $original)) { throw 'Original backup missing; refusing to use patched extension as source.' }
    $source = $original
}
$prepared = & (Join-Path $PSScriptRoot 'prepare-ordinary-vscode.ps1') -ReleaseDirectory $release -OutputDirectory (Join-Path $destination 'package') -SourceExtensionPath $source -OriginalExtensionPath $original -StateRoot $StateRoot -DevinExecutable $DevinExecutable

function Copy-ExtensionBackup([string]$From, [string]$To) {
    & robocopy.exe $From $To /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "Backup copy failed: $From" }
    $global:LASTEXITCODE = 0
}
if (-not (Test-Path -LiteralPath $original)) { Copy-ExtensionBackup $source $original }
$changedFiles = @('package.json', 'out/extension.js', 'out/azrael-runtime.cjs', 'out/azrael-runtime.json', 'webview/assets/app-initial-1e5ee25fb4ec.js', 'webview/assets/app-initial-a190b16fc630.js', '.azrael-official-ui.json', '.azrael-profile-menu.json', '.azrael-startup-notices.json')
$previousFiles = Join-Path $destination 'previous-files'
foreach ($relative in $changedFiles) {
    $existingFile = Join-Path $official $relative
    if (Test-Path -LiteralPath $existingFile) {
        $saved = Join-Path $previousFiles $relative
        New-Item -ItemType Directory -Path (Split-Path $saved -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $existingFile -Destination $saved
    }
}
$receipt = [ordered]@{
    status = 'prepared'; releaseDirectory = $release; extensionsDir = $target; userDataDir = $UserDataDir
    previousFiles = $previousFiles; changedFiles = $changedFiles
    companionVsix = $prepared.CompanionVsix; stateRoot = $prepared.StateRoot
    engineSourceSha256 = (Get-Content (Join-Path $release 'engine/azrael-engine-build.json') -Raw | ConvertFrom-Json).source.sourceSha256
    generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
}
$receiptPath = Join-Path $destination 'deployment.json'
$receipt | ConvertTo-Json | Set-Content $receiptPath -Encoding utf8NoBOM
if ($prepared.DevinExecutable) { & (Join-Path $PSScriptRoot 'prepare-devin.ps1') -Executable $prepared.DevinExecutable -StateRoot $prepared.StateRoot | Out-Null }
& python -B (Join-Path $PSScriptRoot 'engine-provenance.py') verify --root (Join-Path $project 'upstream/codex') --engine-dir (Join-Path $release 'engine') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Source changed while preparing deployment. Rebuild before installing.' }
foreach ($relative in $changedFiles) {
    Copy-Item -LiteralPath (Join-Path $prepared.OfficialExtension $relative) -Destination (Join-Path $official $relative) -Force
}
foreach ($vsix in @($prepared.CompanionVsix)) {
    & $CodePath @codeArgs --install-extension $vsix --force
    if ($LASTEXITCODE -ne 0) { throw "VSIX install failed. Backup and receipt: $destination" }
}
$after = @(& $CodePath @codeArgs --list-extensions --show-versions)
if ($LASTEXITCODE -ne 0) { throw 'Post-install inventory failed.' }
foreach ($existing in $inventory) {
    if ($after -notcontains $existing) { throw "Existing extension changed unexpectedly: $existing" }
}
if ($after -notcontains 'azrael-ex-local.azrael-ex@0.1.0') { throw 'Companion installation is missing.' }
foreach ($relative in @('out/extension.js', 'out/azrael-runtime.cjs', 'out/azrael-runtime.json', 'webview/assets/app-initial-a190b16fc630.js')) {
    if ((Get-FileHash (Join-Path $official $relative)).Hash -cne (Get-FileHash (Join-Path $prepared.OfficialExtension $relative)).Hash) { throw "Installed file mismatch: $relative" }
}
$receipt.status = 'installed-reload-required'
# VS Code stores per-extension update pinning in its extension registry. Keep
# this local fork pinned without disabling updates for other extensions.
$registryPath = Join-Path $target 'extensions.json'
$registry = @(Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json -AsHashtable)
foreach ($entry in $registry) {
    if ($entry.identifier.id -eq 'openai.chatgpt') { $entry.metadata['pinned'] = $true }
}
$registryTemp = Join-Path $target ('.azrael-registry-' + [guid]::NewGuid().ToString('N') + '.json')
ConvertTo-Json -InputObject $registry -Depth 100 | Set-Content -LiteralPath $registryTemp -Encoding utf8NoBOM
[IO.File]::Move($registryTemp, $registryPath, $true)
# Keep the previously supplied azrael shortcut usable after replacing the
# ordinary source extension. It now opens the ordinary editor, like VS Code's
# normal shortcut; never create or modify shortcuts for test/custom profiles.
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'azrael-ex.lnk'
$defaultExtensions = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.vscode/extensions'))
if (-not $UserDataDir -and $target -ieq $defaultExtensions -and (Test-Path -LiteralPath $shortcutPath)) {
    $codeExe = [IO.Path]::GetFullPath((Join-Path (Split-Path (Get-Command $CodePath).Source -Parent) '../Code.exe'))
    if (-not (Test-Path -LiteralPath $codeExe)) { throw 'Cannot update azrael shortcut: Code.exe was not found.' }
    Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $destination 'previous-azrael-shortcut.lnk')
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $codeExe
    $shortcut.WorkingDirectory = (Resolve-Path -LiteralPath $WorkspacePath).Path
    $shortcut.Arguments = ''
    $shortcut.Save()
    $receipt.shortcutUpdated = $true
}
$receipt | ConvertTo-Json | Set-Content $receiptPath -Encoding utf8NoBOM
$receipt | ConvertTo-Json | Set-Content (Join-Path $deploymentRoot 'existing-vscode.json') -Encoding utf8NoBOM
if (-not $NoLaunch) {
    & $CodePath @codeArgs --reuse-window (Resolve-Path -LiteralPath $WorkspacePath).Path
    if ($LASTEXITCODE -ne 0) { throw 'Installed successfully, but VS Code window launch failed.' }
}
[pscustomobject]@{ Installed = $true; ReloadRequired = $true; Receipt = $receiptPath; ReleaseDirectory = $release }
$global:LASTEXITCODE = 0
