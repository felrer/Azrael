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
function Open-BuildModuleCache([string]$ProjectRoot) {
    $root=Assert-BuildCachePath (Join-Path $ProjectRoot 'artifacts/cache/modules') $ProjectRoot
    [IO.Directory]::CreateDirectory($root)|Out-Null
    try{$lease=[IO.File]::Open((Join-Path $root '.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{throw 'Another modular build or cache cleanup is active. Retry after it completes.'}
    return @{Root=$root;Project=[IO.Path]::GetFullPath($ProjectRoot);Lease=$lease;Entries=@();Results=@()}
}
function Get-BuildModuleKey([string[]]$Inputs, [string[]]$Values=@()) {
    $records=[Collections.Generic.List[string]]::new()
    foreach($inputPath in $Inputs){
        $inputPath=[IO.Path]::GetFullPath($inputPath)
        if(-not(Test-Path -LiteralPath $inputPath)){throw "Missing module input: $inputPath"}
        if(Test-Path -LiteralPath $inputPath -PathType Container){
          foreach($link in @(Get-ChildItem $inputPath -Recurse -Force |Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and [IO.Path]::GetRelativePath($inputPath,$_.FullName) -notmatch '(^|[\\/])(node_modules|dist|target|\.git|artifacts)([\\/]|$)'})){throw "Linked module source: $($link.FullName)"}
        }
        $files=if(Test-Path -LiteralPath $inputPath -PathType Leaf){@(Get-Item -LiteralPath $inputPath)}else{@(Get-ChildItem -LiteralPath $inputPath -Recurse -File -Force |Where-Object {[IO.Path]::GetRelativePath($inputPath,$_.FullName) -notmatch '(^|[\\/])(node_modules|dist|target|\.git|artifacts)[\\/]' })}
        foreach($file in $files|Sort-Object FullName){if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Module source contains a link.'};$records.Add($file.FullName+'='+ (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash)}
    }
    foreach($value in $Values){$records.Add('value='+$value)}
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($records -join "`n")))).ToLowerInvariant()
}
function Get-BuildModuleEntry($Cache,[ValidateSet('companion','providers')][string]$Module,[string[]]$Inputs,[string[]]$Values=@(),[switch]$Force) {
    $key=Get-BuildModuleKey $Inputs $Values;$path=Assert-BuildCachePath (Join-Path $Cache.Root "$Module/$key") $Cache.Root
    $entry=@{Module=$Module;Key=$key;Path=$path;Inputs=$Inputs;Values=$Values;Hit=$false}
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
          if((Get-FileHash -LiteralPath $p).Hash -ine $file.sha256){throw 'Cache output changed'}
        }
        $receipt.lastUsedUtc=[DateTime]::UtcNow.ToString('o');$receipt|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $receiptPath -Encoding utf8NoBOM;(Get-Item -LiteralPath $path).LastWriteTimeUtc=[DateTime]::UtcNow;$entry.Hit=$true
      }catch{$entry.Hit=$false}
    }
    if(-not $entry.Hit){
      if(Test-Path -LiteralPath $path){Assert-BuildCachePath $path $Cache.Root|Out-Null;Remove-Item -LiteralPath $path -Recurse -Force}
      [IO.Directory]::CreateDirectory($path)|Out-Null
      @{schema=1;module=$Module;key=$key}|ConvertTo-Json|Set-Content (Join-Path $path 'owner.json') -Encoding utf8NoBOM
    }
    $Cache.Entries+=,$entry;$Cache.Results+=@{module=$Module;key=$key;reused=$entry.Hit;path=$path}
    return $entry
}
function Save-BuildModuleEntry($Entry,[string[]]$Outputs) {
    if((Get-BuildModuleKey $Entry.Inputs $Entry.Values) -cne $Entry.Key){throw 'Module inputs changed during compilation; cache is not reusable.'}
    $files=@(foreach($output in $Outputs){
      $p=Assert-BuildCachePath (Join-Path $Entry.Path $output) $Entry.Path
      if(-not(Test-Path -LiteralPath $p)){throw "Missing module output: $p"}
      $items=@(Get-BuildModuleFiles $p $Entry.Path)
      foreach($file in $items){@{path=[IO.Path]::GetRelativePath($Entry.Path,$file.FullName);sha256=(Get-FileHash -LiteralPath $file.FullName).Hash}}
    })
    if((Get-BuildModuleKey $Entry.Inputs $Entry.Values) -cne $Entry.Key){throw 'Module inputs changed before cache publication.'}
    @{schema=1;module=$Entry.Module;key=$Entry.Key;lastUsedUtc=[DateTime]::UtcNow.ToString('o');outputs=$Outputs;files=$files}|ConvertTo-Json -Depth 6|Set-Content (Join-Path $Entry.Path 'cache.json') -Encoding utf8NoBOM
}
function Remove-OldBuildModuleCaches($Cache,[int]$Keep=2,[string[]]$ProtectedPaths=@(),[switch]$Preview) {
    if(-not $Cache.Lease -or -not $Cache.Lease.CanWrite){throw 'Cleanup requires the cache lease.'}
    $protected=@($ProtectedPaths)+@($Cache.Entries|ForEach-Object Path);$report=@()
    $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)
    $compilerActive=@($processes|Where-Object {$_.Name -match '^(cargo|rustc|link|MSBuild)(\.exe)?$'}).Count -gt 0
    foreach($module in @('companion','providers')){
      $container=Join-Path $Cache.Root $module;if(-not(Test-Path -LiteralPath $container)){continue}
      $entries=@(Get-ChildItem -LiteralPath $container -Directory|Where-Object {$_.Name -match '^[a-f0-9]{64}$'}|Sort-Object LastWriteTimeUtc -Descending)
      $retained=0
      foreach($directory in $entries){
        $path=$directory.FullName
        try{
          Assert-BuildCachePath $path $Cache.Root|Out-Null
          $owner=Get-Content (Join-Path $path 'owner.json') -Raw|ConvertFrom-Json
          if($owner.schema -ne 1 -or $owner.module -cne $module -or $owner.key -cne $directory.Name){throw 'Unknown cache owner'}
          $used=@($protected|Where-Object {$_ -and ([IO.Path]::GetFullPath($_).Equals($path,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFullPath($_).StartsWith($path+'\',[StringComparison]::OrdinalIgnoreCase))}).Count -gt 0
          $used=$used -or $compilerActive -or @($processes|Where-Object {$_.CommandLine -and $_.CommandLine.IndexOf($path,[StringComparison]::OrdinalIgnoreCase) -ge 0}).Count -gt 0
          $complete=Test-Path -LiteralPath (Join-Path $path 'cache.json')
          if($used -or ($complete -and $retained -lt $Keep)){if($complete){$retained++};$status='preserved'}else{$status=if($Preview){'selected'}else{Remove-Item -LiteralPath $path -Recurse -Force;'removed'}}
          $report+=@{path=$path;status=$status}
        }catch{$report+=@{path=$path;status='preserved';reason=$_.Exception.Message}}
      }
    }
    return $report
}
function Get-ProtectedBuildCachePaths($Cache) {
    $paths=@();$deployments=Join-Path $Cache.Project 'artifacts/deployments'
    if(Test-Path $deployments){
      $receipts=@(Get-ChildItem $deployments -Directory|ForEach-Object {$p=Join-Path $_.FullName 'deployment.json';if(Test-Path $p){try{$r=Get-Content $p -Raw|ConvertFrom-Json;if($r.hostInstalled){[pscustomobject]@{Receipt=$r;Time=$r.generatedAt}}}catch{}}}|Sort-Object Time -Descending|Select-Object -First 2)
      foreach($item in $receipts){
        $p=Join-Path $item.Receipt.packageDirectory 'preparation-inputs.json';if(Test-Path $p){try{$paths+=(Get-Content $p -Raw|ConvertFrom-Json).toolDirectory}catch{}}
        $p=Join-Path $item.Receipt.releaseDirectory 'build-info.json';if(Test-Path $p){try{$paths+=(Get-Content $p -Raw|ConvertFrom-Json).moduleBuild.typeScriptPath}catch{}}
      }
    }
    return @($paths|Where-Object {$_})
}
function Remove-OldBuildStaging($Cache,[int]$Keep=2,[string[]]$ProtectedPaths=@(),[switch]$Preview) {
    if(-not $Cache.Lease -or -not $Cache.Lease.CanWrite){throw 'Cleanup requires the cache lease.'}
    $container=Join-Path $Cache.Project 'artifacts/build';$report=@();if(-not(Test-Path $container)){return $report}
    $candidates=@(Get-ChildItem $container -Directory|Where-Object {Test-Path (Join-Path $_.FullName 'companion/package.json')}|Sort-Object LastWriteTimeUtc -Descending)
    $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)
    $retained=0
    foreach($candidate in $candidates){
      $path=$candidate.FullName
      try{
        Assert-BuildCachePath $path $container|Out-Null
        $manifest=Get-Content (Join-Path $path 'companion/package.json') -Raw|ConvertFrom-Json
        if($manifest.publisher -cne 'azrael-ex-local' -or $manifest.name -cne 'azrael'){throw 'Unknown staging owner'}
        $protected=@($ProtectedPaths|Where-Object {$_ -and ([IO.Path]::GetFullPath($_).Equals($path,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFullPath($_).StartsWith($path+'\',[StringComparison]::OrdinalIgnoreCase))}).Count -gt 0
        $running=@($processes|Where-Object {$_.CommandLine -and $_.CommandLine.IndexOf($path,[StringComparison]::OrdinalIgnoreCase) -ge 0}).Count -gt 0
        if($protected -or $running -or $retained -lt $Keep){$retained++;$report+=@{path=$path;status='preserved'};continue}
        foreach($name in @('companion','opencodex','devin')){
          $child=Join-Path $path $name;if(-not(Test-Path $child)){continue};Assert-BuildCachePath $child $path|Out-Null
          if($Preview){$report+=@{path=$child;status='selected'}}else{Remove-Item -LiteralPath $child -Recurse -Force;$report+=@{path=$child;status='removed'}}
        }
      }catch{$report+=@{path=$path;status='preserved';reason=$_.Exception.Message}}
    }
    return $report
}
