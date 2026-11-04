[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$StateRoot,
  [Parameter(Mandatory=$true)][ValidateRange(1,65535)][int]$ChildSessionId
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Manual child recovery requires Windows.' }
if (-not [IO.Path]::IsPathRooted($StateRoot)) { throw 'An absolute isolated StateRoot is required.' }
$recoverySid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$recoveryParent = [Diagnostics.Process]::GetCurrentProcess().SessionId
if ($ChildSessionId -eq $recoveryParent) { throw 'The parent session cannot be a recovery target.' }
$recoveryRoot = [IO.Path]::GetFullPath($StateRoot)
if (-not [IO.Directory]::Exists($recoveryRoot)) { throw 'StateRoot must already exist.' }
$recoveryDirectory = Join-Path $recoveryRoot 'azrael/window-use/manual-recovery'
for ($recoveryAncestor = $recoveryDirectory; $recoveryAncestor; $recoveryAncestor = [IO.Path]::GetDirectoryName($recoveryAncestor)) {
  if ((Test-Path -LiteralPath $recoveryAncestor) -and ((Get-Item -LiteralPath $recoveryAncestor).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Recovery ancestry cannot contain a reparse point.' }
}
$recoverySecurity = New-Object Security.AccessControl.DirectorySecurity
$recoverySecurity.SetAccessRuleProtection($true,$false)
$recoverySecurity.SetOwner($recoverySid)
$recoverySecurity.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($recoverySid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
if (-not [IO.Directory]::Exists($recoveryDirectory)) {
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($recoveryDirectory))
  (New-Object IO.DirectoryInfo($recoveryDirectory)).Create($recoverySecurity)
}
$recoveryAcl = (Get-Item -LiteralPath $recoveryDirectory).GetAccessControl()
if (-not $recoveryAcl.AreAccessRulesProtected -or $recoveryAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $recoverySid.Value) { throw 'Recovery directory must be private and owned by the current user.' }
foreach ($recoveryRule in $recoveryAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
  if ($recoveryRule.AccessControlType -eq 'Allow' -and $recoveryRule.IdentityReference.Value -ne $recoverySid.Value) { throw 'Unexpected recovery directory access.' }
}
$recoveryCreated = [DateTime]::UtcNow
$recoveryRequest = [ordered]@{
  schemaVersion=1; requestId=[Guid]::NewGuid().ToString(); sid=$recoverySid.Value
  profile=[Environment]::GetFolderPath('UserProfile'); parentSessionId=$recoveryParent; childSessionId=$ChildSessionId
  createdUtc=$recoveryCreated.ToString('o'); expiresUtc=$recoveryCreated.AddMinutes(10).ToString('o')
}
$recoveryFile = Join-Path $recoveryDirectory 'request.json'
$recoveryBytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($recoveryRequest | ConvertTo-Json -Compress))
$recoveryStream = New-Object IO.FileStream($recoveryFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try { $recoveryStream.Write($recoveryBytes,0,$recoveryBytes.Length); $recoveryStream.Flush($true) } finally { $recoveryStream.Dispose() }
[ordered]@{ok=$true;state='queued';requestId=$recoveryRequest.requestId;childSessionId=$ChildSessionId;parentSessionId=$recoveryParent;expiresUtc=$recoveryRequest.expiresUtc;uacRequested=$false;connected=$false;next='An authorized stage-3 request in this isolated profile consumes the request and asks for Windows administrator consent.'} | ConvertTo-Json -Compress
