#requires -Version 7.4
[CmdletBinding()]
param(
    [string]$RunDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/tasks/cache-management/runs/cm-20261016'),
    [switch]$CoordinatedOnly
)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$logs = Join-Path $RunDirectory 'temporary/legacy-release-cleanup'
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
    Write-Json (Join-Path $path 'build-info.json') @{ product = 'azrael-ex'; packageVersion = '0.4.0'; sha256 = @{ 'engine/azrael.exe' = ('a' * 64) } }
    $associatedLog = Join-Path $fixture "artifacts/logs/$Name"
    Write-Json (Join-Path $associatedLog 'build-result.json') @{status='complete'}
    $null = Register-ArtifactLifecycle -ProjectRoot $fixture -Id "version:$Name" -Kind version -Owner 'fixture' -State complete -MembershipComplete $true -Members @{release=$path;logs=$associatedLog}
    $path
}
function Invoke-CoordinatedFixtureTests {
    $fixture = Join-Path $fixture 'coordinated'
    $ProjectRoot = $fixture
    $ProtectedPaths = @(); $ReportPath = $null; $Apply = $false; $IncludeModuleCaches = $true
    function Get-LegacyProcesses { @() }
    function Get-CimInstance { if ($runningPath) { @{Name='fixture.exe';CommandLine="--module $runningPath";ProcessId=123} } }
    function Get-LegacyShortcutReferences { @() }
    function Get-LegacyInstalledReferences { @() }
    $result = Invoke-LegacyReleaseCleanup
    Assert ($result.moduleCaches.status -eq 'no-cache' -and -not (Test-Path (Join-Path $fixture 'artifacts/cache/modules'))) 'Absent module root recreated for cleanup.'
    . (Join-Path $PSScriptRoot 'build-module-cache.ps1')
    $cache = Open-BuildModuleCache $fixture
    $cache.Lease.Dispose()
    $entries = @{}
    $keys = @('a','b','c','d','e','f','1','2')
    $names = @('old','current','previous','runtime','consumer','locked','preview','running')
    for ($index = 0; $index -lt $names.Count; $index++) {
        $name = $names[$index]; $key = $keys[$index] * 64
        $path = Join-Path $cache.Root "companion/$key"
        $log = Join-Path $path 'logs'
        Write-Json (Join-Path $path 'owner.json') @{schema=1;module='companion';key=$key}
        Write-Json (Join-Path $path 'cache.json') @{schema=1;module='companion';key=$key}
        Write-Json (Join-Path $log 'build.json') @{status='complete'}
        $id = "run:module-cache:companion:$key"
        $null = Register-ArtifactLifecycle -ProjectRoot $fixture -Id $id -Kind run -Owner module-build-cache -State complete -MembershipComplete $true -Members @{'cache-entry'=$path}
        $entries[$name] = @{path=$path;log=$log;id=$id}
    }
    $runningPath = $entries.running.path
    function Add-FixtureReference([string]$Id, [string]$Target) {
        $recordPath = Join-Path $fixture ('artifacts/maintenance/lifecycles/' + [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Id))).ToLowerInvariant() + '.json')
        $record = Get-Content $recordPath -Raw | ConvertFrom-Json -AsHashtable
        $record.references = @(@{id=$Target;reason='fixture consumer'})
        Write-Json $recordPath $record
    }
    $old = New-Release old
    Add-FixtureReference 'version:old' $entries.old.id
    foreach ($name in @('current','previous')) {
        $release = New-Release $name
        $package = Join-Path $fixture "artifacts/deployments/$name/package"
        Write-Json (Join-Path $package 'preparation-inputs.json') @{toolDirectory=$entries[$name].path}
        Write-Json (Join-Path $fixture "artifacts/deployments/$name/deployment.json") @{hostInstalled=$true;status='installed-reload-required';releaseDirectory=$release;packageDirectory=$package;generatedAt=$(if($name -eq 'current'){'2026-10-16T02:00:00Z'}else{'2026-10-15T02:00:00Z'})}
    }
    $runtimePath = $entries.runtime.path
    function Get-LegacyInstalledReferences { $runtimePath }
    $null = Register-ArtifactLifecycle -ProjectRoot $fixture -Id 'work:consumer' -Kind work -Owner fixture -State complete -MembershipComplete $true -Members @{evidence=(Join-Path $fixture 'artifacts/consumer-evidence')}
    Add-FixtureReference 'work:consumer' $entries.consumer.id
    $ProtectedPaths = @($entries.locked.path)
    $preview = Invoke-LegacyReleaseCleanup
    Assert ($preview.status -eq 'preview' -and (Test-Path $old) -and (Test-Path $entries.old.path) -and (Test-Path $entries.old.log)) 'Coordinated preview deleted version/cache/log members.'
    Assert (@($preview.moduleCaches.candidates | Where-Object { $_.absent -eq $true }).Count -eq 0) 'Preview fabricated cache absence.'
    Assert (@($preview.moduleCaches.candidates | Where-Object { $_.path -eq $entries.preview.path -and $_.status -eq 'selected' }).Count -eq 1 -and (Test-Path $entries.preview.log)) ("Eligible module cache/log preview was not selected without deletion: " + ($preview.moduleCaches | ConvertTo-Json -Depth 8 -Compress))
    $IncludeModuleCaches = $false; $Apply = $true
    $result = Invoke-LegacyReleaseCleanup
    Assert (-not (Test-Path $old) -and (Test-Path $entries.old.path) -and (Test-Path $entries.old.log)) 'Default cleanup changed module caches.'
    $old = New-Release old
    Add-FixtureReference 'version:old' $entries.old.id
    $IncludeModuleCaches = $true
    $result = Invoke-LegacyReleaseCleanup
    Assert (-not (Test-Path $old) -and -not (Test-Path (Join-Path $fixture 'artifacts/logs/old')) -and -not (Test-Path $entries.old.path) -and -not (Test-Path $entries.old.log)) 'Coordinated retirement left obsolete version/cache/log members.'
    foreach ($name in @('current','previous','runtime','consumer','locked','running')) { Assert ((Test-Path $entries[$name].path) -and (Test-Path $entries[$name].log)) "Coordinated cleanup damaged protected cache/log group $name" }
    $ProtectedPaths = @()
    $handle = [IO.File]::Open((Join-Path $entries.locked.log 'build.json'),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        $result = Invoke-LegacyReleaseCleanup
        Assert ($result.status -in @('partial','blocked','preserved') -and (Test-Path $entries.locked.log)) 'Module log failure reported completed cleanup.'
    } finally { $handle.Dispose() }
    Write-Json (Join-Path $cache.Root '.projects.json') @{schema=99;projects=@($fixture)}
    $result = Invoke-LegacyReleaseCleanup
    Assert ($result.status -eq 'partial' -and $result.moduleCaches.status -eq 'blocked' -and $result.moduleCaches.errors.Count -gt 0) 'Module owner error was hidden.'
}
try {
    . (Join-Path $PSScriptRoot 'clean-legacy-releases.ps1') -ProjectRoot $fixture
    if ($CoordinatedOnly) {
        Invoke-CoordinatedFixtureTests
        [pscustomobject]@{ passed = $passed; status = 'passed'; fixture = $fixture }
        return
    }
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
        $expandedShortcut = @(Get-LegacyShortcutPaths @{TargetPath='%LEGACY_CLEANUP_FIXTURE_ROOT%\\engine\\azrael.exe';WorkingDirectory='';Arguments=''} $fixture)
        Assert ((Join-Path $shortcutRelease 'engine/azrael.exe') -in $expandedShortcut) 'Shortcut environment filesystem path not expanded.'
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
    $script:mockProcesses = @(@{ExecutablePath=(Join-Path $active 'engine/azrael.exe');CommandLine='';ProcessId=7})
    $script:mockInstalled = @(Join-Path $runtime 'engine/azrael.exe')
    $script:mockShortcuts = @([pscustomobject]@{command='--engine "' + (Join-Path $shortcutRelease 'engine/azrael.exe') + '"'})
    $ProtectedPaths = @($explicit)
    $preview = Invoke-LegacyReleaseCleanup
    Assert ($preview.status -eq 'preview') 'Preview blocked unexpectedly.'
    Assert ((Test-Path -LiteralPath $old) -and @($preview.candidates | Where-Object status -eq 'selected').Count -eq 1) 'Preview must select only unused owned release without deleting.'
    $Apply = $true
    $result = Invoke-LegacyReleaseCleanup
    Assert (-not (Test-Path -LiteralPath $old)) 'Old release still exists.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $fixture 'artifacts/logs/old'))) 'Associated old build log was orphaned.'
    $deleted = @($result.candidates | Where-Object status -eq 'deleted')
    Assert ($deleted.Count -eq 1 -and $deleted[0].absent -and $deleted[0].identity.receiptSha256.Length -eq 64) 'Deletion absence/compact hash evidence missing.'
    foreach ($keep in @($latestRelease,$current,$previous,$active,$runtime,$shortcutRelease,$explicit,$unknown)) { Assert (Test-Path -LiteralPath $keep) "Protected/unknown path removed: $keep" }
    $associatedProtected = New-Release 'associated-protected'
    $ProtectedPaths += Join-Path $fixture 'artifacts/logs/associated-protected'
    $result = Invoke-LegacyReleaseCleanup
    Assert ((Test-Path -LiteralPath $associatedProtected) -and @($result.candidates | Where-Object { $_.path -eq $associatedProtected -and $_.reason -match 'protected-member' }).Count -eq 1) 'Protected associated log did not preserve entire release group.'
    $unregistered = Join-Path $fixture 'artifacts/releases/unregistered-owned'
    Write-Json (Join-Path $unregistered 'build-info.json') @{product='azrael-ex';packageVersion='0.4.0';sha256=@{engine=('a'*64)}}
    $result = Invoke-LegacyReleaseCleanup
    Assert ((Test-Path -LiteralPath $unregistered) -and @($result.candidates | Where-Object { $_.path -eq $unregistered -and $_.reason -match 'lifecycle-membership-unreviewed' }).Count -eq 1) 'Unregistered owned body was deleted without complete lifecycle review.'
    $reportRelease = New-Release 'report-member'
    $reportMember = Join-Path $fixture 'artifacts/logs/legacy-release-cleanup/report-member'
    $null = Register-ArtifactLifecycle -ProjectRoot $fixture -Id 'version:report-member' -Kind version -Owner fixture -State complete -MembershipComplete $true -Members @{reportlog=$reportMember}
    $ReportPath = Join-Path $reportMember 'cleanup.json'
    $result = Invoke-LegacyReleaseCleanup
    Assert ($result.status -eq 'blocked' -and (Test-Path -LiteralPath $reportRelease) -and -not (Test-Path -LiteralPath $ReportPath)) 'Report inside lifecycle candidate allowed mutation or recreated output.'
    $ReportPath = $null
    $ProtectedPaths += $reportRelease
    $lockedRelease = New-Release 'locked-group'
    $lockedLog = Join-Path $fixture 'artifacts/logs/locked-group'
    $lockedHandle = [IO.File]::Open((Join-Path $lockedRelease 'build-info.json'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $result = Invoke-LegacyReleaseCleanup
        Assert ((Test-Path -LiteralPath $lockedLog) -and @($result.candidates | Where-Object { $_.path -eq $lockedRelease -and $_.lifecycle.status -eq 'partial' }).Count -eq 1) 'Failed body deletion continued into associated logs or hid partial group outcome.'
    } finally { $lockedHandle.Dispose() }
    $finalizeRelease = New-Release 'finalize-failure'
    $script:lifecycleNodeImplementation = ${function:Invoke-ArtifactLifecycleNode}
    function Invoke-ArtifactLifecycleNode([string[]]$Arguments) {
        if ($Arguments[0] -eq 'finalize' -and $Arguments[-1] -eq 'version:finalize-failure') { throw 'fixture metadata finalization failure' }
        & $script:lifecycleNodeImplementation -Arguments $Arguments
    }
    try {
        $result = Invoke-LegacyReleaseCleanup
        Assert (-not (Test-Path -LiteralPath $finalizeRelease) -and @($result.candidates | Where-Object { $_.path -eq $finalizeRelease -and $_.absent -and $_.lifecycle.status -eq 'partial' -and $_.lifecycle.finalization[0].status -eq 'failed' }).Count -eq 1) 'Metadata finalization failure hid observed deletion or reported full completion.'
    } finally { Set-Item -LiteralPath Function:Invoke-ArtifactLifecycleNode -Value $script:lifecycleNodeImplementation }
    $null = Invoke-ArtifactLifecycleNode @('finalize','--project-root',$fixture,'--id','version:finalize-failure')
    $changedRelease = New-Release 'consumer-arrived'
    $changedLog = Join-Path $fixture 'artifacts/logs/consumer-arrived'
    $result = Invoke-ArtifactLifecycleCleanup -ProjectRoot $fixture -Candidate $changedRelease -Apply $true -CheckMember {param($path)} -BeforeDelete {
        $registry = Join-Path $fixture 'artifacts/maintenance/lifecycles'
        $consumer = Register-ArtifactLifecycle -ProjectRoot $fixture -Id 'work:new-consumer' -Kind work -Owner fixture -State complete -MembershipComplete $true -Members @{evidence=(Join-Path $fixture 'artifacts/logs/consumer-evidence')}
        $consumer.references = @(@{id='version:consumer-arrived';reason='fixture concurrent consumer'})
        $consumerPath = Join-Path $registry (([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes('work:new-consumer'))).ToLowerInvariant()) + '.json')
        Write-Json $consumerPath $consumer
    }
    Assert ((Test-Path -LiteralPath $changedRelease) -and (Test-Path -LiteralPath $changedLog) -and $result.status -eq 'partial' -and $result.reason -match 'Lifecycle changed before removal') 'Consumer added after preflight allowed group mutation.'
    $linked = New-Release 'linked'
    $outside = Join-Path $fixture 'outside'
    New-Item -ItemType Directory -Path $outside -Force | Out-Null
    $junction = Join-Path $linked 'nested-link'
    New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
    $result = Invoke-LegacyReleaseCleanup
    Assert (@($result.candidates | Where-Object { $_.path -eq $linked -and $_.reason -match 'Nested link' }).Count -eq 1) 'Nested link did not preserve release.'
    Assert (Test-Path -LiteralPath $outside) 'Link target damaged.'
    Remove-Item -LiteralPath $junction
    $commandRelease = New-Release 'command'
    $script:mockProcesses += @{ExecutablePath=$null;CommandLine='--engine "' + (Join-Path $commandRelease 'engine/azrael.exe') + '"';ProcessId=8}
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
    Remove-Item -LiteralPath (Join-Path $fixture 'artifacts/deployments/broken') -Recurse
    $extensionRoot = Join-Path $fixture 'extensions'
    $extensionPath = Join-Path $extensionRoot 'azrael-ex-local.azrael-1.0.0'
    Write-Json (Join-Path $extensionRoot 'extensions.json') @(@{ identifier=@{id='azrael-ex-local.azrael'};location=@{fsPath=$extensionPath;path='/c:/unused'} })
    Write-Json (Join-Path $extensionPath 'out/azrael-runtime.json') @{engine=@{path=(Join-Path $runtime 'engine/azrael.exe')}}
    $refs = @(& $installedProbe $extensionRoot)
    Assert ((Join-Path $runtime 'engine/azrael.exe') -in $refs) 'Installed runtime absolute references missing.'
    $vsixRoot = Join-Path $fixture 'artifacts/vsix/owned'
    New-Item -ItemType Directory -Path $vsixRoot -Force | Out-Null
    $zip = [IO.Compression.ZipFile]::Open((Join-Path $vsixRoot 'azrael-ex.vsix'), [IO.Compression.ZipArchiveMode]::Create)
    try {
        $entry = $zip.CreateEntry('extension/package.json')
        $writer = [IO.StreamWriter]::new($entry.Open())
        try { $writer.Write('{"publisher":"azrael-ex-local","name":"azrael","version":"0.4.0"}') } finally { $writer.Dispose() }
    } finally { $zip.Dispose() }
    $null = Register-ArtifactLifecycle -ProjectRoot $fixture -Id 'version:owned-vsix' -Kind version -Owner fixture -State complete -MembershipComplete $true -Members @{vsix=$vsixRoot}
    $result = Invoke-LegacyReleaseCleanup
    Assert (@($result.candidates | Where-Object { $_.path -eq $vsixRoot -and $_.status -eq 'deleted' -and $_.absent }).Count -eq 1) 'Owned VSIX not deleted with absence receipt.'
    $fresh = New-Release 'fresh-process'
    $script:probeCount = 0
    function Get-LegacyProcesses {
        $script:probeCount++
        if ($script:probeCount -gt 1) { @{ExecutablePath=(Join-Path $fresh 'engine/azrael.exe');CommandLine='';ProcessId=9} }
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
    Remove-Item -LiteralPath $menuAlias
    $menuAlias = Join-Path $menu 'external'
    New-Item -ItemType Junction -Path $menuAlias -Target $outside | Out-Null
    function Get-LegacyShortcutReferences { Get-LegacyShortcutFiles $menu $true }
    $result = Invoke-LegacyReleaseCleanup
    Assert ($result.status -eq 'blocked' -and $result.errors[0] -match 'External shortcut alias' -and (Test-Path -LiteralPath $fresh)) 'External shortcut alias did not globally fail closed.'
    Remove-Item -LiteralPath $menuAlias
    $menuAlias = $null
    Invoke-CoordinatedFixtureTests
    [pscustomobject]@{ passed = $passed; status = 'passed'; fixture = $fixture }
} finally {
    if (Test-Path -LiteralPath $fixture) {
        $absolute = [IO.Path]::GetFullPath($fixture)
        if (-not $absolute.StartsWith([IO.Path]::GetFullPath($logs) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture teardown containment failed.' }
        # Junction is removed explicitly if an assertion failed before normal removal.
        if ($junction -and (Test-Path -LiteralPath $junction)) { Remove-Item -LiteralPath $junction }
        if ($menuAlias -and (Test-Path -LiteralPath $menuAlias)) { Remove-Item -LiteralPath $menuAlias }
        Remove-Item -LiteralPath $fixture -Recurse
        if (Test-Path -LiteralPath $fixture) { throw 'Fixture teardown failed.' }
    }
}
