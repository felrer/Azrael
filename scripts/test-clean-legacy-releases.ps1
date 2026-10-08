#requires -Version 7.4
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$logs = Join-Path $project 'artifacts/logs/legacy-release-cleanup'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$fixture = Join-Path $logs ('fixture-' + [guid]::NewGuid().ToString('N'))
$passed = 0
function Assert([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message }; $script:passed++ }
function Write-Json([string]$Path, $Data) {
    New-Item -ItemType Directory -Path (Split-Path $Path -Parent) -Force | Out-Null
    ConvertTo-Json -InputObject $Data -Depth 12 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}
function New-Release([string]$Name) {
    $path = Join-Path $fixture "artifacts/releases/$Name"
    Write-Json (Join-Path $path 'build-info.json') @{ product = 'azrael-ex'; packageVersion = '0.4.0'; sha256 = @{ 'engine/codex.exe' = ('a' * 64) } }
    $path
}
try {
    . (Join-Path $PSScriptRoot 'clean-legacy-releases.ps1') -ProjectRoot $fixture
    $installedProbe = ${function:Get-LegacyInstalledReferences}
    # Only platform discovery is mocked, and all destructive candidates are fixtures.
    function Get-LegacyProcesses { if ($script:failProbe) { throw 'mock process inspection failed' }; $script:mockProcesses }
    function Get-LegacyShortcutReferences { $script:mockShortcuts }
    function Get-LegacyInstalledReferences([string]$Directory) { $script:mockInstalled }
    $script:mockProcesses = @(); $script:mockShortcuts = @(); $script:mockInstalled = @(); $script:failProbe = $false
    $latestRelease = New-Release 'latest'
    $current = New-Release 'current'
    $previous = New-Release 'previous'
    $old = New-Release 'old'
    $active = New-Release 'active'
    $runtime = New-Release 'runtime'
    $shortcutRelease = New-Release 'shortcut'
    $explicit = New-Release 'explicit'
    $workspaceShortcut = @(Get-LegacyShortcutPaths @{TargetPath='C:\\Windows\\System32\\cmd.exe';WorkingDirectory=$fixture;Arguments=''} $fixture)
    Assert ($fixture -notin $workspaceShortcut) 'Generic workspace shortcut directory protects all releases.'
    $genericAncestor = Split-Path $fixture -Parent
    $ancestorShortcut = @(Get-LegacyShortcutPaths @{TargetPath='C:\\Windows\\System32\\cmd.exe';WorkingDirectory=$genericAncestor;Arguments=''} $fixture)
    Assert ($genericAncestor -notin $ancestorShortcut) 'Generic ancestor shortcut directory protects all releases.'
    $releaseShortcut = @(Get-LegacyShortcutPaths @{TargetPath='C:\\Windows\\System32\\cmd.exe';WorkingDirectory=$shortcutRelease;Arguments=''} $fixture)
    Assert ($shortcutRelease -in $releaseShortcut) 'Release-specific shortcut working directory not protected.'
    $originalFixtureEnv = $env:LEGACY_CLEANUP_FIXTURE_ROOT
    $originalHomeDrive = $env:HOMEDRIVE
    $originalHomePath = $env:HOMEPATH
    try {
        $env:LEGACY_CLEANUP_FIXTURE_ROOT = $shortcutRelease
        $expandedShortcut = @(Get-LegacyShortcutPaths @{TargetPath='%LEGACY_CLEANUP_FIXTURE_ROOT%\\engine\\codex.exe';WorkingDirectory='';Arguments=''} $fixture)
        Assert ((Join-Path $shortcutRelease 'engine/codex.exe') -in $expandedShortcut) 'Shortcut environment filesystem path not expanded.'
        $env:HOMEDRIVE = $null; $env:HOMEPATH = $null
        Assert ((Expand-LegacyShortcutEnvironment '%HOMEDRIVE%%HOMEPATH%') -ieq (ConvertTo-LegacyPath ([Environment]::GetFolderPath('UserProfile')))) 'Verified UserProfile shortcut fallback failed.'
        $unresolvedFailed = $false
        try { $null = Expand-LegacyShortcutEnvironment '%LEGACY_CLEANUP_UNKNOWN_VARIABLE_7F29%' } catch { $unresolvedFailed = $_.Exception.Message -match 'Unresolved shortcut' }
        Assert $unresolvedFailed 'Unknown shortcut environment variable did not fail closed.'
    } finally {
        $env:LEGACY_CLEANUP_FIXTURE_ROOT = $originalFixtureEnv
        $env:HOMEDRIVE = $originalHomeDrive
        $env:HOMEPATH = $originalHomePath
    }
    $unknown = Join-Path $fixture 'artifacts/releases/unknown'
    New-Item -ItemType Directory -Path $unknown -Force | Out-Null
    Write-Json (Join-Path $fixture 'artifacts/latest.json') @{ releaseDirectory = $latestRelease }
    foreach ($item in @(@{name='current';path=$current;date='2026-10-08T02:00:00Z'},@{name='repeat-current';path=$current;date='2026-10-08T01:00:00Z'},@{name='previous';path=$previous;date='2026-10-07T00:00:00Z'})) {
        Write-Json (Join-Path $fixture "artifacts/deployments/$($item.name)/deployment.json") @{ hostInstalled = $true; status = 'installed-reload-required'; releaseDirectory = $item.path; generatedAt = $item.date; packageDirectory = (Join-Path $fixture "artifacts/deployments/$($item.name)/package") }
    }
    $script:mockProcesses = @(@{ExecutablePath=(Join-Path $active 'engine/codex.exe');CommandLine='';ProcessId=7})
    $script:mockInstalled = @(Join-Path $runtime 'engine/codex.exe')
    $script:mockShortcuts = @([pscustomobject]@{command='--engine "' + (Join-Path $shortcutRelease 'engine/codex.exe') + '"'})
    $ProtectedPaths = @($explicit)
    $preview = Invoke-LegacyReleaseCleanup
    Assert ($preview.status -eq 'preview') 'Preview blocked unexpectedly.'
    Assert ((Test-Path -LiteralPath $old) -and @($preview.candidates | Where-Object status -eq 'selected').Count -eq 1) 'Preview must select only unused owned release without deleting.'
    $Apply = $true
    $result = Invoke-LegacyReleaseCleanup
    Assert (-not (Test-Path -LiteralPath $old)) 'Old release still exists.'
    $deleted = @($result.candidates | Where-Object status -eq 'deleted')
    Assert ($deleted.Count -eq 1 -and $deleted[0].absent -and $deleted[0].identity.receiptSha256.Length -eq 64) 'Deletion absence/compact hash evidence missing.'
    foreach ($keep in @($latestRelease,$current,$previous,$active,$runtime,$shortcutRelease,$explicit,$unknown)) { Assert (Test-Path -LiteralPath $keep) "Protected/unknown path removed: $keep" }
    $linked = New-Release 'linked'
    $outside = Join-Path $fixture 'outside'
    New-Item -ItemType Directory -Path $outside -Force | Out-Null
    $junction = Join-Path $linked 'nested-link'
    New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
    $result = Invoke-LegacyReleaseCleanup
    Assert (@($result.candidates | Where-Object { $_.path -eq $linked -and $_.reason -match 'Nested link' }).Count -eq 1) 'Nested link did not preserve release.'
    Assert (Test-Path -LiteralPath $outside) 'Link target damaged.'
    Remove-Item -LiteralPath $junction -Force
    $commandRelease = New-Release 'command'
    $script:mockProcesses += @{ExecutablePath=$null;CommandLine='--engine "' + (Join-Path $commandRelease 'engine/codex.exe') + '"';ProcessId=8}
    $result = Invoke-LegacyReleaseCleanup
    Assert (@($result.candidates | Where-Object { $_.path -eq $commandRelease -and $_.reason -match 'Active command' }).Count -eq 1) 'Command-line reference ignored.'
    $fail = New-Release 'failclosed'
    $script:failProbe = $true
    $result = Invoke-LegacyReleaseCleanup
    Assert ($result.status -eq 'blocked' -and (Test-Path -LiteralPath $fail)) 'Process failure did not fail closed.'
    $script:failProbe = $false
    Write-Json (Join-Path $fixture 'artifacts/deployments/broken/deployment.json') @{hostInstalled=$true;status='uncertain'}
    $result = Invoke-LegacyReleaseCleanup
    Assert ($result.status -eq 'blocked' -and (Test-Path -LiteralPath $fail)) 'Uncertain deployment did not fail closed.'
    Remove-Item -LiteralPath (Join-Path $fixture 'artifacts/deployments/broken') -Recurse -Force
    $extensionRoot = Join-Path $fixture 'extensions'
    $extensionPath = Join-Path $extensionRoot 'azrael-ex-local.azrael-1.0.0'
    Write-Json (Join-Path $extensionRoot 'extensions.json') @(@{ identifier=@{id='azrael-ex-local.azrael'};location=@{fsPath=$extensionPath;path='/c:/unused'} })
    Write-Json (Join-Path $extensionPath 'out/azrael-runtime.json') @{engine=@{path=(Join-Path $runtime 'engine/codex.exe')}}
    $refs = @(& $installedProbe $extensionRoot)
    Assert ((Join-Path $runtime 'engine/codex.exe') -in $refs) 'Installed runtime absolute references missing.'
    $vsixRoot = Join-Path $fixture 'artifacts/vsix/owned'
    New-Item -ItemType Directory -Path $vsixRoot -Force | Out-Null
    $zip = [IO.Compression.ZipFile]::Open((Join-Path $vsixRoot 'azrael-ex.vsix'), [IO.Compression.ZipArchiveMode]::Create)
    try {
        $entry = $zip.CreateEntry('extension/package.json')
        $writer = [IO.StreamWriter]::new($entry.Open())
        try { $writer.Write('{"publisher":"azrael-ex-local","name":"azrael","version":"0.4.0"}') } finally { $writer.Dispose() }
    } finally { $zip.Dispose() }
    $result = Invoke-LegacyReleaseCleanup
    Assert (@($result.candidates | Where-Object { $_.path -eq $vsixRoot -and $_.status -eq 'deleted' -and $_.absent }).Count -eq 1) 'Owned VSIX not deleted with absence receipt.'
    $fresh = New-Release 'fresh-process'
    $script:probeCount = 0
    function Get-LegacyProcesses {
        $script:probeCount++
        if ($script:probeCount -gt 1) { @{ExecutablePath=(Join-Path $fresh 'engine/codex.exe');CommandLine='';ProcessId=9} }
    }
    $result = Invoke-LegacyReleaseCleanup
    Assert ((Test-Path -LiteralPath $fresh) -and @($result.candidates | Where-Object { $_.path -eq $fresh -and $_.reason -match 'Active executable' }).Count -eq 1) 'Fresh process before deletion ignored.'
    $menu = Join-Path $fixture 'start-menu'
    $programs = Join-Path $menu 'Programs'
    New-Item -ItemType Directory -Path $programs -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $programs 'fixture.lnk') -Value 'enumeration fixture'
    $menuAlias = Join-Path $menu '프로그램'
    New-Item -ItemType Junction -Path $menuAlias -Target $programs | Out-Null
    $shortcutFiles = @(Get-LegacyShortcutFiles $menu $true)
    Assert ($shortcutFiles.Count -eq 1 -and $shortcutFiles[0].DirectoryName -eq $programs) 'Safe localized shortcut alias not deduplicated.'
    Remove-Item -LiteralPath $menuAlias -Force
    $menuAlias = Join-Path $menu 'external'
    New-Item -ItemType Junction -Path $menuAlias -Target $outside | Out-Null
    function Get-LegacyShortcutReferences { Get-LegacyShortcutFiles $menu $true }
    $result = Invoke-LegacyReleaseCleanup
    Assert ($result.status -eq 'blocked' -and $result.errors[0] -match 'External shortcut alias' -and (Test-Path -LiteralPath $fresh)) 'External shortcut alias did not globally fail closed.'
    Remove-Item -LiteralPath $menuAlias -Force
    $menuAlias = $null
    [pscustomobject]@{ passed = $passed; status = 'passed'; fixture = $fixture }
} finally {
    if (Test-Path -LiteralPath $fixture) {
        $absolute = [IO.Path]::GetFullPath($fixture)
        if (-not $absolute.StartsWith([IO.Path]::GetFullPath($logs) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture teardown containment failed.' }
        # Junction is removed explicitly if an assertion failed before normal removal.
        if ($junction -and (Test-Path -LiteralPath $junction)) { Remove-Item -LiteralPath $junction -Force }
        if ($menuAlias -and (Test-Path -LiteralPath $menuAlias)) { Remove-Item -LiteralPath $menuAlias -Force }
        Remove-Item -LiteralPath $fixture -Recurse -Force
        if (Test-Path -LiteralPath $fixture) { throw 'Fixture teardown failed.' }
    }
}
