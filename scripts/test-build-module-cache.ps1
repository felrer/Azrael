#requires -Version 7.0
param([switch]$RecipeOnly,[switch]$CleanupOnly)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'build-module-cache.ps1')
$fixture=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('../artifacts/verification/module-cache-'+[guid]::NewGuid().ToString('N'))))
$fixtureLifecycle='run:module-cache-test:'+ [IO.Path]::GetFileName($fixture)
$testProject=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$null=Register-ArtifactLifecycle -ProjectRoot $testProject -Id $fixtureLifecycle -Kind run -Owner 'module-cache-tests' -State pending -MembershipComplete $false -Members @{fixture=$fixture}
New-Item -ItemType Directory $fixture -Force|Out-Null
function Assert($Condition,$Message){if(-not $Condition){throw $Message}}
# No real processes are terminated or simulated as idle for actual cleanup.
$script:running=@()
$script:inspectionFails=$false
function Get-CimInstance {param($ClassName,$ErrorAction) if($script:inspectionFails){throw 'fixture process inspection unavailable'};$script:running}
$cache=$null
try{
 $source=Join-Path $fixture 'source';New-Item -ItemType Directory $source|Out-Null;Set-Content (Join-Path $source 'code.ts') 'one'
 # Module recipes select only their own implementation and common helpers.
 $runner=Join-Path $fixture 'runner.ps1';$recipe=Join-Path $fixture 'recipe.ps1';$common=Join-Path $fixture 'common.ps1'
 Copy-Item (Join-Path $PSScriptRoot 'build-azrael.ps1') $runner;Copy-Item (Join-Path $PSScriptRoot 'build-module-companion-recipe.ps1') $recipe;Copy-Item (Join-Path $PSScriptRoot 'build-module-cache.ps1') $common
 $ast=[System.Management.Automation.Language.Parser]::ParseFile($runner,[ref]$null,[ref]$null)
 $inputAssignment=$ast.Find({param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$moduleInputs'},$true)
 Assert ($inputAssignment -and $inputAssignment.Right.Extent.Text -notmatch 'build-azrael.ps1') 'Runner must not be a common module input'
 $recipeKey=Get-BuildModuleKey @($source,$recipe,$common)
 Set-Content $runner 'engine recipe two'
 Assert ((Get-BuildModuleKey @($source,$recipe,$common)) -ceq $recipeKey) 'Unrelated engine runner changes retain module identity'
 Set-Content $recipe 'changed companion recipe'
 Assert ((Get-BuildModuleKey @($source,$recipe,$common)) -cne $recipeKey) 'Selected recipe change invalidates'
 $recipeKey=Get-BuildModuleKey @($source,$recipe,$common);Set-Content $common 'changed helper'
 Assert ((Get-BuildModuleKey @($source,$recipe,$common)) -cne $recipeKey) 'Common helper change invalidates'
 # Excluded generated subtrees do not affect source identity, at any depth.
 $sourceKey=Get-BuildModuleKey @($source) @('excluded-guard')
 $excludedRoot=Join-Path $source 'nested-generated'
 foreach($name in @('node_modules','dist','target','.git','artifacts')){
   $directory=Join-Path $excludedRoot $name;New-Item -ItemType Directory $directory -Force|Out-Null
   Set-Content (Join-Path $directory 'generated.txt') 'ignored-one'
 }
 Assert ((Get-BuildModuleKey @($source) @('excluded-guard')) -ceq $sourceKey) 'Excluded subtrees must not contribute source records'
 foreach($name in @('node_modules','dist','target','.git','artifacts')){Set-Content (Join-Path (Join-Path $excludedRoot $name) 'generated.txt') 'ignored-two'}
 Assert ((Get-BuildModuleKey @($source) @('excluded-guard')) -ceq $sourceKey) 'Excluded subtree byte changes must retain the source key'
 Remove-Item -LiteralPath $excludedRoot -Recurse -ErrorAction Stop
 # A selected regular file named like an excluded directory remains source.
 $selectedLeaf=Join-Path $source 'target';Set-Content $selectedLeaf 'selected-one'
 $leafKey=Get-BuildModuleKey @($source) @('excluded-guard')
 Assert ($leafKey -cne $sourceKey) 'Excluded names apply to directories, not selected regular files'
 Set-Content $selectedLeaf 'selected-two'
 Assert ((Get-BuildModuleKey @($source) @('excluded-guard')) -cne $leafKey) 'Selected regular leaf changes must invalidate the key'
 Remove-Item -LiteralPath $selectedLeaf -ErrorAction Stop
 $cache=Open-BuildModuleCache $fixture
 function Test-CompanionProductionRecipe {
  . (Join-Path $PSScriptRoot 'build-metrics.ps1')
  . (Join-Path $PSScriptRoot 'build-module-companion-recipe.ps1')
  $projectRoot=$fixture
  $recipeSource=Join-Path $projectRoot 'extensions/azrael-ex'
  New-Item -ItemType Directory $recipeSource -Force|Out-Null;Set-Content (Join-Path $recipeSource 'source.ts') 'fixture'
  $companionCache=Get-BuildModuleEntry $cache companion @($recipeSource) @('production-recipe')
  $script:buildMetrics=New-BuildMetrics (Join-Path $fixture 'recipe-metrics.json')
  $phase=Start-BuildStage $buildMetrics 'companion-staging'
  $script:recipeFail=$false
  function robocopy.exe {param([Parameter(ValueFromRemainingArguments)]$Arguments) Copy-Item (Join-Path $Arguments[0] 'source.ts') $Arguments[1];$global:LASTEXITCODE=1;'copied'}
  function npm.cmd {
   param([Parameter(ValueFromRemainingArguments)]$Arguments)
   if($script:recipeFail){$global:LASTEXITCODE=9;'fixture npm failed';return}
   if($Arguments[0] -eq 'ci'){New-Item -ItemType Directory 'node_modules' -Force|Out-Null;Set-Content 'node_modules/tool.js' 'tool'}
   else{New-Item -ItemType Directory 'dist' -Force|Out-Null;Set-Content 'dist/code.js' 'compiled';Set-Content $Arguments[-1] 'vsix'}
   $global:LASTEXITCODE=0;'npm fixture success'
  }
  $beforeLocation=(Get-Location).Path;$beforeEnvironment=$env:AZRAEL_PLATFORM_RUNTIME_SOURCE
  . Invoke-BuildModuleCompanionRecipe
  Assert ($CompanionVsixPath -eq (Join-Path $companionCache.Path 'azrael-ex.vsix') -and $companionBuild -eq (Join-Path $companionCache.Path 'companion')) 'Dot-invoked recipe retains caller outputs'
  Assert ((Get-Location).Path -eq $beforeLocation -and $env:AZRAEL_PLATFORM_RUNTIME_SOURCE -eq $beforeEnvironment) 'Recipe restores cwd and environment'
  Assert (Get-BuildModuleEntry $cache companion @($recipeSource) @('production-recipe')).Hit 'Actual production recipe publication is reusable'
  $metrics=Get-Content (Join-Path $fixture 'recipe-metrics.json') -Raw|ConvertFrom-Json
  $commands=@($metrics.stages|Where-Object name -Like 'command:*')
  Assert ($commands.Count -eq 3) 'Production recipe emits all command metrics'
  foreach($command in $commands){Assert ($command.logPath.StartsWith($companionCache.LogDirectory,[StringComparison]::OrdinalIgnoreCase)) 'Raw command logs belong to entry';Assert (Test-Path $command.logPath) 'Raw command log exists'}
  Assert (@($commands|Where-Object {$_.exitCode -eq 1}).Count -eq 1) 'Robocopy actual exit preserved'
  $good=$companionCache
  $companionCache=Get-BuildModuleEntry $cache companion @($recipeSource) @('production-recipe-fail')
  $phase=Start-BuildStage $buildMetrics 'failure-staging';$script:recipeFail=$true
  try{. Invoke-BuildModuleCompanionRecipe;throw 'Missing recipe failure'}catch{Assert ($_.Exception.Message -match 'exit code 9') 'Recipe preserves actual failing native exit'}
  Assert ((Get-Location).Path -eq $beforeLocation -and $env:AZRAEL_PLATFORM_RUNTIME_SOURCE -eq $beforeEnvironment) 'Failed recipe restores cwd and environment'
  Assert ((Test-Path (Join-Path $good.Path 'cache.json')) -and -not(Test-Path (Join-Path $companionCache.Path 'cache.json'))) 'Failed recipe retains last good publication'
  Assert (Test-Path (Join-Path $companionCache.LogDirectory 'npm-ci.log')) 'Failed recipe log retained'
  $metrics=Get-Content (Join-Path $fixture 'recipe-metrics.json') -Raw|ConvertFrom-Json
  Assert (@($metrics.stages|Where-Object {$_.status -eq 'failed' -and $_.exitCode -eq 9}).Count -eq 1) 'Failed native command metric preserved'
  $providerAst=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'build-module-providers-recipe.ps1'),[ref]$null,[ref]$null)
  $providerCommands=@($providerAst.FindAll({param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Invoke-BuildCommand'},$true))
  Assert ($providerCommands.Count -eq 5) 'Provider production recipe command inventory'
  foreach($command in $providerCommands){Assert (@($command.CommandElements|Where-Object {$_ -is [System.Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -eq 'LogDirectory'}).Count -eq 1) 'Provider command raw logs route to cache entry'}
 }
 function Test-ModuleDeletionOrder {
  $cache.SkipCleanup=$true
  $entry=Get-BuildModuleEntry $cache providers @($source) @('readonly-payload-order')
  $payload=Join-Path $entry.Path 'output';New-Item -ItemType Directory $payload|Out-Null
  $blockedFile=Join-Path $payload 'readonly.bin';Set-Content $blockedFile 'fixture payload'
  $log=Join-Path $entry.LogDirectory 'compile.log';Set-Content $log 'diagnostic output'
  Save-BuildModuleEntry $entry @('output')
  $originalAttributes=(Get-Item -LiteralPath $blockedFile).Attributes
  try {
   (Get-Item -LiteralPath $blockedFile).Attributes=$originalAttributes -bor [IO.FileAttributes]::ReadOnly
   $result=Remove-BuildModuleEntry $cache providers $entry.Key $entry.Path
   Assert ($result.status -eq 'partial') 'ReadOnly payload deletion reports partial failure'
   Assert ((Test-Path $blockedFile) -and (Test-Path $log) -and (Test-Path (Join-Path $entry.Path 'owner.json')) -and (Test-Path (Join-Path $entry.Path 'cache.json'))) 'Payload failure preserves raw logs and control receipts'
  } finally {
   # This test created this single-link file; restore its exact original flags
   # only after diagnosing expected failure, so ordinary fixture cleanup works.
   if(Test-Path -LiteralPath $blockedFile){Assert-BuildCachePath $blockedFile $fixture|Out-Null;(Get-Item -LiteralPath $blockedFile).Attributes=$originalAttributes}
  }
  $result=Remove-BuildModuleEntry $cache providers $entry.Key $entry.Path
  Assert ($result.status -eq 'deleted' -and -not(Test-Path $entry.Path)) 'Diagnosed payload retries remove entire entry and logs'
  $entry=Get-BuildModuleEntry $cache providers @($source) @('locked-log-order')
  $payload=Join-Path $entry.Path 'output';New-Item -ItemType Directory $payload|Out-Null;Set-Content (Join-Path $payload 'compiled') 'payload'
  $log=Join-Path $entry.LogDirectory 'compile.log';Set-Content $log 'diagnostic output';Save-BuildModuleEntry $entry @('output')
  $stream=[IO.File]::Open($log,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try {
   $result=Remove-BuildModuleEntry $cache providers $entry.Key $entry.Path
   Assert ($result.status -eq 'partial') 'Locked log deletion reports partial failure'
   Assert (-not(Test-Path $payload)) 'Payload is removed before attempting locked raw logs'
   Assert ((Test-Path $log) -and (Test-Path (Join-Path $entry.Path 'owner.json')) -and (Test-Path (Join-Path $entry.Path 'cache.json'))) 'Locked logs preserve raw logs and control receipts'
  }finally{$stream.Dispose()}
  $result=Remove-BuildModuleEntry $cache providers $entry.Key $entry.Path
  Assert ($result.status -eq 'deleted' -and -not(Test-Path $entry.Path)) 'Unlocked log retry removes whole remaining entry'
 }
 Test-ModuleDeletionOrder
 if($CleanupOnly){Write-Output 'Production module cleanup: ReadOnly payload preserves logs/receipts; locked log follows payload and preserves receipts; retries verify absence; exit=0';return}
 Test-CompanionProductionRecipe
 if($RecipeOnly){Write-Output 'Production companion recipe scope, raw logs, metrics, cache hit, failed exit and last-good retention; provider command routing passed; exit=0';return}
 $cache.SkipCleanup=$true
 try{Open-BuildModuleCache $fixture|Out-Null;throw 'Missing lock failure'}catch{Assert ($_.Exception.Message -match 'Another modular') 'Concurrent build must fail closed'}
 $a=Get-BuildModuleEntry $cache companion @($source) @('node1');Assert (-not $a.Hit) 'First build must miss'
 Set-Content (Join-Path $a.LogDirectory 'compile.log') 'raw command output'
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
 $script:running=@();$r=@(Remove-OldBuildModuleCaches $cache -Keep 1);Assert (-not(Test-Path $b.Path)) 'Obsolete owned cache removed';Assert (-not(Test-Path $b.LogDirectory)) 'Cache logs are evicted with entry';Assert (Test-Path $d.Path) 'Current cache preserved'
 $consumerId='version:fixture-consumer';$consumerPath=Join-Path $fixture 'artifacts/consumer'
 $null=Register-ArtifactLifecycle -ProjectRoot $fixture -Id $consumerId -Kind version -Owner 'fixture-consumer' -State complete -MembershipComplete $true -Members @{release=$consumerPath} -References @{$d.LifecycleId='companion-tool'}
 try{Get-BuildModuleEntry $cache companion @($source) @('node2') -Force|Out-Null;throw 'Missing reference protection'}catch{Assert ($_.Exception.Message -match 'consumer|reference') 'Forced selected entry honors lifecycle consumers'}
 Set-Content (Join-Path $d.Path 'output.txt') 'corrupt pinned output'
 try{Get-BuildModuleEntry $cache companion @($source) @('node2')|Out-Null;throw 'Missing corruption protection'}catch{Assert ($_.Exception.Message -match 'consumer|reference') 'Corrupt selected entry honors lifecycle consumers'}
 Assert (Test-Path $d.Path) 'Protected corrupt entry remains intact'
 $null=Invoke-ArtifactLifecycleNode @('finalize','--project-root',$fixture,'--id',$consumerId)
 $forced=Get-BuildModuleEntry $cache companion @($source) @('node2') -Force;Assert (-not $forced.Hit) 'Explicit rebuild must miss'
 Set-Content (Join-Path $forced.Path 'output.txt') 'compiled4';Set-Content (Join-Path $source 'code.ts') 'changed while building'
 try{Save-BuildModuleEntry $forced @('output.txt');throw 'Missing source race failure'}catch{Assert ($_.Exception.Message -match 'inputs changed') 'Failed/raced build must not commit'}
 $outside=Join-Path $fixture 'external';New-Item -ItemType Directory $outside|Out-Null;Set-Content (Join-Path $outside 'keep.txt') 'keep'
 try{Assert-BuildCachePath $outside $cache.Root|Out-Null;throw 'Missing escape failure'}catch{Assert ($_.Exception.Message -match 'escapes root') 'Escape must be rejected'}
 $linked=Join-Path $cache.Root 'companion/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
 New-Item -ItemType Junction -Path $linked -Target $outside|Out-Null
 $r=@(Remove-OldBuildModuleCaches $cache -Keep 1);Assert (Test-Path (Join-Path $outside 'keep.txt')) 'Junction target preserved';Remove-Item -LiteralPath $linked -ErrorAction Stop
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
 Remove-Item -LiteralPath (Join-Path $nested.Path 'linked') -ErrorAction Stop
 $unknown=Join-Path $cache.Root ('companion/'+('b'*64))
 New-Item -ItemType Directory $unknown -Force|Out-Null
 @{schema=7;module='foreign';key=('b'*64)}|ConvertTo-Json|Set-Content (Join-Path $unknown 'owner.json')
 $r=@(Remove-OldBuildModuleCaches $cache)
 Assert (Test-Path $unknown) 'Unknown cache ownership fails closed'
 Assert (@($r|Where-Object reason -Match 'Unknown cache owner').Count -gt 0) 'Unknown owner reason reported'
 $legacyOwned=Join-Path $cache.Root ('companion/'+('c'*64));New-Item -ItemType Directory $legacyOwned|Out-Null
 @{schema=1;module='companion';key=('c'*64)}|ConvertTo-Json|Set-Content (Join-Path $legacyOwned 'owner.json')
 $r=@(Remove-OldBuildModuleCaches $cache)
 Assert ((Test-Path $legacyOwned) -and @($r|Where-Object reason -Match 'Unregistered legacy').Count) 'Unregistered legacy entries require ownership/reference review'
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
 # Shared owner reuse is content based, while registration protects every source's installed tools.
 $sharedOwner=Join-Path $fixture 'shared-owner';$projectA=Join-Path $sharedOwner 'snapshots/a';$projectB=Join-Path $sharedOwner 'snapshots/b'
 foreach($project in @($projectA,$projectB)){
   New-Item -ItemType Directory (Join-Path $project 'source') -Force|Out-Null;Set-Content (Join-Path $project 'source/code.ts') 'shared'
   $null=Register-ArtifactLifecycle -ProjectRoot $project -Id 'run:fixture-project' -Kind run -Owner 'fixture-project' -State complete -MembershipComplete $true -Members @{evidence=(Join-Path $project 'artifacts/project-evidence')}
 }
 $legacyCache=Join-Path $projectA 'artifacts/cache/modules/legacy.keep';New-Item -ItemType Directory (Split-Path $legacyCache) -Force|Out-Null;Set-Content $legacyCache 'preserve'
 $shared=$null;$registryLink=Join-Path $sharedOwner 'linked-project'
 try{
   $shared=Open-BuildModuleCache $projectA $sharedOwner;$shared.SkipCleanup=$true
   Assert ($shared.Project -eq $projectA -and $shared.Root -eq (Join-Path $sharedOwner 'artifacts/cache/modules')) 'Shared owner must not change execution staging scope'
   $sharedA=Get-BuildModuleEntry $shared companion @((Join-Path $projectA 'source')) @('shared-tool')
   Set-Content (Join-Path $sharedA.Path 'output.txt') 'shared-output';Save-BuildModuleEntry $sharedA @('output.txt')
   $externalConsumer='version:external-consumer';$externalConsumerPath=Join-Path $projectA 'artifacts/consumer'
   $null=Register-ArtifactLifecycle -ProjectRoot $projectA -Id $externalConsumer -Kind version -Owner 'fixture-consumer' -State complete -MembershipComplete $true -Members @{release=$externalConsumerPath} -References @{$sharedA.LifecycleId='companion-tool'}
   $shared.Lease.Dispose();$shared=$null
   $shared=Open-BuildModuleCache $projectB $sharedOwner;$shared.SkipCleanup=$true
   $sharedB=Get-BuildModuleEntry $shared companion @((Join-Path $projectB 'source')) @('shared-tool')
   Assert ($sharedB.Hit -and $sharedB.Key -eq $sharedA.Key) 'Identical source in another snapshot must share cached output'
   $catalogPath=Assert-BuildCachePath (Join-Path $projectB 'artifacts/maintenance/lifecycles') $sharedOwner
   $heldCatalog=Assert-BuildCachePath (Join-Path $projectB 'artifacts/maintenance/lifecycles-held') $sharedOwner
   Move-Item -LiteralPath $catalogPath -Destination $heldCatalog
   try{
     try{Get-BuildModuleEntry $shared companion @((Join-Path $projectB 'source')) @('shared-tool') -Force|Out-Null;throw 'Missing catalog guard'}catch{Assert ($_.Exception.Message -like "*Missing lifecycle catalog*${projectB}*") 'Missing registered project catalog preserves selected cache'}
     Assert (Test-Path $sharedB.Path) 'Unknown catalog state performs no deletion'
   }finally{Move-Item -LiteralPath $heldCatalog -Destination $catalogPath}

   Assert (Test-Path $legacyCache) 'Existing project-local cache remains separate'
   try{Get-BuildModuleKey @((Join-Path $projectB 'source/missing.ts')) @('shared-tool')|Out-Null;throw 'Missing input failure'}catch{Assert ($_.Exception.Message -match 'Missing module input') 'Missing role input must reject reuse'}
   $platformImplementation=(Get-Item Function:Get-BuildCachePlatform).ScriptBlock
   try{function Get-BuildCachePlatform {@('fixture-other-platform','fixture-other-architecture')};Assert ((Get-BuildModuleKey @((Join-Path $projectB 'source')) @('shared-tool')) -ne $sharedB.Key) 'OS/architecture change must invalidate'}finally{Set-Item Function:Get-BuildCachePlatform $platformImplementation}
   $roleKey=Get-BuildModuleKey @((Join-Path $projectB 'source/code.ts')) @('shared-tool')
   Assert ($roleKey -ne $sharedB.Key) 'File and directory input kinds remain distinct'
   Assert ((Get-BuildModuleKey @((Join-Path $projectB 'source/code.ts'),(Join-Path $projectB 'source')) @('shared-tool')) -ne (Get-BuildModuleKey @((Join-Path $projectB 'source'),(Join-Path $projectB 'source/code.ts')) @('shared-tool'))) 'Input role order remains significant'
   try{Get-BuildModuleEntry $shared companion @((Join-Path $projectB 'source')) @('shared-tool') -Force|Out-Null;throw 'Missing external consumer guard'}catch{Assert ($_.Exception.Message -like "*Active module consumer*project $projectA*") 'Other registered project consumer blocks forced replacement and identifies source'}
   $null=Invoke-ArtifactLifecycleNode @('finalize','--project-root',$projectA,'--id',$externalConsumer)
   Set-Content (Join-Path $sharedB.Path 'output.txt') 'damaged';$sharedDamaged=Get-BuildModuleEntry $shared companion @((Join-Path $projectB 'source')) @('shared-tool');Assert (-not $sharedDamaged.Hit) 'Shared damaged output must miss'
   Set-Content (Join-Path $sharedDamaged.Path 'output.txt') 'restored';Save-BuildModuleEntry $sharedDamaged @('output.txt')
   $sharedOld=Get-BuildModuleEntry $shared companion @((Join-Path $projectB 'source')) @('prior-tool');Set-Content (Join-Path $sharedOld.Path 'output.txt') 'prior';Save-BuildModuleEntry $sharedOld @('output.txt')
   foreach($pin in @($sharedDamaged,$sharedOld)){
     $deployment=Join-Path $projectA ('artifacts/deployments/'+$pin.Key);$package=Join-Path $deployment 'package';$release=Join-Path $deployment 'release';New-Item -ItemType Directory $package,$release -Force|Out-Null
     @{hostInstalled=$true;generatedAt=[DateTime]::UtcNow.ToString('o');packageDirectory=$package;releaseDirectory=$release}|ConvertTo-Json|Set-Content (Join-Path $deployment 'deployment.json')
     @{toolDirectory=(Join-Path $pin.Path 'tool')}|ConvertTo-Json|Set-Content (Join-Path $package 'preparation-inputs.json')
     @{moduleBuild=@{typeScriptPath=(Join-Path $pin.Path 'typescript.js')}}|ConvertTo-Json|Set-Content (Join-Path $release 'build-info.json')
   }
   $shared.SkipCleanup=$false;$replacement=Get-BuildModuleEntry $shared companion @((Join-Path $projectB 'source')) @('replacement-tool');Set-Content (Join-Path $replacement.Path 'output.txt') 'replacement';Save-BuildModuleEntry $replacement @('output.txt')
   Assert ((Test-Path $sharedDamaged.Path) -and (Test-Path $sharedOld.Path)) 'Another registered source current/previous installation protects shared toolchains'
   $registry=Join-Path $shared.Root '.projects.json';$validRegistry=Get-Content $registry -Raw;Set-Content $registry '{corrupt'
   try{Remove-OldBuildModuleCaches $shared|Out-Null;throw 'Missing corrupt registry failure'}catch{Assert ($_.Exception.Message -match 'JSON') 'Corrupt registry must stop all cache deletion'}
   Assert (Test-Path $sharedOld.Path) 'Corrupt registry performs no deletion'
   try{Get-BuildModuleEntry $shared companion @((Join-Path $projectB 'source')) @('shared-tool')|Out-Null;throw 'Missing corrupt entry failure'}catch{Assert ($_.Exception.Message -match 'JSON') 'Corrupt registry also stops entry mutation'}
   Assert (Test-Path $sharedOld.Path) 'Corrupt entry lookup performs no deletion'
   $shared.Lease.Dispose();$shared=$null
   try{Open-BuildModuleCache $projectB $sharedOwner|Out-Null;throw 'Missing open registry failure'}catch{Assert ($_.Exception.Message -match 'JSON') 'Opening corrupt registry must fail closed and release lease'}
   @{schema=1;projects=@($outside)}|ConvertTo-Json|Set-Content $registry
   try{Open-BuildModuleCache $projectB $sharedOwner|Out-Null;throw 'Missing registry escape failure'}catch{Assert ($_.Exception.Message -match 'escapes root') 'Registered project escape rejected'}
   @{schema=1;projects=@((Join-Path $sharedOwner 'missing-project'))}|ConvertTo-Json|Set-Content $registry
   try{Open-BuildModuleCache $projectB $sharedOwner|Out-Null;throw 'Missing registered project failure'}catch{Assert ($_.Exception.Message -match 'Missing registered cache project') 'Missing registered project must preserve uncertain installed references'}
   New-Item -ItemType Junction -Path $registryLink -Target $projectA|Out-Null
   @{schema=1;projects=@($registryLink)}|ConvertTo-Json|Set-Content $registry
   try{Open-BuildModuleCache $projectB $sharedOwner|Out-Null;throw 'Missing registry link failure'}catch{Assert ($_.Exception.Message -match 'Linked cache path') 'Registered project junction rejected'}
   Remove-Item -LiteralPath $registryLink -ErrorAction Stop;Set-Content $registry $validRegistry
   try{Open-BuildModuleCache $outside $sharedOwner|Out-Null;throw 'Missing shared owner escape failure'}catch{Assert ($_.Exception.Message -match 'escapes root') 'Execution project outside shared owner rejected'}
   try{Open-BuildModuleCache $projectB 'relative-owner'|Out-Null;throw 'Missing absolute owner failure'}catch{Assert ($_.Exception.Message -match 'fully qualified') 'Relative shared owner rejected'}
   $shared=Open-BuildModuleCache $projectB $sharedOwner;Assert (@(Get-BuildCacheProjects $shared).Count -eq 2) 'Successful registered projects retained after failure recovery'
 }finally{if($shared -and $shared.Lease){$shared.Lease.Dispose()};if(Test-Path -LiteralPath $registryLink){Remove-Item -LiteralPath $registryLink -ErrorAction Stop}}
 Write-Output 'Module cache: reuse, corruption, source/tool changes, force, leases, publication-before-prune, failed publication, module isolation, retention, runtime/installed pins/compiler, uncertainty, race, nested links, path boundary provider-only legacy staging, content-based cross-snapshot reuse, shared installed pins, platform/role identity and registry fail-closed passed; exit=0'
}finally{if($cache -and $cache.Lease){$cache.Lease.Dispose()};Assert-BuildCachePath $fixture ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../artifacts/verification')))|Out-Null;Remove-Item -LiteralPath $fixture -Recurse -ErrorAction Stop; Assert (-not(Test-Path -LiteralPath $fixture)) 'Fixture removal verified'; $null=Register-ArtifactLifecycle -ProjectRoot $testProject -Id $fixtureLifecycle -Kind run -Owner 'module-cache-tests' -State complete -MembershipComplete $true -Members @{fixture=$fixture}; $null=Invoke-ArtifactLifecycleNode @('finalize','--project-root',$testProject,'--id',$fixtureLifecycle)}
