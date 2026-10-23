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
        [System.Collections.IDictionary]$References = @{}, [switch]$Generated, [switch]$ProtectionKnown,
        [ValidateSet('execution','installation','recovery','evidence','dependency')][string]$ReferenceKind)
    $arguments = @('record','--project-root',$ProjectRoot,'--id',$Id,'--kind',$Kind,'--owner',$Owner,'--state',$State,'--membership-complete',$MembershipComplete.ToString().ToLowerInvariant())
    foreach ($role in $Members.Keys) { $arguments += @('--member',("{0}={1}" -f $role, [IO.Path]::GetFullPath($Members[$role]))) }
    foreach ($id in $References.Keys) { $arguments += @('--reference',("{0}={1}" -f $id, $References[$id])) }
    if ($PSBoundParameters.ContainsKey('Generated')) { $arguments += @('--generated', $Generated.IsPresent.ToString().ToLowerInvariant()) }
    if ($PSBoundParameters.ContainsKey('ProtectionKnown')) { $arguments += @('--protection-known', $ProtectionKnown.IsPresent.ToString().ToLowerInvariant()) }
    if ($ReferenceKind) { $arguments += @('--reference-kind', $ReferenceKind) }
    Invoke-ArtifactLifecycleNode $arguments
}
function Close-ArtifactLifecycle {
    param([string]$ProjectRoot, [string]$Id, [string]$RequestFile)
    Invoke-ArtifactLifecycleNode @('close','--project-root',$ProjectRoot,'--id',$Id,'--request-file',$RequestFile)
}
function Release-ArtifactLifecycleReferences {
    param([string]$ProjectRoot, [string]$Id, [string]$RequestFile)
    Invoke-ArtifactLifecycleNode @('release','--project-root',$ProjectRoot,'--id',$Id,'--request-file',$RequestFile)
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
function Initialize-ArtifactWindowsIdentity {
    if ('ArtifactRemovalNative' -as [type]) { return }
    # Windows supplies both the file identity/link count and a complete name enumeration.
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class ArtifactRemovalNative {
    static string Extended(string path) {
        if (path.StartsWith(@"\\?\")) return path;
        var full = System.IO.Path.GetFullPath(path);
        return full.StartsWith(@"\\") ? @"\\?\UNC\" + full.Substring(2) : @"\\?\" + full;
    }
    static string Ordinary(string path) {
        if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + path.Substring(8);
        return path.StartsWith(@"\\?\") ? path.Substring(4) : path;
    }
    [StructLayout(LayoutKind.Sequential)] struct Info {
        public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string p, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h, out Info i);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr FindFirstFileNameW(string p, uint f, ref uint n, StringBuilder b);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool FindNextFileNameW(IntPtr h, ref uint n, StringBuilder b);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool FindClose(IntPtr h);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetVolumePathNameW(string p, StringBuilder b, uint n);
    public static string Identity(string path) {
        using (var h = CreateFileW(Extended(path), 0, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
            if (h.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            Info i; if (!GetFileInformationByHandle(h, out i)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return i.Volume + ":" + i.IndexHigh + ":" + i.IndexLow + ":" + i.Links;
        }
    }
    public static uint Attributes(string path) {
        using (var h = CreateFileW(Extended(path), 0, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
            if (h.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            Info i; if (!GetFileInformationByHandle(h, out i)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return i.Attributes;
        }
    }
    public static string[] Names(string path) {
        var volume = new StringBuilder(32768);
        if (!GetVolumePathNameW(Extended(path), volume, 32768)) throw new Win32Exception(Marshal.GetLastWin32Error());
        uint n = 32768; var b = new StringBuilder((int)n);
        var h = FindFirstFileNameW(Extended(path), 0, ref n, b);
        if (h == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        var names = new List<string>();
        try {
            while (true) {
                names.Add(Ordinary(volume.ToString()).TrimEnd('\\') + b.ToString());
                n = 32768; b.Clear();
                if (FindNextFileNameW(h, ref n, b)) continue;
                int error = Marshal.GetLastWin32Error();
                if (error != 38) throw new Win32Exception(error);
                return names.ToArray();
            }
        } finally { FindClose(h); }
    }
}
'@
}
function Test-ArtifactRemovalContained([string]$Path, [string]$Root) {
    $relative = [IO.Path]::GetRelativePath([IO.Path]::GetFullPath($Root), [IO.Path]::GetFullPath($Path))
    $relative -eq '.' -or (-not [IO.Path]::IsPathRooted($relative) -and $relative -ne '..' -and -not $relative.StartsWith('..' + [IO.Path]::DirectorySeparatorChar))
}
function Assert-ArtifactRemovalAncestors([string]$Path) {
    for ($cursor = [IO.Path]::GetFullPath($Path); $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
        if ([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) { throw "Root or ancestor reparse path cannot be removed: $cursor" }
    }
}
function Get-ArtifactRemovalHardlinkNames([string]$Path) { [ArtifactRemovalNative]::Names($Path) }
function Assert-ArtifactRemovalHardlinks([string]$Path, [string[]]$GroupPaths) {
    $identity = [ArtifactRemovalNative]::Identity($Path)
    $count = [uint32]($identity.Split(':')[-1])
    if ($count -le 1) { return }
    try { $names = @(Get-ArtifactRemovalHardlinkNames $Path) }
    catch { throw "Hardlinked file name enumeration is uncertain: $Path : $_" }
    if ($names.Count -ne $count -or @($names | Sort-Object -Unique).Count -ne $count) { throw "Hardlinked file name enumeration is incomplete: $Path" }
    foreach ($name in $names) {
        if (-not @($GroupPaths | Where-Object { Test-ArtifactRemovalContained $name $_ }).Count) { throw "Hardlinked file has a name outside the deletion group: $Path : $name" }
        Assert-ArtifactRemovalAncestors ([IO.Path]::GetDirectoryName($name))
        if ([ArtifactRemovalNative]::Identity($name) -cne $identity) { throw "Hardlinked file identity changed: $name" }
    }
    if ([ArtifactRemovalNative]::Identity($Path) -cne $identity) { throw "Hardlinked file changed during enumeration: $Path" }
}
function Get-ArtifactRemovalSnapshot {
    param([string[]]$GroupPaths, [bool]$OwnershipVerified, [Collections.IDictionary]$VerifiedJunctions = @{},
        [string[]]$InspectionPaths = $GroupPaths)
    Initialize-ArtifactWindowsIdentity
    $items = [Collections.Generic.List[object]]::new()
    $pending = [Collections.Generic.Stack[object]]::new()
    foreach ($root in $InspectionPaths) {
        if (Test-Path -LiteralPath $root) { Assert-ArtifactRemovalAncestors $root; $pending.Push((Get-Item -LiteralPath $root -Force -ErrorAction Stop)) }
    }
    while ($pending.Count) {
        $item = $pending.Pop()
        try { $attributes = [ArtifactRemovalNative]::Attributes($item.FullName) }
        catch { throw "Cannot inspect removal path '$($item.FullName)': $_" }
        if ($attributes -band [IO.FileAttributes]::System) { throw "System path cannot be normalized: $($item.FullName)" }
        $junction = $false
        if ($attributes -band [IO.FileAttributes]::ReparsePoint) {
            if (-not $OwnershipVerified -or $item.LinkType -ne 'Junction' -or -not $VerifiedJunctions.Contains($item.FullName)) { throw "Unverified reparse path cannot be removed: $($item.FullName)" }
            $target = [IO.Path]::GetFullPath([string]$item.Target)
            if (-not $target.Equals([IO.Path]::GetFullPath($VerifiedJunctions[$item.FullName]), [StringComparison]::OrdinalIgnoreCase)) { throw "Verified junction target changed: $($item.FullName)" }
            $junction = $true
        }
        $items.Add(@{path=$item.FullName;identity=[ArtifactRemovalNative]::Identity($item.FullName);attributes=[int]$attributes;junction=$junction;target=if ($junction) {$target} else {$null};directory=$item.PSIsContainer})
        if ($junction) { continue }
        if (-not $item.PSIsContainer -and ($attributes -band ([IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::ReadOnly))) {
            if (-not $OwnershipVerified) { throw "Generated ownership and protection must be verified before attribute normalization: $($item.FullName)" }
            Assert-ArtifactRemovalHardlinks $item.FullName $GroupPaths
        }
        if ($item.PSIsContainer) { foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop) { $pending.Push($child) } }
    }
    $items.ToArray()
}
function New-ArtifactRemovalContext {
    param([string[]]$GroupPaths, [bool]$OwnershipVerified, [Collections.IDictionary]$VerifiedJunctions = @{})
    $snapshot = @(Get-ArtifactRemovalSnapshot -GroupPaths $GroupPaths -OwnershipVerified $OwnershipVerified -VerifiedJunctions $VerifiedJunctions)
    $roots = @{}
    foreach ($root in $GroupPaths) {
        $full = [IO.Path]::GetFullPath($root)
        $entry = $snapshot | Where-Object path -EQ $full | Select-Object -First 1
        if ($entry) { $roots[$full] = ($entry.identity.Split(':')[0..2] -join ':') }
    }
    [pscustomobject]@{PSTypeName='ArtifactRemovalContext';GroupPaths=$GroupPaths;OwnershipVerified=$OwnershipVerified;VerifiedJunctions=$VerifiedJunctions;Roots=$roots}
}
function Assert-ArtifactRemovalContext($Context, [string]$Path) {
    if ($Context.PSObject.TypeNames -notcontains 'ArtifactRemovalContext' -or -not $Context.Roots.ContainsKey([IO.Path]::GetFullPath($Path))) { throw 'Removal path has no group preflight context.' }
    foreach ($root in $Context.Roots.Keys) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        Assert-ArtifactRemovalAncestors $root
        if (([ArtifactRemovalNative]::Identity($root).Split(':')[0..2] -join ':') -cne $Context.Roots[$root]) { throw "Deletion group root identity changed: $root" }
    }
}
function Set-ArtifactRemovalAttributes {
    param([string]$Path, [Collections.Generic.List[object]]$Audit, [bool]$OwnershipVerified,
        [string[]]$GroupPaths = @($Path), [Collections.IDictionary]$VerifiedJunctions = @{},
        $RemovalContext, [switch]$PassThru)
    if (-not [OperatingSystem]::IsWindows()) { return }
    $mask = [IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::ReadOnly
    # GroupPaths is an authority boundary: callers verify all selected roots belong exclusively
    # to this deletion group, with current ownership/protection and references checked.
    if (-not @($GroupPaths | Where-Object { [IO.Path]::GetFullPath($_) -ieq [IO.Path]::GetFullPath($Path) }).Count) { throw 'Removal path is not a selected group root.' }
    if ($RemovalContext) {
        Assert-ArtifactRemovalContext $RemovalContext $Path
        $GroupPaths = $RemovalContext.GroupPaths; $OwnershipVerified = $RemovalContext.OwnershipVerified; $VerifiedJunctions = $RemovalContext.VerifiedJunctions
        $items = @(Get-ArtifactRemovalSnapshot -GroupPaths $GroupPaths -OwnershipVerified $OwnershipVerified -VerifiedJunctions $VerifiedJunctions -InspectionPaths @($Path))
    } else { $items = @(Get-ArtifactRemovalSnapshot -GroupPaths $GroupPaths -OwnershipVerified $OwnershipVerified -VerifiedJunctions $VerifiedJunctions) }
    $normalized = @{}
    foreach ($item in $items) {
        if (-not ($item.attributes -band $mask) -or -not (Test-ArtifactRemovalContained $item.path $Path) -or $item.junction) { continue }
        Assert-ArtifactRemovalAncestors ([IO.Path]::GetDirectoryName($item.path))
        $current = Get-Item -LiteralPath $item.path -Force -ErrorAction Stop
        $currentAttributes = [ArtifactRemovalNative]::Attributes($item.path)
        $expectedAttributes = if ($normalized.ContainsKey($item.identity)) { $item.attributes -band (-bnot $mask) } else { $item.attributes }
        if ($expectedAttributes -eq 0) { $expectedAttributes = [int][IO.FileAttributes]::Normal }
        $currentIdentity = [ArtifactRemovalNative]::Identity($item.path)
        if ($currentIdentity -cne $item.identity -or [int]$currentAttributes -ne $expectedAttributes) { throw "Removal path changed: $($item.path) (identity $($item.identity) -> $currentIdentity; attributes $expectedAttributes -> $currentAttributes)" }
        if (-not ($currentAttributes -band $mask)) { continue }
        if (-not $OwnershipVerified) { throw "Generated ownership and protection must be verified before attribute normalization: $($current.FullName)" }
        if (-not $current.PSIsContainer) { Assert-ArtifactRemovalHardlinks $item.path $GroupPaths }
        $change = [ordered]@{path=$current.FullName;before=[int]$currentAttributes;after=$null;status='selected'}
        $Audit.Add($change)
        try {
            [IO.File]::SetAttributes($current.FullName, [IO.FileAttributes]($currentAttributes -band (-bnot $mask)))
            $change.after = [int][ArtifactRemovalNative]::Attributes($current.FullName)
            if ($change.after -band $mask) { throw "Hidden/ReadOnly attributes remain: $($current.FullName)" }
            $change.status = 'normalized'
            $normalized[$item.identity] = $true
        } catch { $change.status='failed';$change.reason=$_.Exception.Message;throw }
    }
    if ($PassThru) { $items }
}
function Remove-ArtifactLifecycleMember {
    param([string]$Path, [Collections.Generic.List[object]]$Audit, [bool]$OwnershipVerified,
        [string[]]$GroupPaths = @($Path), [Collections.IDictionary]$VerifiedJunctions = @{}, $RemovalContext)
    if ([OperatingSystem]::IsWindows()) {
        Initialize-ArtifactWindowsIdentity
        Assert-ArtifactRemovalAncestors $Path
        $rootIdentity = [ArtifactRemovalNative]::Identity($Path)
        if (-not $RemovalContext) { $RemovalContext = New-ArtifactRemovalContext -GroupPaths $GroupPaths -OwnershipVerified $OwnershipVerified -VerifiedJunctions $VerifiedJunctions }
        $items = @(Set-ArtifactRemovalAttributes -Path $Path -Audit $Audit -OwnershipVerified $OwnershipVerified -GroupPaths $GroupPaths -VerifiedJunctions $VerifiedJunctions -RemovalContext $RemovalContext -PassThru)
        $OwnershipVerified = $RemovalContext.OwnershipVerified
        foreach ($link in @($items | Where-Object junction)) {
            Assert-ArtifactRemovalAncestors ([IO.Path]::GetDirectoryName($link.path))
            $current = Get-Item -LiteralPath $link.path -Force -ErrorAction Stop
            if ($current.LinkType -ne 'Junction' -or [ArtifactRemovalNative]::Identity($link.path) -cne $link.identity -or -not ([IO.Path]::GetFullPath([string]$current.Target)).Equals($link.target, [StringComparison]::OrdinalIgnoreCase) -or [int][ArtifactRemovalNative]::Attributes($link.path) -ne $link.attributes) { throw "Verified junction changed before removal: $($link.path)" }
            $change = [ordered]@{path=$link.path;target=$link.target;status='selected';operation='remove-junction-link'}
            $Audit.Add($change)
            try {
                Remove-Item -LiteralPath $link.path -ErrorAction Stop
                if (Test-Path -LiteralPath $link.path) { throw "Junction remains: $($link.path)" }
                $change.status='deleted'
            } catch { $change.status='failed';$change.reason=$_.Exception.Message;throw }
        }
        # Rescan without an allowlist: recursion is permitted only after every link is absent.
        $null = Get-ArtifactRemovalSnapshot -GroupPaths @($Path) -OwnershipVerified $OwnershipVerified
        if ([ArtifactRemovalNative]::Identity($Path) -cne $rootIdentity) { throw "Removal root identity changed: $Path" }
    }
    Remove-Item -LiteralPath $Path -Recurse -ErrorAction Stop
}
function Invoke-ArtifactLifecycleCleanup {
    param([string]$ProjectRoot, [Alias('Candidate')][string]$CandidatePath, [string[]]$ProtectedPaths = @(), [string]$ReportPath,
        [bool]$Apply, [scriptblock]$CheckMember, [scriptblock]$BeforeDelete, [scriptblock]$RemoveMember,
        [Collections.IDictionary]$VerifiedJunctions = @{})
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
    $catalogLock = $null
    try {
    # Match Node's create-exclusive catalog lock. Never bypass an occupied lock.
    $catalogLock = [IO.File]::Open((Join-Path $ProjectRoot 'artifacts/maintenance/lifecycles/catalog.lock'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $removalContexts = @{}
    if (-not $RemoveMember -and [OperatingSystem]::IsWindows()) {
        foreach ($group in $plan.groups) {
            $owned = @($group.members | Where-Object { $_.generated -ne $true -or $_.protection_known -ne $true }).Count -eq 0
            $removalContexts[$group.id] = New-ArtifactRemovalContext -GroupPaths @($group.members.path) -OwnershipVerified $owned -VerifiedJunctions $VerifiedJunctions
        }
    }
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
                else {
                    $member.attributes = [Collections.Generic.List[object]]::new()
                    $ownerGroups = @($freshPlan.groups | Where-Object { @($_.members | Where-Object path -CEQ $member.path).Count })
                    if ($ownerGroups.Count -ne 1) { throw 'Deletion member does not belong exclusively to one group.' }
                    $owners = @($ownerGroups[0].members)
                    foreach ($owner in $owners) {
                        # Earlier members are already absent after successful removal. Only
                        # live members need filesystem checks; registry guards still cover all.
                        if (Test-Path -LiteralPath $owner.path) {
                            $reason = & $CheckMember $owner.path
                            if ($reason) { throw $reason }
                        }
                        if (@($freshPlan.groups | Where-Object { @($_.members | Where-Object path -CEQ $owner.path).Count }).Count -ne 1) { throw 'Deletion group member has shared ownership.' }
                    }
                    $ownershipVerified = @($owners | Where-Object { $_.generated -ne $true -or $_.protection_known -ne $true }).Count -eq 0
                    $context = $removalContexts[$ownerGroups[0].id]
                    if ($context -and $context.OwnershipVerified -ne $ownershipVerified) { throw 'Deletion group ownership changed after preflight.' }
                    Remove-ArtifactLifecycleMember -Path $member.path -Audit $member.attributes -OwnershipVerified $ownershipVerified -GroupPaths @($owners.path) -VerifiedJunctions $VerifiedJunctions -RemovalContext $context
                }
            }
            if (Test-Path -LiteralPath $member.path) { throw "Lifecycle member remains: $($member.path)" }
            $member.status='deleted'
        } catch { $member.status='failed';$member.reason=$_.Exception.Message;$result.status='partial';$result.reason=$_.Exception.Message;break }
    }
    } catch { $result.status='blocked';$result.reason=$_.Exception.Message;return $result }
    finally {
        if ($catalogLock) {
            $catalogLock.Dispose()
            Remove-Item -LiteralPath (Join-Path $ProjectRoot 'artifacts/maintenance/lifecycles/catalog.lock') -ErrorAction Stop
        }
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
