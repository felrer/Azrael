#Requires -Version 7.0
<#
.SYNOPSIS
Uploads a verified Azrael package to a new draft GitHub release, optionally publishing it.
.DESCRIPTION
Requires an existing active repository, an existing remote commit and a verification
receipt for the exact manifest. Public repositories require -AllowPublicRepository.
Never changes repository visibility or replaces an existing tag or release.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][string]$VerificationPath,
    [Parameter(Mandatory)][string]$NotesFile,
    [string]$Repository = 'felrer/Azrael',
    [Parameter(Mandatory)][string]$TargetCommit,
    [switch]$Publish,
    [switch]$PreflightOnly,
    [switch]$AllowPublicRepository,
    [string]$ReceiptPath,
    [string]$GhPath = 'gh'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$attemptedCreate = $false
$attemptedRef = $false
$createdReleaseId = $null
$tag = $null
$downloadDirectory = $null

function Invoke-Gh {
    param([string[]]$Arguments, [switch]$AllowFailure)
    # Structured arguments support both the installed executable and test shims.
    $global:LASTEXITCODE = 0
    $output = @(& $GhPath @Arguments 2>&1)
    $code = $LASTEXITCODE
    $result = @{ exitCode = $code; text = ($output | ForEach-Object { [string]$_ }) -join "`n" }
    if ($code -ne 0 -and -not $AllowFailure) {
        # gh stderr can include authentication details; never echo it.
        throw "GitHub CLI operation '$($Arguments[0])' failed (exit $code)."
    }
    return $result
}

function Read-GhJson {
    param([string[]]$Arguments)
    $result = Invoke-Gh -Arguments $Arguments
    try { return ($result.text | ConvertFrom-Json -AsHashtable) }
    catch { throw 'GitHub CLI returned invalid JSON.' }
}

function Assert-RemoteAbsent {
    param([string]$Endpoint, [string]$Description)
    $result = Invoke-Gh -Arguments @('api', '--include', $Endpoint) -AllowFailure
    if ($result.exitCode -eq 0) { throw "$Description already exists; refusing to overwrite it." }
    # Only a confirmed HTTP 404 establishes absence. Other failures fail closed.
    if ($result.text -notmatch '(?m)^HTTP/\S+\s+404(?:\s|$)') {
        throw "Could not establish absence of $Description (exit $($result.exitCode))."
    }
}

function Get-ReleaseForTag {
    # The tag endpoint serves published releases. Authenticated listing also finds drafts.
    $result = Invoke-Gh @('api', '--paginate', '--slurp', "repos/$Repository/releases?per_page=100")
    try { $pages = ConvertFrom-Json -InputObject $result.text -AsHashtable -NoEnumerate }
    catch { throw 'GitHub release listing returned invalid JSON.' }
    $matching = @()
    foreach ($page in $pages) {
        foreach ($candidate in $page) {
            if ($candidate.tag_name -ceq $tag) { $matching += $candidate }
        }
    }
    if ($matching.Count -gt 1) { throw 'Multiple releases reference the requested tag.' }
    if ($matching.Count -eq 1) { return $matching[0] }
    return $null
}

function Resolve-RegularFile {
    param([string]$Path)
    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).ProviderPath
    $item = Get-Item -LiteralPath $resolved -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Expected a regular file: $Path"
    }
    return $resolved
}

function Get-Artifact {
    param([string]$Name, [string]$Path)
    $resolved = Resolve-RegularFile $Path
    return @{ name = $Name; size = (Get-Item -LiteralPath $resolved).Length;
        sha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant(); path = $resolved }
}

function Assert-ArtifactEqual {
    param($Expected, $Actual)
    if ($Expected.name -cne $Actual.name -or ($Expected.size -isnot [long] -and $Expected.size -isnot [int]) -or
        $Expected.size -ne $Actual.size -or [string]$Expected.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
        $Expected.sha256 -cne $Actual.sha256) { throw "Asset verification failed: $($Actual.name)" }
}

function Assert-LocalUnchanged {
    $ancestor = Get-Item -LiteralPath $packageDirectory -Force
    while ($null -ne $ancestor) {
        if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package directory now traverses a filesystem link.' }
        $ancestor = $ancestor.Parent
    }
    foreach ($asset in $uploadAssets) {
        Assert-ArtifactEqual $asset (Get-Artifact $asset.name $asset.path)
    }
    if ((Get-FileHash -LiteralPath $verificationFile -Algorithm SHA256).Hash -cne $verificationHash -or
        (Get-FileHash -LiteralPath $notesPath -Algorithm SHA256).Hash -cne $notesHash) {
        throw 'Verification receipt or release notes changed during publication.'
    }
}

try {
    if ($Repository -cnotmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid repository name.' }
    if ($TargetCommit -cnotmatch '^[0-9a-f]{40}$') { throw 'TargetCommit must be a full lowercase remote commit SHA.' }
    $null = Get-Command $GhPath -ErrorAction Stop
    $manifestFile = Resolve-RegularFile $ManifestPath
    if ([IO.Path]::GetFileName($manifestFile) -cne 'release-manifest.json') { throw 'Manifest must be named release-manifest.json.' }
    $packageDirectory = Split-Path -Parent $manifestFile
    # Reject linked package directories, including linked ancestors.
    $ancestor = Get-Item -LiteralPath $packageDirectory -Force
    while ($null -ne $ancestor) {
        if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package directory must not traverse a filesystem link.' }
        $ancestor = $ancestor.Parent
    }
    $verificationFile = Resolve-RegularFile $VerificationPath
    $notesPath = Resolve-RegularFile $NotesFile
    $verificationHash = (Get-FileHash -LiteralPath $verificationFile -Algorithm SHA256).Hash
    $notesHash = (Get-FileHash -LiteralPath $notesPath -Algorithm SHA256).Hash
    $manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json -AsHashtable
    $verification = Get-Content -LiteralPath $verificationFile -Raw | ConvertFrom-Json -AsHashtable
    $version = [string]$manifest.releaseVersion
    if ($manifest.schemaVersion -ne 1 -or $manifest.product -cne 'Azrael' -or
        $version -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' -or
        $manifest.hostVersion -cne $version -or
        [string]$manifest.engineSourceSha256 -cnotmatch '^[0-9a-f]{64}$' -or
        -not $manifest.sourceBuild) { throw 'Invalid Azrael release manifest or version.' }
    $tag = "azrael-v$version"
    $manifestArtifact = Get-Artifact 'release-manifest.json' $manifestFile
    if ($verification.schemaVersion -ne 1 -or $verification.passed -isnot [bool] -or -not $verification.passed -or
        $verification.releaseVersion -cne $version -or $verification.manifestSha256 -cne $manifestArtifact.sha256) {
        throw 'Verification receipt does not certify this exact release manifest.'
    }
    $packageAssets = @($manifest.assets)
    $verifiedAssets = @($verification.assets)
    if ($packageAssets.Count -eq 0 -or $packageAssets.Count -ne $verifiedAssets.Count) { throw 'Verification asset set differs from the manifest.' }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $uploadAssets = @()
    foreach ($asset in $packageAssets) {
        $name = [string]$asset.name
        if ($name -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$' -or $name -in @('release-manifest.json','SHA256SUMS.txt') -or
            -not $seen.Add($name)) { throw 'Invalid or duplicate manifest asset name.' }
        $assetPath = [IO.Path]::GetFullPath((Join-Path $packageDirectory $name))
        if ([IO.Path]::GetDirectoryName($assetPath) -cne $packageDirectory) { throw 'Asset is outside the package directory.' }
        $actual = Get-Artifact $name $assetPath
        Assert-ArtifactEqual $asset $actual
        $matches = @($verifiedAssets | Where-Object { $_.name -ceq $name })
        if ($matches.Count -ne 1) { throw "Missing or duplicate verified asset: $name" }
        Assert-ArtifactEqual $matches[0] $actual
        $uploadAssets += $actual
    }
    if (-not $seen.Contains("Azrael-$version-windows-x64.zip")) { throw 'Required Windows x64 release archive is missing.' }
    $sumsArtifact = Get-Artifact 'SHA256SUMS.txt' (Join-Path $packageDirectory 'SHA256SUMS.txt')
    $sumLines = @(Get-Content -LiteralPath $sumsArtifact.path | Where-Object { $_.Trim().Length -gt 0 })
    $sumNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $sumExpected = @($uploadAssets) + @($manifestArtifact)
    foreach ($line in $sumLines) {
        if ($line -cnotmatch '^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$') { throw 'Invalid SHA256SUMS.txt entry.' }
        $sumHash = $Matches[1]; $sumName = $Matches[2]
        $match = @($sumExpected | Where-Object { $_.name -ceq $sumName })
        if ($match.Count -ne 1 -or -not $sumNames.Add($sumName) -or $match[0].sha256 -cne $sumHash) { throw 'SHA256SUMS.txt differs from package files.' }
    }
    if ($sumNames.Count -ne $sumExpected.Count) { throw 'SHA256SUMS.txt must cover package assets and the release manifest.' }
    $uploadAssets += @($manifestArtifact, $sumsArtifact)
    if (-not $ReceiptPath) { $ReceiptPath = Join-Path $packageDirectory 'publish-receipt.json' }
    $ReceiptPath = [IO.Path]::GetFullPath($ReceiptPath)
    if (Test-Path -LiteralPath $ReceiptPath) { throw 'Publish receipt path already exists; use a new path.' }
    if ($ReceiptPath -in @($verificationFile,$notesPath) -or $ReceiptPath -in @($uploadAssets.path)) { throw 'Receipt must not replace publication inputs.' }

    $repositoryInfo = Read-GhJson @('api', "repos/$Repository")
    if ($repositoryInfo.private -isnot [bool]) { throw 'Repository visibility must be a Boolean.' }
    if (-not $repositoryInfo.private -and -not $AllowPublicRepository) {
        throw 'Public repository requires explicit -AllowPublicRepository.'
    }
    if (-not $repositoryInfo.permissions.pull -or -not $repositoryInfo.permissions.push -or $repositoryInfo.archived) {
        throw 'Repository must be active and accessible with read/write permissions.'
    }
    $repositoryVisibility = if ($repositoryInfo.private) { 'private' } else { 'public' }
    $remoteCommit = Read-GhJson @('api', "repos/$Repository/commits/$TargetCommit")
    if ($remoteCommit.sha -cne $TargetCommit) { throw 'Target remote commit was not confirmed.' }
    Assert-RemoteAbsent "repos/$Repository/git/ref/tags/$tag" "Tag $tag"
    if ($null -ne (Get-ReleaseForTag)) { throw "Release $tag already exists; refusing to overwrite it." }
    Assert-LocalUnchanged
    if ($PreflightOnly) {
        @{ tag = $tag; repository = $Repository; repositoryVisibility = $repositoryVisibility; targetCommit = $TargetCommit; manifestSha256 = $manifestArtifact.sha256; preflightPassed = $true } | ConvertTo-Json -Depth 8
        exit 0
    }

    # Create the ref explicitly: GitHub may otherwise defer draft tag creation until publication.
    $attemptedRef = $true
    $newRef = Read-GhJson @('api', '--method', 'POST', "repos/$Repository/git/refs", '-f', "ref=refs/tags/$tag", '-f', "sha=$TargetCommit")
    if ($newRef.ref -cne "refs/tags/$tag" -or $newRef.object.sha -cne $TargetCommit -or $newRef.object.type -cne 'commit') {
        throw 'Created tag ref does not point to the requested commit.'
    }
    $tagCommit = Read-GhJson @('api', "repos/$Repository/commits/$tag")
    if ($tagCommit.sha -cne $TargetCommit) { throw 'Created release tag does not point to the requested remote commit.' }
    Assert-LocalUnchanged
    $createArguments = @('release','create',$tag,'--repo',$Repository,'--draft','--verify-tag','--target',$TargetCommit,'--title',"Azrael $version",'--notes-file',$notesPath)
    $createArguments += @($uploadAssets.path)
    $attemptedCreate = $true
    $null = Invoke-Gh $createArguments
    Assert-LocalUnchanged
    $release = Get-ReleaseForTag
    if ($null -eq $release) { throw 'Created draft release was not found in authenticated release listing.' }
    if ($release.tag_name -cne $tag -or $release.draft -ne $true) { throw 'Created release is not the expected draft.' }
    if (($release.id -isnot [long] -and $release.id -isnot [int]) -or $release.id -le 0) { throw 'Created release has no valid numeric ID.' }
    $createdReleaseId = $release.id
    $release = Read-GhJson @('api', "repos/$Repository/releases/$createdReleaseId")
    if ($release.tag_name -cne $tag -or $release.draft -ne $true) { throw 'Created release ID is not the expected draft.' }
    $remoteAssets = @($release.assets)
    if ($remoteAssets.Count -ne $uploadAssets.Count) { throw 'Uploaded asset set differs from the verified package.' }
    foreach ($local in $uploadAssets) {
        $matching = @($remoteAssets | Where-Object { $_.name -ceq $local.name })
        if ($matching.Count -ne 1 -or $matching[0].size -ne $local.size) { throw "Remote asset name/size mismatch: $($local.name)" }
        $remote = $matching[0]
        if ($remote.ContainsKey('digest') -and $remote.digest) {
            if ($remote.digest -cne "sha256:$($local.sha256)") { throw "Remote asset digest mismatch: $($local.name)" }
        } else {
            if (-not $downloadDirectory) {
                $downloadDirectory = Join-Path $packageDirectory ('.publish-verification-' + [guid]::NewGuid().ToString('N'))
                $null = New-Item -ItemType Directory -Path $downloadDirectory
            }
            $null = Invoke-Gh @('release','download',$tag,'--repo',$Repository,'--pattern',$local.name,'--dir',$downloadDirectory)
            Assert-ArtifactEqual $local (Get-Artifact $local.name (Join-Path $downloadDirectory $local.name))
        }
    }
    Assert-LocalUnchanged
    if ($Publish) { $null = Invoke-Gh @('release','edit',$tag,'--repo',$Repository,'--draft=false') }
    $confirmed = Read-GhJson @('api', "repos/$Repository/releases/$createdReleaseId")
    if ($confirmed.tag_name -cne $tag -or $confirmed.draft -ne (-not $Publish.IsPresent) -or -not $confirmed.html_url) {
        throw 'Final release state was not confirmed.'
    }
    $finalAssets = @($confirmed.assets)
    if ($finalAssets.Count -ne $remoteAssets.Count) { throw 'Release asset set changed after verification.' }
    foreach ($remote in $remoteAssets) {
        $matching = @($finalAssets | Where-Object { $_.name -ceq $remote.name })
        if ($matching.Count -ne 1 -or $matching[0].id -ne $remote.id -or $matching[0].size -ne $remote.size) {
            throw 'Release assets changed after verification.'
        }
        if ($remote.ContainsKey('digest') -and $remote.digest -and $matching[0].digest -cne $remote.digest) {
            throw 'Release asset digest changed after verification.'
        }
    }
    $receipt = [ordered]@{ tag = $tag; url = $confirmed.html_url; isDraft = [bool]$confirmed.draft;
        assets = @($uploadAssets | ForEach-Object { @{name=$_.name;size=$_.size;sha256=$_.sha256} });
        manifestSha256 = $manifestArtifact.sha256; targetCommit = $TargetCommit; repositoryVisibility = $repositoryVisibility }
    $receiptJson = $receipt | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($ReceiptPath, $receiptJson + "`n", [Text.UTF8Encoding]::new($false))
    Write-Output $receiptJson
} catch {
    $failure = [ordered]@{ error = $_.Exception.Message; tag = $tag; repository = $Repository; createAttempted = $attemptedCreate; refCreateAttempted = $attemptedRef }
    if ($attemptedRef -or $attemptedCreate) {
        try {
            $state = if ($createdReleaseId) { Read-GhJson @('api', "repos/$Repository/releases/$createdReleaseId") } else { Get-ReleaseForTag }
            if ($null -ne $state) { $failure.url = $state.html_url; $failure.isDraft = $state.draft; $failure.releaseId = $state.id }
            else { $failure.releaseState = 'absent from authenticated release listing' }
        } catch { $failure.releaseState = 'unknown; inspect repository before retrying' }
        try {
            $tagState = Invoke-Gh @('api', '--include', "repos/$Repository/git/ref/tags/$tag") -AllowFailure
            $failure.tagExists = if ($tagState.exitCode -eq 0) { $true } elseif ($tagState.text -match '(?m)^HTTP/\S+\s+404(?:\s|$)') { $false } else { 'unknown' }
        } catch { $failure.tagExists = 'unknown' }
    }
    [Console]::Error.WriteLine(($failure | ConvertTo-Json -Depth 5 -Compress))
    exit 1
} finally {
    if ($downloadDirectory -and (Test-Path -LiteralPath $downloadDirectory)) {
        # Delete only our direct download files; never recursively traverse links.
        Get-ChildItem -LiteralPath $downloadDirectory -File -Force | Remove-Item -Force
        Remove-Item -LiteralPath $downloadDirectory -Force
    }
}
