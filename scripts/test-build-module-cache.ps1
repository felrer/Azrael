#requires -Version 7.0
param([switch]$RecipeOnly,[switch]$CleanupOnly,[switch]$RecoveryOnly,[switch]$RegistryOnly,[switch]$ClaimInspectionOnly,[switch]$ProcessInspectionOnly,[switch]$LegacyRegistryOnly,[switch]$MissingRegistryOnly,[switch]$InvalidationOnly,[switch]$OwnershipOnly,[string]$FixtureRoot)
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
function Test-ModuleMarkerRecovery([string]$fixture){
 $cache=$null
 try{
   $cache=Open-BuildModuleCache $fixture
   $cache.SkipCleanup=$true
   $source=Join-Path $fixture 'source';New-Item -ItemType Directory $source|Out-Null
   Set-Content (Join-Path $source 'input.txt') 'recovery input'
   $entry=Get-BuildModuleEntry $cache providers @($source) @('unknown-marker-recovery')
   $marker=Join-Path $entry.Path 'owner.json';$payload=Join-Path $entry.Path 'partial.txt'
   Set-Content $payload 'partial output'
   $originalMarker=[IO.File]::ReadAllBytes($marker);$nul=[byte[]]::new(128)
   [IO.File]::WriteAllBytes($marker,$nul)
   $sha=(Get-BuildModuleFileHash $marker).ToLowerInvariant()
   $node=(Get-Command node -CommandType Application|Select-Object -First 1).Source
   $lifecycle=Join-Path $PSScriptRoot 'artifact-lifecycle.cjs'
   # A synchronous, directly owned fixture producer creates no child processes.
   # Its successful process exit is observed separately; the historical module
   # result remains unknown throughout close, recovery and cleanup selection.
   $closeSource=@'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [api,root,id]=process.argv.slice(1),l=require(api),r=l.catalog(root).find(r=>r.id===id);
const proof=path.join(root,'producer-close.json');fs.writeFileSync(proof,JSON.stringify({producer_pid:process.pid,children:[],fixture:'synchronous partial module producer'}),{flag:'wx'});
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
l.closeLifecycle(root,id,{owner:r.owner,expected_revision:r.revision,producer_stopped_verified:true,outcome:'unknown',exit_code:null,reason:'Fixture partial producer has no remaining work or children',evidence_ref:proof,evidence_sha256:digest(proof)});
'@
   $null=& $node -e $closeSource $lifecycle $fixture $entry.LifecycleId
   Assert ($LASTEXITCODE -eq 0) 'Directly owned synchronous fixture producer exited with no child tree'
   $closed=Get-BuildModuleLifecycleRecord $cache providers $entry.Key $entry.Path
   $revision=$closed.revision
   $reject={param([hashtable]$Options,[string]$Pattern)
     $message=$null
     try{$result=Remove-BuildModuleEntry $cache providers $entry.Key $entry.Path @Options;if($result.status -eq 'blocked'){$message=$result.reason}}catch{$message=$_.Exception.Message}
     Assert ($message -and $message -match $Pattern) "Recovery must reject: $Pattern; actual: $message"
     Assert ((Test-Path $payload) -and (Test-Path $marker)) 'Rejection preserves partial payload and marker'
     $current=Get-BuildModuleLifecycleRecord $cache providers $entry.Key $entry.Path
     Assert ($current.state -eq 'pending' -and $current.producer.outcome -eq 'unknown' -and $null -eq $current.producer.exit_code) 'Rejected recovery preserves unknown outcome'
   }
   & $reject @{RecoveredOwnerSha256=$sha;ExpectedRecoveryRevision=$revision} 'cleanup recovery revision'
   Set-Content (Join-Path $fixture 'producer-observer.json') 'PowerShell observed direct synchronous Node producer exit=0; no children were created; original module outcome remains unknown'
   $recoverSource=@'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [api,root,id]=process.argv.slice(1),l=require(api),r=l.catalog(root).find(r=>r.id===id);
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const proof=path.join(root,'cleanup-recovery.json'),observer=path.join(root,'producer-observer.json');
const source={id:r.id,kind:r.kind,owner:r.owner,version:r.version??null,generation:r.generation??null,revision:r.revision,state:r.state,membership_complete:r.membership_complete,producer:r.producer??null,members:r.members};
fs.writeFileSync(proof,JSON.stringify({schema:1,action:'recover-cleanup',source,producer_stopped_verified:true,membership_complete_verified:true,stop_basis:'Direct synchronous producer process exit observed by PowerShell; no children created',membership_basis:'Original single generated cache root contains all partial output',producer_evidence:[{path:observer,sha256:digest(observer)}]}),{flag:'wx'});
l.recoverCleanup(root,id,{owner:r.owner,expected_revision:r.revision,producer_stopped_verified:true,membership_complete_verified:true,reason:'Reconcile partial fixture membership without changing unknown outcome',evidence_ref:proof,evidence_sha256:digest(proof)});
'@
   $null=& $node -e $recoverSource $lifecycle $fixture $entry.LifecycleId
   Assert ($LASTEXITCODE -eq 0) 'Supported recoverCleanup validates independent external proof'
   $recovered=Get-BuildModuleLifecycleRecord $cache providers $entry.Key $entry.Path
   $revision=$recovered.revision;$options=@{RecoveredOwnerSha256=$sha;ExpectedRecoveryRevision=$revision}
   & $reject @{RecoveredOwnerSha256=('0'*64);ExpectedRecoveryRevision=$revision} 'SHA256 mismatch'
   & $reject @{RecoveredOwnerSha256=$sha;ExpectedRecoveryRevision=($revision-1)} 'cleanup recovery revision'
   & $reject @{RecoveredOwnerSha256=$sha;ExpectedRecoveryRevision=$revision;Retry=$true} 'cannot retry'
   & $reject @{RecoveredOwnerSha256=$sha;ExpectedRecoveryRevision=$revision;ProtectedPaths=@($payload)} 'protected'
   foreach($bytes in @($originalMarker,[byte[]]@(0,1),[byte[]]::new(0),[byte[]]::new(65537))){
     [IO.File]::WriteAllBytes($marker,$bytes)
     & $reject $options 'NUL owner marker'
   }
   [IO.File]::WriteAllBytes($marker,$nul)
   $renamed=Join-Path $entry.Path 'owner.saved';Move-Item -LiteralPath $marker -Destination $renamed
   try{
     $missingRejected=$false
     try{Remove-BuildModuleEntry $cache providers $entry.Key $entry.Path @options|Out-Null}catch{$missingRejected=$true}
     Assert ($missingRejected -and (Test-Path $payload)) 'Missing marker rejects without deletion'
   }finally{Move-Item -LiteralPath $renamed -Destination $marker}
   $hardlink=Join-Path $fixture 'marker-link';New-Item -ItemType HardLink -Path $hardlink -Target $marker|Out-Null
   try{& $reject $options 'single-link'}finally{Remove-Item -LiteralPath $hardlink -ErrorAction Stop}
   $substitutedRejected=$false
   try{Remove-BuildModuleEntry $cache providers $entry.Key ($entry.Path+'-substitute') @options|Out-Null}catch{$substitutedRejected=$true}
   Assert ($substitutedRejected -and (Test-Path $payload)) 'Substituted member path rejects without deletion'
   $moved=$entry.Path+'-moved';Move-Item -LiteralPath $entry.Path -Destination $moved
   try{
     New-Item -ItemType Junction -Path $entry.Path -Target $moved|Out-Null
     & $reject $options 'Linked cache path'
   }finally{if(Test-Path -LiteralPath $entry.Path){Remove-Item -LiteralPath $entry.Path -ErrorAction Stop};Move-Item -LiteralPath $moved -Destination $entry.Path}
   $script:inspectionMutation={[IO.File]::WriteAllBytes($marker,[byte[]]@(0,1))}
   try{& $reject $options 'NUL owner marker'}finally{$script:inspectionMutation=$null;[IO.File]::WriteAllBytes($marker,$nul)}
   $lease=$cache.Lease;$cache.Lease=$null
   try{& $reject $options 'cache lease'}finally{$cache.Lease=$lease}
   $script:running=@([pscustomobject]@{Name='cargo.exe';CommandLine='cargo fixture'})
   try{& $reject $options 'compiler reference'}finally{$script:running=@()}
   $consumer='run:marker-consumer'
   $null=Register-ArtifactLifecycle -ProjectRoot $fixture -Id $consumer -Kind run -Owner fixture -State complete -MembershipComplete $true -Members @{output=(Join-Path $fixture 'artifacts/absent-consumer-output')} -References @{$entry.LifecycleId='fixture dependency'} -Generated -ProtectionKnown
   try{& $reject $options 'consumer'}finally{$null=Invoke-ArtifactLifecycleNode @('finalize','--project-root',$fixture,'--id',$consumer)}
   $recoveryProof=Join-Path $fixture 'cleanup-recovery.json';$proofBytes=[IO.File]::ReadAllBytes($recoveryProof)
   try{[IO.File]::AppendAllText($recoveryProof,' ');& $reject $options 'SHA256|recovery|lifecycle command failed'}finally{[IO.File]::WriteAllBytes($recoveryProof,$proofBytes)}
   $preview=Remove-BuildModuleEntry $cache providers $entry.Key $entry.Path @options -Preview
   Assert ($preview.status -eq 'selected' -and (Test-Path $payload)) 'Recovery preview uses real native cleanup proof validation'
   $current=Get-BuildModuleLifecycleRecord $cache providers $entry.Key $entry.Path
   Assert ($current.revision -eq $revision -and $current.state -eq 'pending' -and $current.producer.outcome -eq 'unknown' -and $null -eq $current.producer.exit_code) 'Unknown outcome unchanged until native finalization'
   $result=Remove-BuildModuleEntry $cache providers $entry.Key $entry.Path @options
   Assert ($result.status -eq 'deleted' -and -not(Test-Path $entry.Path)) ('Supported recovered marker cleanup deletes exact entry: '+($result|ConvertTo-Json -Depth 10 -Compress))
   Assert (-not @((Invoke-ArtifactLifecycleNode @('catalog','--project-root',$fixture)).groups|Where-Object id -EQ $entry.LifecycleId).Count) 'Native cleanup finalizes deleted lifecycle'
   Write-Output 'Module marker recovery: supported unknown close/recoverCleanup, external proof, NUL hash/revision, retry, marker type/bounds, lease, protection, process and consumer guards; native deletion/finalization passed; exit=0'
 }finally{if($cache -and $cache.Lease){$cache.Lease.Dispose()}}
}
try{
 if($OwnershipOnly -or -not($RecipeOnly -or $CleanupOnly -or $RecoveryOnly -or $RegistryOnly -or $ClaimInspectionOnly -or $ProcessInspectionOnly -or $LegacyRegistryOnly -or $MissingRegistryOnly)){
   # Execute the production deployment binding function; the resolver itself has
   # real manifest/working-root coverage in test-deployment-workspace.cjs.
   $tokens=$null;$errors=$null
   $deployAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'deploy-azrael.ps1'),[ref]$tokens,[ref]$errors)
   Assert (-not $errors.Count) 'Deployment script parses'
   $binding=$deployAst.Find({param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -ceq 'Resolve-DeploymentModuleCacheOwner'},$true)
   Assert ($null -ne $binding) 'Production manifest binding owner exists'
   . ([scriptblock]::Create($binding.Extent.Text))
   $manifest=Join-Path $fixture 'manifest.json';$sha='a'*64;$selected=[IO.Path]::GetFullPath($fixture)
   $script:resolverExit=0;$script:resolverPacket=@{moduleCacheProjectRoot=$selected}|ConvertTo-Json
   function node {$script:resolverArgs=@($args);$global:LASTEXITCODE=$script:resolverExit;$script:resolverPacket}
   try{
     Assert ((Resolve-DeploymentModuleCacheOwner $fixture '' '' $selected) -ceq $selected) 'Explicit independent owner preserved'
     foreach($pair in @(@($manifest,''),@('',$sha))){
       try{Resolve-DeploymentModuleCacheOwner $fixture $pair[0] $pair[1] ''|Out-Null;throw 'Expected paired manifest inputs'}catch{Assert ($_.Exception.Message -match 'supplied together') 'Partial manifest arguments rejected'}
     }
     Assert ((Resolve-DeploymentModuleCacheOwner $fixture $manifest $sha '') -ceq $selected) 'Verified manifest owner selected'
     Assert ($script:resolverArgs.Count -eq 5 -and $script:resolverArgs[1] -ceq '--module-cache-owner' -and $script:resolverArgs[2] -ceq $manifest -and $script:resolverArgs[3] -ceq $sha -and $script:resolverArgs[4] -ceq $fixture) 'Production binding forwards exact manifest/hash/execution root'
     Assert ((Resolve-DeploymentModuleCacheOwner $fixture $manifest $sha $selected) -ceq $selected) 'Matching explicit owner accepted'
     try{Resolve-DeploymentModuleCacheOwner $fixture $manifest $sha (Join-Path $fixture 'wrong')|Out-Null;throw 'Expected conflict'}catch{Assert ($_.Exception.Message -match 'conflicts') 'Conflicting explicit owner rejected'}
     $script:resolverExit=1
     try{Resolve-DeploymentModuleCacheOwner $fixture $manifest $sha ''|Out-Null;throw 'Expected resolver exit rejection'}catch{Assert ($_.Exception.Message -match 'verification failed') 'Nonzero resolver exit rejected'}
     $script:resolverExit=0;$script:resolverPacket='{}'
     try{Resolve-DeploymentModuleCacheOwner $fixture $manifest $sha ''|Out-Null;throw 'Expected missing owner rejection'}catch{Assert ($_.Exception.Message -match 'owner missing') 'Empty resolver result rejected'}
   }finally{Remove-Item Function:\node;Remove-Item Function:\Resolve-DeploymentModuleCacheOwner}
   $owner=Join-Path $fixture 'owner';$projectA=Join-Path $owner 'workspaces/a';$projectB=Join-Path $owner 'workspaces/b'
   New-Item -ItemType Directory $projectA,$projectB|Out-Null
   foreach($project in @($projectA,$projectB)){Set-Content (Join-Path $project 'source.txt') 'same content'}
   $cache=Open-BuildModuleCache $projectA $owner;$cache.SkipCleanup=$true
   $generated=0
   $a=Get-BuildModuleEntry $cache providers @((Join-Path $projectA 'source.txt')) @('handoff')
   if(-not $a.Hit){$generated++;Set-Content (Join-Path $a.Path 'output.txt') 'compiled';Save-BuildModuleEntry $a @('output.txt')}
   # An empty, genuinely finalized source catalog is required for normal retirement.
   $null=Register-ArtifactLifecycle $projectA 'run:fixture-a' run fixture complete $true @{payload=(Join-Path $projectA 'artifacts/absent')} -Generated -ProtectionKnown
   $null=Invoke-ArtifactLifecycleNode @('finalize','--project-root',$projectA,'--id','run:fixture-a')
   $cache.Lease.Dispose();$cache=Open-BuildModuleCache $projectB $owner;$cache.SkipCleanup=$true
   $b=Get-BuildModuleEntry $cache providers @((Join-Path $projectB 'source.txt')) @('handoff')
   if(-not $b.Hit){$generated++}
   Assert ($b.Hit -and $b.Key -ceq $a.Key -and $generated -eq 1) 'A/B reuse one physical complete cache without invoking generation twice'
   $inspection=Get-BuildCacheProjectInspection $cache $projectA
   Assert ($inspection.status -eq 'ready-for-proof') ('A normal retirement inspection: '+$inspection.reason)
   $proof=Join-Path $owner 'retire-a.json'
   @{schema=1;project=$projectA;registry_sha256=$inspection.registrySha256;catalog_sha256=$inspection.catalogSha256;producer_stopped_verified=$true;consumers_released_verified=$true;installations_released_verified=$true;rollback_released_verified=$true;reason='Synchronous fixture producer ended, no durable consumers or installations'}|ConvertTo-Json|Set-Content $proof
   $retired=Remove-BuildCacheProjectRegistration $cache $projectA $proof (Get-BuildModuleFileHash $proof) -Apply
   Assert ($retired.status -eq 'retired' -and $retired.registrationAbsent) 'A exact registration retired without removing B'
   Assert-BuildCachePath $projectA $owner|Out-Null;Remove-Item -LiteralPath $projectA -Recurse -ErrorAction Stop
   Assert (-not(Test-Path $projectA)) 'Retired A fixture removed'
   $again=Get-BuildModuleEntry $cache providers @((Join-Path $projectB 'source.txt')) @('handoff')
   Assert ($again.Hit -and (Test-Path $a.Path) -and $projectB -in @(Get-BuildCacheProjects $cache)) 'B survives A retirement'
   # Unrelated historical absence blocks replacement/deletion, not a verified hit.
   $registry=Join-Path $cache.Root '.projects.json';$data=Get-Content $registry -Raw|ConvertFrom-Json
   $data.projects+=@(Join-Path $owner 'missing-legacy');$data|ConvertTo-Json|Set-Content $registry
   $again=Get-BuildModuleEntry $cache providers @((Join-Path $projectB 'source.txt')) @('handoff')
   Assert $again.Hit 'Verified complete hit remains reusable with unrelated missing legacy project'
   try{Get-BuildModuleEntry $cache providers @((Join-Path $projectB 'source.txt')) @('handoff') -Force|Out-Null;throw 'Expected replacement guard'}catch{Assert ($_.Exception.Message -match 'Missing registered cache project') 'Legacy uncertainty still prevents selected-key replacement'}
   Assert (Test-Path $a.Path) 'Legacy replacement rejection preserves payload'
   . (Join-Path $PSScriptRoot 'window-control-cache.ps1')
   $nativeCopy=Join-Path $owner 'workspaces/native-b';New-Item -ItemType Directory $nativeCopy|Out-Null
   $native=$null
   try{
     $native=Open-WindowControlSharedCache $projectB $owner
     Assert (-not $native.CanReuse) 'New shared native target cannot claim a receipt hit'
     $nativeTarget=$native.Target
     $plan=Get-ArtifactLifecyclePlan -ProjectRoot $owner -Candidates @($nativeTarget)
     Assert (@($plan.groups|Where-Object {$_.id -ceq $native.LifecycleId -and $_.blockers.Count}).Count -eq 1) 'Active WindowControl target is protected from canonical cleanup'
     try{Open-WindowControlSharedCache $nativeCopy $owner|Out-Null;throw 'Expected native lease collision'}catch{Assert ($_.Exception.Message -match 'holds the shared target lease') 'Shared native lease excludes another workspace'}
     Set-Content (Join-Path $nativeTarget 'fixture-output.txt') 'owned generated native fixture'
     Complete-WindowControlSharedCache $native
     $native.Lease.Dispose();$native=$null
     $native=Open-WindowControlSharedCache $nativeCopy $owner
     Assert ($native.CanReuse -and $native.Target -ceq $nativeTarget) 'A completed native target has the same owner/path in B'
     Fail-WindowControlSharedCache $native
     $native.Lease.Dispose();$native=$null
     $script:running=@([pscustomobject]@{Name='cargo.exe';ProcessId=987654;CommandLine='cargo fixture';ExecutablePath='fixture'})
     try{Open-WindowControlSharedCache $nativeCopy $owner|Out-Null;throw 'Expected interrupted producer guard'}catch{Assert ($_.Exception.Message -match 'Compiler process') 'Interrupted native retry preserves possibly running compiler'}finally{$script:running=@()}
     $native=Open-WindowControlSharedCache $nativeCopy $owner
     Assert (-not $native.CanReuse) 'Failed native generation requires rebuilding despite old output'
     Set-Content (Join-Path $nativeTarget 'fixture-output.txt') 'rebuilt fixture output after synchronous failed fixture producer'
     Complete-WindowControlSharedCache $native
     $native.Lease.Dispose();$native=$null
     $marker=Join-Path $nativeTarget 'owner.json';$markerBytes=[IO.File]::ReadAllBytes($marker)
     try{
       Set-Content $marker '{"schema":1}'
       try{Open-WindowControlSharedCache $nativeCopy $owner|Out-Null;throw 'Expected native marker rejection'}catch{Assert ($_.Exception.Message -match 'ownership marker') 'Corrupt native ownership never authorizes use'}
     }finally{[IO.File]::WriteAllBytes($marker,$markerBytes)}
     $unregisteredOwner=Join-Path $fixture 'unregistered-native';New-Item -ItemType Directory $unregisteredOwner|Out-Null
     $unregisteredTarget=Get-WindowControlSharedTarget $unregisteredOwner;New-Item -ItemType Directory $unregisteredTarget|Out-Null
     Set-Content (Join-Path $unregisteredTarget 'sentinel') 'unclaimed'
     try{Open-WindowControlSharedCache $unregisteredOwner $unregisteredOwner|Out-Null;throw 'Expected native legacy refusal'}catch{Assert ($_.Exception.Message -match 'Unregistered window-control target') 'Shared native owner never claims an unregistered target'}
     Assert ((Get-Content (Join-Path $unregisteredTarget 'sentinel')) -ceq 'unclaimed') 'Unregistered native payload preserved'
   }finally{if($native -and $native.Lease){$native.Lease.Dispose()}}
   Write-Output 'WindowControl shared ownership: stable target, native cleanup protection, physical lease, completed cross-copy selection, failed/active retry, marker and legacy guards passed; exit=0'
   Write-Output 'Ownership lifetime: A/B one generation, exact retirement, A absence/B hit, legacy hit/replacement separation passed; exit=0'
   if($OwnershipOnly){return}
   $cache.Lease.Dispose();$cache=$null
 }
 if($RecoveryOnly){Test-ModuleMarkerRecovery $fixture;return}
 if($InvalidationOnly){
   $owner=Join-Path $fixture 'owner';$project=Join-Path $owner 'snapshots/absent';$other=Join-Path $owner 'snapshots/existing'
   New-Item -ItemType Directory $project,$other|Out-Null
   $cache=Open-BuildModuleCache $project $owner
   $cache.Lease.Dispose();$cache=Open-BuildModuleCache $owner
   Remove-Item -LiteralPath $project -ErrorAction Stop
   $registry=Join-Path $cache.Root '.projects.json';$original=[IO.File]::ReadAllBytes($registry);$hash=Get-BuildModuleFileHash $registry
   $evidence=Join-Path $owner 'invalidation.json';$receipt=Join-Path $owner 'invalidation-receipt.json'
   $proof=@{schema=1;action='invalidate-absent-project-cache-registration';user_authorized=$true;project=$project;cache_owner=$owner;registry_sha256=$hash;reason='User authorized regenerable cache invalidation'}
   $proof|ConvertTo-Json|Set-Content $evidence
   $evidenceHash=Get-BuildModuleFileHash $evidence
   $reject={param($Pattern)
     try{Remove-BuildCacheAbsentProjectRegistration $cache $project $evidence $evidenceHash $receipt -Apply|Out-Null;throw 'Expected invalidation rejection'}catch{Assert ($_.Exception.Message -match $Pattern) "Expected invalidation guard $Pattern, got: $($_.Exception.Message)"}
     Assert ((Get-BuildModuleFileHash $registry) -eq $hash -and -not(Test-Path $receipt)) 'Rejected invalidation preserves registry and creates no receipt'
   }
   Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Default absent-project retirement remains protected'
   $cache.Lease.Dispose();& $reject 'lease';$cache=Open-BuildModuleCache $owner
   Move-Item -LiteralPath $evidence -Destination ($evidence+'.held');& $reject 'Readable';Move-Item -LiteralPath ($evidence+'.held') -Destination $evidence
   Add-Content $evidence ' ';& $reject 'Stale';$proof|ConvertTo-Json|Set-Content $evidence
   $proof.user_authorized=$false;$proof|ConvertTo-Json|Set-Content $evidence;$evidenceHash=Get-BuildModuleFileHash $evidence;& $reject 'user-authorized'
   $proof.user_authorized=$true;$proof|ConvertTo-Json|Set-Content $evidence;$evidenceHash=Get-BuildModuleFileHash $evidence
   New-Item -ItemType Directory $project|Out-Null;& $reject 'Only an absent';Remove-Item -LiteralPath $project -ErrorAction Stop
   $script:running=@([pscustomobject]@{ProcessId=123456;Name='node.exe';CommandLine=$cache.Root;ExecutablePath=$null});& $reject 'process reference';$script:running=@()
   $script:inspectionFails=$true;& $reject 'inspection unavailable';$script:inspectionFails=$false
   $script:inspectionMutation={New-Item -ItemType Directory $project|Out-Null};& $reject 'inputs changed';Remove-Item -LiteralPath $project -ErrorAction Stop
   $script:inspectionMutation={Add-Content $evidence ' '};& $reject 'inputs changed';$proof|ConvertTo-Json|Set-Content $evidence
   $script:registryRace=$registry
   try{Remove-BuildCacheAbsentProjectRegistration $cache $project $evidence $evidenceHash $receipt -Apply|Out-Null;throw 'Expected registry race rejection'}catch{Assert ($_.Exception.Message -match 'inputs changed') 'Registry race rejected'}finally{[IO.File]::WriteAllBytes($registry,$original)}
   # The durable consumer list remains a separate mandatory protection boundary.
   function node {param([Parameter(ValueFromRemainingArguments)]$Arguments) $global:LASTEXITCODE=0;'[{"references":[{"id":"live"}]}]'}
   try{& $reject 'Durable cache consumer'}finally{Remove-Item Function:node}
   $preview=Remove-BuildCacheAbsentProjectRegistration $cache $project $evidence $evidenceHash $receipt
   Assert ($preview.status -eq 'selected' -and -not(Test-Path $receipt)) 'Preview preserves registry and receipt absence'
   $result=Remove-BuildCacheAbsentProjectRegistration $cache $project $evidence $evidenceHash $receipt -Apply
   $saved=Get-Content $receipt -Raw|ConvertFrom-Json
   Assert ($result.status -eq 'invalidated' -and $result.registrationAbsent -and $saved.historicalOutcome -eq 'unknown' -and $saved.historical_consumer_index -eq 'unavailable') 'Explicit invalidation preserves unknown historical outcome'
   Assert ([Convert]::ToBase64String($original) -ceq $saved.original_registry_base64 -and $saved.original_registry_sha256 -eq $hash -and $saved.removed_project -ceq $project) 'Immutable receipt preserves exact registry bytes and removed project'
   Assert ($owner -in @(Get-BuildCacheProjects $cache) -and (Test-Path $other) -and -not(Test-Path $project)) 'Only missing registration removed; other source and owner preserved'
   Write-Output 'Absent-project cache invalidation: explicit authority, default protection, lease, evidence/registry/absence/process/consumer guards, preview and immutable original registry receipt passed; exit=0'
   return
 }
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
 if($RegistryOnly -or $ClaimInspectionOnly -or $ProcessInspectionOnly){
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
   Assert ($inspection.status -eq 'ready-for-proof') ("Genuine catalog survives canonical finalization: "+($inspection|ConvertTo-Json -Depth 10 -Compress))
   if($RegistryOnly -or $ProcessInspectionOnly){
     $proof=Join-Path $owner 'process-retirement-proof.json'
     @{schema=1;project=$project;registry_sha256=$inspection.registrySha256;catalog_sha256=$inspection.catalogSha256;producer_stopped_verified=$true;consumers_released_verified=$true;installations_released_verified=$true;rollback_released_verified=$true;reason='Isolated fixture has no consumers, installations or producers'}|ConvertTo-Json|Set-Content -LiteralPath $proof
     $proofHash=Get-BuildModuleFileHash $proof
     $cache.Lease.Dispose();$cache=$null
     $cli=Join-Path $PSScriptRoot 'manage-module-cache-projects.ps1'
     $invokeCli={
       $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=(Get-Process -Id $PID).Path
       foreach($argument in @('-NoProfile','-File',$cli,'-CacheProjectRoot',$owner,'-Action','retire','-Project',$project,'-EvidencePath',$proof,'-EvidenceSha256',$proofHash)){$start.ArgumentList.Add($argument)}
       $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
       $process=[Diagnostics.Process]::Start($start)
       try{$stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync();$process.WaitForExit();@{exitCode=$process.ExitCode;stdout=$stdout.Result;stderr=$stderr.Result}}finally{$process.Dispose()}
     }
     $preview=& $invokeCli
     Assert ($preview.exitCode -eq 0 -and ($preview.stdout|ConvertFrom-Json).status -eq 'selected') ('Actual management CLI excludes only itself: '+$preview.stderr)
     $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=(Get-Process -Id $PID).Path
     foreach($argument in @('-NoProfile','-CommandWithArgs','param([string]$Project) [Console]::Out.WriteLine("ready");[Console]::Out.Flush();$null=[Console]::ReadLine()',$project)){$start.ArgumentList.Add($argument)}
     $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
     $projectProcess=[Diagnostics.Process]::Start($start)
     try{
       Assert ($projectProcess.StandardOutput.ReadLine() -eq 'ready') 'Separate project process is actually running'
       $blocked=& $invokeCli
       Assert ($blocked.exitCode -ne 0 -and $blocked.stderr -match 'Running project process or compiler reference') 'Separate project process remains protective'
     }finally{$projectProcess.StandardInput.Close();$projectProcess.WaitForExit();Assert ($projectProcess.ExitCode -eq 0) 'Owned project child actually stopped';$projectProcess.Dispose()}
     $cache=Open-BuildModuleCache $owner
     try{
       $script:running=@(@{ProcessId=$PID+10000;Name='cargo.exe';CommandLine='cargo build'})
       try{Remove-BuildCacheProjectRegistration $cache $project $proof $proofHash|Out-Null;throw 'Expected compiler guard'}catch{Assert ($_.Exception.Message -match 'Running project process or compiler reference') 'Other compiler remains protective'}
     }finally{$script:running=@();$cache.Lease.Dispose();$cache=$null}
     $preview=& $invokeCli
     Assert ($preview.exitCode -eq 0 -and ($preview.stdout|ConvertFrom-Json).status -eq 'selected') ('Stopped project child releases process guard: '+$preview.stderr)
     Write-Output 'Module retirement process inspection: actual CLI self exclusion, separate project child protection/terminal release, and other compiler guard passed; exit=0'
     if($ProcessInspectionOnly){return}
     $cache=Open-BuildModuleCache $owner
   }
   $catalogLock=Join-Path $project 'artifacts/maintenance/lifecycles/catalog.lock'
   Assert (Test-Path $catalogLock) 'Canonical finalization preserves the stable OS lock file'
   $heldCatalog=Start-ArtifactMaintenanceClient $project
   try{Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Occupied OS catalog lease blocks retirement inspection'}
   finally{$null=Send-ArtifactMaintenanceCommand $heldCatalog @{operation='release'};$heldCatalog.Process.StandardInput.Close();$heldCatalog.Process.WaitForExit();Assert ($heldCatalog.Process.ExitCode -eq 0) 'Inspection fixture lease exits successfully';$heldCatalog.Process.Dispose()}
   $stableLockBytes=[IO.File]::ReadAllBytes($catalogLock)
   try{[IO.File]::WriteAllText($catalogLock,'{"schema":1}');Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Legacy catalog marker is not mistaken for an idle stable lease'}
   finally{[IO.File]::WriteAllBytes($catalogLock,$stableLockBytes)}
   $reservationControls=Join-Path $project 'artifacts/maintenance/lifecycles/reservations'
   New-Item -ItemType Directory $reservationControls|Out-Null
   $unknownControl=Join-Path $reservationControls 'unknown.json';Set-Content $unknownControl '{}'
   try{Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Unresolved reservation controls protect an otherwise empty catalog';Assert (Test-Path $unknownControl) 'Inspection preserves unresolved reservation evidence'}
   finally{Remove-Item -LiteralPath $unknownControl;Remove-Item -LiteralPath $reservationControls}
   $afterLease=Get-BuildCacheProjectInspection $cache $project
   Assert ($afterLease.status -eq 'ready-for-proof' -and $afterLease.catalogSha256 -ceq $inspection.catalogSha256) 'Validated lease metadata renewal preserves semantic catalog identity'
   # Do not simplify this to an ignored filename: inspection must exclude new
   # artifact-run claims and validate the real stable native lease at release.
   $claimLock=Join-Path $project 'artifacts/maintenance/lifecycles/.run-claim.lock'
   Assert (Test-Path $claimLock) 'Inspection retains the actual stable claim inode'
   $claimBytes=[IO.File]::ReadAllBytes($claimLock)
   foreach($invalidClaim in @('{"schema":1}','not JSON')){
     try{[IO.File]::WriteAllText($claimLock,$invalidClaim);$blocked=Get-BuildCacheProjectInspection $cache $project;Assert ($blocked.status -eq 'blocked') 'Malformed or legacy claim requires explicit recovery';Assert ([IO.File]::ReadAllText($claimLock) -ceq $invalidClaim) 'Rejected claim bytes preserved'}
     finally{[IO.File]::WriteAllBytes($claimLock,$claimBytes)}
   }
   $unknownClaim=Join-Path $project 'artifacts/maintenance/lifecycles/unknown.claim'
   try{[IO.File]::WriteAllText($unknownClaim,'unknown');Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Only the held exact claim control is recognized';Assert (Test-Path $unknownClaim) 'Unknown claim control preserved'}
   finally{Remove-Item -LiteralPath $unknownClaim -ErrorAction Stop}
   $claimAlias=Join-Path $project 'claim-hardlink'
   try{New-Item -ItemType HardLink -Path $claimAlias -Target $claimLock|Out-Null;Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Hardlinked native claim is not an idle plain sentinel'}
   finally{if(Test-Path $claimAlias){Remove-Item -LiteralPath $claimAlias -ErrorAction Stop}}
   Move-Item -LiteralPath $claimLock -Destination $claimAlias -ErrorAction Stop
   try{New-Item -ItemType Junction -Path $claimLock -Target $owner|Out-Null;Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Linked claim paths remain protected';Assert ((Get-Item -LiteralPath $claimLock).LinkType -eq 'Junction') 'Linked claim preserved'}
   finally{if(Test-Path $claimLock){Remove-Item -LiteralPath $claimLock -ErrorAction Stop};Move-Item -LiteralPath $claimAlias -Destination $claimLock -ErrorAction Stop}
   $heldClaim=Start-ArtifactMaintenanceClient $project -ClaimBeforeCatalog
   try{
     Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Occupied claim lease blocks retirement inspection'
     $probe='const path=require("node:path"),{acquire}=require(process.argv[1]);try{const l=acquire(path.join(process.argv[2],"artifacts/maintenance/lifecycles/.run-claim.lock"),{operation:"artifact-run.claim",waitMs:0});l.release();throw Error("Claim unexpectedly available");}catch(e){if(e.code!=="EEXIST")throw e;}'
     & node -e $probe (Join-Path $PSScriptRoot 'maintenance-lock-owner.cjs') $project
     Assert ($LASTEXITCODE -eq 0) 'Held inspection prevents a fresh artifact-run claim'
   }finally{
     $release=Send-ArtifactMaintenanceCommand $heldClaim @{operation='release'};$heldClaim.Process.StandardInput.Close();$heldClaim.Process.WaitForExit()
     Assert ($heldClaim.Process.ExitCode -eq 0 -and $release.claim.native_close_observed -eq $true -and $release.claim.native_exit_code -eq 0) 'Both native leases actually terminate successfully'
     $heldClaim.Process.Dispose()
   }
   $heldClaim=Start-ArtifactMaintenanceClient $project -ClaimBeforeCatalog
   $displacedClaim=Join-Path $project 'displaced-claim'
   try{
     Move-Item -LiteralPath $claimLock -Destination $displacedClaim -ErrorAction Stop
     [IO.File]::WriteAllBytes($claimLock,$claimBytes)
     try{$null=Send-ArtifactMaintenanceCommand $heldClaim @{operation='release'};throw 'Expected replaced claim refusal'}
     catch{Assert ($_.Exception.Message -match 'identity|owner changed') 'Replaced claim fails native release verification'}
     $heldClaim.Process.StandardInput.Close();$heldClaim.Process.WaitForExit()
     Assert ($heldClaim.Process.ExitCode -ne 0) 'Uncertain claim release cannot report a successful client exit'
     Assert ((Test-Path $claimLock) -and (Test-Path $displacedClaim)) 'Replaced and original claim evidence preserved'
   }finally{$heldClaim.Process.StandardInput.Close();$heldClaim.Process.WaitForExit();$heldClaim.Process.Dispose()}
   # Both stopped fixture sentinels are now disposable. Restore the original
   # inode so subsequent identity checks observe the canonical owner object.
   Remove-Item -LiteralPath $claimLock -ErrorAction Stop
   Move-Item -LiteralPath $displacedClaim -Destination $claimLock -ErrorAction Stop
   $afterClaim=Get-BuildCacheProjectInspection $cache $project
   Assert ($afterClaim.status -eq 'ready-for-proof' -and $afterClaim.catalogSha256 -ceq $inspection.catalogSha256) 'Claim renewal and failed admission preserve semantic identity and release custody'
   if($ClaimInspectionOnly){Write-Output 'Module claim inspection: canonical empty catalog, real claim custody, occupied catalog/claim, malformed/legacy/hardlinked/replaced claim, semantic renewal and terminal release passed; exit=0';return}
   # Exercise immutable controls emitted by the real owner, rather than fabricated idle markers.
   $settledId='run:inspection-terminal';$settledMember=Join-Path $project 'artifacts/inspection-terminal'
   $null=Register-ArtifactLifecycle -ProjectRoot $project -Id $settledId -Kind run -Owner fixture -State complete -MembershipComplete $true -Members @{payload=$settledMember} -Generated -ProtectionKnown
   $terminalClient=Start-ArtifactMaintenanceClient $project
   try{
     $null=Send-ArtifactMaintenanceCommand $terminalClient @{operation='reserve';ids=@($settledId)}
     $null=Send-ArtifactMaintenanceCommand $terminalClient @{operation='releaseCatalog'}
     $outcomes=@(@{id=$settledId;status='deleted';members=@(@{path=$settledMember;status='deleted';remaining=$false})})
     $terminalProof=Save-ArtifactCleanupEvidence $project @{groups=@(@{members=@(@{path=$settledMember})})} $outcomes
     $finished=Send-ArtifactMaintenanceCommand $terminalClient @{operation='finish';outcomes=$outcomes;evidenceRef=$terminalProof.path;evidenceSha=$terminalProof.sha256}
     Assert ($finished.finished -eq $true -and -not @($finished.reservations_retained).Count) 'Native terminal receipt is synced before active fence removal'
   }finally{$null=Send-ArtifactMaintenanceCommand $terminalClient @{operation='release'};$terminalClient.Process.StandardInput.Close();$terminalClient.Process.WaitForExit();Assert ($terminalClient.Process.ExitCode -eq 0) 'Terminal fixture native owner stopped';$terminalClient.Process.Dispose()}
   $null=Invoke-ArtifactLifecycleNode @('finalize','--project-root',$project,'--id',$settledId)
   $settledInspection=Get-BuildCacheProjectInspection $cache $project
   Assert ($settledInspection.status -eq 'ready-for-proof') ('Genuine terminal controls permit independent retirement proof: '+$settledInspection.reason)
   $renewedInspection=Get-BuildCacheProjectInspection $cache $project
   Assert ($renewedInspection.catalogSha256 -ceq $settledInspection.catalogSha256) 'Group lock diagnostic renewal preserves semantic receipt identity'
   $terminalReceipt=@(Get-ChildItem -LiteralPath $reservationControls -Filter '*.terminal')[0].FullName
   $terminalBytes=[IO.File]::ReadAllBytes($terminalReceipt)
   try{
     [IO.File]::WriteAllText($terminalReceipt,'{}')
     Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Malformed terminal controls remain protective'
   }finally{[IO.File]::WriteAllBytes($terminalReceipt,$terminalBytes)}
   try{
     [IO.File]::AppendAllText($terminalReceipt,' ')
     $changedReceipt=Get-BuildCacheProjectInspection $cache $project
     Assert ($changedReceipt.status -eq 'ready-for-proof' -and $changedReceipt.catalogSha256 -cne $settledInspection.catalogSha256) 'Immutable terminal bytes remain part of retirement proof identity'
   }finally{[IO.File]::WriteAllBytes($terminalReceipt,$terminalBytes)}
   $groupLock=@(Get-ChildItem -LiteralPath $reservationControls -Filter '*.lock')[0].FullName
   $groupLockBytes=[IO.File]::ReadAllBytes($groupLock)
   try{
     [IO.File]::WriteAllText($groupLock,'{"schema":1}')
     Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Malformed or legacy group lock controls require explicit recovery'
   }finally{[IO.File]::WriteAllBytes($groupLock,$groupLockBytes)}
   $activeControl=Join-Path $reservationControls (('a'*64)+'.json')
   try{[IO.File]::WriteAllText($activeControl,'{}');Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Any active reservation publication remains protective'}
   finally{Remove-Item -LiteralPath $activeControl -ErrorAction Stop}
   $unknownControl=Join-Path $reservationControls 'unknown.control'
   try{[IO.File]::WriteAllText($unknownControl,'unknown');Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Unknown non-JSON reservation controls remain protective'}
   finally{Remove-Item -LiteralPath $unknownControl -ErrorAction Stop}
   $catalogGate=Start-ArtifactMaintenanceClient $project
   try{$heldControls=Start-BuildCacheReservationInspection $project $reservationControls}
   finally{$null=Send-ArtifactMaintenanceCommand $catalogGate @{operation='release'};$catalogGate.Process.StandardInput.Close();$catalogGate.Process.WaitForExit();$catalogGate.Process.Dispose()}
   try{Assert ((Get-BuildCacheProjectInspection $cache $project).status -eq 'blocked') 'Occupied native group leases block an otherwise settled catalog'}
   finally{$null=Send-ArtifactMaintenanceCommand $heldControls @{operation='release'};$heldControls.Process.StandardInput.Close();$heldControls.Process.WaitForExit();Assert ($heldControls.Process.ExitCode -eq 0) 'Held group inspection leases released';$heldControls.Process.Dispose()}
   # Recovery uses a directly owned native child. Wait for its close event and
   # the supervising Node process exit; PID lookup alone is not stop evidence.
   $recoveredId='run:inspection-recovered';$recoveredMember=Join-Path $project 'artifacts/inspection-recovered'
   $null=Register-ArtifactLifecycle -ProjectRoot $project -Id $recoveredId -Kind run -Owner fixture -State complete -MembershipComplete $true -Members @{payload=$recoveredMember} -Generated -ProtectionKnown
   $crashSource='const path=require("node:path"),assert=require("node:assert/strict"),{spawn}=require("node:child_process"),{createInterface}=require("node:readline"),command=require(process.argv[1]).resolveMaintenanceCommand();const child=spawn(command.executable,[...command.args,"--lease",path.join(process.argv[2],"artifacts/maintenance/lifecycles/catalog.lock"),"--operation","test.inspect-recovery","--wait-ms","0","--parent-pid",String(process.pid)],{stdio:["pipe","pipe","pipe"],windowsHide:true});let result,stage=0,error,stderr="";const fail=e=>{error=e;child.stdin.destroy();child.kill();};const timer=setTimeout(()=>fail(Error("Owned native helper close timeout")),10000);child.on("error",fail);child.stderr.on("data",b=>{stderr=(stderr+b).slice(0,4096);});createInterface({input:child.stdout}).on("line",line=>{try{assert(Buffer.byteLength(line)<1048576);const packet=JSON.parse(line);assert.equal(packet.ok,true,packet.error);assert.equal(packet.id,stage);if(stage++===0){assert.equal(packet.result.pid,child.pid);child.stdin.write(JSON.stringify({id:1,operation:"reserve_producers",records:[{id:process.argv[3],revision:1}]})+"\n");}else{assert.equal(stage,2);result=packet.result;assert.equal(result.observed[0].fence.lease_owner.pid,child.pid);child.stdin.end();}}catch(e){fail(e);}});child.on("close",(code,signal)=>{clearTimeout(timer);try{if(error)throw error;assert.equal(code,0,stderr);assert.equal(signal,null);assert.equal(stage,2);assert(result);process.stdout.write(JSON.stringify(result));}catch(e){console.error(e);process.exitCode=1;}});'
   $node=(Get-Command node -CommandType Application|Select-Object -First 1).Source
   $crashed=@(& $node -e $crashSource (Join-Path $PSScriptRoot 'maintenance-owner-config.cjs') $project $recoveredId)
   Assert ($LASTEXITCODE -eq 0) 'Owned native helper close and supervising producer exit observed after real reservation publication'
   $activeFiles=@(Get-ChildItem -LiteralPath $reservationControls -Filter '*.json');Assert ($activeFiles.Count -eq 1) 'Exactly one known fixture reservation remains active'
   $stopProof=Join-Path $project 'artifacts/maintenance/evidence/inspection-recovery.json'
   $recoveryRequest=Join-Path $project 'artifacts/inspection-recovery-request.json'
   # The native protocol compares lowercase raw SHA and the exact JSON fence.
   # The cache hash helper returns uppercase, and PowerShell date conversion can
   # alter producer timestamp strings. Preserve the native JSON through Node.
   $prepareRecovery='const fs=require("node:fs"),crypto=require("node:crypto"),assert=require("node:assert/strict"),[active,proofPath,requestPath,id,observer]=process.argv.slice(1);const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex"),raw=fs.readFileSync(active),fence=JSON.parse(raw),original=JSON.parse(observer).observed.find(item=>item.id===id);assert(original,"Exact acquired fixture observer required");assert.deepEqual(fence,original.fence,"Reservation changed after independently observed helper stop");const sha=hash(raw),proof=Buffer.from(JSON.stringify({id,producer_stopped_verified:true,process_tree_stopped_verified:true,reservation_sha256:sha,lease_owner:fence.lease_owner})+"\n");fs.writeFileSync(proofPath,proof,{flag:"wx"});fs.writeFileSync(requestPath,JSON.stringify({operation:"recover_reservation",id,producer_stopped_verified:true,reason:"Fixture-owned producer and bounded native helper tree stopped after EOF",expected_sha256:sha,token:fence.token,fence,evidence_ref:proofPath,evidence_sha256:hash(proof)}),{flag:"wx"});'
   $null=& $node -e $prepareRecovery $activeFiles[0].FullName $stopProof $recoveryRequest $recoveredId ($crashed -join "`n")
   Assert ($LASTEXITCODE -eq 0) 'Recovery request pins unchanged native fence, token and lowercase raw hashes'
   $ownerJson=@(& $node -e 'process.stdout.write(JSON.stringify(require(process.argv[1]).resolveMaintenanceCommand()))' (Join-Path $PSScriptRoot 'maintenance-owner-config.cjs'))
   Assert ($LASTEXITCODE -eq 0) 'Frozen maintenance owner resolves for fixture recovery'
   $ownerCommand=($ownerJson -join "`n")|ConvertFrom-Json
   $ownerBinary=$ownerCommand.executable;$ownerArgs=@($ownerCommand.args)+@('--project-root',$project,'--request',$recoveryRequest)
   $null=& $ownerBinary @ownerArgs
   Assert ($LASTEXITCODE -eq 0) 'Real native reservation recovery emits immutable receipt without changing historical outcome'
   $null=Invoke-ArtifactLifecycleNode @('finalize','--project-root',$project,'--id',$recoveredId)
   $inspection=Get-BuildCacheProjectInspection $cache $project
   Assert ($inspection.status -eq 'ready-for-proof' -and @(Get-ChildItem -LiteralPath $reservationControls -Filter '*.recovered').Count -eq 1) ('Genuine recovered controls permit independent retirement proof: '+$inspection.reason)
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
 if(-not $CleanupOnly -and -not $RecipeOnly){Test-ModuleMarkerRecovery (Join-Path $fixture 'marker-recovery')}
 $source=Join-Path $fixture 'source';New-Item -ItemType Directory $source|Out-Null;Set-Content (Join-Path $source 'code.ts') 'one'
 # Parallel readers must keep file identities and input roles aligned, and may
 # not publish partial rows when one worker cannot read its selected file.
 $parallelSource=Join-Path $fixture 'parallel-fingerprint';New-Item -ItemType Directory $parallelSource|Out-Null
 $expectedHashes=@{}
 for($i=0;$i -lt 24;$i++){
   $file=Join-Path $parallelSource ('file-{0:D2}.bin' -f $i)
   $bytes=[byte[]]::new(16384+$i)
   for($offset=0;$offset -lt $bytes.Length;$offset++){$bytes[$offset]=[byte](($offset+$i)%251)}
   [IO.File]::WriteAllBytes($file,$bytes)
   $expectedHashes[$file]=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
 }
 $selectedFile=Join-Path $parallelSource 'file-07.bin'
 $parallelRows=[Azrael.BuildModuleFingerprint]::Scan([string[]]@($parallelSource,$selectedFile),$false,$fixture)
 Assert (@($parallelRows|Where-Object FullName).Count -eq 25) 'Parallel scan retains every selected file and repeated input role'
 Assert ($parallelRows[0].Kind -ceq 'directory' -and $parallelRows[-2].Kind -ceq 'file' -and $parallelRows[-1].Input -eq 1) 'Parallel completion preserves input row order'
 foreach($row in $parallelRows|Where-Object FullName){Assert ($row.Sha256 -ceq $expectedHashes[$row.FullName]) 'Parallel result hash belongs to its original file'}
 $locked=[IO.File]::Open($selectedFile,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 try{
   $scanRejected=$false
   try{[Azrael.BuildModuleFingerprint]::Scan([string[]]@($parallelSource),$false,$fixture)|Out-Null}catch{$scanRejected=$true}
   Assert $scanRejected 'A failed parallel reader fails the complete fingerprint'
 }finally{$locked.Dispose()}
 Remove-Item -LiteralPath $parallelSource -Recurse -ErrorAction Stop
 # Independent schema-2 serialization contract: input roles, file names, SHA case,
 # value escaping and ordering must survive fingerprint implementation changes.
 $contractHash=Get-BuildModuleFileHash (Join-Path $source 'code.ts')
 $contractRecords=@(
   [ordered]@{schema=2;platform=@(Get-BuildCachePlatform)},
   [ordered]@{input=0;kind='directory'},
   [ordered]@{input=0;path='code.ts';sha256=$contractHash},
   [ordered]@{input=1;kind='file'},
   [ordered]@{input=1;path='code.ts';sha256=$contractHash},
   [ordered]@{value=0;content='tool <one> "quoted"'},
   [ordered]@{value=1;content="line`nbreak"}
 )
 $contractJson=ConvertTo-Json -InputObject $contractRecords -Depth 5 -Compress
 $contractKey=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($contractJson))).ToLowerInvariant()
 $fingerprintDiagnostics=@{}
 Assert ((Get-BuildModuleKey @($source,(Join-Path $source 'code.ts')) @('tool <one> "quoted"',"line`nbreak") -Diagnostics $fingerprintDiagnostics) -ceq $contractKey) 'Batched fingerprint preserves schema-2 key bytes'
 Assert ($fingerprintDiagnostics.inputManifest.inputs[1].path -ceq 'code.ts' -and $fingerprintDiagnostics.inputManifest.inputs[1].sha256 -ceq $contractHash -and $fingerprintDiagnostics.inputManifest.values.Count -eq 2) 'Manifest records relative input roles and value identities from the same fingerprint'
 # Module recipes select only their own implementation and common helpers.
 $recipe=Join-Path $fixture 'recipe.ps1';$common=Join-Path $fixture 'common.ps1'
 Copy-Item (Join-Path $PSScriptRoot 'build-module-companion-recipe.ps1') $recipe;Copy-Item (Join-Path $PSScriptRoot 'build-module-cache.ps1') $common
 $recipeKey=Get-BuildModuleKey @($source,$recipe,$common)
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
 $selectedLink=Join-Path $source 'selected-link'
 New-Item -ItemType Junction -Path $selectedLink -Target $source|Out-Null
 try{
   try{Get-BuildModuleKey @($source)|Out-Null;throw 'Expected selected source link failure'}catch{Assert ($_.Exception.Message -match 'Linked cache path') 'Batched source scan refuses selected links'}
   try{[Azrael.BuildModuleFingerprint]::Scan([string[]]@($source),$false,$fixture)|Out-Null;throw 'Expected output link failure'}catch{Assert ($_.Exception.Message -match 'Linked cache path') 'Batched output scan refuses nested links'}
 }finally{Remove-Item -LiteralPath $selectedLink -ErrorAction Stop}
 $excludedLink=Join-Path $source 'node_modules'
 New-Item -ItemType Junction -Path $excludedLink -Target $source|Out-Null
 try{Assert ((Get-BuildModuleKey @($source) @('excluded-guard')) -ceq $sourceKey) 'Excluded generated link is pruned before descent'}
 finally{Remove-Item -LiteralPath $excludedLink -ErrorAction Stop}
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
  $resultJson=ConvertTo-Json -InputObject @($cache.Results) -Depth 8
  $resultManifest=@($resultJson|ConvertFrom-Json|Where-Object key -CEQ $companionCache.Key)[0].inputManifest
  Assert ($resultManifest.inputs[1].sha256 -ceq $companionCache.InputManifest.inputs[1].sha256 -and $resultManifest.values[0].sha256 -ceq $companionCache.InputManifest.values[0].sha256) 'Module result serialization preserves source and tool value manifest for build evidence'
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
   Assert ($result.status -eq 'partial') ("ReadOnly payload deletion reports partial failure: " + ($result|ConvertTo-Json -Depth 15 -Compress))
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
  $legacyKey='0'*64;$legacyPath=Join-Path $cache.Root "providers/$legacyKey"
  New-Item -ItemType Directory $legacyPath|Out-Null
  @{schema=1;module='providers';key=$legacyKey}|ConvertTo-Json|Set-Content (Join-Path $legacyPath 'owner.json')
  $legacyPayload=Join-Path $legacyPath 'payload.txt';Set-Content $legacyPayload 'unconfirmed legacy fixture'
  $legacyRecord=Register-ArtifactLifecycle -ProjectRoot $cache.Owner -Id "run:module-cache:providers:$legacyKey" -Kind run -Owner 'module-build-cache' -State pending -MembershipComplete $false -Members @{'cache-entry'=$legacyPath}
  $legacyRegistry=Join-Path $cache.Owner ('artifacts/maintenance/lifecycles/'+[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($legacyRecord.id))).ToLowerInvariant()+'.json')
  $legacyBefore=Get-BuildModuleFileHash $legacyRegistry
  try{Remove-BuildModuleEntry $cache providers $legacyKey $legacyPath -Retry|Out-Null;throw 'Expected unknown legacy ownership guard'}catch{Assert ($_.Exception.Message -match 'Unconfirmed module cache') 'Retry preserves unconfirmed legacy ownership/protection'}
  Assert ((Test-Path $legacyPayload) -and (Get-BuildModuleFileHash $legacyRegistry) -eq $legacyBefore) 'Unknown legacy payload and lifecycle metadata remain unchanged'
 }
 Test-ModuleDeletionOrder
 if($CleanupOnly){Write-Output 'Production module cleanup: ReadOnly payload preserves logs/receipts; locked log follows payload and preserves receipts; retries verify absence; exit=0';return}
 $cache.SkipCleanup=$false
 Test-CompanionProductionRecipe
 if($RecipeOnly){Write-Output 'Production companion recipe scope, raw logs, metrics, cache hit, failed exit and superseded-key retirement; provider command routing passed; exit=0';return}
 $cache.SkipCleanup=$true
 try{Open-BuildModuleCache $fixture|Out-Null;throw 'Missing lock failure'}catch{Assert ($_.Exception.Message -match 'Another modular') 'Concurrent build must fail closed'}
 $a=Get-BuildModuleEntry $cache companion @($source) @('node1');Assert (-not $a.Hit) 'First build must miss'
 Assert ($a.MissReason -eq 'receipt-missing' -and $a.PhaseMetrics.inputFingerprintMs -ge 0) 'Miss reason and input fingerprint timing are observable'
 Set-Content (Join-Path $a.LogDirectory 'compile.log') 'raw command output'
 Set-Content (Join-Path $a.Path 'output.txt') 'compiled';Save-BuildModuleEntry $a @('output.txt')
 $diagnostics=Get-Content (Join-Path $a.Path 'cache.json') -Raw|ConvertFrom-Json
 Assert ($diagnostics.schema -eq 1 -and $diagnostics.phaseMetrics.publicationOutputMs -ge 0 -and $diagnostics.missReason -eq 'receipt-missing') 'Publication keeps schema and records additive diagnostics'
 Assert ($diagnostics.inputManifest.inputs[1].sha256 -ceq $a.InputManifest.inputs[1].sha256) 'Receipt binds the selected input manifest'
 $b=Get-BuildModuleEntry $cache companion @($source) @('node1');Assert $b.Hit 'Identical input must hit'
 if($IsWindows){
   $caseReceiptPath=Join-Path $b.Path 'cache.json'
   $caseReceipt=Get-Content $caseReceiptPath -Raw|ConvertFrom-Json
   $caseReceipt.files[0].path='OUTPUT.TXT'
   $caseReceipt|ConvertTo-Json -Depth 6|Set-Content $caseReceiptPath -Encoding utf8NoBOM
   $b=Get-BuildModuleEntry $cache companion @($source) @('node1')
   Assert $b.Hit 'Indexed output hashes retain Windows case-insensitive path lookup'
 }
 Assert ($null -eq $b.MissReason -and $b.PhaseMetrics.outputValidationMs -ge 0) 'Validated hit reports output validation timing without a miss'
 Set-Content (Join-Path $b.Path 'output.txt') 'damaged';$b=Get-BuildModuleEntry $cache companion @($source) @('node1');Assert (-not $b.Hit) 'Damaged output must miss'
 Assert ($b.MissReason -eq 'Cache output changed') 'Output hash mismatch is diagnosed'
 Set-Content (Join-Path $b.Path 'output.txt') 'compiled';Save-BuildModuleEntry $b @('output.txt')
 Set-Content (Join-Path $source 'code.ts') 'two';$c=Get-BuildModuleEntry $cache companion @($source) @('node1');Assert ($c.Key -ne $b.Key -and -not $c.Hit) 'Source change must miss'
 Assert ($c.InputManifest.inputs[1].sha256 -cne $b.InputManifest.inputs[1].sha256) 'Manifest identifies changed source bytes with key mismatch'
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
 Assert (-not(Test-Path $old.Path)) ("Selection retires unused prior key despite failure before Save; cleanup: " + ($cache.CleanupResults | ConvertTo-Json -Depth 8 -Compress))
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
 # Historical installation inputs do not pin rebuildable preparation tools.
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
 Assert ((-not(Test-Path $retained.Path)) -and (-not(Test-Path $compiler.Path))) 'Installed tool history does not pin obsolete preparation caches'
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
 # Shared owner reuse is content based; actual installed payloads stay protected.
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
   Assert ((-not(Test-Path $sharedDamaged.Path)) -and (-not(Test-Path $sharedOld.Path))) 'Another source installation history does not pin obsolete toolchains'
   $shared.SkipCleanup=$true
   $runtimePin=Get-BuildModuleEntry $shared companion @((Join-Path $projectB 'source')) @('installed-runtime')
   Set-Content (Join-Path $runtimePin.Path 'output.txt') 'runtime';Save-BuildModuleEntry $runtimePin @('output.txt')
   $runtimeDeployment=Join-Path $projectA 'artifacts/deployments/runtime'
   New-Item -ItemType Directory $runtimeDeployment|Out-Null
   @{hostInstalled=$true;generatedAt=[DateTime]::UtcNow.AddMinutes(1).ToString('o');packageDirectory=$runtimeDeployment;releaseDirectory=$runtimePin.Path}|ConvertTo-Json|Set-Content (Join-Path $runtimeDeployment 'deployment.json')
   $shared.SkipCleanup=$false
   $null=Get-BuildModuleEntry $shared companion @((Join-Path $projectB 'source')) @('replacement-tool')
   Assert (Test-Path $runtimePin.Path) 'Actual installed runtime path remains protected without preparation receipts'
   $registry=Join-Path $shared.Root '.projects.json';$validRegistry=Get-Content $registry -Raw;Set-Content $registry '{corrupt'
   try{Remove-OldBuildModuleCaches $shared|Out-Null;throw 'Missing corrupt registry failure'}catch{Assert ($_.Exception.Message -match 'JSON') 'Corrupt registry must stop all cache deletion'}
   Assert (Test-Path $runtimePin.Path) 'Corrupt registry performs no deletion'
   try{Get-BuildModuleEntry $shared companion @((Join-Path $projectB 'source')) @('shared-tool')|Out-Null;throw 'Missing corrupt entry failure'}catch{Assert ($_.Exception.Message -match 'JSON') 'Corrupt registry also stops entry mutation'}
   Assert (Test-Path $runtimePin.Path) 'Corrupt entry lookup performs no deletion'
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
