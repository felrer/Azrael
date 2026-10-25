#requires -Version 7.0
param([switch]$RecipeOnly,[switch]$CleanupOnly,[switch]$RegistryOnly,[switch]$LegacyRegistryOnly,[switch]$MissingRegistryOnly,[string]$FixtureRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'build-module-cache.ps1')
$fixture=if($FixtureRoot){Assert-BuildCachePath $FixtureRoot ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../artifacts/tasks')))}else{[IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('../artifacts/verification/module-cache-'+[guid]::NewGuid().ToString('N'))))}
if(Test-Path -LiteralPath $fixture){throw 'New isolated fixture path required'}
$fixtureLifecycle='run:module-cache-test:'+ [IO.Path]::GetFileName($fixture)
$testProject=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $FixtureRoot){$null=Register-ArtifactLifecycle -ProjectRoot $testProject -Id $fixtureLifecycle -Kind run -Owner 'module-cache-tests' -State pending -MembershipComplete $false -Members @{fixture=$fixture}}
New-Item -ItemType Directory $fixture -Force|Out-Null
function Assert($Condition,$Message){if(-not $Condition){throw $Message}}
# No real processes are terminated or simulated as idle for actual cleanup.
$script:running=@()
$script:inspectionFails=$false
function Get-CimInstance {param($ClassName,$ErrorAction) if($script:inspectionFails){throw 'fixture process inspection unavailable'};if($script:inspectionMutation){if($script:inspectionMutationDelay -gt 0){$script:inspectionMutationDelay--}else{& $script:inspectionMutation;$script:inspectionMutation=$null}};if($script:registryRace){Add-Content -LiteralPath $script:registryRace ' ';$script:registryRace=$null};$script:running}
$cache=$null
try{
 if($MissingRegistryOnly){
   $owner=Join-Path $fixture 'owner';$project=Join-Path $owner 'snapshots/missing';$other=Join-Path $owner 'snapshots/existing'
   New-Item -ItemType Directory $project,$other|Out-Null
   $cache=Open-BuildModuleCache $owner
   $cache.Lease.Dispose();$cache=Open-BuildModuleCache $project $owner
   $cache.Lease.Dispose();$cache=Open-BuildModuleCache $other $owner
   $cache.Lease.Dispose();$cache=Open-BuildModuleCache $owner
   # Capture a real fixture consumer and canonically finalize it before its source root disappears.
   $member=Join-Path $project 'artifacts/consumer'
   $null=Register-ArtifactLifecycle $project 'run:missing-consumer' run fixture complete $true @{payload=$member}
   $null=Invoke-ArtifactLifecycleNode @('finalize','--project-root',$project,'--id','run:missing-consumer')
   $original=Get-BuildCacheProjectInspection $cache $project
   Assert ($original.status -eq 'ready-for-proof') 'Canonical consumer retirement precedes fixture absence'
   Assert-BuildCachePath $project $owner|Out-Null;Remove-Item -LiteralPath $project -Recurse -ErrorAction Stop
   $registry=Join-Path $cache.Root '.projects.json';$registryBytes=[IO.File]::ReadAllBytes($registry)
   $inspection=Get-BuildCacheLegacyProjectInspection $cache $project
   Assert ($inspection.projectState -eq 'absent' -and $inspection.status -eq 'ready-for-proof') 'Missing exact registration remains inspectable'
   Assert (@(Get-BuildCacheProjects $cache).Count -eq 3) 'Enumeration preserves missing registration'
   Assert ((Get-BuildCacheProjectInspection $cache $other).reason -eq 'Missing lifecycle catalog') 'Missing neighbor does not block individual inspection'
   foreach($check in @({Assert-BuildModuleConsumers $cache 'run:any'},{Get-ProtectedBuildCachePaths $cache},{Get-BuildCacheProjects $cache -RequireExisting})){
     try{& $check|Out-Null;throw 'Expected missing consumer guard'}catch{Assert ($_.Exception.Message -match 'Missing registered cache project') 'Missing evidence prevents cache eviction'}
   }
   $authority=Join-Path $owner 'authority.txt';Set-Content $authority 'Retire only this absent fixture registration after known consumer release'
   $consumerEvidence=Join-Path $owner 'consumers.json'
   $consumers=@{schema=1;project=$project;registry_sha256=$inspection.registrySha256;membership_complete=$true;provenance='Fixture registration and original run:missing-consumer canonically finalized before source removal';consumers=@(@{id='run:missing-consumer';released_verified=$true;release_basis='Canonical finalize completed with absent payload and no remaining references'})}
   $saveConsumers={$consumers|ConvertTo-Json -Depth 5|Set-Content $consumerEvidence}
   & $saveConsumers
   $proof=@{schema=3;action='retire-legacy';project=$project;project_state='absent';project_absent_verified=$true;registry_sha256=$inspection.registrySha256;historical_consumer_index='verified-released';producer_stopped_verified=$true;consumers_released_verified=$true;installations_released_verified=$true;rollback_released_verified=$true;payload_absent_verified=$true;reason='Exact missing fixture registration, known consumers released; history remains unknown';authority_ref=$authority;authority_sha256=(Get-BuildModuleFileHash $authority);consumer_evidence_ref=$consumerEvidence;consumer_evidence_sha256=(Get-BuildModuleFileHash $consumerEvidence)}
   $evidence=Join-Path $owner 'missing-proof.json';$save={$proof|ConvertTo-Json -Depth 5|Set-Content $evidence};& $save
   $reject={param($Pattern) try{Remove-BuildCacheLegacyProjectRegistration $cache $project $evidence (Get-BuildModuleFileHash $evidence) -Apply|Out-Null;throw 'Expected rejection missing'}catch{Assert ($_.Exception.Message -match $Pattern) "Expected missing guard: $Pattern"};Assert ((Get-BuildModuleFileHash $registry) -eq $inspection.registrySha256) 'Rejected missing retirement preserves registry'}
   $proof.schema=2;$proof.historical_consumer_index='unavailable';& $save;& $reject 'identity mismatch';$proof.schema=3;$proof.historical_consumer_index='verified-released'
   $proof.project_absent_verified=$false;& $save;& $reject 'absence proof';$proof.project_absent_verified=$true
   $proof.registry_sha256='0'*64;& $save;& $reject 'identity mismatch';$proof.registry_sha256=$inspection.registrySha256
   $consumers.membership_complete=$false;& $saveConsumers;$proof.consumer_evidence_sha256=Get-BuildModuleFileHash $consumerEvidence;& $save;& $reject 'Complete original';$consumers.membership_complete=$true
   $consumers.consumers[0].released_verified=$false;& $saveConsumers;$proof.consumer_evidence_sha256=Get-BuildModuleFileHash $consumerEvidence;& $save;& $reject 'Known consumer';$consumers.consumers[0].released_verified=$true
   & $saveConsumers;$proof.consumer_evidence_sha256=Get-BuildModuleFileHash $consumerEvidence;& $save
   $script:inspectionFails=$true;try{& $reject 'inspection unavailable'}finally{$script:inspectionFails=$false}
   $script:running=@([pscustomobject]@{Name='cargo.exe';CommandLine='cargo check'});try{& $reject 'compiler reference'}finally{$script:running=@()}
   $script:inspectionMutation={New-Item -ItemType Directory $project|Out-Null};try{& $reject 'inputs changed'}finally{Remove-Item -LiteralPath $project -ErrorAction Stop}
   $script:inspectionMutation={Add-Content $consumerEvidence ' '};try{& $reject 'consumer evidence inputs changed'}finally{& $saveConsumers}
   $script:registryRace=$registry
   try{Remove-BuildCacheLegacyProjectRegistration $cache $project $evidence (Get-BuildModuleFileHash $evidence) -Apply|Out-Null;throw 'Expected registry race rejection'}catch{Assert ($_.Exception.Message -match 'inputs changed') 'Missing registration registry race rejected'}finally{[IO.File]::WriteAllBytes($registry,$registryBytes)}
   $cache.Lease.Dispose();$pwsh=(Get-Process -Id $PID).Path;$cli=Join-Path $PSScriptRoot 'manage-module-cache-projects.ps1'
   $rows=& $pwsh -NoProfile -File $cli -CacheProjectRoot $owner -Action inspect
   Assert ($LASTEXITCODE -eq 0 -and @($rows|ConvertFrom-Json).Count -eq 3) 'CLI enumerates all rows including missing root'
   $preview=& $pwsh -NoProfile -File $cli -CacheProjectRoot $owner -Action retire-legacy -Project $project -EvidencePath $evidence -EvidenceSha256 (Get-BuildModuleFileHash $evidence)
   Assert ($LASTEXITCODE -eq 0 -and ($preview|ConvertFrom-Json).status -eq 'selected') 'Missing CLI preview uses actual process inspection'
   $cache=Open-BuildModuleCache $owner
   $retired=Remove-BuildCacheLegacyProjectRegistration $cache $project $evidence (Get-BuildModuleFileHash $evidence) -Apply
   Assert ($retired.status -eq 'retired' -and $retired.historicalOutcome -eq 'unknown' -and -not(Test-Path $project)) 'Exact absent registration retired without recreating root or history'
   Assert (@(Get-BuildCacheProjects $cache).Count -eq 2 -and $other -in @(Get-BuildCacheProjects $cache) -and (Test-Path $consumerEvidence)) 'Unrelated registrations and retained consumer evidence survive'
   Write-Output 'Missing module registry: enumeration, isolated inspection, eviction protection, complete released-consumer proof, authority, process, absence/evidence/registry races, CLI and exact retirement passed; exit=0'
   return
 }
 if($LegacyRegistryOnly){
   $owner=Join-Path $fixture 'owner';$project=Join-Path $owner 'snapshots/legacy'
   New-Item -ItemType Directory $project -Force|Out-Null
   $source=Join-Path $project 'source.txt';Set-Content $source 'original source'
   $cache=Open-BuildModuleCache $owner
   $cache.Lease.Dispose();$cache=Open-BuildModuleCache $project $owner
   $cache.Lease.Dispose();$cache=Open-BuildModuleCache $owner
   $payload=Join-Path $cache.Root 'preserved-cache.bin';Set-Content $payload 'unchanged cache bytes'
   $sourceHash=Get-BuildModuleFileHash $source;$payloadHash=Get-BuildModuleFileHash $payload
   $registry=Join-Path $cache.Root '.projects.json';$registryBytes=[IO.File]::ReadAllBytes($registry)
   $normal=Get-BuildCacheProjectInspection $cache $project
   Assert ($normal.reason -eq 'Missing lifecycle catalog') 'Normal missing-catalog inspection stays blocked'
   Assert ((Remove-BuildCacheProjectRegistration $cache $project 'unused' 'unused' -Apply).status -eq 'blocked') 'Normal retirement stays blocked'
   $inspection=Get-BuildCacheLegacyProjectInspection $cache $project
   Assert ($inspection.status -eq 'ready-for-proof' -and $inspection.historicalOutcome -eq 'unknown') 'Legacy inspection preserves unknown history'
   $authority=Join-Path $owner 'authority.txt';Set-Content $authority 'User authorized retirement of this inactive fixture only'
   $evidence=Join-Path $owner 'legacy-proof.json'
   $proof=@{schema=2;action='retire-legacy';project=$project;registry_sha256=$inspection.registrySha256;historical_consumer_index='unavailable';producer_stopped_verified=$true;consumers_released_verified=$true;installations_released_verified=$true;rollback_released_verified=$true;payload_absent_verified=$true;reason='Verified current absence; historical producer result remains unknown';authority_ref=$authority;authority_sha256=(Get-BuildModuleFileHash $authority)}
   $save={ $proof|ConvertTo-Json|Set-Content $evidence }
   & $save
   $unchanged={Assert ((Get-BuildModuleFileHash $registry) -eq $inspection.registrySha256) 'Rejected retirement cannot mutate registry'}
   $heldProject=Assert-BuildCachePath (Join-Path $owner 'snapshots/held-legacy') $owner
   $null=Assert-BuildCachePath $project $owner
   Move-Item -LiteralPath $project -Destination $heldProject -ErrorAction Stop
   try{
     try{Remove-BuildCacheLegacyProjectRegistration $cache $project $evidence (Get-BuildModuleFileHash $evidence) -Apply|Out-Null;throw 'Expected missing evidence rejection'}catch{Assert ($_.Exception.Message -match 'identity mismatch') 'Absent source requires complete retained consumer proof instead of unavailable history'}
     & $unchanged
   }finally{Move-Item -LiteralPath $heldProject -Destination $project -ErrorAction Stop}
   $reject={param($Pattern) try{Remove-BuildCacheLegacyProjectRegistration $cache $project $evidence (Get-BuildModuleFileHash $evidence) -Apply|Out-Null;throw 'Expected rejection missing'}catch{Assert ($_.Exception.Message -match $Pattern) "Expected guard: $Pattern"}; & $unchanged}
   try{Remove-BuildCacheLegacyProjectRegistration $cache $project $evidence ('0'*64) -Apply|Out-Null;throw 'Expected stale rejection'}catch{Assert ($_.Exception.Message -match 'Stale retirement') 'Pinned evidence required'}
   $proof.project=$owner;& $save;& $reject 'identity mismatch';$proof.project=$project
   $proof.registry_sha256='0'*64;& $save;& $reject 'identity mismatch';$proof.registry_sha256=$inspection.registrySha256
   $proof.payload_absent_verified='true';& $save;& $reject 'payload_absent_verified';$proof.payload_absent_verified=$true
   $proof.authority_ref=$source;& $save;& $reject 'must survive';$proof.authority_ref=$authority
   $proof.authority_ref=$payload;& $save;& $reject 'must survive';$proof.authority_ref=$authority
   & $save
   $script:running=@([pscustomobject]@{Name='cargo.exe';CommandLine='cargo check'})
   try{& $reject 'compiler reference'}finally{$script:running=@()}
   $script:running=@([pscustomobject]@{Name='node.exe';CommandLine="node $project/producer.js";ProcessId=987654})
   try{& $reject 'compiler reference'}finally{$script:running=@()}
   $script:running=@([pscustomobject]@{Name='azrael.exe';CommandLine=$null;ExecutablePath=(Join-Path $project 'bin/azrael.exe');ProcessId=987654})
   try{& $reject 'compiler reference'}finally{$script:running=@()}
   $script:inspectionFails=$true
   try{& $reject 'inspection unavailable'}finally{$script:inspectionFails=$false}
   foreach($output in @('artifacts','engine/codex-rs/target','providers/opencodex/node_modules','extensions/azrael-ex/node_modules','extensions/azrael-ex/dist','providers/opencodex/gui/dist','providers/opencodex/gui/node_modules','providers/opencodex/native/remote-workspace-helper/target')){
     $path=Join-Path $project $output;New-Item -ItemType Directory $path -Force|Out-Null
     Assert ((Remove-BuildCacheLegacyProjectRegistration $cache $project $evidence (Get-BuildModuleFileHash $evidence) -Apply).status -eq 'blocked') 'Existing output prevents legacy retirement'
     & $unchanged;Remove-Item -LiteralPath $path -Recurse -ErrorAction Stop
   }
   $script:inspectionMutation={New-Item -ItemType Directory (Join-Path $project 'artifacts')|Out-Null}
   try{& $reject 'inputs changed'}finally{Remove-Item -LiteralPath (Join-Path $project 'artifacts') -ErrorAction Stop}
   $script:inspectionMutation={Add-Content -LiteralPath $evidence ' '}
   & $reject 'inputs changed';& $save
   $script:inspectionMutation={Add-Content -LiteralPath $authority 'changed'}
   & $reject 'inputs changed';Set-Content $authority 'User authorized retirement of this inactive fixture only'
   $script:inspectionMutationDelay=1
   $script:inspectionMutation={New-Item -ItemType Directory (Join-Path $project 'artifacts')|Out-Null}
   try{& $reject 'inputs changed'}finally{Remove-Item -LiteralPath (Join-Path $project 'artifacts') -ErrorAction Stop}
   $script:registryRace=$registry
   try{Remove-BuildCacheLegacyProjectRegistration $cache $project $evidence (Get-BuildModuleFileHash $evidence) -Apply|Out-Null;throw 'Expected registry race rejection'}catch{Assert ($_.Exception.Message -match 'inputs changed') 'Registry race fails closed'}finally{[IO.File]::WriteAllBytes($registry,$registryBytes)}
   $cache.Project=$project
   try{Assert ((Get-BuildCacheLegacyProjectInspection $cache $project).status -eq 'blocked') 'Current project protected'}finally{$cache.Project=$owner}
   $linked=Join-Path $owner 'linked';New-Item -ItemType Junction -Path $linked -Target $project|Out-Null
   try{Get-BuildCacheLegacyProjectInspection $cache $linked|Out-Null;throw 'Expected linked rejection'}catch{Assert ($_.Exception.Message -match 'Linked cache path') 'Linked project protected'}finally{Remove-Item -LiteralPath $linked -ErrorAction Stop}
   # Exercise CLI dispatch and its actual process inspection in a separate PS7 process.
   $cache.Lease.Dispose()
   $pwsh=(Get-Process -Id $PID).Path
   $cli=Join-Path $PSScriptRoot 'manage-module-cache-projects.ps1'
   $cliInspection=& $pwsh -NoProfile -File $cli -CacheProjectRoot $owner -Action inspect-legacy -Project $project
   Assert ($LASTEXITCODE -eq 0 -and (($cliInspection|ConvertFrom-Json).status -eq 'ready-for-proof')) 'Explicit legacy CLI inspection'
   $cliPreview=& $pwsh -NoProfile -File $cli -CacheProjectRoot $owner -Action retire-legacy -Project $project -EvidencePath $evidence -EvidenceSha256 (Get-BuildModuleFileHash $evidence)
   Assert ($LASTEXITCODE -eq 0 -and (($cliPreview|ConvertFrom-Json).status -eq 'selected')) 'CLI retirement preview uses real process inspection'
   $cache=Open-BuildModuleCache $owner
   $preview=Remove-BuildCacheLegacyProjectRegistration $cache $project $evidence (Get-BuildModuleFileHash $evidence)
   Assert ($preview.status -eq 'selected' -and -not $preview.registrationAbsent) 'Preview selects without unregistering';& $unchanged
   $retired=Remove-BuildCacheLegacyProjectRegistration $cache $project $evidence (Get-BuildModuleFileHash $evidence) -Apply
   Assert ($retired.status -eq 'retired' -and $retired.registrationAbsent -and $retired.historicalOutcome -eq 'unknown' -and $retired.historical_consumer_index -eq 'unavailable') 'Retirement retains historical unknown state'
   Assert ((Get-BuildModuleFileHash $source) -eq $sourceHash -and (Get-BuildModuleFileHash $payload) -eq $payloadHash -and -not(Test-Path (Join-Path $project 'artifacts'))) 'Source/cache bytes preserved and no historical catalog fabricated'
   Write-Output 'Legacy registration retirement: opt-in absence, proof/authority identity, process, outputs/races, source/cache preservation and unknown history passed; exit=0'
   return
 }
 if($RegistryOnly){
   $owner=Join-Path $fixture 'owner';$project=Join-Path $owner 'snapshots/retired'
   New-Item -ItemType Directory $project -Force|Out-Null
   $cache=Open-BuildModuleCache $owner
   $cache.Lease.Dispose();$cache=Open-BuildModuleCache $project $owner
   $cache.Lease.Dispose();$cache=Open-BuildModuleCache $owner
   $missing=Get-BuildCacheProjectInspection $cache $project
   Assert ($missing.status -eq 'blocked' -and $missing.reason -eq 'Missing lifecycle catalog' -and $missing.recoveryCondition -match 'genuine') 'Missing catalog requires genuine recovery, never an empty fabricated catalog'
   $member=Join-Path $project 'artifacts/consumer'
   $null=Register-ArtifactLifecycle $project 'run:consumer' run fixture pending $false @{payload=$member} @{'run:module-cache:fixture'='active dependency'}
   $active=Get-BuildCacheProjectInspection $cache $project
   Assert ($active.status -eq 'blocked' -and $active.groups.Count -eq 1) 'Active/pending consumer prevents project retirement'
   # Canonical owner retires a terminal group only after actual member absence.
   $null=Register-ArtifactLifecycle $project 'run:consumer' run fixture complete $true @{payload=$member}
   $null=Invoke-ArtifactLifecycleNode @('finalize','--project-root',$project,'--id','run:consumer')
   $inspection=Get-BuildCacheProjectInspection $cache $project
   Assert ($inspection.status -eq 'ready-for-proof') 'Genuine catalog survives canonical finalization'
   $evidence=Join-Path $owner 'retirement-proof.json'
   $proof=@{schema=1;project=$project;registry_sha256=$inspection.registrySha256;catalog_sha256=$inspection.catalogSha256;producer_stopped_verified=$true;consumers_released_verified=$true;installations_released_verified=$true;rollback_released_verified=$true;reason='Fixture producer and all consumers independently closed'}
   $proof|ConvertTo-Json|Set-Content $evidence
   $hash=Get-BuildModuleFileHash $evidence
   try{Remove-BuildCacheProjectRegistration $cache $project $evidence ('0'*64) -Apply|Out-Null;throw 'Missing stale evidence guard'}catch{Assert ($_.Exception.Message -match 'Stale retirement') 'Stale evidence hash fails closed'}
   $proof.registry_sha256='0'*64;$proof|ConvertTo-Json|Set-Content $evidence
   try{Remove-BuildCacheProjectRegistration $cache $project $evidence (Get-BuildModuleFileHash $evidence) -Apply|Out-Null;throw 'Missing registry identity guard'}catch{Assert ($_.Exception.Message -match 'identity mismatch') 'Changed registry identity fails closed'}
   $proof.registry_sha256=$inspection.registrySha256;$proof|ConvertTo-Json|Set-Content $evidence;$hash=Get-BuildModuleFileHash $evidence
   $script:running=@([pscustomobject]@{Name='cargo.exe';CommandLine='cargo check'})
   try{Remove-BuildCacheProjectRegistration $cache $project $evidence $hash -Apply|Out-Null;throw 'Missing compiler guard'}catch{Assert ($_.Exception.Message -match 'compiler reference') 'Compiler protects project retirement'}finally{$script:running=@()}
   $script:inspectionFails=$true
   try{
     try{Remove-BuildCacheProjectRegistration $cache $project $evidence $hash -Apply|Out-Null;throw 'Missing inspection guard'}catch{Assert ($_.Exception.Message -match 'inspection unavailable') 'Unavailable process inspection fails closed'}
     $cache.Entries=@();$blockedCleanup=Remove-OldBuildModuleCaches $cache
     Assert ($blockedCleanup.deletedBytes -eq 0 -and $blockedCleanup.deletedItemCount -eq 0 -and -not $blockedCleanup.cleanupComplete -and $blockedCleanup.revisitCondition) 'Process inspection failure reports zero actual deletion and recovery condition'
   }finally{$script:inspectionFails=$false}
   $registry=Join-Path $cache.Root '.projects.json';$originalRegistry=[IO.File]::ReadAllBytes($registry);$script:registryRace=$registry
   try{Remove-BuildCacheProjectRegistration $cache $project $evidence $hash -Apply|Out-Null;throw 'Missing registry race guard'}catch{Assert ($_.Exception.Message -match 'inputs changed') 'Registry mutation during inspection refuses retirement'}finally{[IO.File]::WriteAllBytes($registry,$originalRegistry);$script:registryRace=$null}
   $deployment=Join-Path $project 'artifacts/deployments/installed';New-Item -ItemType Directory $deployment -Force|Out-Null
   @{hostInstalled=$true}|ConvertTo-Json|Set-Content (Join-Path $deployment 'deployment.json')
   try{Remove-BuildCacheProjectRegistration $cache $project $evidence $hash -Apply|Out-Null;throw 'Missing installed guard'}catch{Assert ($_.Exception.Message -match 'Installed or rollback') 'Installed/rollback deployment prevents retirement'}finally{Remove-Item -LiteralPath $deployment -Recurse -ErrorAction Stop}
   $linked=Join-Path $owner 'linked-project';New-Item -ItemType Junction -Path $linked -Target $project|Out-Null
   try{Get-BuildCacheProjectInspection $cache $linked|Out-Null;throw 'Missing linked project guard'}catch{Assert ($_.Exception.Message -match 'Linked cache path') 'Reparse project path refuses inspection'}finally{Remove-Item -LiteralPath $linked -ErrorAction Stop}
   $preview=Remove-BuildCacheProjectRegistration $cache $project $evidence $hash
   Assert ($preview.status -eq 'selected' -and $project -in @(Get-BuildCacheProjects $cache)) 'Preview preserves registration'
   $retired=Remove-BuildCacheProjectRegistration $cache $project $evidence $hash -Apply
   Assert ($retired.status -eq 'retired' -and $retired.registrationAbsent -and (Test-Path $project) -and (Test-Path $evidence)) 'Exact retirement removes only registration and preserves source/evidence'
   try{Get-BuildCacheProjectInspection $cache (Join-Path $fixture 'outside')|Out-Null;throw 'Missing escape guard'}catch{Assert ($_.Exception.Message -match 'escapes root') 'Escaping project blocked'}
   Write-Output 'Module cache registration: missing provenance, pending consumer, canonical empty catalog, stale proof/registry, compiler and inspection guards, preview and exact registration retirement passed; exit=0'
   return
 }
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
  Assert (-not(Test-Path $good.Path) -and -not(Test-Path (Join-Path $companionCache.Path 'cache.json'))) 'Failed recipe does not retain an unused superseded publication'
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
  $entry=Get-BuildModuleEntry $cache providers @($source) @('deleted-byte-count')
  Set-Content (Join-Path $entry.Path 'output.txt') 'count bytes';Save-BuildModuleEntry $entry @('output.txt')
  $expected=[long]((Get-BuildModuleFiles $entry.Path $cache.Root|Measure-Object Length -Sum).Sum)
  $cache.Entries=@()
  $report=@(Remove-OldBuildModuleCaches $cache -Module providers)
  $row=@($report|Where-Object path -EQ $entry.Path)[0]
  Assert ($row.deletedBytes -eq $expected -and $row.deletedItemCount -eq 1 -and $row.cleanupComplete -and $row.absent) 'Deletion report counts actual removed entry bytes and verified absence'
 }
 Test-ModuleDeletionOrder
 if($CleanupOnly){Write-Output 'Production module cleanup: ReadOnly payload preserves logs/receipts; locked log follows payload and preserves receipts; retries verify absence; exit=0';return}
 $cache.SkipCleanup=$false
 Test-CompanionProductionRecipe
 if($RecipeOnly){Write-Output 'Production companion recipe scope, raw logs, metrics, cache hit, failed exit and superseded-key retirement; provider command routing passed; exit=0';return}
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
 # Selecting a replacement collects unused keys before generation, only for that module.
 $provider=Get-BuildModuleEntry $cache providers @($source) @('provider-old')
 Set-Content (Join-Path $provider.Path 'output.txt') 'provider';Save-BuildModuleEntry $provider @('output.txt')
 $old=Get-BuildModuleEntry $cache companion @($source) @('auto-old')
 Set-Content (Join-Path $old.Path 'output.txt') 'old';Save-BuildModuleEntry $old @('output.txt')
 $referenced=Get-BuildModuleEntry $cache companion @($source) @('auto-referenced')
 Set-Content (Join-Path $referenced.Path 'output.txt') 'referenced';Save-BuildModuleEntry $referenced @('output.txt')
 $selectionConsumerId='version:selection-consumer'
 $null=Register-ArtifactLifecycle -ProjectRoot $fixture -Id $selectionConsumerId -Kind version -Owner 'fixture-consumer' -State complete -MembershipComplete $true -Members @{release=(Join-Path $fixture 'artifacts/selection-consumer')} -References @{$referenced.LifecycleId='companion-tool'}
 $cache.SkipCleanup=$false
 try{
   $next=Get-BuildModuleEntry $cache companion @($source) @('auto-next')
   throw 'fixture generation failed before Save'
 }catch{Assert ($_.Exception.Message -eq 'fixture generation failed before Save') 'Generation fails before publication'}
 Assert (-not(Test-Path $old.Path)) 'Selection retires unused prior key despite failure before Save'
 Assert (Test-Path $referenced.Path) 'Actual lifecycle consumer protects prior key despite replacement failure'
 Assert (Test-Path $next.Path) 'Failed generation keeps selected key'
 $null=Invoke-ArtifactLifecycleNode @('finalize','--project-root',$fixture,'--id',$selectionConsumerId)
 try{Save-BuildModuleEntry $next @('missing.txt');throw 'Expected output failure'}catch{Assert ($_.Exception.Message -match 'Missing module output') 'Missing output must reject publication'}
 Assert (-not(Test-Path $old.Path)) 'Failed publication does not restore retired keys'
 Set-Content (Join-Path $next.Path 'output.txt') 'next';Save-BuildModuleEntry $next @('output.txt')
 Assert (Test-Path (Join-Path $next.Path 'cache.json')) 'Replacement receipt published'
 $cache.SkipCleanup=$true
 $hitObsolete=Get-BuildModuleEntry $cache companion @($source) @('hit-obsolete')
 Set-Content (Join-Path $hitObsolete.Path 'output.txt') 'obsolete';Save-BuildModuleEntry $hitObsolete @('output.txt')
 $cache.SkipCleanup=$false
 $hit=Get-BuildModuleEntry $cache companion @($source) @('auto-next')
 Assert ($hit.Hit -and -not(Test-Path $hitObsolete.Path)) 'Cache-hit selection also retires obsolete keys'
 Assert (-not(Test-Path $referenced.Path)) 'Released lifecycle consumer allows collection on next selection'
 Assert (Test-Path $provider.Path) 'Selection collects only the selected module'
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
 # Installed current and previous tool references are protected during selection.
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
   $missingCache=Open-BuildModuleCache $projectB $sharedOwner
   try{try{Get-BuildCacheProjects $missingCache -RequireExisting|Out-Null;throw 'Missing registered project failure'}catch{Assert ($_.Exception.Message -match 'Missing registered cache project') 'Missing registered project must preserve uncertain installed references'}}finally{$missingCache.Lease.Dispose()}
   New-Item -ItemType Junction -Path $registryLink -Target $projectA|Out-Null
   @{schema=1;projects=@($registryLink)}|ConvertTo-Json|Set-Content $registry
   try{Open-BuildModuleCache $projectB $sharedOwner|Out-Null;throw 'Missing registry link failure'}catch{Assert ($_.Exception.Message -match 'Linked cache path') 'Registered project junction rejected'}
   Remove-Item -LiteralPath $registryLink -ErrorAction Stop;Set-Content $registry $validRegistry
   try{Open-BuildModuleCache $outside $sharedOwner|Out-Null;throw 'Missing shared owner escape failure'}catch{Assert ($_.Exception.Message -match 'escapes root') 'Execution project outside shared owner rejected'}
   try{Open-BuildModuleCache $projectB 'relative-owner'|Out-Null;throw 'Missing absolute owner failure'}catch{Assert ($_.Exception.Message -match 'fully qualified') 'Relative shared owner rejected'}
   $shared=Open-BuildModuleCache $projectB $sharedOwner;Assert (@(Get-BuildCacheProjects $shared).Count -eq 2) 'Successful registered projects retained after failure recovery'
 }finally{if($shared -and $shared.Lease){$shared.Lease.Dispose()};if(Test-Path -LiteralPath $registryLink){Remove-Item -LiteralPath $registryLink -ErrorAction Stop}}
 Write-Output 'Module cache: reuse, corruption, source/tool changes, force, leases, selection-time pruning, failed generation/publication, module isolation, retention, runtime/installed pins/compiler, uncertainty, race, nested links, path boundary provider-only legacy staging, content-based cross-snapshot reuse, shared installed pins, platform/role identity and registry fail-closed passed; exit=0'
}finally{if($cache -and $cache.Lease){$cache.Lease.Dispose()};Assert-BuildCachePath $fixture ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../artifacts')))|Out-Null;Remove-Item -LiteralPath $fixture -Recurse -ErrorAction Stop; Assert (-not(Test-Path -LiteralPath $fixture)) 'Fixture removal verified'; if(-not $FixtureRoot){$null=Register-ArtifactLifecycle -ProjectRoot $testProject -Id $fixtureLifecycle -Kind run -Owner 'module-cache-tests' -State complete -MembershipComplete $true -Members @{fixture=$fixture}; $null=Invoke-ArtifactLifecycleNode @('finalize','--project-root',$testProject,'--id',$fixtureLifecycle)}}
