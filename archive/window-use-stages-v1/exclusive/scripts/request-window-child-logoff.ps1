[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$StateRoot,
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$')][string]$ResourceId,
  [Parameter(Mandatory=$true)][string]$NativeHelperPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$NativeHelperSha256,
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$NodeSha256,
  [switch]$ElevatedOneShot,
  [string]$RequestFile,
  [string]$RequestSha256,
  [switch]$CurrentChild,
  [ValidatePattern('^[A-Za-z0-9+/=]{1,16384}$')][string]$IdentityBase64
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Explicit child logoff requires local Windows.' }
$logoffSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$logoffSession = [Diagnostics.Process]::GetCurrentProcess().SessionId
$logoffAdmin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
function Assert-SafePath([string]$Value,[bool]$Directory=$false) {
  if (-not [IO.Path]::IsPathRooted($Value) -or $Value -match '[\x00-\x1f"]' -or $Value.StartsWith('\\')) { throw 'An absolute local path without command delimiters is required.' }
  $full = [IO.Path]::GetFullPath($Value)
  for ($ancestor=$full; $ancestor; $ancestor=[IO.Path]::GetDirectoryName($ancestor)) {
    $item = Get-Item -LiteralPath $ancestor
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Path ancestry contains a reparse point.' }
    if ($ancestor -ne $full -and -not $item.PSIsContainer) { throw 'Invalid path ancestry.' }
  }
  if ((Get-Item -LiteralPath $full).PSIsContainer -ne $Directory) { throw 'Unexpected path type.' }
  return $full
}
function Assert-Hash([string]$File,[string]$Hash) {
  [void](Assert-SafePath $File)
  if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ine $Hash) { throw 'Pinned executable or request hash mismatch.' }
}
function Assert-PrivateDirectory([string]$Directory) {
  [void](Assert-SafePath $Directory $true)
  $acl = (Get-Item -LiteralPath $Directory).GetAccessControl()
  if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $logoffSid.Value) { throw 'Request directory must be private and owned by the parent user.' }
  foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $logoffSid.Value) { throw 'Unexpected request directory access.' }
  }
}
function Write-NewJson([string]$File,$Value) {
  $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($Value | ConvertTo-Json -Compress -Depth 16))
  $stream = New-Object IO.FileStream($File,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}
function Quote-Argument([string]$Value) {
  if ($Value -match '[\x00-\x1f"]' -or $Value.EndsWith('\')) { throw 'Invalid process argument.' }
  return '"' + $Value + '"'
}
function Test-SameIdentity($Left,$Right) {
  $keys=@('sid','profile','parentSessionId','childSessionId','workerPid','workerCreated','sessionAnchorPid','sessionAnchorCreated')
  if (-not $Left -or -not $Right -or @($Left.PSObject.Properties).Count -ne $keys.Count -or @($Right.PSObject.Properties).Count -ne $keys.Count) { return $false }
  foreach ($key in $keys) { if (-not $Left.PSObject.Properties[$key] -or -not $Right.PSObject.Properties[$key] -or $Left.$key -cne $Right.$key) { return $false } }
  return $true
}
function Invoke-NativeLogoff($Request) {
  Assert-Hash $NativeHelperPath $NativeHelperSha256
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName=$NativeHelperPath; $start.Arguments='--logoff-child'; if ($CurrentChild) { $start.Arguments='--logoff-current-child' }; $start.UseShellExecute=$false; $start.CreateNoWindow=$true
  $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
  $process = New-Object Diagnostics.Process
  $process.StartInfo=$start
  try {
    [void]$process.Start()
    $outputTask=$process.StandardOutput.ReadToEndAsync(); $errorTask=$process.StandardError.ReadToEndAsync()
    $wireValue=@{helperSha256=$NativeHelperSha256.ToLowerInvariant();identity=$Request.identity}
    if ($CurrentChild) { $wireValue.approved=$true }
    $wire = $wireValue | ConvertTo-Json -Compress -Depth 8
    if ($wire.Length -gt 8192) { throw 'Native identity request exceeded limit.' }
    $process.StandardInput.WriteLine($wire); $process.StandardInput.Close()
    if (-not $process.WaitForExit(60000)) { throw 'Native logoff timeout; completion unconfirmed.' }
    $output=$outputTask.GetAwaiter().GetResult(); $ignoredError=$errorTask.GetAwaiter().GetResult()
    if ($output.Length -gt 16384 -or $ignoredError.Length -gt 16384) { throw 'Native response exceeded limit.' }
    if ($process.ExitCode -ne 0) { return @{helperExitCode=$process.ExitCode;proof=$null;code='native_logoff_failed'} }
    return @{helperExitCode=$process.ExitCode;proof=($output | ConvertFrom-Json);code='native_completed'}
  } finally { $process.Dispose() }
}
$StateRoot=Assert-SafePath $StateRoot $true
if ($StateRoot -ieq [IO.Path]::GetPathRoot($StateRoot) -or $StateRoot.TrimEnd('\') -ieq $env:USERPROFILE.TrimEnd('\')) { throw 'Dedicated isolated StateRoot required.' }
$NativeHelperPath=Assert-SafePath $NativeHelperPath
$NodePath=Assert-SafePath $NodePath
Assert-Hash $NativeHelperPath $NativeHelperSha256
Assert-Hash $NodePath $NodeSha256
$logoffRoot=Join-Path $StateRoot 'azrael/window-use/logoff-requests'
if ($CurrentChild) {
  if ($ResourceId -or $IdentityBase64 -eq '' -and -not $ElevatedOneShot) { throw 'Current-child logoff requires an exact inspected identity, without ResourceId.' }
  if ($ElevatedOneShot) {
    if (-not $logoffAdmin -or $RequestSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Bounded elevated invocation required.' }
    $RequestFile=Assert-SafePath $RequestFile
    $invocationDirectory=[IO.Path]::GetDirectoryName($RequestFile)
    if ([IO.Path]::GetDirectoryName($invocationDirectory) -ine $logoffRoot -or [IO.Path]::GetFileName($RequestFile) -ne 'request.json' -or [IO.Path]::GetFileName($invocationDirectory) -notmatch '^[a-f0-9-]{36}$') { throw 'Current-child request escaped its invocation directory.' }
    Assert-PrivateDirectory $logoffRoot; Assert-PrivateDirectory $invocationDirectory
    Assert-Hash $RequestFile $RequestSha256
    if ((Get-Item -LiteralPath $RequestFile).Length -gt 16384) { throw 'Request exceeded limit.' }
    $request=Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($request.schemaVersion -ne 1 -or $request.operation -cne 'current-child-logoff' -or $request.nativeHelperPath -cne $NativeHelperPath -or $request.nativeHelperSha256 -cne $NativeHelperSha256 -or $request.identity.sid -cne $logoffSid.Value -or $request.identity.profile -ine [Environment]::GetFolderPath('UserProfile') -or $request.identity.parentSessionId -ne $logoffSession -or $request.identity.childSessionId -eq $logoffSession -or [DateTime]::Parse($request.expiresUtc).ToUniversalTime() -lt [DateTime]::UtcNow) { throw 'Current-child request identity or expiry mismatch.' }
    $nativeResult=Invoke-NativeLogoff $request
    Write-NewJson (Join-Path $invocationDirectory 'receipt.json') @{requestSha256=$RequestSha256;helperExitCode=$nativeResult.helperExitCode;proof=$nativeResult.proof}
    exit $nativeResult.helperExitCode
  }
  if ($logoffAdmin -or $RequestFile -or $RequestSha256) { throw 'Use an ordinary parent token for current-child logoff.' }
  $identity=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($IdentityBase64)) | ConvertFrom-Json
  if ($identity.sid -cne $logoffSid.Value -or $identity.profile -ine [Environment]::GetFolderPath('UserProfile') -or $identity.parentSessionId -ne $logoffSession -or $identity.childSessionId -le 0 -or $identity.childSessionId -eq $logoffSession) { throw 'Inspected current-child identity mismatch.' }
  # App approval occurs in Azrael before this wrapper runs; UAC authorizes only the bounded native operation.
  if (-not (Test-Path -LiteralPath $logoffRoot)) {
    [void](Assert-SafePath ([IO.Path]::GetDirectoryName($logoffRoot)) $true)
    $security=New-Object Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true,$false); $security.SetOwner($logoffSid)
    $security.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($logoffSid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    (New-Object IO.DirectoryInfo($logoffRoot)).Create($security)
  }
  Assert-PrivateDirectory $logoffRoot
  $invocationId=[Guid]::NewGuid().ToString(); $invocationDirectory=Join-Path $logoffRoot $invocationId
  $planPath=Join-Path $logoffRoot ($invocationId+'.plan.json')
  Write-NewJson $planPath @{schemaVersion=1;operation='current-child-logoff';identity=$identity;outputs=@($invocationDirectory,(Join-Path $logoffRoot ($invocationId+'.verification.json')));createdUtc=[DateTime]::UtcNow.ToString('o')}
  (New-Object IO.DirectoryInfo($invocationDirectory)).Create((Get-Item -LiteralPath $logoffRoot).GetAccessControl())
  $requestPath=Join-Path $invocationDirectory 'request.json'; $receiptPath=Join-Path $invocationDirectory 'receipt.json'
  Write-NewJson $requestPath @{schemaVersion=1;operation='current-child-logoff';identity=$identity;nativeHelperPath=$NativeHelperPath;nativeHelperSha256=$NativeHelperSha256;expiresUtc=[DateTime]::UtcNow.AddMinutes(10).ToString('o')}
  $requestHash=(Get-FileHash -LiteralPath $requestPath -Algorithm SHA256).Hash
  $result=@{logoffConfirmed=$false;processesStopped=$false;identity=$identity;filesCleanupState='deferred';code='child_logoff_unknown';mutationOutcome='unknown';remainingPaths=@($invocationDirectory)}
  try {
    $powershell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $arguments=@('-NoProfile','-NonInteractive','-File',(Quote-Argument $PSCommandPath),'-StateRoot',(Quote-Argument $StateRoot),'-CurrentChild','-NativeHelperPath',(Quote-Argument $NativeHelperPath),'-NativeHelperSha256',$NativeHelperSha256,'-NodePath',(Quote-Argument $NodePath),'-NodeSha256',$NodeSha256,'-ElevatedOneShot','-RequestFile',(Quote-Argument $requestPath),'-RequestSha256',$requestHash)
    $elevated=Start-Process -FilePath $powershell -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    Assert-PrivateDirectory $invocationDirectory
    [void](Assert-SafePath $receiptPath)
    if ((Get-Item -LiteralPath $receiptPath).Length -gt 32768) { throw 'Receipt exceeded limit.' }
    $receipt=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($receipt.requestSha256 -cne $requestHash) { throw 'Current-child receipt mismatch.' }
    if ($receipt.proof.actionExecuted -eq $false) { $result.code=$receipt.proof.code; $result.actionExecuted=$false; $result.mutationOutcome='not_executed'; $result.message=$receipt.proof.message }
    if ($receipt.helperExitCode -ne 0 -or $elevated.ExitCode -ne 0 -or $receipt.proof.ok -ne $true -or $receipt.proof.logoffConfirmed -ne $true -or $receipt.proof.processesStopped -ne $true -or $receipt.proof.identity.childSessionId -ne $identity.childSessionId -or $receipt.proof.identity.parentSessionId -ne $identity.parentSessionId -or $receipt.proof.identity.sid -cne $identity.sid -or $receipt.proof.identity.profile -cne $identity.profile) { throw 'Current-child logoff was not confirmed.' }
    $result.logoffConfirmed=$true; $result.processesStopped=$true; $result.code='child_logged_off'; $result.mutationOutcome='executed'
    # This mode has no registered payload identity: preserve profile, documents and resource manifests.
    $result.filesCleanupState='not_requested'
    Write-NewJson (Join-Path $logoffRoot ($invocationId+'.verification.json')) $result
    Assert-Hash $requestPath $requestHash
    Remove-Item -LiteralPath $requestPath
    Remove-Item -LiteralPath $receiptPath
    Remove-Item -LiteralPath $invocationDirectory
    $result.remainingPaths=@()
  } catch {
    if (-not $result.message) { $result.message=$_.Exception.Message }
    $cancelException=$_.Exception
    for($depth=0;$cancelException -and $depth -lt 8;$depth++) {
      if($cancelException.NativeErrorCode -eq 1223) {$result.code='approval_cancelled';$result.actionExecuted=$false;$result.mutationOutcome='not_executed';break}
      $cancelException=$cancelException.InnerException
    }
    if ($result.logoffConfirmed) { $result.filesCleanupState='partial' }
  }
  $result | ConvertTo-Json -Compress -Depth 10
  exit 0
}
if (-not $ResourceId -or $IdentityBase64) { throw 'Registered logoff requires ResourceId; identity input is reserved for CurrentChild.' }
if ($ElevatedOneShot) {
  if (-not $logoffAdmin -or $RequestSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Bounded elevated invocation required.' }
  $RequestFile=Assert-SafePath $RequestFile
  $invocationDirectory=[IO.Path]::GetDirectoryName($RequestFile)
  if ([IO.Path]::GetDirectoryName($invocationDirectory) -ine $logoffRoot -or [IO.Path]::GetFileName($RequestFile) -ne 'request.json' -or [IO.Path]::GetFileName($invocationDirectory) -notmatch '^[a-f0-9-]{36}$') { throw 'Request is outside its dedicated invocation directory.' }
  Assert-PrivateDirectory $logoffRoot
  Assert-PrivateDirectory $invocationDirectory
  Assert-Hash $RequestFile $RequestSha256
  if ((Get-Item -LiteralPath $RequestFile).Length -gt 16384) { throw 'Request exceeded limit.' }
  $request=Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($request.schemaVersion -ne 1 -or $request.resourceId -cne $ResourceId -or $request.stateRoot -cne $StateRoot -or $request.nativeHelperPath -cne $NativeHelperPath -or $request.nativeHelperSha256 -cne $NativeHelperSha256 -or $request.identity.sid -cne $logoffSid.Value -or $request.identity.profile -ine [Environment]::GetFolderPath('UserProfile') -or $request.identity.parentSessionId -ne $logoffSession -or $request.identity.childSessionId -eq $logoffSession -or [DateTime]::Parse($request.expiresUtc).ToUniversalTime() -lt [DateTime]::UtcNow) { throw 'Request identity, scope or expiry mismatch.' }
  $nativeResult=Invoke-NativeLogoff $request
  Write-NewJson (Join-Path $invocationDirectory 'receipt.json') ([ordered]@{schemaVersion=1;requestSha256=$RequestSha256;identity=$request.identity;helperExitCode=$nativeResult.helperExitCode;proof=$nativeResult.proof;code=$nativeResult.code})
  if ($nativeResult.helperExitCode -ne 0) { exit 1 }
  exit 0
}
if ($logoffAdmin) { throw 'Run the parent wrapper with the ordinary user token; only the bounded native operation elevates.' }
if ($RequestFile -or $RequestSha256) { throw 'Request arguments are reserved for the bounded elevated invocation.' }
$cli=Assert-SafePath (Join-Path $PSScriptRoot 'window-child-session-cleanup.cjs')
$cliArgs=@('--state-root',$StateRoot,'--resource-id',$ResourceId,'--native-helper-path',$NativeHelperPath,'--native-helper-sha256',$NativeHelperSha256)
$inspection = & $NodePath $cli inspect @cliArgs
if ($LASTEXITCODE -ne 0) { throw 'Registered session validation failed before elevation.' }
$selected = $inspection | ConvertFrom-Json
if ($selected.identity.sid -cne $logoffSid.Value -or $selected.identity.parentSessionId -ne $logoffSession -or $selected.identity.profile -ine [Environment]::GetFolderPath('UserProfile')) { throw 'Registered parent identity mismatch.' }
# This private root holds per-invocation journals and compact verification, outside disposable payload.
if (-not (Test-Path -LiteralPath $logoffRoot)) {
  $parent=[IO.Path]::GetDirectoryName($logoffRoot)
  [void](Assert-SafePath $parent $true)
  $security=New-Object Security.AccessControl.DirectorySecurity
  $security.SetAccessRuleProtection($true,$false); $security.SetOwner($logoffSid)
  $security.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($logoffSid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
  (New-Object IO.DirectoryInfo($logoffRoot)).Create($security)
}
Assert-PrivateDirectory $logoffRoot
$invocationId=[Guid]::NewGuid().ToString()
$invocationDirectory=Join-Path $logoffRoot $invocationId
$requestPath=Join-Path $invocationDirectory 'request.json'
$receiptPath=Join-Path $invocationDirectory 'receipt.json'
$verificationPath=Join-Path $logoffRoot ($invocationId+'.verification.jsonl')
$planPath=Join-Path $logoffRoot ($invocationId+'.plan.json')
# Persist intended identity and complete output membership before creating invocation payload.
Write-NewJson $planPath @{schemaVersion=1;identity=$selected.identity;resourceId=$ResourceId;outputs=@($invocationDirectory,$requestPath,$receiptPath,$verificationPath);createdUtc=[DateTime]::UtcNow.ToString('o')}
$planHash=(Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash
$planCreation=(Get-Item -LiteralPath $planPath).CreationTimeUtc.Ticks
$security=(Get-Item -LiteralPath $logoffRoot).GetAccessControl()
(New-Object IO.DirectoryInfo($invocationDirectory)).Create($security)
Assert-PrivateDirectory $invocationDirectory
Write-NewJson $requestPath @{schemaVersion=1;resourceId=$ResourceId;stateRoot=$StateRoot;nativeHelperPath=$NativeHelperPath;nativeHelperSha256=$NativeHelperSha256;identity=$selected.identity;expiresUtc=[DateTime]::UtcNow.AddMinutes(10).ToString('o')}
$requestHash=(Get-FileHash -LiteralPath $requestPath -Algorithm SHA256).Hash
$requestCreation=(Get-Item -LiteralPath $requestPath).CreationTimeUtc.Ticks
$result=[ordered]@{logoffConfirmed=$false;filesCleanupState='deferred';remainingPaths=@($selected.remainingPaths);code='elevation_unconfirmed';phase='closure-inspection';verificationPath=$verificationPath}
$producerTerminal=$false
$elevationAttempted=$false
$elevated=$null
try {
  # A previous invocation may already have logged off this exact instance. Only inspect
  # closure and run common cleanup before deciding whether another UAC is necessary.
  $prior = & $NodePath $cli finalize @cliArgs --request-file $requestPath
  $priorExit=$LASTEXITCODE
  if ($priorExit -notin @(0,2)) { throw 'Closure inspection failed before elevation.' }
  $priorResult=$prior | ConvertFrom-Json
  if ($priorResult.logoffConfirmed -eq $true) {
    $producerTerminal=$true
    $result.logoffConfirmed=$true; $result.filesCleanupState=$priorResult.filesCleanupState
    $result.remainingPaths=@($priorResult.remainingPaths); $result.code='already_closed'; $result.finalizerExitCode=$priorExit
  } else {
  $result.phase='elevated-logoff'
  $powershell=Assert-SafePath (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe')
  $arguments=@('-NoProfile','-NonInteractive','-File',(Quote-Argument $PSCommandPath),'-StateRoot',(Quote-Argument $StateRoot),'-ResourceId',$ResourceId,'-NativeHelperPath',(Quote-Argument $NativeHelperPath),'-NativeHelperSha256',$NativeHelperSha256,'-NodePath',(Quote-Argument $NodePath),'-NodeSha256',$NodeSha256,'-ElevatedOneShot','-RequestFile',(Quote-Argument $requestPath),'-RequestSha256',$requestHash)
  $elevationAttempted=$true
  $elevated=Start-Process -FilePath $powershell -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
  $result.elevatedExitCode=$elevated.ExitCode
  Assert-PrivateDirectory $invocationDirectory
  [void](Assert-SafePath $receiptPath)
  if ((Get-Item -LiteralPath $receiptPath).Length -gt 32768) { throw 'Receipt exceeded limit.' }
  $receiptHash=(Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash
  $receiptCreation=(Get-Item -LiteralPath $receiptPath).CreationTimeUtc.Ticks
  $receipt=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($receipt.schemaVersion -ne 1 -or $receipt.requestSha256 -cne $requestHash -or -not (Test-SameIdentity $receipt.identity $selected.identity) -or $receipt.helperExitCode -isnot [int]) { throw 'Exact terminal native receipt required.' }
  # The elevated runner writes this receipt only after observing the native exit.
  # An exited runner alone cannot prove its timed-out native child has stopped.
  $producerTerminal=$true
  $result.helperExitCode=$receipt.helperExitCode
  if ($elevated.ExitCode -ne 0 -or $receipt.helperExitCode -ne 0) { throw 'Native logoff failed.' }
  if (-not (Test-SameIdentity $receipt.proof.identity $selected.identity) -or $receipt.proof.ownershipVerified -ne $true -or $receipt.proof.logoffConfirmed -ne $true -or $receipt.proof.processesStopped -ne $true -or $receipt.proof.state -ne 'closed') { throw 'Exact native closure receipt required.' }
  foreach ($unsafeFlag in @('pendingWork','directUser','unsavedWork','unknownState','unrelatedApps','pendingUserDecision','heldInput')) { if ($receipt.proof.$unsafeFlag -ne $false) { throw 'Native closure safety proof is incomplete.' } }
  $result.logoffConfirmed=$true
  $result.phase='ordinary-resource-cleanup'
  Assert-Hash $NodePath $NodeSha256
  $final = & $NodePath $cli finalize @cliArgs --request-file $requestPath
  $finalExit=$LASTEXITCODE
  if ($final) { $finalResult=$final | ConvertFrom-Json; $result.filesCleanupState=$finalResult.filesCleanupState; $result.remainingPaths=@($finalResult.remainingPaths); $result.code='finalized'; $result.finalizerExitCode=$finalExit }
  if ($finalExit -notin @(0,2)) { throw 'Ordinary finalizer failed; cleanup requires retry.' }
  }
} catch {
  $result.code=switch ($result.phase) {
    'closure-inspection' { 'closure_inspection_failed' }
    'elevated-logoff' { 'native_terminal_or_closure_unconfirmed' }
    'ordinary-resource-cleanup' { 'ordinary_cleanup_failed' }
    default { 'operation_incomplete' }
  }
  $cancelException=$_.Exception
  for ($exceptionDepth=0; $cancelException -and $exceptionDepth -lt 8; $exceptionDepth++) {
    if ($elevationAttempted -and -not $elevated -and $cancelException.PSObject.Properties['NativeErrorCode'] -and $cancelException.NativeErrorCode -eq 1223) { $producerTerminal=$true; $result.code='uac_cancelled_before_launch'; break }
    $cancelException=$cancelException.InnerException
  }
}
$result.producerTerminal=$producerTerminal
# Preserve an independently readable, secret-free receipt before removing exact invocation files.
Write-NewJson $verificationPath @{schemaVersion=1;identity=$selected.identity;resourceId=$ResourceId;at=[DateTime]::UtcNow.ToString('o');result=$result}
$temporaryRemaining=@()
if ($producerTerminal) {
foreach ($temporary in @(@{path=$requestPath;hash=$requestHash;created=$requestCreation},@{path=$receiptPath;hash=$receiptHash;created=$receiptCreation})) {
  if (Test-Path -LiteralPath $temporary.path) {
    try {
      Assert-PrivateDirectory $invocationDirectory
      Assert-Hash $temporary.path $temporary.hash
      if ((Get-Item -LiteralPath $temporary.path).CreationTimeUtc.Ticks -ne $temporary.created) { throw 'Invocation file identity changed.' }
      Remove-Item -LiteralPath $temporary.path
      if (Test-Path -LiteralPath $temporary.path) { throw 'Invocation file remains.' }
    } catch { $temporaryRemaining += $temporary.path }
  }
}
try { if ((Get-ChildItem -LiteralPath $invocationDirectory).Count -eq 0) { Remove-Item -LiteralPath $invocationDirectory } } catch { }
} else {
  # Preserve the complete invocation when native producer termination is unknown.
  foreach ($pendingPath in @($requestPath,$receiptPath)) { if (Test-Path -LiteralPath $pendingPath) { $temporaryRemaining += $pendingPath } }
}
if (Test-Path -LiteralPath $invocationDirectory) { $temporaryRemaining += $invocationDirectory }
if ($producerTerminal -and -not $temporaryRemaining.Count -and $result.filesCleanupState -eq 'complete') {
  try {
    Assert-PrivateDirectory $logoffRoot
    Assert-Hash $planPath $planHash
    if ((Get-Item -LiteralPath $planPath).CreationTimeUtc.Ticks -ne $planCreation) { throw 'Invocation plan identity changed.' }
    Remove-Item -LiteralPath $planPath
    if (Test-Path -LiteralPath $planPath) { throw 'Invocation plan remains.' }
  } catch { $temporaryRemaining += $planPath }
} elseif (Test-Path -LiteralPath $planPath) { $temporaryRemaining += $planPath }
$result.remainingPaths=@($result.remainingPaths + $temporaryRemaining | Select-Object -Unique)
if ($temporaryRemaining.Count -and $result.filesCleanupState -eq 'complete') { $result.filesCleanupState='partial' }
$result.temporaryCleanupState=$(if ($temporaryRemaining.Count) { 'partial' } else { 'complete' })
# An exclusive append leaves the earlier verification readable if final audit persistence fails.
try {
  [void](Assert-SafePath $verificationPath)
  $verificationStream=New-Object IO.FileStream($verificationPath,[IO.FileMode]::Append,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $verificationBytes=(New-Object Text.UTF8Encoding($false)).GetBytes("`n"+(@{schemaVersion=1;final=$true;result=$result} | ConvertTo-Json -Compress -Depth 16))
    $verificationStream.Write($verificationBytes,0,$verificationBytes.Length); $verificationStream.Flush($true)
  } finally { $verificationStream.Dispose() }
} catch { $result.code='verification_persistence_failed'; $result.filesCleanupState='partial' }
$result | ConvertTo-Json -Compress -Depth 16
if ($result.filesCleanupState -ne 'complete') { exit 2 }
