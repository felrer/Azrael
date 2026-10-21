#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CacheProjectRoot,
    [ValidateSet('inspect','retire','inspect-legacy','retire-legacy')][string]$Action='inspect',
    [string]$Project,
    [string]$EvidencePath,
    [string]$EvidenceSha256,
    [switch]$Apply
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'build-module-cache.ps1')
if(-not [IO.Path]::IsPathFullyQualified($CacheProjectRoot)){throw 'CacheProjectRoot must be fully qualified'}
$owner=Assert-BuildCachePath $CacheProjectRoot $CacheProjectRoot
$root=Assert-BuildCachePath (Join-Path $owner 'artifacts/cache/modules') $owner
if(-not(Test-Path -LiteralPath $root -PathType Container)){throw 'Existing module cache required'}
if($Action -in @('inspect','inspect-legacy') -and $Apply){throw 'Apply requires retire or retire-legacy'}
if($Action -in @('inspect-legacy','retire-legacy') -and -not $Project){throw 'Legacy retirement requires exact Project'}
$lease=[IO.File]::Open((Join-Path $root '.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$cache=@{Root=$root;Owner=$owner;Project=$owner;Lease=$lease}
try {
    if($Action -in @('retire','retire-legacy')){
        if(-not $Project -or -not $EvidencePath -or -not $EvidenceSha256){throw 'Retire requires exact Project, EvidencePath and EvidenceSha256'}
        if($Action -eq 'retire-legacy'){Remove-BuildCacheLegacyProjectRegistration $cache $Project $EvidencePath $EvidenceSha256 -Apply:$Apply|ConvertTo-Json -Depth 12}
        else{Remove-BuildCacheProjectRegistration $cache $Project $EvidencePath $EvidenceSha256 -Apply:$Apply|ConvertTo-Json -Depth 12}
    }else{
        $projects=if($Project){@($Project)}else{@(Get-BuildCacheProjects $cache)}
        @(foreach($item in $projects){if($Action -eq 'inspect-legacy'){Get-BuildCacheLegacyProjectInspection $cache $item}else{Get-BuildCacheProjectInspection $cache $item}})|ConvertTo-Json -Depth 12
    }
}finally{$lease.Dispose()}
