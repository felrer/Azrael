. (Join-Path $PSScriptRoot 'artifact-lifecycle.ps1')
# Module cache primitives. All mutation is serialized under the build-owned lock.
function Assert-BuildCachePath([string]$Path, [string]$Root) {
    $full=[IO.Path]::GetFullPath($Path);$boundary=[IO.Path]::GetFullPath($Root).TrimEnd('\','/')
    if($full -ne $boundary -and -not $full.StartsWith($boundary+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw "Cache path escapes root: $full"}
    $cursor=$full
    while($cursor){if((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw "Linked cache path: $cursor"};$cursor=[IO.Path]::GetDirectoryName($cursor)}
    return $full
}
function Get-BuildModuleFiles([string]$Path,[string]$Root) {
    $Path=Assert-BuildCachePath $Path $Root
    if(-not(Test-Path -LiteralPath $Path)){throw "Missing cache output: $Path"}
    $items=if(Test-Path $Path -PathType Leaf){@(Get-Item -LiteralPath $Path)}else{@(Get-ChildItem -LiteralPath $Path -Recurse -Force)}
    foreach($item in $items){
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Linked cache output: $($item.FullName)"}
        if(-not $item.PSIsContainer){$item}
    }
}
function Get-BuildCacheProjects($Cache,[switch]$RequireExisting) {
    $registry=Assert-BuildCachePath (Join-Path $Cache.Root '.projects.json') $Cache.Root
    if(-not(Test-Path -LiteralPath $registry)){throw 'Missing module cache project registry.'}
    $data=Get-Content -LiteralPath $registry -Raw -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop
    if($data.schema -ne 1 -or $data.projects -isnot [array] -or -not $data.projects.Count){throw 'Invalid module cache project registry.'}
    return @(foreach($project in $data.projects){
      if($project -isnot [string] -or -not [IO.Path]::IsPathFullyQualified($project)){throw 'Invalid registered cache project.'}
      $validated=Assert-BuildCachePath $project $Cache.Owner
      if($RequireExisting -and -not(Test-Path -LiteralPath $validated -PathType Container -ErrorAction Stop)){throw "Missing registered cache project: $validated"}
      $validated
    })
}
function Start-BuildCacheReservationInspection([string]$ProjectRoot,[string]$Directory) {
    # Retain native group leases while immutable control bytes contribute to the digest.
    $source=@'
"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const {isDeepStrictEqual:equal}=require("node:util"),{acquire}=require(process.argv[1]);
const root=path.resolve(process.argv[2]),directory=path.resolve(process.argv[3]);
assert.equal(directory,path.join(root,"artifacts/maintenance/lifecycles/reservations"),"Exact reservation control directory required");
const leases=[],observed=new Map();let observedBytes=0;
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex"),hashValue=value=>hash(JSON.stringify(value));
const text=value=>typeof value==="string"&&value.trim().length>0;
const hex=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const canonical=value=>process.platform==="win32"?path.resolve(value).toLowerCase():path.resolve(value);
function inside(base,target){const rel=path.relative(canonical(base),canonical(target));return rel===""||(!path.isAbsolute(rel)&&rel!==".."&&!rel.startsWith(".."+path.sep));}
function keys(value,expected){assert(value&&typeof value==="object"&&!Array.isArray(value));assert(equal(Object.keys(value).sort(),expected.split(" ").sort()),"Unexpected receipt shape");}
function plain(filename,kind){for(let current=filename;;current=path.dirname(current)){const stat=fs.lstatSync(current);assert(!stat.isSymbolicLink(),"Linked reservation control");assert(current===filename?(kind==="directory"?stat.isDirectory():stat.isFile()):stat.isDirectory(),"Nonplain reservation control");if(path.dirname(current)===current)break;}}
function remember(filename,observation){const previous=observed.get(filename);if(previous){assert(previous.identity===observation.identity&&previous.bytes.equals(observation.bytes),"Receipt evidence changed between controls");return;}observedBytes+=observation.bytes.length;assert(observedBytes<=128*1024*1024,"Reservation inspection exceeds bounded 128 MiB evidence budget");observed.set(filename,observation);}
function read(filename,max=64*1024*1024){plain(filename,"file");const descriptor=fs.openSync(filename,"r");try{const before=fs.fstatSync(descriptor,{bigint:true});assert(before.nlink===1n&&before.size<=BigInt(max),"Unbounded or multiply-linked reservation evidence");const chunks=[];let length=0;for(;;){const chunk=Buffer.allocUnsafe(Math.min(65536,max+1-length)),count=fs.readSync(descriptor,chunk,0,chunk.length,null);if(!count)break;length+=count;assert(length<=max,"Reservation evidence grew beyond bound");chunks.push(chunk.subarray(0,count));}const bytes=Buffer.concat(chunks,length),after=fs.lstatSync(filename,{bigint:true});assert(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size,"Reservation evidence identity changed");plain(filename,"file");return{bytes,identity:before.dev+":"+before.ino};}finally{fs.closeSync(descriptor);}}
function evidence(filename,sha){assert(text(filename)&&!filename.includes("\0")&&!filename.split(/[\\/]/).includes("..")&&hex(sha),"Missing or invalid receipt evidence identity");filename=path.resolve(root,filename);assert(inside(root,filename),"Receipt evidence escapes project");const observation=read(filename,16*1024*1024);assert.equal(hash(observation.bytes),sha,"Receipt evidence SHA mismatch");remember(filename,observation);return JSON.parse(observation.bytes.toString("utf8"));}
function leaseOwner(owner){keys(owner,"schema pid token acquired_at_ms operation");assert(owner.schema===2&&Number.isSafeInteger(owner.pid)&&owner.pid>0&&Number.isSafeInteger(owner.acquired_at_ms)&&owner.acquired_at_ms>=0&&typeof owner.token==="string"&&new RegExp("^"+owner.pid+"-[0-9]+-[a-f0-9]{16}$").test(owner.token)&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(owner.operation),"Invalid native lease owner");}
function minimumReservation(value,id){assert(value&&value.schema===1&&value.id===id&&text(value.token)&&Array.isArray(value.members),"Invalid prior reservation");leaseOwner(value.lease_owner);assert.equal(value.token,value.lease_owner.token,"Reservation token differs from lease owner");}
function terminal(value,prefix,tokenHash){
 keys(value,"reservation terminal evidence");const reservation=value.reservation,outcome=value.terminal;
 minimumReservation(reservation,reservation?.id);keys(reservation,"schema id token lease_owner manifest_revision group_scope members source source_fence source_owner status");
 assert(text(reservation.id)&&reservation.status==="active"&&Number.isSafeInteger(reservation.manifest_revision)&&reservation.manifest_revision>=0&&reservation.members.length>0,"Invalid terminal reservation");
 assert.equal(hashValue(reservation.id),prefix);assert.equal(hashValue(reservation.token),tokenHash);
 const scope=reservation.group_scope;keys(scope,"id owner kind version members membership_source membership_source_identity");assert(scope.id===reservation.id&&text(scope.owner)&&["work","run","version"].includes(scope.kind)&&Array.isArray(scope.members),"Invalid terminal scope");
 // Native PathBuf::join preserves the literal's slash spelling on Windows.
 // Compare absolute path identity, while retaining exact fence and owner checks.
 const sourcePath=value=>typeof value==="string"&&path.isAbsolute(value)&&!value.includes("\0")&&!value.split(/[\\/]/).includes("..");
 assert(sourcePath(reservation.source)&&canonical(reservation.source)===canonical(path.join(root,"artifacts/maintenance/lifecycles")),"Invalid terminal producer source path");
 assert(sourcePath(scope.membership_source)&&canonical(scope.membership_source)===canonical(reservation.source),"Invalid terminal scope source path");
 assert(hex(reservation.source_fence)&&scope.membership_source_identity===reservation.source_fence,"Invalid terminal producer source identity");
 assert(reservation.source_owner?.schema===1&&reservation.source_owner.id===reservation.id&&reservation.source_owner.owner===scope.owner&&reservation.source_owner.kind===scope.kind&&equal(reservation.source_owner.version??null,scope.version),"Invalid terminal producer source owner");
 assert(outcome&&outcome.id===reservation.id&&["deleted","complete","partial","failed","blocked","cancelled","deferred"].includes(outcome.status)&&Array.isArray(outcome.members)&&outcome.members.length===reservation.members.length,"Unsettled terminal receipt");
 const members=new Map();assert(scope.members.length===reservation.members.length,"Terminal scope membership differs");for(const member of reservation.members){assert(text(member.path)&&path.isAbsolute(member.path)&&inside(root,member.path)&&text(member.id)&&scope.members.includes(member.id)&&member.generated===true&&member.protection_known===true,"Invalid reserved member");const key=canonical(member.path);assert(!members.has(key),"Duplicate reserved member");members.set(key,member);}
 const seen=new Set();for(const member of outcome.members){assert(text(member.path)&&path.isAbsolute(member.path)&&members.has(canonical(member.path))&&!seen.has(canonical(member.path))&&["deleted","failed","blocked","cancelled","deferred"].includes(member.status)&&typeof member.remaining==="boolean"&&(member.status!=="deleted"||!member.remaining),"Invalid terminal member outcome");seen.add(canonical(member.path));}
 keys(value.evidence,"evidence_ref evidence_sha256");const proof=evidence(value.evidence.evidence_ref,value.evidence.evidence_sha256);assert(Array.isArray(proof.outcomes)&&proof.outcomes.some(item=>equal(item,outcome)),"Terminal proof differs from receipt");
 const proofPath=path.resolve(root,value.evidence.evidence_ref);for(const member of reservation.members)assert(!inside(member.path,proofPath),"Terminal evidence overlaps payload");
}
function recovered(value,prefix,tokenHash){
 keys(value,"id status prior_reservation malformed_publication lease_owner prior_bytes reservation_sha256 reason evidence_ref evidence_sha256 execution_outcome_changed pending_intents_changed");
 assert(text(value.id)&&value.status==="reservation_recovered"&&typeof value.malformed_publication==="boolean"&&hex(value.reservation_sha256)&&text(value.reason)&&value.execution_outcome_changed===false&&value.pending_intents_changed===false,"Invalid recovered receipt");leaseOwner(value.lease_owner);assert.equal(hashValue(value.id),prefix);
 let token;if(value.malformed_publication){assert(value.prior_reservation===null&&Array.isArray(value.prior_bytes)&&value.prior_bytes.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255),"Invalid malformed recovery bytes");assert.equal(hash(Buffer.from(value.prior_bytes)),value.reservation_sha256);token=value.lease_owner.token;}else{minimumReservation(value.prior_reservation,value.id);assert(value.prior_bytes===null&&equal(value.prior_reservation.lease_owner,value.lease_owner),"Recovery owner mismatch");token=value.prior_reservation.token;}
 assert.equal(hashValue(token),tokenHash);const proof=evidence(value.evidence_ref,value.evidence_sha256);assert(proof.id===value.id&&proof.producer_stopped_verified===true&&proof.process_tree_stopped_verified===true&&proof.reservation_sha256===value.reservation_sha256&&equal(proof.lease_owner,value.lease_owner),"Recovery proof differs from receipt");
 for(const member of value.prior_reservation?.members||[])assert(text(member.path)&&!inside(member.path,path.resolve(root,value.evidence_ref)),"Recovery evidence overlaps payload");
}
function observe(){plain(directory,"directory");const names=fs.readdirSync(directory).sort();assert(names.length<=10000,"Too many reservation controls for bounded inspection");const locks=[],receipts=[];
 for(const name of names){const filename=path.join(directory,name);plain(filename,"file");if(/^[a-f0-9]{64}\.json$/.test(name))throw Error("Active lifecycle reservation remains");if(/^[a-f0-9]{64}\.lock$/.test(name)){locks.push(filename);continue;}const match=/^([a-f0-9]{64})\.([a-f0-9]{64})\.(terminal|recovered)$/.exec(name);assert(match,"Unknown lifecycle reservation control");const observation=read(filename),value=JSON.parse(observation.bytes.toString("utf8"));(match[3]==="terminal"?terminal:recovered)(value,match[1],match[2]);remember(filename,observation);receipts.push(filename);assert(names.includes(match[1]+".lock"),"Receipt stable group lock missing");}
 assert(locks.length<=128,"Reservation inspection exceeds bounded 128 native group leases");
 for(const filename of locks){const before=read(filename,65536);leaseOwner(JSON.parse(before.bytes.toString("utf8")));leases.push(acquire(filename,{operation:"module-cache.inspect",waitMs:0}));const current=fs.lstatSync(filename,{bigint:true});assert.equal(current.dev+":"+current.ino,before.identity,"Stable group lock identity changed before native acquisition");}
 return{names,locks,receipts};
}
let snapshot;
function verify(){plain(directory,"directory");assert.deepEqual(fs.readdirSync(directory).sort(),snapshot.names,"Reservation controls changed during inspection");for(const [filename,before]of observed){const current=read(filename,filename.startsWith(directory+path.sep)?64*1024*1024:16*1024*1024);assert(current.identity===before.identity&&current.bytes.equals(before.bytes),"Immutable receipt or evidence changed during inspection");}}
function release(){let failure;try{verify();}catch(error){failure=error;}for(const lease of leases.reverse())try{lease.release();}catch(error){failure||=error;}if(failure)throw failure;}
try{snapshot=observe();verify();const ready=JSON.stringify({ok:true,ready:true,report:{receipts:snapshot.receipts,locks:snapshot.locks}})+"\n";assert(Buffer.byteLength(ready)<=64*1024*1024,"Reservation inspection report exceeds frame bound");process.stdout.write(ready);}
catch(error){for(const lease of leases.reverse())try{lease.release();}catch{}process.stdout.write(JSON.stringify({ok:false,error:error.message})+"\n");process.exitCode=1;}
if(snapshot){let buffer="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>{buffer+=chunk;if(Buffer.byteLength(buffer)>4096){process.stdin.destroy();process.exitCode=1;return;}const at=buffer.indexOf("\n");if(at<0)return;try{const command=JSON.parse(buffer.slice(0,at));assert(command.operation==="release"&&command.id===1,"Invalid inspection release");release();process.stdout.write(JSON.stringify({id:1,ok:true,result:{released:true}})+"\n");}catch(error){process.stdout.write(JSON.stringify({id:1,ok:false,error:error.message})+"\n");process.exitCode=1;}process.stdin.destroy();});}
'@
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=(Get-Command node -CommandType Application|Select-Object -First 1).Source
    foreach($argument in @('-e',$source,(Join-Path $PSScriptRoot 'maintenance-lock-owner.cjs'),[IO.Path]::GetFullPath($ProjectRoot),[IO.Path]::GetFullPath($Directory))){$start.ArgumentList.Add($argument)}
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    $start.StandardInputEncoding=[Text.UTF8Encoding]::new($false);$start.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
    $process=[Diagnostics.Process]::new();$process.StartInfo=$start;$null=$process.Start();$process.StandardInput.NewLine="`n"
    $client=@{Process=$process;Sequence=0;Errors=$process.StandardError.ReadToEndAsync()}
    try{$packet=Receive-ArtifactMaintenanceResponse $client;if($packet.ready -ne $true){throw 'Reservation inspection ready handshake missing'};$client.Report=$packet.report;return $client}
    catch{$process.StandardInput.Close();$process.WaitForExit();$process.Dispose();throw}
}
function Get-BuildCacheProjectInspection($Cache,[string]$Project) {
    $registry=Assert-BuildCachePath (Join-Path $Cache.Root '.projects.json') $Cache.Root
    $project=Assert-BuildCachePath $Project $Cache.Owner
    $result=[ordered]@{project=$project;status='blocked';reason=$null;recoveryCondition=$null;registrySha256=(Get-BuildModuleFileHash $registry);catalogSha256=$null;groups=@()}
    $catalogClient=$null;$reservationClient=$null
    try {
      if($project -notin @(Get-BuildCacheProjects $Cache)){throw 'Project is not registered'}
      if(-not(Test-Path -LiteralPath $project -PathType Container -ErrorAction Stop)){throw 'Missing registered cache project; inspect-legacy requires independently retained consumer evidence for retirement'}
      $catalog=Assert-BuildCachePath (Join-Path $project 'artifacts/maintenance/lifecycles') $Cache.Owner
      if(-not(Test-Path -LiteralPath $catalog -PathType Container)){
        $result.reason='Missing lifecycle catalog'
        $result.recoveryCondition='Restore a genuine matching lifecycle catalog from original provenance, or recover a verified original consumer index through the canonical lifecycle owner; never fabricate an empty catalog.'
        return $result
      }
      # The native owner validates the stable inode and acquires its OS lease;
      # a schema-shaped file alone cannot establish that the catalog is idle.
      $catalogClient=Start-ArtifactMaintenanceClient $project
      $records=@();$offset=0
      do {$page=Invoke-ArtifactLifecycleNode @('catalog','--project-root',$project,'--limit','200','--offset',"$offset");$records+=@($page.groups);$offset+=200}while($offset -lt $page.total)
      $result.groups=@($records)
      # Only the held stable lease metadata is mutable coordination state.
      # Unknown control files and unresolved reservations remain protective.
      $items=@(Get-ChildItem -LiteralPath $catalog -Force -ErrorAction Stop)
      $semanticFiles=@();$semanticValues=@('module-catalog-v2')
      foreach($item in $items){
        Assert-BuildCachePath $item.FullName $Cache.Owner|Out-Null
        if($item.Name -ceq 'catalog.lock' -and -not $item.PSIsContainer){continue}
        if($item.Name -ceq 'reservations' -and $item.PSIsContainer){
          $reservationClient=Start-BuildCacheReservationInspection $project $item.FullName
          if(-not @($reservationClient.Report.locks).Count -and -not @($reservationClient.Report.receipts).Count){$semanticValues+='empty-reservations-directory'}
          else{
            $semanticValues+='settled-reservation-controls-v1'
            foreach($lock in @($reservationClient.Report.locks)){$semanticValues+='reservation-lock:'+([IO.Path]::GetFileName($lock))}
            $semanticFiles+=@($reservationClient.Report.receipts)
          }
          continue
        }
        if($item.PSIsContainer -or $item.Name -notmatch '^[a-f0-9]{64}\.json$'){throw 'Unresolved lifecycle catalog entry or producer lock'}
        $semanticFiles+=,$item.FullName
      }
      $result.catalogSha256=Get-BuildModuleKey -Inputs @($semanticFiles|Sort-Object) -Values $semanticValues
      if($records.Count){throw 'Lifecycle groups remain; reconcile their actual members, references and producers through the canonical lifecycle owner first'}
      $result.status='ready-for-proof';$result.recoveryCondition='Supply independently verified producer closure and release of all consumers, installations and rollback references, pinned to this registry and catalog identity.'
    }catch{$result.reason=$_.Exception.Message;$result.recoveryCondition='Resolve the reported ownership, catalog, reference or path uncertainty and inspect again.'}
    finally{
      if($reservationClient){
        try{$null=Send-ArtifactMaintenanceCommand $reservationClient @{operation='release'};$reservationClient.Process.StandardInput.Close();$reservationClient.Process.WaitForExit();if($reservationClient.Process.ExitCode -ne 0){throw 'Reservation inspection lease exit is unconfirmed'}}
        catch{$result.status='blocked';$result.reason=$_.Exception.Message;$result.recoveryCondition='Resolve reservation control or lease uncertainty and inspect again.'}
        finally{$reservationClient.Process.StandardInput.Close();$reservationClient.Process.WaitForExit();$reservationClient.Process.Dispose()}
      }
      if($catalogClient){
        try{
          $null=Send-ArtifactMaintenanceCommand $catalogClient @{operation='release'}
          $catalogClient.Process.StandardInput.Close();$catalogClient.Process.WaitForExit()
          if($catalogClient.Process.ExitCode -ne 0){throw 'Catalog inspection lease exit is unconfirmed'}
        }catch{$result.status='blocked';$result.reason=$_.Exception.Message;$result.recoveryCondition='Resolve catalog lease termination and inspect again.'}
        finally{$catalogClient.Process.StandardInput.Close();$catalogClient.Process.WaitForExit();$catalogClient.Process.Dispose()}
      }
    }
    $result
}
function Remove-BuildCacheProjectRegistration($Cache,[string]$Project,[string]$EvidencePath,[string]$EvidenceSha256,[switch]$Apply) {
    if(-not $Cache.Lease -or -not $Cache.Lease.CanWrite){throw 'Project retirement requires the cache lease.'}
    $inspection=Get-BuildCacheProjectInspection $Cache $Project
    if($inspection.status -ne 'ready-for-proof'){return $inspection}
    $project=$inspection.project
    if($project -ieq $Cache.Owner -or $project -ieq $Cache.Project){throw 'Cannot retire cache owner or current execution project'}
    $evidence=Assert-BuildCachePath $EvidencePath $Cache.Owner
    foreach($boundary in @($project,$Cache.Root)){
      $relative=[IO.Path]::GetRelativePath($boundary,$evidence)
      if($relative -eq '.' -or (-not [IO.Path]::IsPathRooted($relative) -and $relative -ne '..' -and -not $relative.StartsWith('..'+[IO.Path]::DirectorySeparatorChar))){throw 'Retirement evidence must survive project and cache retirement'}
    }
    if($EvidenceSha256 -notmatch '^[a-fA-F0-9]{64}$' -or (Get-BuildModuleFileHash $evidence) -ine $EvidenceSha256){throw 'Stale retirement evidence identity'}
    $proof=Get-Content -LiteralPath $evidence -Raw -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop
    if($proof.schema -ne 1 -or $proof.project -cne $project -or $proof.registry_sha256 -ine $inspection.registrySha256 -or $proof.catalog_sha256 -ine $inspection.catalogSha256){throw 'Retirement evidence project or registry/catalog identity mismatch'}
    foreach($flag in @('producer_stopped_verified','consumers_released_verified','installations_released_verified','rollback_released_verified')){
      if($proof.$flag -isnot [bool] -or $proof.$flag -ne $true){throw "Independent retirement proof required: $flag"}
    }
    if([string]::IsNullOrWhiteSpace($proof.reason)){throw 'Retirement reason required'}
    # Existing installation owner checks remain authoritative. Any installation
    # record in this project requires explicit canonical retirement first.
    $deployments=Assert-BuildCachePath (Join-Path $project 'artifacts/deployments') $Cache.Owner
    if(Test-Path -LiteralPath $deployments){
      foreach($receipt in Get-ChildItem -LiteralPath $deployments -Filter deployment.json -Recurse -Force -ErrorAction Stop){Assert-BuildCachePath $receipt.FullName $Cache.Owner|Out-Null;$installed=Get-Content -LiteralPath $receipt.FullName -Raw|ConvertFrom-Json;if($installed.hostInstalled){throw 'Installed or rollback deployment remains in project'}}
    }
    $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)
    if(@($processes|Where-Object {$_.Name -match '^(cargo|rustc|link|MSBuild)(\.exe)?$' -or ($_.CommandLine -and $_.CommandLine.IndexOf($project,[StringComparison]::OrdinalIgnoreCase) -ge 0)}).Count){throw 'Running project process or compiler reference'}
    $fresh=Get-BuildCacheProjectInspection $Cache $project
    if($fresh.status -ne 'ready-for-proof' -or $fresh.registrySha256 -cne $inspection.registrySha256 -or $fresh.catalogSha256 -cne $inspection.catalogSha256 -or (Get-BuildModuleFileHash $evidence) -ine $EvidenceSha256){throw 'Project retirement inputs changed; inspect and verify fresh proof'}
    $result=[ordered]@{project=$project;status='selected';registrationAbsent=$false;evidence=$evidence;evidenceSha256=$EvidenceSha256;reason=$proof.reason}
    if($Apply){
      $registry=Assert-BuildCachePath (Join-Path $Cache.Root '.projects.json') $Cache.Root
      $projects=@(Get-BuildCacheProjects $Cache|Where-Object {$_ -ine $project})
      $temporary=Join-Path $Cache.Root ('.projects-'+[guid]::NewGuid().ToString('N')+'.tmp')
      try{
        @{schema=1;projects=$projects}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $temporary -Encoding utf8NoBOM
        if((Get-BuildModuleFileHash $registry) -cne $inspection.registrySha256){throw 'Project registry changed before retirement'}
        [IO.File]::Move($temporary,$registry,$true)
      }finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -ErrorAction Stop}}
      $result.registrationAbsent=$project -notin @(Get-BuildCacheProjects $Cache)
      $result.status=if($result.registrationAbsent){'retired'}else{'blocked'}
    }
    $result
}
function Get-BuildCacheLegacyProjectInspection($Cache,[string]$Project) {
    if(-not [IO.Path]::IsPathFullyQualified($Project)){throw 'Legacy retirement requires fully qualified Project'}
    $project=Assert-BuildCachePath $Project $Cache.Owner
    $registry=Assert-BuildCachePath (Join-Path $Cache.Root '.projects.json') $Cache.Root
    $result=[ordered]@{project=$project;action='retire-legacy';status='blocked';reason=$null;registrySha256=(Get-BuildModuleFileHash $registry);projectState='unknown';historical_consumer_index='unavailable';historicalOutcome='unknown';catalogSha256=$null}
    try {
      if($project -notin @(Get-BuildCacheProjects $Cache)){throw 'Project is not registered'}
      if($project -ieq $Cache.Owner -or $project -ieq $Cache.Project){throw 'Cannot retire cache owner or current execution project'}
      $exists=Test-Path -LiteralPath $project -ErrorAction Stop
      if($exists -and -not(Test-Path -LiteralPath $project -PathType Container -ErrorAction Stop)){throw 'Registered project path is not a directory'}
      $result.projectState=if($exists){'existing'}else{'absent'}
      # No catalog is synthesized: even an empty artifacts directory requires the normal owner.
      foreach($relative in @('artifacts','engine/codex-rs/target','providers/opencodex/node_modules','extensions/azrael-ex/node_modules','extensions/azrael-ex/dist','providers/opencodex/gui/dist','providers/opencodex/gui/node_modules','providers/opencodex/native/remote-workspace-helper/target')){
        $output=Assert-BuildCachePath (Join-Path $project $relative) $Cache.Owner
        if(Test-Path -LiteralPath $output){throw "Legacy generated output exists; use normal lifecycle retirement: $output"}
      }
      $result.status='ready-for-proof'
    }catch{$result.reason=$_.Exception.Message}
    $result
}
function Assert-BuildCacheRetirementEvidencePath($Cache,[string]$Project,[string]$Path) {
    $full=Assert-BuildCachePath $Path $Cache.Owner
    foreach($boundary in @($Project,$Cache.Root)){
      $relative=[IO.Path]::GetRelativePath($boundary,$full)
      if($relative -eq '.' -or (-not [IO.Path]::IsPathRooted($relative) -and $relative -ne '..' -and -not $relative.StartsWith('..'+[IO.Path]::DirectorySeparatorChar))){throw 'Retirement evidence must survive project and cache retirement'}
    }
    if(-not(Test-Path -LiteralPath $full -PathType Leaf)){throw 'Readable retirement evidence file required'}
    $full
}
function Remove-BuildCacheLegacyProjectRegistration($Cache,[string]$Project,[string]$EvidencePath,[string]$EvidenceSha256,[switch]$Apply) {
    if(-not $Cache.Lease -or -not $Cache.Lease.CanWrite){throw 'Project retirement requires the cache lease.'}
    $inspection=Get-BuildCacheLegacyProjectInspection $Cache $Project
    if($inspection.status -ne 'ready-for-proof'){return $inspection}
    $project=$inspection.project
    $evidence=Assert-BuildCacheRetirementEvidencePath $Cache $project $EvidencePath
    if($EvidenceSha256 -notmatch '^[a-fA-F0-9]{64}$' -or (Get-BuildModuleFileHash $evidence) -ine $EvidenceSha256){throw 'Stale retirement evidence identity'}
    $proof=Get-Content -LiteralPath $evidence -Raw -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop
    $missing=$inspection.projectState -eq 'absent'
    $schema=if($missing){3}else{2};$consumerState=if($missing){'verified-released'}else{'unavailable'}
    if($proof.schema -ne $schema -or $proof.action -cne 'retire-legacy' -or $proof.project -cne $project -or $proof.registry_sha256 -ine $inspection.registrySha256 -or $proof.historical_consumer_index -cne $consumerState){throw 'Legacy retirement evidence project or registry identity mismatch'}
    foreach($flag in @('producer_stopped_verified','consumers_released_verified','installations_released_verified','rollback_released_verified','payload_absent_verified')){
      if($proof.$flag -isnot [bool] -or $proof.$flag -ne $true){throw "Independent retirement proof required: $flag"}
    }
    if($proof.reason -isnot [string] -or [string]::IsNullOrWhiteSpace($proof.reason) -or $proof.authority_ref -isnot [string] -or [string]::IsNullOrWhiteSpace($proof.authority_ref)){throw 'Retirement reason and authority_ref required'}
    $authority=Assert-BuildCacheRetirementEvidencePath $Cache $project $proof.authority_ref
    if($proof.authority_sha256 -notmatch '^[a-fA-F0-9]{64}$' -or (Get-BuildModuleFileHash $authority) -ine $proof.authority_sha256){throw 'Stale retirement authority identity'}
    $consumerEvidence=$null
    if($missing){
      if($proof.project_state -cne 'absent' -or $proof.project_absent_verified -isnot [bool] -or -not $proof.project_absent_verified){throw 'Independent missing project absence proof required'}
      $consumerEvidence=Assert-BuildCacheRetirementEvidencePath $Cache $project $proof.consumer_evidence_ref
      if($proof.consumer_evidence_sha256 -notmatch '^[a-fA-F0-9]{64}$' -or (Get-BuildModuleFileHash $consumerEvidence) -ine $proof.consumer_evidence_sha256){throw 'Stale retained consumer evidence identity'}
      $consumers=Get-Content -LiteralPath $consumerEvidence -Raw -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop
      if($consumers.schema -ne 1 -or $consumers.project -cne $project -or $consumers.registry_sha256 -ine $inspection.registrySha256 -or $consumers.membership_complete -isnot [bool] -or -not $consumers.membership_complete -or $consumers.consumers -isnot [array] -or [string]::IsNullOrWhiteSpace($consumers.provenance)){throw 'Complete original consumer provenance required; unavailable or unknown consumers remain protected'}
      foreach($consumer in $consumers.consumers){
        if([string]::IsNullOrWhiteSpace($consumer.id) -or $consumer.released_verified -isnot [bool] -or -not $consumer.released_verified -or [string]::IsNullOrWhiteSpace($consumer.release_basis)){throw 'Known consumer release evidence required'}
      }
    }
    # An absent artifacts root excludes all deployment/installation/rollback receipts.
    # Process inspection remains fail-closed and uses the normal retirement guard.
    $check={
      $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)
      if(@($processes|Where-Object {$_.ProcessId -ne $PID -and ($_.Name -match '^(cargo|rustc|link|MSBuild)(\.exe)?$' -or ($_.CommandLine -and $_.CommandLine.IndexOf($project,[StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($_.ExecutablePath -and ($_.ExecutablePath -ieq $project -or $_.ExecutablePath.StartsWith($project.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase))))}).Count){throw 'Running project process or compiler reference'}
      $fresh=Get-BuildCacheLegacyProjectInspection $Cache $project
      $null=Assert-BuildCacheRetirementEvidencePath $Cache $project $evidence
      $null=Assert-BuildCacheRetirementEvidencePath $Cache $project $authority
      if($fresh.status -ne 'ready-for-proof' -or $fresh.projectState -cne $inspection.projectState -or $fresh.registrySha256 -cne $inspection.registrySha256 -or (Get-BuildModuleFileHash $evidence) -ine $EvidenceSha256 -or (Get-BuildModuleFileHash $authority) -ine $proof.authority_sha256){throw 'Legacy retirement inputs changed; inspect and verify fresh proof'}
      if($consumerEvidence){
        $null=Assert-BuildCacheRetirementEvidencePath $Cache $project $consumerEvidence
        if((Get-BuildModuleFileHash $consumerEvidence) -ine $proof.consumer_evidence_sha256){throw 'Legacy retirement consumer evidence inputs changed'}
      }
    }
    & $check
    $result=[ordered]@{project=$project;action='retire-legacy';status='selected';registrationAbsent=$false;projectState=$inspection.projectState;historical_consumer_index=$consumerState;historicalOutcome='unknown';evidence=$evidence;evidenceSha256=$EvidenceSha256;authority_ref=$authority;authority_sha256=$proof.authority_sha256;consumer_evidence_ref=$consumerEvidence;registrySha256=$inspection.registrySha256;reason=$proof.reason}
    if($Apply){
      $registry=Assert-BuildCachePath (Join-Path $Cache.Root '.projects.json') $Cache.Root
      $projects=@(Get-BuildCacheProjects $Cache|Where-Object {$_ -ine $project})
      $temporary=Join-Path $Cache.Root ('.projects-'+[guid]::NewGuid().ToString('N')+'.tmp')
      try{
        @{schema=1;projects=$projects}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $temporary -Encoding utf8NoBOM
        & $check
        [IO.File]::Move($temporary,$registry,$true)
      }finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -ErrorAction Stop}}
      $result.registrationAbsent=$project -notin @(Get-BuildCacheProjects $Cache)
      $result.status=if($result.registrationAbsent){'retired'}else{'blocked'}
    }
    $result
}
function Open-BuildModuleCache([string]$ProjectRoot,[string]$CacheProjectRoot) {
    if($CacheProjectRoot -and -not [IO.Path]::IsPathFullyQualified($CacheProjectRoot)){throw 'CacheProjectRoot must be fully qualified.'}
    $owner=if($CacheProjectRoot){[IO.Path]::GetFullPath($CacheProjectRoot)}else{[IO.Path]::GetFullPath($ProjectRoot)}
    $project=Assert-BuildCachePath $ProjectRoot $owner
    $root=Assert-BuildCachePath (Join-Path $owner 'artifacts/cache/modules') $owner
    [IO.Directory]::CreateDirectory($root)|Out-Null
    try{$lease=[IO.File]::Open((Join-Path $root '.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{throw 'Another modular build or cache cleanup is active. Retry after it completes.'}
    $cache=@{Root=$root;Project=$project;Owner=$owner;Lease=$lease;Entries=@();Results=@();Keep=0;SkipCleanup=$false;CleanupResults=@();StagingCleanupResults=@();LogDirectory=$null}
    try {
      $registry=Assert-BuildCachePath (Join-Path $root '.projects.json') $root
      $projects=if(Test-Path -LiteralPath $registry){@(Get-BuildCacheProjects $cache)}else{@()}
      if($project -notin $projects){
        $temporary=Join-Path $root ('.projects-'+[guid]::NewGuid().ToString('N')+'.tmp')
        try {
          @{schema=1;projects=@($projects)+@($project)}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $temporary -Encoding utf8NoBOM
          [IO.File]::Move($temporary,$registry,$true)
        } finally {if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -ErrorAction Stop}}
      }
      return $cache
    } catch {$lease.Dispose();throw}
}
function Get-BuildCachePlatform {
    $os=if([Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Windows)){'windows'}elseif([Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Linux)){'linux'}elseif([Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::OSX)){'macos'}else{[Runtime.InteropServices.RuntimeInformation]::OSDescription}
    return @($os,[Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString())
}
function Get-BuildModuleSourceFiles([string]$Root) {
    # Excluded build directories contribute no source records or link guards.
    # Skip them before recursion, preserving guards for every selected entry.
    $pending=[Collections.Generic.Stack[string]]::new()
    $pending.Push($Root)
    while($pending.Count){
        $directory=$pending.Pop()
        foreach($item in Get-ChildItem -LiteralPath $directory -Force){
            if($item.PSIsContainer){
                if($item.Name -in @('node_modules','dist','target','.git','artifacts')){continue}
                if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Linked module source: $($item.FullName)"}
                $pending.Push($item.FullName)
            } else {
                if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Module source contains a link.'}
                $item
            }
        }
    }
}
function Get-BuildModuleFileHash([string]$Path) {
    $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) }
    finally { $stream.Dispose() }
}
function Get-BuildModuleKey([string[]]$Inputs, [string[]]$Values=@()) {
    $records=[Collections.Generic.List[object]]::new()
    $records.Add([ordered]@{schema=2;platform=@(Get-BuildCachePlatform)})
    for($index=0;$index -lt $Inputs.Count;$index++){
        $inputPath=[IO.Path]::GetFullPath($Inputs[$index])
        Assert-BuildCachePath $inputPath $inputPath|Out-Null
        if(-not(Test-Path -LiteralPath $inputPath)){throw "Missing module input: $inputPath"}
        $kind=if(Test-Path -LiteralPath $inputPath -PathType Leaf){'file'}else{'directory'}
        $records.Add([ordered]@{input=$index;kind=$kind})
        $files=if($kind -eq 'file'){@(Get-Item -LiteralPath $inputPath)}else{@(Get-BuildModuleSourceFiles $inputPath)}
        foreach($file in $files|Sort-Object FullName){
          if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Module source contains a link.'}
          $before=Get-Item -LiteralPath $file.FullName -Force
          $hash=(Get-BuildModuleFileHash $file.FullName)
          $after=Get-Item -LiteralPath $file.FullName -Force
          if($after.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Module source contains a link.'}
          if($before.Length -ne $after.Length -or $before.LastWriteTimeUtc -ne $after.LastWriteTimeUtc){throw 'Module input changed during hashing.'}
          $name=if($kind -eq 'file'){$file.Name}else{[IO.Path]::GetRelativePath($inputPath,$file.FullName).Replace('\','/')}
          $records.Add([ordered]@{input=$index;path=$name;sha256=$hash})
        }
    }
    for($index=0;$index -lt $Values.Count;$index++){$records.Add([ordered]@{value=$index;content=$Values[$index]})}
    $json=ConvertTo-Json -InputObject @($records.ToArray()) -Depth 5 -Compress
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($json))).ToLowerInvariant()
}
function Get-BuildModuleLifecycleRecord($Cache,[string]$Module,[string]$Key,[string]$Path) {
    $id="run:module-cache:${Module}:$Key"
    $hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($id))).ToLowerInvariant()
    $recordPath=Assert-BuildCachePath (Join-Path $Cache.Owner "artifacts/maintenance/lifecycles/$hash.json") $Cache.Owner
    if(-not(Test-Path -LiteralPath $recordPath)){throw 'Unregistered legacy module cache; ownership and references require review'}
    $record=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json
    if($record.schema -ne 1 -or $record.id -cne $id -or $record.owner -cne 'module-build-cache' -or $record.kind -cne 'run' -or @($record.members).Count -ne 1 -or $record.members[0].role -cne 'cache-entry' -or $record.members[0].path -ine $Path){throw 'Unexpected module cache lifecycle ownership or membership'}
    if($record.members[0].generated -ne $true -or $record.members[0].protection_known -ne $true){throw 'Unconfirmed module cache generated ownership or protection; legacy metadata requires review'}
    return $record
}
function Assert-BuildModuleConsumers($Cache,[string]$Id) {
    $projects=@(Get-BuildCacheProjects $Cache -RequireExisting)
    foreach($project in $projects){
      $registry=Assert-BuildCachePath (Join-Path $project 'artifacts/maintenance/lifecycles') $Cache.Owner
      if($project -ine $Cache.Owner -and -not(Test-Path -LiteralPath $registry -PathType Container)){throw "Missing lifecycle catalog for registered cache project: $project"}
    }
    foreach($project in $projects){
      $offset=0
      do {
        $catalog=Invoke-ArtifactLifecycleNode @('catalog','--project-root',$project,'--limit','200','--offset',"$offset")
        foreach($group in $catalog.groups){
          if(-not $group.ContainsKey('references')){throw 'Lifecycle catalog omits consumer references'}
          if(@($group.references|Where-Object id -CEQ $Id).Count){throw "Active module consumer $($group.id) in project $project"}
        }
        $offset+=200
      } while($offset -lt $catalog.total)
    }
}
function Remove-BuildModuleOwnedContents($Cache,[string]$Path) {
    Assert-BuildCacheTree $Path $Cache.Root
    # Preserve diagnostics and ownership if any payload cannot be removed.
    foreach($child in Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop | Where-Object Name -NotIn @('logs','cache.json','owner.json')){
      Assert-BuildCachePath $child.FullName $Path|Out-Null
      Remove-Item -LiteralPath $child.FullName -Recurse -ErrorAction Stop
      if(Test-Path -LiteralPath $child.FullName){throw "Module payload remains: $($child.FullName)"}
    }
    $logs=Join-Path $Path 'logs'
    if(Test-Path -LiteralPath $logs){Remove-Item -LiteralPath $logs -Recurse -ErrorAction Stop}
    if(Test-Path -LiteralPath $logs){throw "Module logs remain: $logs"}
    foreach($name in @('cache.json','owner.json')){
      $receipt=Join-Path $Path $name
      if(Test-Path -LiteralPath $receipt){Remove-Item -LiteralPath $receipt -ErrorAction Stop}
    }
    Remove-Item -LiteralPath $Path -ErrorAction Stop
}
function Remove-BuildModuleEntry($Cache,[string]$Module,[string]$Key,[string]$Path,[string[]]$ProtectedPaths=@(),[switch]$Preview,[switch]$Retry) {
    if(-not $Cache.Lease -or -not $Cache.Lease.CanWrite){throw 'Cleanup requires the cache lease.'}
    $record=Get-BuildModuleLifecycleRecord $Cache $Module $Key $Path
    $owner=Get-Content -LiteralPath (Join-Path $Path 'owner.json') -Raw|ConvertFrom-Json
    if($owner.schema -ne 1 -or $owner.module -cne $Module -or $owner.key -cne $Key){throw 'Unknown cache owner'}
    $check={param($member)
      if($member -ine $Path){return 'Unexpected module lifecycle member'}
      try {
        Assert-BuildCacheTree $member $Cache.Root
        Get-BuildModuleLifecycleRecord $Cache $Module $Key $Path|Out-Null
        Assert-BuildModuleConsumers $Cache $record.id
        $protected=@($ProtectedPaths)+@(Get-ProtectedBuildCachePaths $Cache)
        if(@($protected|Where-Object {$_ -and ([IO.Path]::GetFullPath($_).Equals($Path,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFullPath($_).StartsWith($Path+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase))}).Count){return 'Installed or protected module cache'}
        $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)
        if(@($processes|Where-Object {$_.Name -match '^(cargo|rustc|link|MSBuild)(\.exe)?$' -or ($_.CommandLine -and $_.CommandLine.IndexOf($Path,[StringComparison]::OrdinalIgnoreCase) -ge 0)}).Count){return 'Running process or compiler reference'}
      }catch{return $_.Exception.Message}
    }
    $reason=& $check $Path
    if($reason){return @{status='blocked';reason=$reason}}
    # Selecting the same key for retry closes the diagnosed attempt. Other failed
    # or pending generations remain protected from background eviction.
    if($Retry -and $record.state -ne 'complete'){
      $null=Register-ArtifactLifecycle -ProjectRoot $Cache.Owner -Id $record.id -Kind run -Owner 'module-build-cache' -Generated -ProtectionKnown -State complete -MembershipComplete $true -Members @{'cache-entry'=$Path}
    }
    $remove={param($member) Remove-BuildModuleOwnedContents $Cache $member}
    Invoke-ArtifactLifecycleCleanup -ProjectRoot $Cache.Owner -CandidatePath $Path -ProtectedPaths $ProtectedPaths -Apply (-not $Preview) -CheckMember $check -RemoveMember $remove
}
function Get-BuildModuleEntry($Cache,[ValidateSet('companion','providers')][string]$Module,[string[]]$Inputs,[string[]]$Values=@(),[switch]$Force,[scriptblock]$AdditionalInputs) {
    Get-BuildCacheProjects $Cache -RequireExisting|Out-Null
    $sourceInputs=$Inputs
    if($AdditionalInputs){$Inputs=@($sourceInputs)+@(& $AdditionalInputs)}
    $key=Get-BuildModuleKey $Inputs $Values;$path=Assert-BuildCachePath (Join-Path $Cache.Root "$Module/$key") $Cache.Root
    $entry=@{Module=$Module;Key=$key;Path=$path;Inputs=$Inputs;SourceInputs=$sourceInputs;AdditionalInputs=$AdditionalInputs;Values=$Values;Hit=$false;Cache=$Cache;LifecycleId="run:module-cache:${Module}:$key";LogDirectory=(Join-Path $path 'logs')}
    $receiptPath=Join-Path $path 'cache.json'
    if(-not $Force -and (Test-Path -LiteralPath $receiptPath)){
      try{
        $receipt=Get-Content -LiteralPath $receiptPath -Raw|ConvertFrom-Json
        if($receipt.schema -ne 1 -or $receipt.module -cne $Module -or $receipt.key -cne $key -or -not @($receipt.files).Count -or -not @($receipt.outputs).Count){throw 'Invalid cache receipt'}
        $inventoryFiles=@(foreach($output in $receipt.outputs){Get-BuildModuleFiles (Join-Path $path $output) $path})
        $inventory=@($inventoryFiles|ForEach-Object {[IO.Path]::GetRelativePath($path,$_.FullName)})
        if(@(Compare-Object @($inventory|Sort-Object) @($receipt.files.path|Sort-Object)).Count){throw 'Cache inventory changed'}
        foreach($file in $receipt.files){
          $p=Join-Path $path $file.path
          if((Get-BuildModuleFileHash $p) -ine $file.sha256){throw 'Cache output changed'}
        }
        $receipt.lastUsedUtc=[DateTime]::UtcNow.ToString('o');$receipt|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $receiptPath -Encoding utf8NoBOM;(Get-Item -LiteralPath $path).LastWriteTimeUtc=[DateTime]::UtcNow;$entry.Hit=$true
      }catch{$entry.Hit=$false}
    }
    if(-not $entry.Hit){
      if(Test-Path -LiteralPath $path){
        $removed=Remove-BuildModuleEntry $Cache $Module $key $path -Retry
        if($removed.status -ne 'deleted' -or (Test-Path -LiteralPath $path)){throw "Selected cache cannot be replaced: $($removed.reason)"}
      }
      $null=Register-ArtifactLifecycle -ProjectRoot $Cache.Owner -Id $entry.LifecycleId -Kind run -Owner 'module-build-cache' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members @{'cache-entry'=$path}
      [IO.Directory]::CreateDirectory($entry.LogDirectory)|Out-Null
      @{schema=1;module=$Module;key=$key}|ConvertTo-Json|Set-Content (Join-Path $path 'owner.json') -Encoding utf8NoBOM
    }
    $Cache.Entries+=,$entry;$Cache.Results+=@{module=$Module;key=$key;reused=$entry.Hit;path=$path}
    # Selection supersedes unused keys even when generation fails before publication.
    if(-not $Cache.SkipCleanup){
      try {
        $protected=@(Get-ProtectedBuildCachePaths $Cache)
        $Cache.CleanupResults+=@(Remove-OldBuildModuleCaches $Cache -Module $Module -Keep $Cache.Keep -ProtectedPaths $protected)
      } catch {
        $Cache.CleanupResults+=@{path=$entry.Path;status='preserved';reason=$_.Exception.Message}
      }
      if($Cache.LogDirectory){
        $Cache.CleanupResults|ConvertTo-Json -Depth 5|Set-Content (Join-Path $Cache.LogDirectory 'module-cache-cleanup.json') -Encoding utf8NoBOM
      }
    }
    return $entry
}
function Get-BuildModuleCurrentKey($Entry) {
    $inputs=if($Entry.AdditionalInputs){@($Entry.SourceInputs)+@(& $Entry.AdditionalInputs)}else{$Entry.Inputs}
    Get-BuildModuleKey $inputs $Entry.Values
}
function Save-BuildModuleEntry($Entry,[string[]]$Outputs) {
    Get-BuildCacheProjects $Entry.Cache -RequireExisting|Out-Null
    Get-BuildModuleLifecycleRecord $Entry.Cache $Entry.Module $Entry.Key $Entry.Path|Out-Null
    if((Get-BuildModuleCurrentKey $Entry) -cne $Entry.Key){throw 'Module inputs changed during compilation; cache is not reusable.'}
    $files=@(foreach($output in $Outputs){
      $p=Assert-BuildCachePath (Join-Path $Entry.Path $output) $Entry.Path
      if(-not(Test-Path -LiteralPath $p)){throw "Missing module output: $p"}
      $items=@(Get-BuildModuleFiles $p $Entry.Path)
      foreach($file in $items){@{path=[IO.Path]::GetRelativePath($Entry.Path,$file.FullName);sha256=(Get-BuildModuleFileHash $file.FullName)}}
    })
    if((Get-BuildModuleCurrentKey $Entry) -cne $Entry.Key){throw 'Module inputs changed before cache publication.'}
    $temporary=Join-Path $Entry.Path ('cache-'+[guid]::NewGuid().ToString('N')+'.tmp')
    try {
      @{schema=1;module=$Entry.Module;key=$Entry.Key;lastUsedUtc=[DateTime]::UtcNow.ToString('o');outputs=$Outputs;files=$files}|ConvertTo-Json -Depth 6|Set-Content $temporary -Encoding utf8NoBOM
      [IO.File]::Move($temporary,(Join-Path $Entry.Path 'cache.json'),$true)
    } finally {if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -ErrorAction Stop}}
    $null=Register-ArtifactLifecycle -ProjectRoot $Entry.Cache.Owner -Id $Entry.LifecycleId -Kind run -Owner 'module-build-cache' -Generated -ProtectionKnown -State complete -MembershipComplete $true -Members @{'cache-entry'=$Entry.Path}
    $cache=$Entry.Cache
    if($cache -and -not $cache.SkipCleanup){
      try {
        $protected=@(Get-ProtectedBuildCachePaths $cache)
        $cache.StagingCleanupResults+=@(Remove-OldBuildStaging $cache -Keep $cache.Keep -ProtectedPaths $protected)
      } catch {
        $cache.CleanupResults+=@{path=$Entry.Path;status='preserved';reason=$_.Exception.Message}
        $cache.StagingCleanupResults+=@{path=(Join-Path $cache.Project 'artifacts/build');status='preserved';reason=$_.Exception.Message}
      }
      if($cache.LogDirectory){
        $cache.CleanupResults|ConvertTo-Json -Depth 5|Set-Content (Join-Path $cache.LogDirectory 'module-cache-cleanup.json') -Encoding utf8NoBOM
        $cache.StagingCleanupResults|ConvertTo-Json -Depth 5|Set-Content (Join-Path $cache.LogDirectory 'legacy-cache-cleanup.json') -Encoding utf8NoBOM
      }
    }
}
function Assert-BuildCacheTree([string]$Path,[string]$Root) {
    Assert-BuildCachePath $Path $Root|Out-Null
    foreach($item in Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction Stop){
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Linked cache content: $($item.FullName)"}
    }
}
function Remove-OldBuildModuleCaches($Cache,[ValidateRange(0,10)][int]$Keep=0,[string[]]$ProtectedPaths=@(),[switch]$Preview,[ValidateSet('companion','providers')][string[]]$Module=@('companion','providers')) {
    if(-not $Cache.Lease -or -not $Cache.Lease.CanWrite){throw 'Cleanup requires the cache lease.'}
    Get-BuildCacheProjects $Cache -RequireExisting|Out-Null
    $selected=@(foreach($name in @('companion','providers')){$Cache.Entries|Where-Object Module -EQ $name|Select-Object -Last 1})
    $protected=@($ProtectedPaths)+@($selected|ForEach-Object Path);$report=@()
    try {$processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)}catch{return @{path=$Cache.Root;status='preserved';reason="Process inspection failed: $($_.Exception.Message)";absent=(-not(Test-Path -LiteralPath $Cache.Root));deletedItemCount=0;deletedFileCount=0;deletedBytes=[long]0;cleanupComplete=$false;revisitCondition='Restore complete process inspection, then preview and recheck cache protections.'}}
    $compilerActive=@($processes|Where-Object {$_.Name -match '^(cargo|rustc|link|MSBuild)(\.exe)?$'}).Count -gt 0
    foreach($moduleName in $Module){
      $container=Join-Path $Cache.Root $moduleName;if(-not(Test-Path -LiteralPath $container)){continue}
      $entries=@(Get-ChildItem -LiteralPath $container -Directory|Where-Object {$_.Name -match '^[a-f0-9]{64}$'}|Sort-Object LastWriteTimeUtc -Descending)
      $retained=0
      foreach($directory in $entries){
        $path=$directory.FullName;$result=$null;$measured=@()
        try{
          Assert-BuildCachePath $path $Cache.Root|Out-Null
          Assert-BuildCacheTree $path $Cache.Root
          $measured=@(Get-BuildModuleFiles $path $Cache.Root|ForEach-Object {@{path=$_.FullName;bytes=$_.Length}})
          $owner=Get-Content (Join-Path $path 'owner.json') -Raw|ConvertFrom-Json
          if($owner.schema -ne 1 -or $owner.module -cne $moduleName -or $owner.key -cne $directory.Name){throw 'Unknown cache owner'}
          $used=@($protected|Where-Object {$_ -and ([IO.Path]::GetFullPath($_).Equals($path,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFullPath($_).StartsWith($path+'\',[StringComparison]::OrdinalIgnoreCase))}).Count -gt 0
          $used=$used -or $compilerActive -or @($processes|Where-Object {$_.CommandLine -and $_.CommandLine.IndexOf($path,[StringComparison]::OrdinalIgnoreCase) -ge 0}).Count -gt 0
          $complete=Test-Path -LiteralPath (Join-Path $path 'cache.json')
          if($used -or ($complete -and $retained -lt $Keep)){if($complete){$retained++};$status='preserved';$reason=if($used){'Selected, installed, running process or compiler reference'}else{'Explicit retention'}}else{
            $result=Remove-BuildModuleEntry $Cache $moduleName $directory.Name $path -ProtectedPaths $protected -Preview:$Preview
            $status=if($result.status -eq 'deleted' -and -not(Test-Path -LiteralPath $path)){'removed'}elseif($result.status -eq 'selected'){'selected'}elseif($result.status -eq 'partial'){'partial'}else{'preserved'}
            $reason=$result.reason
          }
          $report+=@{path=$path;status=$status;reason=$reason;absent=(-not(Test-Path -LiteralPath $path));lifecycle=$result}
        }catch{$report+=@{path=$path;status='preserved';reason=$_.Exception.Message;absent=(-not(Test-Path -LiteralPath $path));lifecycle=$result}}
        $row=$report[-1]
        $deleted=@($measured|Where-Object {-not(Test-Path -LiteralPath $_.path)})
        $row.deletedFileCount=$deleted.Count
        $row.deletedBytes=[long](($deleted|Measure-Object -Property bytes -Sum).Sum)
        $row.deletedItemCount=if($row.absent -and $row.status -eq 'removed'){1}else{0}
        $row.cleanupComplete=$row.status -eq 'removed' -and $row.absent
        $row.revisitCondition=if($row.cleanupComplete){$null}elseif($row.reason -match 'Missing lifecycle catalog'){'Restore genuine matching catalog provenance or a verified original consumer index; inspect project registration retirement after canonical reconciliation.'}else{'Release selected/installed/rollback/consumer/process protection or resolve the reported deletion/ownership failure, then preview and recheck actual remaining paths.'}
      }
    }
    return $report
}
function Get-ProtectedBuildCachePaths($Cache) {
    $paths=@()
    foreach($project in @(Get-BuildCacheProjects $Cache -RequireExisting)){
    $deployments=Assert-BuildCachePath (Join-Path $project 'artifacts/deployments') $Cache.Owner
    if(Test-Path $deployments){
      $receipts=@(Get-ChildItem $deployments -Directory -ErrorAction Stop|ForEach-Object {$p=Assert-BuildCachePath (Join-Path $_.FullName 'deployment.json') $Cache.Owner;if(Test-Path $p){$r=Get-Content $p -Raw -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop;if($r.hostInstalled){[pscustomobject]@{Receipt=$r;Time=$r.generatedAt}}}}|Sort-Object Time -Descending|Select-Object -First 2)
      foreach($item in $receipts){
        $p=Assert-BuildCachePath (Join-Path $item.Receipt.packageDirectory 'preparation-inputs.json') $Cache.Owner;if(-not(Test-Path $p)){throw "Missing installed tool receipt: $p"};$paths+=(Get-Content $p -Raw -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop).toolDirectory
        $p=Assert-BuildCachePath (Join-Path $item.Receipt.releaseDirectory 'build-info.json') $Cache.Owner;if(-not(Test-Path $p)){throw "Missing installed build receipt: $p"};$paths+=(Get-Content $p -Raw -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop).moduleBuild.typeScriptPath
      }
    }
    }
    return @($paths|Where-Object {$_})
}
function Remove-OldBuildStaging($Cache,[ValidateRange(0,10)][int]$Keep=0,[string[]]$ProtectedPaths=@(),[switch]$Preview) {
    if(-not $Cache.Lease -or -not $Cache.Lease.CanWrite){throw 'Cleanup requires the cache lease.'}
    Get-BuildCacheProjects $Cache -RequireExisting|Out-Null
    $container=Join-Path $Cache.Project 'artifacts/build';$report=@();if(-not(Test-Path $container)){return $report}
    $candidates=@(Get-ChildItem $container -Directory|Where-Object {(Test-Path (Join-Path $_.FullName 'companion/package.json')) -or (Test-Path (Join-Path $_.FullName 'opencodex/package.json'))}|Sort-Object LastWriteTimeUtc -Descending)
    try {$processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)}catch{return @{path=$container;status='preserved';reason="Process inspection failed: $($_.Exception.Message)"}}
    $compilerActive=@($processes|Where-Object {$_.Name -match '^(cargo|rustc|link|MSBuild)(\.exe)?$'}).Count -gt 0
    $retained=0
    foreach($candidate in $candidates){
      $path=$candidate.FullName
      try{
        Assert-BuildCachePath $path $container|Out-Null
        $companion=Test-Path (Join-Path $path 'companion/package.json')
        $manifest=Get-Content (Join-Path $path $(if($companion){'companion/package.json'}else{'opencodex/package.json'})) -Raw|ConvertFrom-Json
        if($companion){if($manifest.publisher -cne 'azrael-ex-local' -or $manifest.name -cne 'azrael'){throw 'Unknown staging owner'}}
        elseif($manifest.name -cne '@bitkyc08/opencodex'){throw 'Unknown provider staging owner'}
        $protected=@($ProtectedPaths|Where-Object {$_ -and ([IO.Path]::GetFullPath($_).Equals($path,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFullPath($_).StartsWith($path+'\',[StringComparison]::OrdinalIgnoreCase))}).Count -gt 0
        $running=@($processes|Where-Object {$_.CommandLine -and $_.CommandLine.IndexOf($path,[StringComparison]::OrdinalIgnoreCase) -ge 0}).Count -gt 0
        if($protected -or $running -or $compilerActive -or $retained -lt $Keep){$retained++;$report+=@{path=$path;status='preserved';reason='Installed, running process, compiler reference or explicit retention'};continue}
        foreach($name in $(if($companion){@('companion','opencodex/node_modules','devin')}else{@('opencodex/node_modules')})){
          $child=Join-Path $path $name;if(-not(Test-Path $child)){continue};Assert-BuildCachePath $child $path|Out-Null
          Assert-BuildCacheTree $child $path
          if($Preview){$report+=@{path=$child;status='selected'}}else{Remove-Item -LiteralPath $child -Recurse -ErrorAction Stop;$report+=@{path=$child;status='removed'}}
        }
      }catch{$report+=@{path=$path;status='preserved';reason=$_.Exception.Message}}
    }
    return $report
}
