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
function Get-BuildCacheProjects($Cache) {
    $registry=Assert-BuildCachePath (Join-Path $Cache.Root '.projects.json') $Cache.Root
    if(-not(Test-Path -LiteralPath $registry)){throw 'Missing module cache project registry.'}
    $data=Get-Content -LiteralPath $registry -Raw -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop
    if($data.schema -ne 1 -or $data.projects -isnot [array] -or -not $data.projects.Count){throw 'Invalid module cache project registry.'}
    return @(foreach($project in $data.projects){
      if($project -isnot [string] -or -not [IO.Path]::IsPathFullyQualified($project)){throw 'Invalid registered cache project.'}
      $validated=Assert-BuildCachePath $project $Cache.Owner
      if(-not(Test-Path -LiteralPath $validated -PathType Container)){throw "Missing registered cache project: $validated"}
      $validated
    })
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
    return $record
}
function Assert-BuildModuleConsumers($Cache,[string]$Id) {
    $projects=@(Get-BuildCacheProjects $Cache)
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
      $null=Register-ArtifactLifecycle -ProjectRoot $Cache.Owner -Id $record.id -Kind run -Owner 'module-build-cache' -State complete -MembershipComplete $true -Members @{'cache-entry'=$Path}
    }
    $remove={param($member) Remove-BuildModuleOwnedContents $Cache $member}
    Invoke-ArtifactLifecycleCleanup -ProjectRoot $Cache.Owner -CandidatePath $Path -ProtectedPaths $ProtectedPaths -Apply (-not $Preview) -CheckMember $check -RemoveMember $remove
}
function Get-BuildModuleEntry($Cache,[ValidateSet('companion','providers')][string]$Module,[string[]]$Inputs,[string[]]$Values=@(),[switch]$Force,[scriptblock]$AdditionalInputs) {
    Get-BuildCacheProjects $Cache|Out-Null
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
      $null=Register-ArtifactLifecycle -ProjectRoot $Cache.Owner -Id $entry.LifecycleId -Kind run -Owner 'module-build-cache' -State pending -MembershipComplete $false -Members @{'cache-entry'=$path}
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
    Get-BuildCacheProjects $Entry.Cache|Out-Null
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
    $null=Register-ArtifactLifecycle -ProjectRoot $Entry.Cache.Owner -Id $Entry.LifecycleId -Kind run -Owner 'module-build-cache' -State complete -MembershipComplete $true -Members @{'cache-entry'=$Entry.Path}
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
    Get-BuildCacheProjects $Cache|Out-Null
    $selected=@(foreach($name in @('companion','providers')){$Cache.Entries|Where-Object Module -EQ $name|Select-Object -Last 1})
    $protected=@($ProtectedPaths)+@($selected|ForEach-Object Path);$report=@()
    try {$processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)}catch{return @{path=$Cache.Root;status='preserved';reason="Process inspection failed: $($_.Exception.Message)"}}
    $compilerActive=@($processes|Where-Object {$_.Name -match '^(cargo|rustc|link|MSBuild)(\.exe)?$'}).Count -gt 0
    foreach($moduleName in $Module){
      $module=$moduleName
      $container=Join-Path $Cache.Root $module;if(-not(Test-Path -LiteralPath $container)){continue}
      $entries=@(Get-ChildItem -LiteralPath $container -Directory|Where-Object {$_.Name -match '^[a-f0-9]{64}$'}|Sort-Object LastWriteTimeUtc -Descending)
      $retained=0
      foreach($directory in $entries){
        $path=$directory.FullName;$result=$null
        try{
          Assert-BuildCachePath $path $Cache.Root|Out-Null
          $owner=Get-Content (Join-Path $path 'owner.json') -Raw|ConvertFrom-Json
          if($owner.schema -ne 1 -or $owner.module -cne $module -or $owner.key -cne $directory.Name){throw 'Unknown cache owner'}
          $used=@($protected|Where-Object {$_ -and ([IO.Path]::GetFullPath($_).Equals($path,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFullPath($_).StartsWith($path+'\',[StringComparison]::OrdinalIgnoreCase))}).Count -gt 0
          $used=$used -or $compilerActive -or @($processes|Where-Object {$_.CommandLine -and $_.CommandLine.IndexOf($path,[StringComparison]::OrdinalIgnoreCase) -ge 0}).Count -gt 0
          $complete=Test-Path -LiteralPath (Join-Path $path 'cache.json')
          if($used -or ($complete -and $retained -lt $Keep)){if($complete){$retained++};$status='preserved';$reason=if($used){'Selected, installed, running process or compiler reference'}else{'Explicit retention'}}else{
            $result=Remove-BuildModuleEntry $Cache $module $directory.Name $path -ProtectedPaths $protected -Preview:$Preview
            $status=if($result.status -eq 'deleted' -and -not(Test-Path -LiteralPath $path)){'removed'}elseif($result.status -eq 'selected'){'selected'}elseif($result.status -eq 'partial'){'partial'}else{'preserved'}
            $reason=$result.reason
          }
          $report+=@{path=$path;status=$status;reason=$reason;absent=(-not(Test-Path -LiteralPath $path));lifecycle=$result}
        }catch{$report+=@{path=$path;status='preserved';reason=$_.Exception.Message;absent=(-not(Test-Path -LiteralPath $path));lifecycle=$result}}
      }
    }
    return $report
}
function Get-ProtectedBuildCachePaths($Cache) {
    $paths=@()
    foreach($project in @(Get-BuildCacheProjects $Cache)){
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
    Get-BuildCacheProjects $Cache|Out-Null
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
