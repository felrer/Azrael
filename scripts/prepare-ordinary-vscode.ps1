#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReleaseDirectory,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$SourceExtensionPath = (Join-Path $PSScriptRoot '../artifacts/upstream-ui/26.928.31416'),
    [string]$StateRoot = (Join-Path $env:USERPROFILE '.azrael-ex'),
    [string]$OriginalExtensionPath,
    [string]$DevinExecutable
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
function Resolve-ReleaseEngineSourceRoot {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$BuildInfo)
    $root = if ($BuildInfo.Contains('engineSourceRoot')) { $BuildInfo['engineSourceRoot'] } else { Join-Path $projectRoot 'upstream/codex' }
    if ($root -isnot [string] -or -not [IO.Path]::IsPathFullyQualified($root)) { throw 'Release engineSourceRoot must be an absolute directory path.' }
    $root = [IO.Path]::GetFullPath($root)
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Release engine source directory does not exist: $root" }
    $root = (Resolve-Path -LiteralPath $root).Path
    if (-not (Test-Path -LiteralPath (Join-Path $root 'codex-rs/Cargo.toml') -PathType Leaf)) { throw 'Release engine source is not a Codex checkout.' }
    $root
}
function Set-AzraelEngineResolver {
    param([Parameter(Mandatory)][string]$HostText)
    $anchors = @(
        'function yI(t,e){let r=mn("cliExecutable");',
        'function bM(t,e){let r=Mn("cliExecutable");',
        'function QN(t,e){let r=Jn("cliExecutable");'
    )
    $matchingAnchors = @($anchors | Where-Object { [regex]::Matches($HostText, [regex]::Escape($_)).Count -gt 0 })
    if ($matchingAnchors.Count -ne 1 -or [regex]::Matches($HostText, [regex]::Escape($matchingAnchors[0])).Count -ne 1) { throw 'Pinned engine resolver anchor changed or is ambiguous.' }
    $needle = $matchingAnchors[0]
    $replacement = $needle.Replace('let r=', 'if(e && e!=="win32")throw new Error("azrael requires local Windows execution.");return require("./azrael-runtime.cjs").runtime.engine;let r=')
    $HostText.Replace($needle, $replacement)
}
$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $release 'build-info.json') -Raw | ConvertFrom-Json -AsHashtable
$sourceRoot = Resolve-ReleaseEngineSourceRoot -BuildInfo $manifest
& python -B (Join-Path $PSScriptRoot 'engine-provenance.py') verify --root $sourceRoot --engine-dir (Join-Path $release 'engine') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Deployment requires an engine built from the current source. Rebuild first.' }
if (Test-Path -LiteralPath $OutputDirectory) { throw 'OutputDirectory must be new.' }
if (-not [IO.Path]::IsPathFullyQualified($OutputDirectory) -or -not [IO.Path]::IsPathFullyQualified($StateRoot)) { throw 'Output and state paths must be absolute.' }
$ordinary = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.codex'))
$state = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\','/')
if ($state -ieq $ordinary -or $state.StartsWith($ordinary + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Do not use ordinary Codex state.' }
$nativeConfigText = & node (Join-Path $PSScriptRoot 'devin-native-host.cjs') $release
if ($LASTEXITCODE -ne 0) { throw 'Devin native bundle validation failed. No host was installed.' }
$nativeConfig = $nativeConfigText | ConvertFrom-Json
$providerAccountsConfigText = & node (Join-Path $PSScriptRoot 'provider-accounts-host.cjs') $release
if ($LASTEXITCODE -ne 0) { throw 'Provider accounts bundle validation failed. No host was installed.' }
$providerAccountsConfig = $providerAccountsConfigText | ConvertFrom-Json
$computerUseDirectory = Join-Path $release 'computer-use'
$computerUseText = & node (Join-Path $PSScriptRoot 'computer-use-runtime.cjs') verify --directory $computerUseDirectory
if ($LASTEXITCODE -ne 0) { throw 'Computer Use bundle validation failed. No host was installed.' }
$computerUse = $computerUseText | ConvertFrom-Json
if (-not $manifest.sha256['computer-use/manifest.json'] -or $computerUse.manifestSha256 -ine $manifest.sha256['computer-use/manifest.json']) { throw 'Release Computer Use manifest hash mismatch.' }
$windowControlText = & node (Join-Path $PSScriptRoot 'window-control-runtime.cjs') verify-release --release $release --source-root (Join-Path $projectRoot 'native/window-control')
if ($LASTEXITCODE -ne 0) { throw 'Window Control bundle validation failed. No host was installed.' }
$windowControl = $windowControlText | ConvertFrom-Json
foreach ($file in @('engine/codex.exe', 'engine/azrael-bridge.exe', 'engine/codex-code-mode-host.exe', 'azrael-ex.vsix')) {
    if ((Get-FileHash (Join-Path $release $file)).Hash -cne $manifest.sha256[$file]) { throw "Release hash mismatch: $file" }
}
$prepared = & (Join-Path $PSScriptRoot 'prepare-official-ui.ps1') -SourceExtensionPath $SourceExtensionPath -ExtensionsDir (Join-Path $OutputDirectory 'staging')
Copy-Item -LiteralPath $computerUseDirectory -Destination (Join-Path $prepared.Extension 'computer-use') -Recurse
& node (Join-Path $PSScriptRoot 'computer-use-runtime.cjs') verify --directory (Join-Path $prepared.Extension 'computer-use') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Copied Computer Use bundle validation failed.' }
if ($windowControl) {
    Copy-Item -LiteralPath $windowControl.directory -Destination (Join-Path $prepared.Extension 'window-control') -Recurse
    & node (Join-Path $PSScriptRoot 'window-control-runtime.cjs') verify --directory (Join-Path $prepared.Extension 'window-control') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Copied Window Control bundle validation failed.' }
    foreach ($module in @('window-control-host.cjs', 'window-control-backend.cjs', 'window-control-policy.cjs', 'window-control-mcp.cjs', 'window-control-runtime.cjs', 'computer-use-runtime.cjs')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $module) -Destination (Join-Path $prepared.Extension "out/$module")
    }
}
$hostFile = Join-Path $prepared.Extension 'out/extension.js'
$hostText = [IO.File]::ReadAllText($hostFile)
$hostText = Set-AzraelEngineResolver -HostText $hostText
# Scoped process proxy preserves all direct config/file lookups and child env
# assembly without mutating the environment of unrelated VS Code extensions.
$guard = 'if(require("vscode").env.remoteName || require("vscode").workspace.getConfiguration("chatgpt").get("runCodexInWindowsSubsystemForLinux")) throw new Error("This azrael release requires local Windows VS Code. Disable Codex WSL execution for this window or use the official extension in the remote host.");'
[IO.File]::WriteAllText($hostFile, $guard + "`n(function(process){`n" + $hostText + "`n}).call(this, require('./azrael-runtime.cjs').process);`n", [Text.UTF8Encoding]::new($false))
Copy-Item (Join-Path $PSScriptRoot 'ordinary-runtime.cjs') (Join-Path $prepared.Extension 'out/azrael-runtime.cjs')
Copy-Item (Join-Path $PSScriptRoot 'devin-native-host.cjs') (Join-Path $prepared.Extension 'out/devin-native-host.cjs')
Copy-Item (Join-Path $PSScriptRoot 'provider-accounts-host.cjs') (Join-Path $prepared.Extension 'out/provider-accounts-host.cjs')
if (-not $DevinExecutable) {
    $candidate = Join-Path $env:LOCALAPPDATA 'azrael-ex/tools/devin/3000.10.21/bin/devin.exe'
    if (Test-Path -LiteralPath $candidate) { $DevinExecutable = $candidate }
}
if ($DevinExecutable) { $DevinExecutable = (Resolve-Path -LiteralPath $DevinExecutable).Path }
[ordered]@{
    schema = 1
    engine = Join-Path $release 'engine/codex.exe'
    bridge = Join-Path $release 'engine/azrael-bridge.exe'
    engineVersion = [string]$manifest.engineVersion
    codexHome = $state
    devinExecutable = $DevinExecutable
    devinNative = $nativeConfig
    providerAccounts = $providerAccountsConfig
    windowControl = $windowControl
    computerUse = @{ directory = $computerUseDirectory; manifestSha256 = [string]$computerUse.manifestSha256 }
    originalExtension = if ($OriginalExtensionPath) { $OriginalExtensionPath } else { $SourceExtensionPath }
} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $prepared.Extension 'out/azrael-runtime.json') -Encoding utf8NoBOM

& node (Join-Path $PSScriptRoot 'window-control-runtime.cjs') verify-host --directory $prepared.Extension --release $release | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Prepared Window Control host integrity verification failed.' }

$result = [ordered]@{ OfficialExtension = $prepared.Extension; CompanionVsix = Join-Path $release 'azrael-ex.vsix'; ReleaseDirectory = $release; StateRoot = $state; DevinExecutable = $DevinExecutable }
$result | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'prepared.json') -Encoding utf8NoBOM
[pscustomobject]$result
$global:LASTEXITCODE = 0
