#Requires -Version 7.0
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('azrael-publisher-test-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$publisher = Join-Path $PSScriptRoot 'publish-app-release.ps1'
$shim = Join-Path $root 'gh-shim.ps1'
$oldFixture = $env:AZRAEL_PUBLISH_TEST_FIXTURE
@'
param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
$root = $env:AZRAEL_PUBLISH_TEST_FIXTURE
$stateFile = Join-Path $root 'remote.json'
$state = Get-Content $stateFile -Raw | ConvertFrom-Json -AsHashtable
Add-Content (Join-Path $root 'calls.jsonl') (ConvertTo-Json -InputObject @($Arguments) -Compress)
if ($Arguments[0] -eq 'api') {
  $endpoint = @($Arguments | Where-Object { $_ -like 'repos/*' })[0]
  if ($endpoint -match '/git/refs$') {
    if ($Arguments -notcontains 'POST' -or $Arguments -notcontains 'ref=refs/tags/azrael-v2026.0.0' -or $Arguments -notcontains ('sha=' + ('a' * 40))) { throw 'Unexpected ref creation' }
    if ($state.scenario -eq 'tag-failure') { 'HTTP/2.0 403 Forbidden'; exit 1 }
    $state.tagged = $true
    $state | ConvertTo-Json -Depth 8 | Set-Content $stateFile -Encoding utf8NoBOM
    @{ref='refs/tags/azrael-v2026.0.0';object=@{sha=('a' * 40);type='commit'}} | ConvertTo-Json -Depth 4 -Compress; exit 0
  }
  if ($endpoint -eq 'repos/felrer/Azrael') {
    if ($state.scenario -eq 'mutate-artifact') { Add-Content (Join-Path $root 'Azrael-2026.0.0-windows-x64.zip') 'mutation' }
    if ($state.scenario -eq 'mutate-receipt') { Add-Content (Join-Path $root 'verification.json') ' ' }
    @{private=($state.scenario -ne 'public'); archived=$false; permissions=@{pull=$true;push=$true}} | ConvertTo-Json -Compress; exit 0
  }
  if ($endpoint -match '/commits/') { @{sha=('a' * 40)} | ConvertTo-Json -Compress; exit 0 }
  if ($endpoint -match '/git/ref/tags/') {
    if ($state.tagged -or $state.scenario -eq 'duplicate-tag') { '{}'; exit 0 }
    'HTTP/2.0 404 Not Found'; exit 1
  }
  if ($endpoint -match '/releases\?per_page=100$') {
    if ($Arguments -notcontains '--paginate' -or $Arguments -notcontains '--slurp') { throw 'Release lookup must include all authenticated pages' }
    if ($state.scenario -eq 'unknown-absence') { 'HTTP/2.0 403 Forbidden'; exit 1 }
    if ($state.created) { '[' + (ConvertTo-Json -InputObject @($state.release) -Depth 8 -Compress) + ']'; exit 0 }
    if ($state.scenario -in @('duplicate-release','existing-draft')) { '[[{"id":72,"tag_name":"azrael-v2026.0.0","draft":true}]]'; exit 0 }
    '[[]]'; exit 0
  }
  if ($endpoint -match '/releases/71$') {
    if ($state.scenario -eq 'read-failure') { 'HTTP/2.0 503 Unavailable'; exit 1 }
    $state.release | ConvertTo-Json -Depth 8 -Compress; exit 0
  }
}
if ($Arguments[0] -eq 'release' -and $Arguments[1] -eq 'create') {
  if ($Arguments -notcontains '--draft' -or $Arguments -notcontains '--verify-tag' -or -not $state.tagged) { throw 'Creation must verify an existing draft tag' }
  if ($state.scenario -eq 'create-failure') { 'release create failed'; exit 1 }
  $index = [Array]::IndexOf($Arguments, '--notes-file') + 2
  $assets = @(); $id = 0
  foreach ($file in $Arguments[$index..($Arguments.Length - 1)]) {
    $item = Get-Item -LiteralPath $file
    $assets += @{id=(++$id);name=$item.Name;size=$item.Length;digest=('sha256:' + (Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant())}
  }
  if ($state.scenario -eq 'digest-mismatch') { $assets[0].digest = 'sha256:' + ('0' * 64) }
  if ($state.scenario -eq 'size-mismatch') { $assets[0].size += 1 }
  if ($state.scenario -eq 'fallback') { foreach ($asset in $assets) { $asset.Remove('digest') } }
  $state.created = $true
  $state.release = @{id=71;tag_name='azrael-v2026.0.0';draft=$true;html_url='https://github.com/felrer/Azrael/releases/tag/azrael-v2026.0.0';assets=$assets}
} elseif ($Arguments[0] -eq 'release' -and $Arguments[1] -eq 'edit') {
  if ($Arguments -notcontains '--draft=false') { throw 'Unexpected release edit' }
  $state.release.draft = $false
} elseif ($Arguments[0] -eq 'release' -and $Arguments[1] -eq 'download') {
  $name = $Arguments[[Array]::IndexOf($Arguments, '--pattern') + 1]
  $directory = $Arguments[[Array]::IndexOf($Arguments, '--dir') + 1]
  Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $directory $name)
} else { throw 'Unexpected gh operation' }
$state | ConvertTo-Json -Depth 8 | Set-Content $stateFile -Encoding utf8NoBOM
exit 0
'@ | Set-Content -LiteralPath $shim -Encoding utf8NoBOM
function Assert-True($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
try {
  $cases = @('preflight','draft','publish','fallback','public','duplicate-tag','duplicate-release','existing-draft','unknown-absence','tag-failure','create-failure','read-failure','digest-mismatch','size-mismatch','mutate-artifact','mutate-receipt','bad-receipt','bad-receipt-assets','bad-sums')
  foreach ($case in $cases) {
    $fixture = Join-Path $root $case
    $null = New-Item -ItemType Directory -Path $fixture
    $env:AZRAEL_PUBLISH_TEST_FIXTURE = $fixture
    $zip = Join-Path $fixture 'Azrael-2026.0.0-windows-x64.zip'
    [IO.File]::WriteAllText($zip, 'fixture archive')
    $asset = @{name=[IO.Path]::GetFileName($zip);size=(Get-Item $zip).Length;sha256=(Get-FileHash $zip).Hash.ToLowerInvariant()}
    $manifest = Join-Path $fixture 'release-manifest.json'
    @{schemaVersion=1;product='Azrael';releaseVersion='2026.0.0';hostVersion='2026.0.0';engineSourceSha256=('b' * 64);sourceBuild=@{name='fixture'};assets=@($asset)} | ConvertTo-Json -Depth 5 | Set-Content $manifest -Encoding utf8NoBOM
    $manifestHash = (Get-FileHash $manifest).Hash.ToLowerInvariant()
    $verification = Join-Path $fixture 'verification.json'
    $verifiedAsset = $asset.Clone()
    if ($case -eq 'bad-receipt-assets') { $verifiedAsset.sha256 = '0' * 64 }
    @{schemaVersion=1;passed=$true;releaseVersion='2026.0.0';manifestSha256=$(if ($case -eq 'bad-receipt') { '0' * 64 } else { $manifestHash });assets=@($verifiedAsset)} | ConvertTo-Json -Depth 5 | Set-Content $verification -Encoding utf8NoBOM
    $sums = @("$($asset.sha256)  $($asset.name)", "$manifestHash  release-manifest.json")
    if ($case -eq 'bad-sums') { $sums = @("$($asset.sha256) $($asset.name)") }
    $sums | Set-Content (Join-Path $fixture 'SHA256SUMS.txt') -Encoding utf8NoBOM
    $notes = Join-Path $fixture 'notes.md'; 'Release fixture' | Set-Content $notes
    @{scenario=$case;created=$false;tagged=$false} | ConvertTo-Json | Set-Content (Join-Path $fixture 'remote.json')
    $receipt = Join-Path $fixture 'publish-receipt.json'
    $arguments = @('-NoProfile','-File',$publisher,'-ManifestPath',$manifest,'-VerificationPath',$verification,'-NotesFile',$notes,'-TargetCommit',('a' * 40),'-GhPath',$shim,'-ReceiptPath',$receipt)
    if ($case -eq 'preflight') { $arguments += '-PreflightOnly' }
    if ($case -in @('publish','fallback','digest-mismatch','size-mismatch','mutate-artifact','mutate-receipt')) { $arguments += '-Publish' }
    $output = @(& pwsh @arguments 2>&1); $code = $LASTEXITCODE
    $success = $case -in @('preflight','draft','publish','fallback')
    Assert-True ($code -eq $(if ($success) { 0 } else { 1 })) "$case unexpected exit $code : $output"
    $callsFile = Join-Path $fixture 'calls.jsonl'
    $calls = if (Test-Path $callsFile) { @(Get-Content $callsFile | ForEach-Object { ,(ConvertFrom-Json $_) }) } else { @() }
    $writes = @($calls | Where-Object { ($_[0] -eq 'release' -and $_[1] -in @('create','edit')) -or ($_[0] -eq 'api' -and $_ -contains 'POST') })
    $remote = Get-Content (Join-Path $fixture 'remote.json') -Raw | ConvertFrom-Json
    if ($case -eq 'preflight' -or -not $success -and $case -notin @('digest-mismatch','size-mismatch','tag-failure','create-failure','read-failure')) {
      Assert-True ($writes.Count -eq 0) "$case made forbidden network writes"
    }
    if ($case -in @('digest-mismatch','size-mismatch')) {
      Assert-True ($remote.created -and $remote.release.draft -and $writes.Count -eq 2) "$case did not leave its draft unpublished"
    }
    if ($case -in @('tag-failure','create-failure','read-failure')) {
      $failure = ($output | ForEach-Object { [string]$_ } | Where-Object { $_.StartsWith('{') } | Select-Object -Last 1) | ConvertFrom-Json
      Assert-True ($failure.refCreateAttempted -eq $true -and $failure.tagExists -eq ($case -ne 'tag-failure')) "$case ref state was reported inaccurately"
      Assert-True ($failure.createAttempted -eq ($case -ne 'tag-failure')) "$case release attempt was reported inaccurately"
      Assert-True (@($calls | Where-Object { $_[0] -eq 'release' -and $_[1] -eq 'edit' }).Count -eq 0) "$case published after failure"
      if ($case -eq 'read-failure') { Assert-True ($remote.created -and $remote.release.draft -and $failure.releaseState -like 'unknown*') "$case draft/uncertainty report differed" }
    }
    if ($success -and $case -ne 'preflight') {
      $actual = Get-Content $receipt -Raw | ConvertFrom-Json
      Assert-True ($actual.manifestSha256 -ceq $manifestHash -and $actual.assets.Count -eq 3) "$case receipt does not bind exact uploads"
      foreach ($entry in $actual.assets) {
        $file = Join-Path $fixture $entry.name
        Assert-True ($entry.size -eq (Get-Item $file).Length -and $entry.sha256 -ceq (Get-FileHash $file).Hash.ToLowerInvariant()) "$case receipt asset mismatch"
      }
      Assert-True ($actual.isDraft -eq ($case -eq 'draft')) "$case final draft state differs"
    } else { Assert-True (-not (Test-Path $receipt)) "$case wrote a success receipt" }
    Assert-True (@(Get-ChildItem $fixture -Directory -Filter '.publish-verification-*').Count -eq 0) "$case leaked download fixture"
    Assert-True (@($calls | Where-Object { $_ -contains 'PATCH' -or $_ -contains 'DELETE' }).Count -eq 0) "$case mutated repository configuration"
    Write-Output "PASS $case (publisher exit $code)"
  }
} finally {
  $env:AZRAEL_PUBLISH_TEST_FIXTURE = $oldFixture
  $resolved = [IO.Path]::GetFullPath($root)
  if ([IO.Path]::GetDirectoryName($resolved) -ne [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -notlike 'azrael-publisher-test-*') { throw 'Unsafe fixture cleanup path' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
