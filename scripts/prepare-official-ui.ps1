[CmdletBinding()]
param(
    [string]$SourceExtensionPath = (Join-Path $PSScriptRoot '../artifacts/upstream-ui/26.928.31416'),
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ExtensionsDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$expectedVersion = '26.928.31416'
$expectedPackageHash = 'A79470219220CB315977455D5BD22BACB7FE6A4CEC80FEB46CE557E67CB6C6A6'
$expectedScriptRelativePath = 'webview/assets/app-initial-9cbfb5c07b41.js'
$expectedScriptHash = '85A8F628342C9352CB15643E6EA077750CEE1544D4A34084EA56CA51642D03A0'
$destinationName = "openai.chatgpt-$expectedVersion-win32-x64"
$markerName = '.azrael-official-ui.json'
$menuScriptRelativePath = 'webview/assets/profile-dropdown-items-12755417f9b8.js'
$menuSourceHash = 'AD0465211D069A2A71CB3A9D3EDDA4861D39D347E0FDA3906F7B3FC2B305D62A'

function Set-StartupNoticesDismissed {
    param([Parameter(Mandatory = $true)][string]$Destination)

    $asset = Join-Path $Destination 'out/extension.js'
    $noticeMarkerPath = Join-Path $Destination '.azrael-startup-notices.json'
    $sourceHash = '550B03E76AC5A83CB25788AA3240BA445D0E7C7D4E76AF8331442687529617EF'
    if (Test-Path -LiteralPath $noticeMarkerPath) {
        $noticeMarker = Get-Content -LiteralPath $noticeMarkerPath -Raw | ConvertFrom-Json -AsHashtable
        if ($noticeMarker['schema'] -ne 1 -or $noticeMarker['sourceSha256'] -cne $sourceHash) {
            throw 'Unknown startup notice patch marker.'
        }
        Assert-Hash -Path $asset -Expected $noticeMarker['patchedSha256'] -Description 'Startup notice host'
        return
    }
    Assert-Hash -Path $asset -Expected $sourceHash -Description 'Original startup notice host'
    # Use the official completion/dismissal contracts, including in fresh editor
    # instances. Do not accept terms, alter authentication, or suppress errors.
    $replacements = @(
        @('"get-global-state":async({key:e})=>{', '"get-global-state":async({key:e})=>{if([xe.NUX_2025_09_15,xe.NUX_2025_09_15_FULL_CHATGPT_AUTH_VIEWED,xe.NUX_2025_09_15_APIKEY_AUTH_VIEWED].includes(e))return{value:!0};'),
        @('async readPersistedAtomState(){let e=await this.globalState.get(xe.PERSISTED_ATOM_STATE);return!e||typeof e!="object"?{}:e}', 'async readPersistedAtomState(){let e=await this.globalState.get(xe.PERSISTED_ATOM_STATE);return{...(!e||typeof e!="object"?{}:e),"imagegen-2-5-announcement-dismissed-v1":!0}}')
    )
    $text = [IO.File]::ReadAllText($asset)
    foreach ($replacement in $replacements) {
        if ([regex]::Matches($text, [regex]::Escape($replacement[0])).Count -ne 1) {
            throw 'Pinned startup notice anchor must occur exactly once.'
        }
        $text = $text.Replace($replacement[0], $replacement[1])
    }
    [IO.File]::WriteAllText($asset, $text, [Text.UTF8Encoding]::new($false))
    [ordered]@{
        schema = 1
        sourceSha256 = $sourceHash
        patchedSha256 = Get-Sha256 -Path $asset
    } | ConvertTo-Json | Set-Content -LiteralPath $noticeMarkerPath -Encoding utf8NoBOM
}

function Set-AccountMenuEntry {
    param([Parameter(Mandatory = $true)][string]$Destination)

    $asset = Join-Path $Destination $menuScriptRelativePath
    $menuMarkerPath = Join-Path $Destination '.azrael-profile-menu.json'
    $original = 'children:[Y,$,null,Gn,Kn,qn,Xn,null,null,null,null,Zn]'
    $replacement = 'children:[Y,$,null,(0,Q.jsx)(L,{leftIconAsset:u,onClick:()=>{l(),lt.dispatchMessage(`open-vscode-command`,{command:`azrael-ex.usage`})},children:`계정 및 사용량`}),(0,Q.jsx)(L,{leftIconAsset:u,onClick:()=>{l(),lt.dispatchMessage(`open-vscode-command`,{command:`azrael-ex.rootResume`})},children:`루트 재개 예약`}),Gn,Kn,qn,Xn,null,null,null,null,Zn]'
    if (Test-Path -LiteralPath $menuMarkerPath) {
        $menuMarker = Get-Content -LiteralPath $menuMarkerPath -Raw | ConvertFrom-Json -AsHashtable
        if ($menuMarker['schema'] -ne 4 -or $menuMarker['sourceSha256'] -cne $menuSourceHash) {
            throw 'Unknown profile menu patch marker.'
        }
        Assert-Hash -Path $asset -Expected $menuMarker['patchedSha256'] -Description 'Account menu webview'
        return
    } else {
        Assert-Hash -Path $asset -Expected $menuSourceHash -Description 'Original profile menu webview'
        $needle = $original
    }
    $text = [IO.File]::ReadAllText($asset)
    if ([regex]::Matches($text, [regex]::Escape($needle)).Count -ne 1) {
        throw 'Pinned profile menu anchor must occur exactly once.'
    }
    [IO.File]::WriteAllText($asset, $text.Replace($needle, $replacement), [Text.UTF8Encoding]::new($false))
    [ordered]@{
        schema = 4
        sourceSha256 = $menuSourceHash
        patchedSha256 = Get-Sha256 -Path $asset
        command = 'azrael-ex.usage'
        rootResumeCommand = 'azrael-ex.rootResume'
    } | ConvertTo-Json | Set-Content -LiteralPath $menuMarkerPath -Encoding utf8NoBOM
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Assert-Hash {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Description
    )
    $actual = Get-Sha256 -Path $Path
    if ($actual -cne $Expected) {
        throw "$Description hash mismatch at '$Path'. Expected $Expected, found $actual."
    }
}

function Assert-BrandingMarker {
    param([Parameter(Mandatory = $true)][string]$Destination)

    $markerPath = Join-Path $Destination $markerName
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        throw "Refusing to overwrite an unknown official-extension destination: $Destination"
    }

    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json -AsHashtable
    if ($marker['schema'] -ne 1 -or
        $marker['sourceVersion'] -cne $expectedVersion -or
        $marker['sourcePackageSha256'] -cne $expectedPackageHash -or
        $marker['sourceWebviewSha256'] -cne $expectedScriptHash) {
        throw "Existing branding marker does not match the pinned official source: $markerPath"
    }

    Assert-Hash -Path (Join-Path $Destination 'package.json') -Expected $marker['brandedPackageSha256'] -Description 'Branded package.json'
    Assert-Hash -Path (Join-Path $Destination $expectedScriptRelativePath) -Expected $marker['brandedWebviewSha256'] -Description 'Branded webview asset'
}

if (-not [IO.Path]::IsPathFullyQualified($SourceExtensionPath)) {
    throw 'SourceExtensionPath must be an absolute path.'
}
if (-not [IO.Path]::IsPathFullyQualified($ExtensionsDir)) {
    throw 'ExtensionsDir must be an absolute path.'
}

$source = (Resolve-Path -LiteralPath $SourceExtensionPath).Path
# Ordinary deployment retains the pristine, hash-checked package for future
# isolated preparations. Never treat the installed patched bundle as pristine.
$runtimeConfig = Join-Path $source 'out/azrael-runtime.json'
if (Test-Path -LiteralPath $runtimeConfig) {
    $originalSource = (Get-Content -LiteralPath $runtimeConfig -Raw | ConvertFrom-Json).originalExtension
    if (-not $originalSource -or -not [IO.Path]::IsPathFullyQualified($originalSource)) { throw 'Original official source reference is missing.' }
    $source = (Resolve-Path -LiteralPath $originalSource).Path
}
$packagePath = Join-Path $source 'package.json'
$scriptPath = Join-Path $source $expectedScriptRelativePath
Assert-Hash -Path $packagePath -Expected $expectedPackageHash -Description 'Official package.json'
Assert-Hash -Path $scriptPath -Expected $expectedScriptHash -Description 'Official webview asset'
Assert-Hash -Path (Join-Path $source $menuScriptRelativePath) -Expected $menuSourceHash -Description 'Official profile menu asset'

$sourceManifest = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json -AsHashtable
if ($sourceManifest['publisher'] -cne 'openai' -or $sourceManifest['name'] -cne 'chatgpt' -or $sourceManifest['version'] -cne $expectedVersion) {
    throw "Official extension identity/version mismatch at '$packagePath'."
}

$extensionsPath = [IO.Path]::GetFullPath($ExtensionsDir)
$destination = Join-Path $extensionsPath $destinationName
if (Test-Path -LiteralPath $destination) {
    Assert-BrandingMarker -Destination $destination
    Set-AccountMenuEntry -Destination $destination
    Set-StartupNoticesDismissed -Destination $destination
    [pscustomobject]@{
        Source = $source
        Extension = $destination
        ExtensionsDir = $extensionsPath
        Version = $expectedVersion
        Reused = $true
    }
    return
}

New-Item -ItemType Directory -Path $extensionsPath -Force | Out-Null
$stage = Join-Path $extensionsPath ".$destinationName.staging-$([guid]::NewGuid().ToString('N'))"
$reusedAfterRace = $false
try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    & robocopy.exe $source $stage /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD (Join-Path $source 'bin/linux-x86_64') | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "Official extension staging copy failed with robocopy exit code $LASTEXITCODE."
    }
    # Robocopy uses 0..7 for successful copies. Do not leak its success code as
    # a failing PowerShell process exit status to preparation/build callers.
    $global:LASTEXITCODE = 0

    $stagedPackagePath = Join-Path $stage 'package.json'
    $stagedScriptPath = Join-Path $stage $expectedScriptRelativePath
    $manifest = Get-Content -LiteralPath $stagedPackagePath -Raw | ConvertFrom-Json -AsHashtable
    $labelSlots = @(
        $manifest['contributes']['viewsContainers']['activitybar'][0],
        $manifest['contributes']['viewsContainers']['secondarySidebar'][0],
        $manifest['contributes']['views']['codexViewContainer'][0],
        $manifest['contributes']['views']['codexSecondaryViewContainer'][0]
    )
    foreach ($slot in $labelSlots) {
        $key = if ($slot.ContainsKey('title')) { 'title' } else { 'name' }
        if ($slot[$key] -cne 'Codex') {
            throw "Pinned manifest branding slot '$key' no longer contains Codex."
        }
        $slot[$key] = 'azrael'
    }
    $manifest | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $stagedPackagePath -Encoding utf8NoBOM

    $scriptText = [IO.File]::ReadAllText($stagedScriptPath)
    $needle = 'qOt=`Codex`'
    $matches = ([regex]::Matches($scriptText, [regex]::Escape($needle))).Count
    if ($matches -ne 1) {
        throw "Pinned webview branding token count mismatch: expected 1, found $matches."
    }
    [IO.File]::WriteAllText($stagedScriptPath, $scriptText.Replace($needle, 'qOt=`azrael`'), [Text.UTF8Encoding]::new($false))
    Set-AccountMenuEntry -Destination $stage
    Set-StartupNoticesDismissed -Destination $stage

    $marker = [ordered]@{
        schema = 1
        sourceVersion = $expectedVersion
        sourcePackageSha256 = $expectedPackageHash
        sourceWebviewSha256 = $expectedScriptHash
        brandedPackageSha256 = Get-Sha256 -Path $stagedPackagePath
        brandedWebviewSha256 = Get-Sha256 -Path $stagedScriptPath
    }
    $marker | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage $markerName) -Encoding utf8NoBOM

    # Recheck the source after the copy and edits so a changing or accidentally
    # targeted installation cannot be accepted as a pinned input.
    Assert-Hash -Path $packagePath -Expected $expectedPackageHash -Description 'Official package.json'
    Assert-Hash -Path $scriptPath -Expected $expectedScriptHash -Description 'Official webview asset'
    if (Test-Path -LiteralPath $destination) {
        Assert-BrandingMarker -Destination $destination
        Set-AccountMenuEntry -Destination $destination
        Set-StartupNoticesDismissed -Destination $destination
        $reusedAfterRace = $true
    }
    else {
        Move-Item -LiteralPath $stage -Destination $destination
    }
}
finally {
    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Recurse
    }
}

[pscustomobject]@{
    Source = $source
    Extension = $destination
    ExtensionsDir = $extensionsPath
    Version = $expectedVersion
    Reused = $reusedAfterRace
}
