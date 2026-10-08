#requires -Version 7.0
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'build-module-cache.ps1')
$fixture=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('../artifacts/verification/module-cache-'+[guid]::NewGuid().ToString('N'))))
New-Item -ItemType Directory $fixture -Force|Out-Null
function Assert($Condition,$Message){if(-not $Condition){throw $Message}}
# No real processes are terminated or simulated as idle for actual cleanup.
$script:running=@()
$script:inspectionFails=$false
function Get-CimInstance {param($ClassName,$ErrorAction) if($script:inspectionFails){throw 'fixture process inspection unavailable'};$script:running}
$cache=$null
try{
 $source=Join-Path $fixture 'source';New-Item -ItemType Directory $source|Out-Null;Set-Content (Join-Path $source 'code.ts') 'one'
 $cache=Open-BuildModuleCache $fixture
 $cache.SkipCleanup=$true
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
 # Automatic collection happens only after publication, and only for that module.
 $provider=Get-BuildModuleEntry $cache providers @($source) @('provider-old')
 Set-Content (Join-Path $provider.Path 'output.txt') 'provider';Save-BuildModuleEntry $provider @('output.txt')
 $old=Get-BuildModuleEntry $cache companion @($source) @('auto-old')
 Set-Content (Join-Path $old.Path 'output.txt') 'old';Save-BuildModuleEntry $old @('output.txt')
 $cache.SkipCleanup=$false
 $next=Get-BuildModuleEntry $cache companion @($source) @('auto-next')
 Assert (Test-Path $old.Path) 'Prior successful cache must survive before publication'
 try{Save-BuildModuleEntry $next @('missing.txt');throw 'Expected output failure'}catch{Assert ($_.Exception.Message -match 'Missing module output') 'Missing output must reject publication'}
 Assert (Test-Path $old.Path) 'Failed publication must preserve prior cache'
 Set-Content (Join-Path $next.Path 'output.txt') 'next';Save-BuildModuleEntry $next @('output.txt')
 Assert (Test-Path (Join-Path $next.Path 'cache.json')) 'Replacement receipt published'
 Assert (-not(Test-Path $old.Path)) 'Default automatic prune removes prior selected cache immediately'
 Assert (Test-Path $provider.Path) 'Publication collects only the published module'
 $cache.Keep=2
 $retained=Get-BuildModuleEntry $cache companion @($source) @('auto-retained')
 Set-Content (Join-Path $retained.Path 'output.txt') 'retained';Save-BuildModuleEntry $retained @('output.txt')
 Assert (Test-Path $next.Path) 'Explicit retention remains effective'
 $cache.Keep=0
 $script:running=@([pscustomobject]@{Name='rustc.exe';CommandLine='rustc fixture'})
 $compiler=Get-BuildModuleEntry $cache companion @($source) @('auto-compiler')
 Set-Content (Join-Path $compiler.Path 'output.txt') 'compiler';Save-BuildModuleEntry $compiler @('output.txt')
 Assert (Test-Path $retained.Path) 'Active compiler preserves prior cache'
 $script:running=@();$script:inspectionFails=$true
 $uncertain=Get-BuildModuleEntry $cache companion @($source) @('auto-uncertain')
 Set-Content (Join-Path $uncertain.Path 'output.txt') 'uncertain';Save-BuildModuleEntry $uncertain @('output.txt')
 Assert (Test-Path $compiler.Path) 'Uncertain process state fails closed'
 Assert (@($cache.CleanupResults|Where-Object reason -Match 'Process inspection failed').Count -gt 0) 'Uncertainty reported'
 $script:inspectionFails=$false
 # Installed current and previous tool references are protected during publication.
 foreach($pin in @($retained,$compiler)){
   $deployment=Join-Path $fixture ('artifacts/deployments/'+$pin.Key)
   $package=Join-Path $deployment 'package';$release=Join-Path $deployment 'release'
   New-Item -ItemType Directory $package,$release -Force|Out-Null
   @{hostInstalled=$true;generatedAt=[DateTime]::UtcNow.ToString('o');packageDirectory=$package;releaseDirectory=$release}|ConvertTo-Json|Set-Content (Join-Path $deployment 'deployment.json')
   @{toolDirectory=(Join-Path $pin.Path 'tool')}|ConvertTo-Json|Set-Content (Join-Path $package 'preparation-inputs.json')
   @{moduleBuild=@{typeScriptPath=(Join-Path $pin.Path 'typescript.js')}}|ConvertTo-Json|Set-Content (Join-Path $release 'build-info.json')
 }
 $pinned=Get-BuildModuleEntry $cache companion @($source) @('auto-pinned')
 Set-Content (Join-Path $pinned.Path 'output.txt') 'pinned';Save-BuildModuleEntry $pinned @('output.txt')
 Assert ((Test-Path $retained.Path) -and (Test-Path $compiler.Path)) 'Current and previous installed references preserved'
 $receiptPath=Join-Path $deployment 'deployment.json'
 $validReceipt=Get-Content $receiptPath -Raw
 Set-Content $receiptPath '{invalid'
 $receiptUncertain=Get-BuildModuleEntry $cache companion @($source) @('receipt-uncertain')
 Set-Content (Join-Path $receiptUncertain.Path 'output.txt') 'receipt';Save-BuildModuleEntry $receiptUncertain @('output.txt')
 Assert (Test-Path $pinned.Path) 'Unreadable installed receipts preserve previous cache'
 Assert (@($cache.CleanupResults|Where-Object {$_.status -eq 'preserved' -and $_.reason -match 'JSON'}).Count -gt 0) 'Installed receipt uncertainty reported'
 Set-Content $receiptPath $validReceipt
 $cache.SkipCleanup=$true
 $optout=Get-BuildModuleEntry $cache companion @($source) @('optout')
 Set-Content (Join-Path $optout.Path 'output.txt') 'optout';Save-BuildModuleEntry $optout @('output.txt')
 Assert (Test-Path $receiptUncertain.Path) 'Cleanup opt-out preserves old cache after successful publication'
 # A linked descendant must prevent recursive deletion, not just a linked root.
 $cache.SkipCleanup=$true
 $nested=Get-BuildModuleEntry $cache companion @($source) @('nested-link')
 New-Item -ItemType Junction -Path (Join-Path $nested.Path 'linked') -Target $outside|Out-Null
 $cache.Entries=@($pinned,$provider)
 $r=@(Remove-OldBuildModuleCaches $cache -ProtectedPaths @(Get-ProtectedBuildCachePaths $cache))
 Assert (Test-Path (Join-Path $outside 'keep.txt')) 'Nested junction target preserved'
 Assert (@($r|Where-Object reason -Match 'Linked cache content').Count -gt 0) 'Nested link guard reported'
 Remove-Item -LiteralPath (Join-Path $nested.Path 'linked') -Force
 $unknown=Join-Path $cache.Root ('companion/'+('b'*64))
 New-Item -ItemType Directory $unknown -Force|Out-Null
 @{schema=7;module='foreign';key=('b'*64)}|ConvertTo-Json|Set-Content (Join-Path $unknown 'owner.json')
 $r=@(Remove-OldBuildModuleCaches $cache)
 Assert (Test-Path $unknown) 'Unknown cache ownership fails closed'
 Assert (@($r|Where-Object reason -Match 'Unknown cache owner').Count -gt 0) 'Unknown owner reason reported'
 # Historical provider-only stages lose dependencies while source and provenance remain.
 $providerLegacy=Join-Path $fixture 'artifacts/build/provider-only/opencodex'
 New-Item -ItemType Directory (Join-Path $providerLegacy 'node_modules') -Force|Out-Null
 @{name='@bitkyc08/opencodex'}|ConvertTo-Json|Set-Content (Join-Path $providerLegacy 'package.json')
 Set-Content (Join-Path $providerLegacy 'UPSTREAM.md') 'provenance';Set-Content (Join-Path $providerLegacy 'helper.ts') 'source'
 $script:running=@([pscustomobject]@{Name='bun.exe';CommandLine="bun $providerLegacy/helper.ts"})
 $r=@(Remove-OldBuildStaging $cache)
 Assert (Test-Path (Join-Path $providerLegacy 'node_modules')) 'Running legacy provider preserved'
 $script:running=@();$r=@(Remove-OldBuildStaging $cache -ProtectedPaths @($providerLegacy))
 Assert (Test-Path (Join-Path $providerLegacy 'node_modules')) 'Pinned legacy provider preserved'
 $cache.SkipCleanup=$false
 $cache.LogDirectory=Join-Path $fixture 'publication-logs'
 New-Item -ItemType Directory $cache.LogDirectory -Force|Out-Null
 $publication=Get-BuildModuleEntry $cache providers @($source) @('legacy-publication')
 Set-Content (Join-Path $publication.Path 'output.txt') 'published provider'
 Save-BuildModuleEntry $publication @('output.txt')
 Assert (-not(Test-Path (Join-Path $providerLegacy 'node_modules'))) 'Provider-only dependencies collected immediately upon publication before build completion'
 Assert (@($cache.StagingCleanupResults|Where-Object {$_.path -eq (Join-Path $providerLegacy 'node_modules') -and $_.status -eq 'removed'}).Count -gt 0) 'Publication staging cleanup receipt retained'
 Assert ((Test-Path (Join-Path $providerLegacy 'UPSTREAM.md')) -and (Test-Path (Join-Path $providerLegacy 'helper.ts'))) 'Provider source and provenance preserved'
 Save-BuildModuleEntry $publication @('output.txt')
 $stagingReceipt=@(Get-Content (Join-Path $cache.LogDirectory 'legacy-cache-cleanup.json') -Raw|ConvertFrom-Json)
 Assert (@($stagingReceipt|Where-Object {$_.path -eq (Join-Path $providerLegacy 'node_modules') -and $_.status -eq 'removed'}).Count -eq 1) 'Later cleanup preserves earlier staging receipt'
 $cache.Lease.Dispose();$cache.Lease=$null
 $readLease=[IO.File]::Open((Join-Path $cache.Root '.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 try{
   try{Open-BuildModuleCache $fixture|Out-Null;throw 'Missing preparation lease failure'}catch{Assert ($_.Exception.Message -match 'Another modular') 'Preparation reader must block collection/build writer'}
 }finally{$readLease.Dispose()}
 $cache=Open-BuildModuleCache $fixture
 Write-Output 'Module cache: reuse, corruption, source/tool changes, force, leases, publication-before-prune, failed publication, module isolation, retention, runtime/installed pins/compiler, uncertainty, race, nested links, path boundary and provider-only legacy staging passed; exit=0'
}finally{if($cache -and $cache.Lease){$cache.Lease.Dispose()};Assert-BuildCachePath $fixture ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../artifacts/verification')))|Out-Null;Remove-Item -LiteralPath $fixture -Recurse -Force}
