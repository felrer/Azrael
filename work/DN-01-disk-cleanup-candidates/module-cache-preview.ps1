#requires -Version 7.0
param([Parameter(Mandatory)][string]$ProjectRoot)
$ErrorActionPreference='Stop'
. (Join-Path $ProjectRoot 'scripts/build-module-cache.ps1')
$cache=$null
try {
    $cache=Open-BuildModuleCache $ProjectRoot $ProjectRoot
    $protected=@(Get-ProtectedBuildCachePaths $cache)
    $rows=@(Remove-OldBuildModuleCaches $cache -Keep 0 -ProtectedPaths $protected -Preview)
    @{status='preview';candidates=$rows;errors=@()}|ConvertTo-Json -Depth 14
} catch {
    @{status='blocked';candidates=@();errors=@($_.Exception.Message)}|ConvertTo-Json -Depth 6
    exit 1
} finally {if($cache){$cache.Lease.Dispose()}}
