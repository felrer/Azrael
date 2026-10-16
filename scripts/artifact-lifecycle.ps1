# Shared adapter only: ownership records and candidate expansion stay in the Node owner.
function Invoke-ArtifactLifecycleNode {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $previousEncoding = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
        $lines = @(& (Get-Command node -CommandType Application).Source (Join-Path $PSScriptRoot 'artifact-lifecycle.cjs') @Arguments)
        if ($LASTEXITCODE -ne 0) { throw "Artifact lifecycle command failed (exit $LASTEXITCODE)." }
    } finally { [Console]::OutputEncoding = $previousEncoding }
    ($lines -join "`n") | ConvertFrom-Json -AsHashtable
}
function Register-ArtifactLifecycle {
    param([string]$ProjectRoot, [string]$Id, [ValidateSet('version','run','work')][string]$Kind, [string]$Owner,
        [ValidateSet('pending','complete','failed','retained')][string]$State, [bool]$MembershipComplete, [System.Collections.IDictionary]$Members,
        [System.Collections.IDictionary]$References = @{})
    $arguments = @('record','--project-root',$ProjectRoot,'--id',$Id,'--kind',$Kind,'--owner',$Owner,'--state',$State,'--membership-complete',$MembershipComplete.ToString().ToLowerInvariant())
    foreach ($role in $Members.Keys) { $arguments += @('--member',("{0}={1}" -f $role, [IO.Path]::GetFullPath($Members[$role]))) }
    foreach ($id in $References.Keys) { $arguments += @('--reference',("{0}={1}" -f $id, $References[$id])) }
    Invoke-ArtifactLifecycleNode $arguments
}
function Get-VersionLifecycleMembers([string]$ProjectRoot, [string]$ReleaseName) {
    [ordered]@{
        release = Join-Path $ProjectRoot "artifacts/releases/$ReleaseName"
        'build-logs' = Join-Path $ProjectRoot "artifacts/logs/$ReleaseName"
        vsix = Join-Path $ProjectRoot "artifacts/vsix/$ReleaseName"
        deployment = Join-Path $ProjectRoot "artifacts/deployments/deploy-$ReleaseName"
        'deploy-logs' = Join-Path $ProjectRoot "artifacts/logs/deploy-$ReleaseName"
        'verification-evidence' = Join-Path $ProjectRoot "artifacts/logs/verification-evidence/deploy-$ReleaseName"
        'account-evidence' = Join-Path $ProjectRoot "artifacts/logs/verification-evidence/account-controls-$ReleaseName"
    }
}
function Get-ArtifactLifecyclePlan {
    param([string]$ProjectRoot, [string[]]$Candidates, [string[]]$ProtectedPaths = @(), [string]$ReportPath)
    if (-not $Candidates.Count) { return @{groups=@();standalone=@();blockers=@()} }
    $arguments = @('plan','--project-root',$ProjectRoot)
    foreach ($candidate in $Candidates) { $arguments += @('--candidate',$candidate) }
    foreach ($protected in $ProtectedPaths) { $arguments += @('--protected',$protected) }
    if ($ReportPath) { $arguments += @('--report',$ReportPath) }
    Invoke-ArtifactLifecycleNode $arguments
}
function Assert-ArtifactReportOutside {
    param([string]$ProjectRoot, [string[]]$Candidates, [string]$ReportPath, [switch]$SkipLifecycle)
    if (-not $ReportPath) { return }
    foreach ($candidate in $Candidates) {
        $relative = [IO.Path]::GetRelativePath([IO.Path]::GetFullPath($candidate), [IO.Path]::GetFullPath($ReportPath))
        if ($relative -eq '.' -or (-not [IO.Path]::IsPathRooted($relative) -and $relative -ne '..' -and -not $relative.StartsWith('..' + [IO.Path]::DirectorySeparatorChar))) { throw 'ReportPath is inside a cleanup candidate; reporting must not recreate deleted artifacts.' }
    }
    if ($SkipLifecycle) { return }
    $reportRelative = [IO.Path]::GetRelativePath($ProjectRoot, $ReportPath)
    if ([IO.Path]::IsPathRooted($reportRelative) -or $reportRelative -eq '..' -or $reportRelative.StartsWith('..' + [IO.Path]::DirectorySeparatorChar)) { return }
    $unlinked = @($Candidates | Where-Object {
        $artifactRelative = [IO.Path]::GetRelativePath((Join-Path $ProjectRoot 'artifacts'), $_)
        if ($artifactRelative -eq '.' -or [IO.Path]::IsPathRooted($artifactRelative) -or $artifactRelative -eq '..' -or $artifactRelative.StartsWith('..' + [IO.Path]::DirectorySeparatorChar)) { return $false }
        $linked = $false
        for ($cursor = $_; $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) { if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { $linked = $true;break } }
        -not $linked
    })
    $plan = Get-ArtifactLifecyclePlan -ProjectRoot $ProjectRoot -Candidates $unlinked -ReportPath $ReportPath
    if (@($plan.blockers | Where-Object { $_ -match 'report-inside' }).Count -or @($plan.groups | Where-Object { @($_.blockers | Where-Object { $_ -match 'report-inside' }).Count }).Count) { throw 'ReportPath is inside a lifecycle member; reporting must not recreate deleted artifacts.' }
}
function Invoke-ArtifactLifecycleCleanup {
    param([string]$ProjectRoot, [Alias('Candidate')][string]$CandidatePath, [string[]]$ProtectedPaths = @(), [string]$ReportPath,
        [bool]$Apply, [scriptblock]$CheckMember, [scriptblock]$BeforeDelete, [scriptblock]$RemoveMember)
    $plan = Get-ArtifactLifecyclePlan -ProjectRoot $ProjectRoot -Candidates @($CandidatePath) -ProtectedPaths $ProtectedPaths -ReportPath $ReportPath
    $result = [ordered]@{status='selected';reason=$null;groups=@($plan.groups | ForEach-Object id);members=@();finalization=@()}
    $blockers = @($plan.blockers) + @($plan.groups | ForEach-Object { $_.blockers })
    if (@($plan.standalone).Count -or -not @($plan.groups).Count) { $blockers += 'lifecycle-membership-unreviewed' }
    if ($blockers.Count) { $result.status='blocked';$result.reason=($blockers -join '; ');return $result }
    $seen = @{}
    foreach ($group in $plan.groups) { foreach ($member in $group.members) { if (-not $seen.ContainsKey($member.path)) { $seen[$member.path]=$true;$result.members += [ordered]@{path=$member.path;role=$member.role;status='selected'} } } }
    $result.members = @($result.members | Sort-Object @{Expression={if ($_.role -match 'log|report|evidence') {1} else {0}}})
    foreach ($member in $result.members) {
        $reason = & $CheckMember $member.path
        if ($reason) { $result.status='blocked';$result.reason=$reason;return $result }
    }
    if (-not $Apply) { return $result }
    if ($BeforeDelete) { $null = & $BeforeDelete }
    $plannedScope = @($plan.groups | ForEach-Object { $group=$_; @($group.members | ForEach-Object { "$($group.id)`0$($_.role)`0$($_.path)" }) } | Sort-Object) -join "`n"
    foreach ($member in $result.members) {
        try {
            $freshPlan = Get-ArtifactLifecyclePlan $ProjectRoot @($CandidatePath) $ProtectedPaths $ReportPath
            $freshScope = @($freshPlan.groups | ForEach-Object { $group=$_; @($group.members | ForEach-Object { "$($group.id)`0$($_.role)`0$($_.path)" }) } | Sort-Object) -join "`n"
            $freshBlockers = @($freshPlan.blockers) + @($freshPlan.groups | ForEach-Object { $_.blockers })
            if ($freshBlockers.Count -or @($freshPlan.standalone).Count -or $freshScope -cne $plannedScope) { throw ('Lifecycle changed before removal: ' + ($freshBlockers -join '; ')) }
            $reason = & $CheckMember $member.path
            if ($reason) { throw $reason }
            if (Test-Path -LiteralPath $member.path) {
                if ($RemoveMember) { $null = & $RemoveMember $member.path }
                else { Remove-Item -LiteralPath $member.path -Recurse -ErrorAction Stop }
            }
            if (Test-Path -LiteralPath $member.path) { throw "Lifecycle member remains: $($member.path)" }
            $member.status='deleted'
        } catch { $member.status='failed';$member.reason=$_.Exception.Message;$result.status='partial';$result.reason=$_.Exception.Message;break }
    }
    foreach ($group in $plan.groups) {
        try { $result.finalization += Invoke-ArtifactLifecycleNode @('finalize','--project-root',$ProjectRoot,'--id',$group.id) }
        catch {
            $result.finalization += @{id=$group.id;status='failed';reason=$_.Exception.Message}
            $result.status='partial';$result.reason=$_.Exception.Message
        }
    }
    if ($result.status -ne 'partial') { $result.status=if (@($result.finalization | Where-Object status -ne 'finalized').Count) {'partial'} else {'deleted'} }
    $result
}
function Start-ArtifactCleanupOperation([string]$ProjectRoot, [string]$ReportPath) {
    if (-not $ReportPath) { return $null }
    $relative = [IO.Path]::GetRelativePath((Join-Path $ProjectRoot 'artifacts'), $ReportPath)
    if ([IO.Path]::IsPathRooted($relative) -or $relative -eq '..' -or $relative.StartsWith('..' + [IO.Path]::DirectorySeparatorChar)) { return $null }
    $id = 'work:cleanup:' + [guid]::NewGuid().ToString('N')
    $null = Register-ArtifactLifecycle -ProjectRoot $ProjectRoot -Id $id -Kind work -Owner 'artifact-cleanup' -State pending -MembershipComplete $false -Members @{report=$ReportPath}
    $id
}
function Complete-ArtifactCleanupOperation([string]$ProjectRoot, [string]$Id, [string]$ReportPath) {
    if ($Id) { $null = Register-ArtifactLifecycle -ProjectRoot $ProjectRoot -Id $Id -Kind work -Owner 'artifact-cleanup' -State complete -MembershipComplete $true -Members @{report=$ReportPath} }
}
