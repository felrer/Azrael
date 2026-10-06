#requires -Version 7.0
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'build-module-cache.ps1')
$fixture=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('../artifacts/verification/module-cache-'+[guid]::NewGuid().ToString('N'))))
New-Item -ItemType Directory $fixture -Force|Out-Null
function Assert($Condition,$Message){if(-not $Condition){throw $Message}}
# No real processes are terminated or simulated as idle for actual cleanup.
$script:running=@()
function Get-CimInstance {param($ClassName,$ErrorAction) $script:running}
$cache=$null
try{
 $source=Join-Path $fixture 'source';New-Item -ItemType Directory $source|Out-Null;Set-Content (Join-Path $source 'code.ts') 'one'
 $cache=Open-BuildModuleCache $fixture
 try{Open-BuildModuleCache $fixture|Out-Null;throw 'Missing lock failure'}catch{Assert ($_.Exception.Message -match 'Another modular') 'Concurrent build must fail closed'}
 $a=Get-BuildModuleEntry $cache companion @($source) @('node1');Assert (-not $a.Hit) 'First build must miss'
 Set-Content (Join-Path $a.Path 'output.txt') 'compiled';Save-BuildModuleEntry $a @('output.txt')
 $b=Get-BuildModuleEntry $cache companion @($source) @('node1');Assert $b.Hit 'Identical input must hit'
 Set-Content (Join-Path $b.Path 'output.txt') 'damaged';$b=Get-BuildModuleEntry $cache companion @($source) @('node1');Assert (-not $b.Hit) 'Damaged output must miss'
 Set-Content (Join-Path $b.Path 'output.txt') 'compiled';Save-BuildModuleEntry $b @('output.txt')
 Set-Content (Join-Path $source 'code.ts') 'two';$c=Get-BuildModuleEntry $cache companion @($source) @('node1');Assert ($c.Key -ne $b.Key -and -not $c.Hit) 'Source change must miss'
 Set-Content (Join-Path $c.Path 'output.txt') 'compiled2';Save-BuildModuleEntry $c @('output.txt')
 $d=Get-BuildModuleEntry $cache companion @($source) @('node2');Assert (-not $d.Hit -and $d.Key -ne $c.Key) 'Tool version must invalidate'
 Set-Content (Join-Path $d.Path 'output.txt') 'compiled3';Save-BuildModuleEntry $d @('output.txt')
 $cache.Entries=@($d)
 $script:running=@([pscustomobject]@{Name='node.exe';CommandLine="node $($b.Path)/test.js"})
 $r=@(Remove-OldBuildModuleCaches $cache -Keep 1 -ProtectedPaths @($c.Path));Assert (Test-Path $b.Path) 'Running cache preserved';Assert (Test-Path $c.Path) 'Pinned cache preserved'
 $script:running=@();$r=@(Remove-OldBuildModuleCaches $cache -Keep 1);Assert (-not(Test-Path $b.Path)) 'Obsolete owned cache removed';Assert (Test-Path $d.Path) 'Current cache preserved'
 $forced=Get-BuildModuleEntry $cache companion @($source) @('node2') -Force;Assert (-not $forced.Hit) 'Explicit rebuild must miss'
 Set-Content (Join-Path $forced.Path 'output.txt') 'compiled4';Set-Content (Join-Path $source 'code.ts') 'changed while building'
 try{Save-BuildModuleEntry $forced @('output.txt');throw 'Missing source race failure'}catch{Assert ($_.Exception.Message -match 'inputs changed') 'Failed/raced build must not commit'}
 $outside=Join-Path $fixture 'external';New-Item -ItemType Directory $outside|Out-Null;Set-Content (Join-Path $outside 'keep.txt') 'keep'
 try{Assert-BuildCachePath $outside $cache.Root|Out-Null;throw 'Missing escape failure'}catch{Assert ($_.Exception.Message -match 'escapes root') 'Escape must be rejected'}
 $linked=Join-Path $cache.Root 'companion/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
 New-Item -ItemType Junction -Path $linked -Target $outside|Out-Null
 $r=@(Remove-OldBuildModuleCaches $cache -Keep 1);Assert (Test-Path (Join-Path $outside 'keep.txt')) 'Junction target preserved';Remove-Item -LiteralPath $linked -Force
 $legacy=Join-Path $fixture 'artifacts/build/old/companion';New-Item -ItemType Directory $legacy -Force|Out-Null
 @{publisher='azrael-ex-local';name='azrael'}|ConvertTo-Json|Set-Content (Join-Path $legacy 'package.json')
 $new=Join-Path $fixture 'artifacts/build/new/companion';New-Item -ItemType Directory $new -Force|Out-Null
 @{publisher='azrael-ex-local';name='azrael'}|ConvertTo-Json|Set-Content (Join-Path $new 'package.json')
 (Get-Item (Split-Path $legacy)).LastWriteTimeUtc=[DateTime]::UtcNow.AddDays(-3)
 $r=@(Remove-OldBuildStaging $cache -Keep 1 -ProtectedPaths @($legacy));Assert (Test-Path $legacy) 'Legacy protected tool path preserved'
 $r=@(Remove-OldBuildStaging $cache -Keep 1);Assert (-not(Test-Path $legacy)) 'Old known staging removed';Assert (Test-Path $new) 'Newest staging preserved'
 $cache.Lease.Dispose();$cache.Lease=$null
 $readLease=[IO.File]::Open((Join-Path $cache.Root '.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 try{
   try{Open-BuildModuleCache $fixture|Out-Null;throw 'Missing preparation lease failure'}catch{Assert ($_.Exception.Message -match 'Another modular') 'Preparation reader must block collection/build writer'}
 }finally{$readLease.Dispose()}
 $cache=Open-BuildModuleCache $fixture
 Write-Output 'Module cache: reuse, corruption, source/tool changes, force, leases, retention, runtime/pins, race, links, path boundary and legacy staging passed; exit=0'
}finally{if($cache -and $cache.Lease){$cache.Lease.Dispose()};Assert-BuildCachePath $fixture ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../artifacts/verification')))|Out-Null;Remove-Item -LiteralPath $fixture -Recurse -Force}
