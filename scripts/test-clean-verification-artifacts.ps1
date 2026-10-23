#requires -Version 7.4
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$testRoot = Join-Path $project ('artifacts/logs/storage-cleanup-20261006/verification-fixtures-' + [guid]::NewGuid().ToString('N'))
$cleaner = Join-Path $PSScriptRoot 'clean-verification-artifacts.ps1'
. (Join-Path $PSScriptRoot 'artifact-lifecycle.ps1')
$passed = 0
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message }; $script:passed++ }
function Write-Json([string]$Path, $Value) {
    New-Item -ItemType Directory -Path (Split-Path $Path -Parent) -Force | Out-Null
    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}
function New-Fixture([string]$Name) {
    $path = Join-Path $testRoot "artifacts/verification/$Name"
    Write-Json (Join-Path $path 'check-result.json') @{ passed = $true; exitCodes = @{initialInventory=0;hostInstall=0;finalInventory=0;namespace=0;standaloneHost=0;host=0} }
    Write-Json (Join-Path $path 'host-result.json') @{passed=$true}
    Write-Json (Join-Path $path 'report.json') @{status='passed'}
    Write-Json (Join-Path $path 'auth-report.json') @{token='private'}
    Write-Json (Join-Path $path 'state/sessions/session.json') @{secret='private'}
    New-Item -ItemType Directory -Path (Join-Path $path 'extensions/payload') -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $path 'extensions/payload/large.bin'), [byte[]]::new(65536))
    $associatedLog = Join-Path $testRoot "artifacts/logs/fixture-$Name"
    Write-Json (Join-Path $associatedLog 'diagnostic.json') @{status='complete'}
    $null = Register-ArtifactLifecycle -ProjectRoot $testRoot -Id "run:$Name" -Kind run -Owner fixture -Generated -ProtectionKnown -State complete -MembershipComplete $true -Members @{fixture=$path;logs=$associatedLog}
    $path
}
function Run-Clean([string]$Path, [string[]]$Protected = @(), [bool]$ApplyNow = $true) {
    & $cleaner -ProjectRoot $testRoot -FixtureRoot $Path -ProtectedPaths $Protected -Apply:$ApplyNow
}
function Start-Reference([string]$Reference) {
    $sleeper = Join-Path $testRoot 'sleep.ps1'
    'param([string]$Reference) Start-Sleep -Seconds 60' | Set-Content -LiteralPath $sleeper
    $info = [Diagnostics.ProcessStartInfo]::new((Get-Process -Id $PID).Path)
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    foreach ($arg in @('-NoProfile','-File',$sleeper,'-Reference',$Reference)) { $info.ArgumentList.Add($arg) }
    [Diagnostics.Process]::Start($info)
}
try {
    foreach ($case in @('ok','unregistered','wrong-owner','pending','incomplete','referenced','protected')) {
        $short = Join-Path $testRoot "artifacts/v-$case"
        Write-Json (Join-Path $short 'check-result.json') @{passed=$true;exitCodes=@{initialInventory=0;hostInstall=0;finalInventory=0;namespace=0;standaloneHost=0;host=0}}
        if ($case -ne 'unregistered') {
            $owner = if ($case -eq 'wrong-owner') {'other-owner'} else {'azrael-release'}
            $state = if ($case -eq 'pending') {'pending'} else {'complete'}
            $null = Register-ArtifactLifecycle -ProjectRoot $testRoot -Id "run:verification:short-$case" -Kind run -Owner $owner -Generated -ProtectionKnown -State $state -MembershipComplete ($case -notin @('pending','incomplete')) -Members @{fixture=$short}
        }
        if ($case -eq 'referenced') { $null = Register-ArtifactLifecycle -ProjectRoot $testRoot -Id 'run:short-consumer' -Kind run -Owner fixture -State pending -MembershipComplete $false -Members @{fixture=(Join-Path $testRoot 'artifacts/short-consumer')} -References @{'run:verification:short-referenced'='active test consumer'} }
        [string[]]$protected = @()
        if ($case -eq 'protected') { $protected = @($short) }
        $preview = Run-Clean $short $protected $false
        Assert (Test-Path -LiteralPath $short) "Short fixture preview mutated $case."
        $report = Run-Clean $short $protected
        if ($case -eq 'ok') {
            Assert ($preview.candidates[0].status -eq 'selected' -and $report.candidates[0].status -eq 'deleted' -and -not (Test-Path -LiteralPath $short)) "Registered short fixture result: preview=$($preview.candidates[0].status), apply=$($report.candidates[0].status), remaining=$(Test-Path -LiteralPath $short), path=$short, reason=$($report.candidates[0].reason), errors=$(@($preview.errors + $report.errors) -join '; ')"
        } else { Assert ($report.candidates[0].status -eq 'retained' -and (Test-Path -LiteralPath $short)) "Uncertain or protected short fixture deleted: $case" }
    }
    $shortTarget = Join-Path $testRoot 'artifacts/short-target'
    Write-Json (Join-Path $shortTarget 'preserve.json') @{original='test-owned target'}
    $shortLink = Join-Path $testRoot 'artifacts/v-link'
    New-Item -ItemType Junction -Path $shortLink -Target $shortTarget | Out-Null
    $linkedReport = Run-Clean $shortLink
    Assert ($linkedReport.candidates[0].status -eq 'retained' -and $linkedReport.candidates[0].reason -match 'Linked path' -and (Test-Path -LiteralPath (Join-Path $shortTarget 'preserve.json'))) 'Short fixture link guard failed.'
    Remove-Item -LiteralPath $shortLink
    $fixture = New-Fixture 'completed spaces 한글'
    $preview = Run-Clean $fixture @() $false
    Assert ($preview.candidates[0].status -eq 'selected' -and (Test-Path -LiteralPath $fixture)) 'Preview changed fixture.'
    $report = Run-Clean $fixture
    Assert ($report.candidates[0].status -eq 'deleted' -and -not (Test-Path -LiteralPath $fixture)) "Completed fixture retained: $($report.candidates[0].reason)"
    $archive = Split-Path $report.candidates[0].archived[0] -Parent
    Assert ((Test-Path -LiteralPath (Join-Path $archive 'check-result.json')) -and (Test-Path -LiteralPath (Join-Path $archive 'host-result.json')) -and (Test-Path -LiteralPath (Join-Path $archive 'report.json'))) 'Compact evidence missing.'
    Assert (@(Get-ChildItem -LiteralPath $archive -Recurse -File).Count -eq 3) 'Private or payload data archived.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $testRoot 'artifacts/logs/fixture-completed spaces 한글'))) 'Associated fixture log was orphaned.'
    $fixture = New-Fixture 'deleted-group-owner'
    $report = Invoke-ArtifactLifecycleCleanup -ProjectRoot $testRoot -CandidatePath $fixture -Apply $true -CheckMember {
        param($memberPath)
        if (-not (Test-Path -LiteralPath $memberPath)) { throw "Filesystem guard received an absent member: $memberPath" }
    }
    Assert ($report.status -eq 'deleted' -and -not (Test-Path -LiteralPath (Join-Path $testRoot 'artifacts/logs/fixture-deleted-group-owner'))) 'Deleted group owner prevented associated log removal.'
    $fixture = New-Fixture 'hidden-git'
    $gitDirectory = Join-Path $fixture '.git'
    $gitFile = Join-Path $gitDirectory 'objects/object'
    Write-Json $gitFile @{generated=$true}
    [IO.File]::SetAttributes($gitDirectory, ([IO.File]::GetAttributes($gitDirectory) -bor [IO.FileAttributes]::Hidden))
    [IO.File]::SetAttributes($gitFile, ([IO.File]::GetAttributes($gitFile) -bor [IO.FileAttributes]::ReadOnly))
    $report = Run-Clean $fixture
    Assert ($report.candidates[0].status -eq 'deleted' -and -not (Test-Path -LiteralPath $fixture)) 'Hidden generated .git tree remained.'
    $attributeChanges = @($report.candidates[0].lifecycle.members | ForEach-Object { $_.attributes } | Where-Object { $null -ne $_ })
    Assert (@($attributeChanges | Where-Object { $_.path -ceq $gitDirectory -and ($_.before -band [IO.FileAttributes]::Hidden) -and -not ($_.after -band [IO.FileAttributes]::Hidden) -and $_.status -eq 'normalized' }).Count -eq 1) 'Hidden attribute audit missing.'
    Assert (@($attributeChanges | Where-Object { $_.path -ceq $gitFile -and ($_.before -band [IO.FileAttributes]::ReadOnly) -and -not ($_.after -band [IO.FileAttributes]::ReadOnly) }).Count -eq 1) 'ReadOnly attribute audit missing.'
    $fixture = New-Fixture 'hardlinked-internal'
    $original = Join-Path $fixture ('extensions/' + ('deep' * 25) + '/original.txt')
    $shortOriginal = Join-Path $fixture 'extensions/original.txt'
    Write-Json $shortOriginal @{generated=$true}
    New-Item -ItemType HardLink -Path (Join-Path $fixture 'extensions/alias.txt') -Target $shortOriginal | Out-Null
    New-Item -ItemType Directory -Path (Split-Path $original -Parent) | Out-Null
    if (-not (Test-ArtifactRemovalContained $shortOriginal $fixture) -or -not (Test-ArtifactRemovalContained $original $fixture)) { throw 'Long-path fixture move escapes its owner.' }
    [IO.File]::Move($shortOriginal, $original)
    [IO.File]::SetAttributes($original, ([IO.FileAttributes]::ReadOnly -bor [IO.FileAttributes]::Hidden))
    $report = Run-Clean $fixture
    Assert ($report.candidates[0].status -eq 'deleted' -and -not (Test-Path -LiteralPath $fixture)) "Internal hardlinks retained: $($report.candidates[0].reason)"
    $fixture = New-Fixture 'hardlinked-group'
    $original = Join-Path $fixture 'extensions/original.txt'
    $associatedLog = Join-Path $testRoot 'artifacts/logs/fixture-hardlinked-group'
    Write-Json $original @{generated=$true}
    New-Item -ItemType HardLink -Path (Join-Path $associatedLog 'alias.txt') -Target $original | Out-Null
    [IO.File]::SetAttributes($original, [IO.FileAttributes]::ReadOnly)
    $report = Run-Clean $fixture
    Assert ($report.candidates[0].status -eq 'deleted' -and -not (Test-Path -LiteralPath $fixture) -and -not (Test-Path -LiteralPath $associatedLog)) "Cross-member hardlinks retained: $($report.candidates[0].reason)"
    $fixture = New-Fixture 'hardlinked-uncertain'
    $original = Join-Path $fixture 'extensions/original.txt'
    Write-Json $original @{generated=$true}
    New-Item -ItemType HardLink -Path (Join-Path $fixture 'extensions/alias.txt') -Target $original | Out-Null
    [IO.File]::SetAttributes($original, [IO.FileAttributes]::ReadOnly)
    $enumerator = (Get-Command Get-ArtifactRemovalHardlinkNames).ScriptBlock
    try {
        Set-Item Function:Get-ArtifactRemovalHardlinkNames { throw 'injected enumeration failure' }
        $audit = [Collections.Generic.List[object]]::new()
        $failure = $null
        try { Set-ArtifactRemovalAttributes -Path $fixture -Audit $audit -OwnershipVerified $true } catch { $failure = $_.Exception.Message }
        Assert ($failure -match 'enumeration is uncertain' -and $audit.Count -eq 0 -and ([IO.File]::GetAttributes($original) -band [IO.FileAttributes]::ReadOnly)) 'Uncertain enumeration changed attributes.'
    } finally { Set-Item Function:Get-ArtifactRemovalHardlinkNames $enumerator; [IO.File]::SetAttributes($original, [IO.FileAttributes]::Normal) }
    $fixture = New-Fixture 'hardlinked-race'
    $original = Join-Path $fixture 'extensions/original.txt'
    Write-Json $original @{generated=$true}
    New-Item -ItemType HardLink -Path (Join-Path $fixture 'extensions/alias.txt') -Target $original | Out-Null
    $racedName = Join-Path $testRoot 'outside/raced-hardlink.txt'
    New-Item -ItemType Directory -Path (Split-Path $racedName -Parent) -Force | Out-Null
    [IO.File]::SetAttributes($original, [IO.FileAttributes]::ReadOnly)
    $script:linkEnumerationCalls = 0
    try {
        Set-Item Function:Get-ArtifactRemovalHardlinkNames {
            param([string]$Path)
            $script:linkEnumerationCalls++
            if ($script:linkEnumerationCalls -eq 3) { New-Item -ItemType HardLink -Path $racedName -Target $original | Out-Null }
            [ArtifactRemovalNative]::Names($Path)
        }
        $audit = [Collections.Generic.List[object]]::new()
        $failure = $null
        try { Set-ArtifactRemovalAttributes -Path $fixture -Audit $audit -OwnershipVerified $true } catch { $failure = $_.Exception.Message }
        Assert ($failure -match 'Hardlinked' -and $audit.Count -eq 0 -and ([IO.File]::GetAttributes($original) -band [IO.FileAttributes]::ReadOnly)) 'New external hardlink before normalization was not blocked.'
    } finally { Set-Item Function:Get-ArtifactRemovalHardlinkNames $enumerator; [IO.File]::SetAttributes($original, [IO.FileAttributes]::Normal) }
    $fixture = New-Fixture 'group-preflight'
    $associatedLog = Join-Path $testRoot 'artifacts/logs/fixture-group-preflight'
    $systemFile = Join-Path $associatedLog 'system.txt'
    Write-Json $systemFile @{generated=$true}
    [IO.File]::SetAttributes($fixture, ([IO.File]::GetAttributes($fixture) -bor [IO.FileAttributes]::Hidden))
    [IO.File]::SetAttributes($systemFile, ([IO.File]::GetAttributes($systemFile) -bor [IO.FileAttributes]::System))
    try {
        $report = Run-Clean $fixture
        Assert ($report.candidates[0].reason -match 'System' -and ([IO.File]::GetAttributes($fixture) -band [IO.FileAttributes]::Hidden) -and (Test-Path -LiteralPath $associatedLog)) 'A later unsafe group member allowed earlier mutation.'
    } finally {
        [IO.File]::SetAttributes($systemFile, [IO.FileAttributes]::Normal)
        [IO.File]::SetAttributes($fixture, [IO.FileAttributes]::Directory)
    }
    $fixture = New-Fixture 'hardlinked-original'
    $original = Join-Path $testRoot 'outside/shared-original.txt'
    Write-Json $original @{original=$true}
    $hardlink = Join-Path $fixture 'extensions/shared.txt'
    New-Item -ItemType HardLink -Path $hardlink -Target $original | Out-Null
    $originalAttributes = [IO.File]::GetAttributes($original)
    $originalContents = Get-Content -LiteralPath $original -Raw
    try {
        [IO.File]::SetAttributes($original, ($originalAttributes -bor [IO.FileAttributes]::ReadOnly))
        $report = Run-Clean $fixture
        Assert ($report.candidates[0].reason -match 'Hardlinked' -and (Test-Path -LiteralPath $fixture)) 'Hardlinked original did not block normalization.'
        Assert (([IO.File]::GetAttributes($original) -band [IO.FileAttributes]::ReadOnly) -ne 0) 'Shared original attributes changed.'
    } finally { [IO.File]::SetAttributes($original, $originalAttributes) }
    $report = Run-Clean $fixture
    Assert ($report.candidates[0].status -eq 'deleted' -and -not (Test-Path -LiteralPath $fixture)) 'Ordinary hardlink deletion was blocked.'
    Assert ((Test-Path -LiteralPath $original) -and [IO.File]::GetAttributes($original) -eq $originalAttributes -and (Get-Content -LiteralPath $original -Raw) -ceq $originalContents) 'Ordinary hardlink deletion changed the shared original.'
    $fixture = New-Fixture 'associated-protected'
    $protectedAttributes = [IO.File]::GetAttributes($fixture)
    [IO.File]::SetAttributes($fixture, ($protectedAttributes -bor [IO.FileAttributes]::Hidden))
    $report = Run-Clean $fixture @((Join-Path $testRoot 'artifacts/logs/fixture-associated-protected'))
    Assert ($report.candidates[0].reason -match 'protected-member' -and (Test-Path -LiteralPath $fixture)) 'Protected associated log did not preserve the whole group.'
    Assert (([IO.File]::GetAttributes($fixture) -band [IO.FileAttributes]::Hidden) -ne 0) 'Protected member attributes changed.'
    [IO.File]::SetAttributes($fixture, $protectedAttributes)
    $fixture = New-Fixture 'report-inside'
    $unsafeReport = Join-Path $fixture 'new-report/report.json'
    $report = & $cleaner -ProjectRoot $testRoot -FixtureRoot $fixture -Apply -ReportPath $unsafeReport
    Assert ($report.status -eq 'blocked' -and (Test-Path -LiteralPath $fixture) -and -not (Test-Path -LiteralPath $unsafeReport)) 'Report inside candidate mutated or recreated the candidate.'
    $fixture = Join-Path $testRoot 'artifacts/verification/unregistered'
    Write-Json (Join-Path $fixture 'check-result.json') @{passed=$true;exitCodes=@{initialInventory=0;hostInstall=0;finalInventory=0;namespace=0;standaloneHost=0;host=0}}
    $report = Run-Clean $fixture
    Assert ($report.candidates[0].reason -match 'lifecycle-membership-unreviewed' -and (Test-Path -LiteralPath $fixture)) 'Unregistered fixture body was deleted.'
    $fixture = New-Fixture 'protected'
    $report = Run-Clean $fixture @((Join-Path $fixture 'state'))
    Assert ($report.candidates[0].reason -match 'Protected' -and (Test-Path -LiteralPath $fixture)) 'Protected path ignored.'
    $fixture = New-Fixture 'failed'
    Write-Json (Join-Path $fixture 'check-result.json') @{passed=$false;exitCodes=@{host=1}}
    Assert ((Run-Clean $fixture).candidates[0].reason -match 'Failed or incomplete') 'Failed fixture selected.'
    $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $fixture -IncludeDiagnosedFixtures -Apply
    Assert ($diagnosed.candidates[0].status -eq 'deleted' -and @($diagnosed.candidates[0].archived | Where-Object { [IO.Path]::GetFileName($_) -eq 'check-result.json' -and (Test-Path -LiteralPath $_) }).Count -eq 1) 'Diagnosed failed fixture not removed with evidence.'
    $fixture = New-Fixture 'unknown'
    Remove-Item -LiteralPath (Join-Path $fixture 'check-result.json')
    Assert ((Run-Clean $fixture).candidates[0].reason -match 'Unknown or incomplete') 'Unknown fixture selected.'
    $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $fixture -IncludeDiagnosedFixtures -Apply
    Assert ($diagnosed.candidates[0].status -eq 'deleted' -and @($diagnosed.candidates[0].archived | Where-Object { [IO.Path]::GetFileName($_) -eq 'cleanup-receipt.json' -and (Test-Path -LiteralPath $_) }).Count -eq 1) 'Diagnosed unknown fixture not removed with receipt.'
    $fixture = New-Fixture 'active'
    $proc = Start-Reference ('\\?\' + $fixture.Replace('\','/'))
    try { Assert ((Run-Clean $fixture).candidates[0].reason -match 'Active command') 'Normalized active path missed.' }
    finally { if (-not $proc.HasExited) { $proc.Kill($true) }; $proc.WaitForExit(); $proc.Dispose() }
    $proc = Start-Reference ($fixture + '-backup')
    try { Assert ((Run-Clean $fixture).candidates[0].status -eq 'deleted') 'Sibling substring falsely protected.' }
    finally { if (-not $proc.HasExited) { $proc.Kill($true) }; $proc.WaitForExit(); $proc.Dispose() }
    $outside = Join-Path $testRoot 'outside'
    New-Item -ItemType Directory -Path $outside -Force | Out-Null
    $sentinel = Join-Path $outside 'sentinel.txt'
    'preserve me' | Set-Content -LiteralPath $sentinel
    Assert ((Run-Clean $outside).candidates[0].reason -match 'immediate verification child') 'Outside containment not rejected.'
    Assert ((Run-Clean (Join-Path $testRoot 'artifacts/verification')).candidates[0].reason -match 'immediate verification child') 'Verification root selected.'
    foreach ($ownerPrefix in @('deploy', 'manual')) {
        $stage = Join-Path $testRoot ("artifacts/deployments/${ownerPrefix}-interrupted/package/stage-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $stage -Force | Out-Null
        $null = Register-ArtifactLifecycle -ProjectRoot $testRoot -Id "run:stage-$ownerPrefix" -Kind run -Owner fixture -State complete -MembershipComplete $true -Members @{stage=$stage}
        Assert ((Run-Clean $stage).candidates[0].reason -match 'immediate verification child') 'Package stage allowed without explicit diagnosis.'
        $proc = Start-Reference $stage
        try {
            $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $stage -IncludeDiagnosedFixtures -Apply
            Assert ($diagnosed.candidates[0].reason -match 'Active command' -and (Test-Path -LiteralPath $stage)) 'Active package stage removed.'
        } finally { if (-not $proc.HasExited) { $proc.Kill($true) }; $proc.WaitForExit(); $proc.Dispose() }
        $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $stage -IncludeDiagnosedFixtures -Apply
        Assert ($diagnosed.candidates[0].status -eq 'deleted' -and -not (Test-Path -LiteralPath $stage)) 'Diagnosed package stage not removed.'
        $stage = Join-Path $testRoot ("artifacts/deployments/${ownerPrefix}-installed/package/stage-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $stage -Force | Out-Null
        Write-Json (Join-Path (Split-Path (Split-Path $stage -Parent) -Parent) 'deployment.json') @{hostInstalled=$true}
        $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $stage -IncludeDiagnosedFixtures -Apply
        Assert ($diagnosed.candidates[0].reason -match 'Installed deployment' -and (Test-Path -LiteralPath $stage)) 'Installed package stage removed.'
        $badStage = Join-Path (Split-Path $stage -Parent) 'stage-invalid'
        New-Item -ItemType Directory -Path $badStage -Force | Out-Null
        $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $badStage -IncludeDiagnosedFixtures -Apply
        Assert ($diagnosed.candidates[0].reason -match 'immediate verification child') 'Malformed package stage selected.'
    }
    foreach ($invalidOwner in @('manual-', 'unowned-stage')) {
        $invalidStage = Join-Path $testRoot ('artifacts/deployments/' + $invalidOwner + '/package/stage-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $invalidStage -Force | Out-Null
        $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $invalidStage -IncludeDiagnosedFixtures -Apply
        Assert ($diagnosed.candidates[0].reason -match 'immediate verification child' -and (Test-Path -LiteralPath $invalidStage)) 'Malformed deployment owner selected.'
    }
    $outsideManualStage = Join-Path $testRoot ('outside/deployments/manual-other/package/stage-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $outsideManualStage -Force | Out-Null
    $diagnosed = & $cleaner -ProjectRoot $testRoot -FixtureRoot $outsideManualStage -IncludeDiagnosedFixtures -Apply
    Assert ($diagnosed.candidates[0].reason -match 'immediate verification child' -and (Test-Path -LiteralPath $outsideManualStage)) 'Manual stage outside deployments boundary selected.'
    $fixture = New-Fixture 'nested-junction'
    New-Item -ItemType Junction -Path (Join-Path $fixture 'extensions/outside-link') -Target $outside | Out-Null
    Assert ((Run-Clean $fixture).candidates[0].reason -match 'reparse') 'Nested junction was traversed or normalized.'
    Remove-Item -LiteralPath (Join-Path $fixture 'extensions/outside-link')
    Assert ((Get-Content -LiteralPath $sentinel -Raw).Trim() -eq 'preserve me') 'Nested junction target changed.'
    $fixture = New-Fixture 'verified-junction'
    $junction = Join-Path $fixture 'extensions/verified-test-link'
    New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
    $targetAttributes = [IO.File]::GetAttributes($sentinel)
    [IO.File]::SetAttributes($sentinel, ($targetAttributes -bor [IO.FileAttributes]::ReadOnly))
    try {
        $report = Invoke-ArtifactLifecycleCleanup -ProjectRoot $testRoot -CandidatePath $fixture -Apply $true -CheckMember {} -VerifiedJunctions @{$junction=$outside}
        Assert ($report.status -eq 'deleted' -and -not (Test-Path -LiteralPath $fixture)) "Verified junction retained: $($report.reason)"
        Assert ((Get-Content -LiteralPath $sentinel -Raw).Trim() -eq 'preserve me' -and ([IO.File]::GetAttributes($sentinel) -band [IO.FileAttributes]::ReadOnly)) 'Verified junction target was traversed or normalized.'
        Assert (@($report.members | ForEach-Object attributes | Where-Object { $_.operation -eq 'remove-junction-link' -and $_.status -eq 'deleted' }).Count -eq 1) 'Link-only removal audit missing.'
    } finally { [IO.File]::SetAttributes($sentinel, $targetAttributes) }
    $fixture = New-Fixture 'retargeted-junction'
    $junction = Join-Path $fixture 'extensions/verified-test-link'
    $otherTarget = Join-Path $testRoot 'outside-other'
    New-Item -ItemType Directory -Path $otherTarget | Out-Null
    New-Item -ItemType Junction -Path $junction -Target $otherTarget | Out-Null
    $report = Invoke-ArtifactLifecycleCleanup -ProjectRoot $testRoot -CandidatePath $fixture -Apply $true -CheckMember {} -VerifiedJunctions @{$junction=$outside}
    Assert ($report.status -eq 'blocked' -and $report.reason -match 'target changed' -and (Test-Path -LiteralPath $fixture)) 'Retargeted junction did not preserve the group.'
    Remove-Item -LiteralPath $junction
    $link = Join-Path $testRoot 'artifacts/verification/linked-candidate'
    New-Item -ItemType Junction -Path $link -Target $outside | Out-Null
    Assert ((Run-Clean $link).candidates[0].reason -match 'Linked path') 'Linked candidate selected.'
    $failure = $null
    try { Remove-ArtifactLifecycleMember -Path $link -Audit ([Collections.Generic.List[object]]::new()) -OwnershipVerified $true -VerifiedJunctions @{$link=$outside} } catch { $failure=$_.Exception.Message }
    Assert ($failure -match 'Root or ancestor reparse' -and (Test-Path -LiteralPath $link)) 'Allowlist permitted a root junction.'
    Remove-Item -LiteralPath $link
    $fixture = New-Fixture 'installed'
    Write-Json (Join-Path $testRoot 'artifacts/deployments/current/deployment.json') @{ status='installed-reload-required';hostInstalled=$true;packageDirectory=(Join-Path $testRoot 'package');stateRoot=(Join-Path $fixture 'state') }
    Assert ((Run-Clean $fixture).candidates[0].reason -match 'Protected reference') 'Installed fixture reference ignored.'
    $fixture = New-Fixture 'previous'
    Write-Json (Join-Path $testRoot 'artifacts/deployments/previous/deployment.json') @{ status='installed-reload-required';hostInstalled=$true;packageDirectory=(Join-Path $testRoot 'previous-package') }
    Write-Json (Join-Path $testRoot 'artifacts/logs/previous/deployment-metrics.json') @{packageDirectory=(Join-Path $testRoot 'previous-package');fixtureRoot=$fixture;acceptanceResult=(Join-Path $fixture 'check-result.json')}
    Assert ((Run-Clean $fixture).candidates[0].reason -match 'Protected reference') 'Previous linked metrics ignored.'
    $fixture = New-Fixture 'inspection-failure'
    'invalid json' | Set-Content -LiteralPath (Join-Path $testRoot 'artifacts/deployments/current/deployment.json')
    Assert ((Run-Clean $fixture).status -eq 'blocked' -and (Test-Path -LiteralPath $fixture)) 'Inspection failure did not preserve fixture.'
    [pscustomobject]@{Passed=$passed;Failed=0}
} catch {
    Write-Error ($_.Exception.Message + "`n" + $_.ScriptStackTrace) -ErrorAction Continue
    throw
} finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $testContainer = [IO.Path]::GetFullPath((Join-Path $project 'artifacts/logs/storage-cleanup-20261006')).TrimEnd('\')
    if (-not $resolvedTestRoot.StartsWith($testContainer + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup escapes its fixture container.' }
    if (Test-Path -LiteralPath $resolvedTestRoot) {
        # Failure fixtures can contain hardlink directory entries with stale attribute caches
        # after test-owned attributes were restored. Recheck through the same safe owner.
        Remove-ArtifactLifecycleMember -Path $resolvedTestRoot -Audit ([Collections.Generic.List[object]]::new()) -OwnershipVerified $true
    }
}
