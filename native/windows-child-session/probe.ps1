$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
# Read-only: never enable child sessions, connect, log off, launch an app or change configuration.
$nativeSource = @'
using System;
using System.Runtime.InteropServices;
public static class AzraelChildSessionProbe {
 [DllImport("wtsapi32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)]
 public static extern bool WTSIsChildSessionsEnabled([MarshalAs(UnmanagedType.Bool)] out bool enabled);
 [DllImport("wtsapi32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)]
 public static extern bool WTSGetChildSessionId(out uint sessionId);
 [StructLayout(LayoutKind.Sequential)] private struct WtsSession { public uint id; public IntPtr station; public int state; }
 [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)]
 private static extern bool WTSEnumerateSessions(IntPtr server,int reserved,int version,out IntPtr buffer,out int count);
 [DllImport("wtsapi32.dll")] private static extern void WTSFreeMemory(IntPtr buffer);
 public static bool TrySessionExists(uint id,out bool exists,out int error) {
  exists=true; error=0; IntPtr buffer=IntPtr.Zero; int count;
  if(!WTSEnumerateSessions(IntPtr.Zero,0,1,out buffer,out count)) { error=Marshal.GetLastWin32Error(); return false; }
  try {
   if(count<0||count>65536||(count>0&&buffer==IntPtr.Zero)) { error=13; return false; }
   for(int i=0;i<count;i++)if(((WtsSession)Marshal.PtrToStructure(IntPtr.Add(buffer,i*Marshal.SizeOf(typeof(WtsSession))),typeof(WtsSession))).id==id)return true;
   exists=false; return true;
  } finally { if(buffer!=IntPtr.Zero)WTSFreeMemory(buffer); }
 }
}
'@
$result = [ordered]@{
 schemaVersion = 1; platform = 'win32'; architecture = $env:PROCESSOR_ARCHITECTURE
 observedAt = [DateTime]::UtcNow.ToString('o'); readOnly = $true
 parent = $null; os = $null; childSessions = $null; service = $null; activeX = $null; errors = @()
}
try {
 Add-Type -TypeDefinition $nativeSource
 $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
 $principal = New-Object Security.Principal.WindowsPrincipal($identity)
 $result.parent = @{
  sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
  sid = $identity.User.Value; profile = [Environment]::GetFolderPath('UserProfile')
  elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 }
 $os = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
 $result.os = @{ edition = $os.EditionID; build = $os.CurrentBuildNumber; revision = $os.UBR }
 $enabled = $false
 $enabledOk = [AzraelChildSessionProbe]::WTSIsChildSessionsEnabled([ref]$enabled)
 $enabledError = if ($enabledOk) { 0 } else { [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
 [uint32]$childId = [uint32]::MaxValue
 $idOk = [AzraelChildSessionProbe]::WTSGetChildSessionId([ref]$childId)
 $idError = if ($idOk) { 0 } else { [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
 $enumerated = $false; $sessionExists = $true; $enumerationError = 0
 if ($idOk -and $childId -ne [uint32]::MaxValue) {
  $enumerated = [AzraelChildSessionProbe]::TrySessionExists($childId, [ref]$sessionExists, [ref]$enumerationError)
 }
 $result.childSessions = @{
  enabledQuerySucceeded = $enabledOk; enabled = $(if ($enabledOk) { $enabled } else { $null })
  enabledError = $enabledError; idQuerySucceeded = $idOk; idError = $idError
  childAbsent = (($idOk -and $childId -eq [uint32]::MaxValue) -or (!$idOk -and $idError -eq 1168) -or ($idOk -and $enumerated -and !$sessionExists))
  sessionEnumerationSucceeded = $enumerated; sessionEnumerationError = $enumerationError
  reportedChildSessionLive = $(if ($enumerated) { $sessionExists } else { $null })
  childSessionId = $(if ($idOk -and $childId -ne [uint32]::MaxValue) { $childId } else { $null })
 }
} catch { $result.errors += @{ operation = 'wtsIdentityProbe'; message = $_.Exception.Message; hresult = $_.Exception.HResult } }
try { $service = Get-Service -Name TermService; $result.service = @{ name = 'TermService'; status = [string]$service.Status } }
catch { $result.errors += @{ operation = 'serviceQuery'; message = $_.Exception.Message; hresult = $_.Exception.HResult } }
$instance = $null; $unknown = [IntPtr]::Zero
try {
 $clsid = [Guid]'A0C63C30-F08D-4AB4-907C-34905D770C7D'
 $instance = [Activator]::CreateInstance([Type]::GetTypeFromCLSID($clsid, $true))
 $unknown = [Runtime.InteropServices.Marshal]::GetIUnknownForObject($instance)
 $interfaces = @{}
 foreach ($entry in @(
  @{ name='inputSink'; iid='4606850E-76A7-4E28-A47E-C7174F619351' },
  @{ name='scanCodeInput'; iid='2F079C4C-87B2-4AFD-97AB-20CDB43038AE' },
  @{ name='extendedSettings'; iid='302D8188-0052-4807-806A-362B628F9AC5' }
 )) {
  $iid = [Guid]$entry.iid; $pointer = [IntPtr]::Zero
  try {
   $hr = [Runtime.InteropServices.Marshal]::QueryInterface($unknown, [ref]$iid, [ref]$pointer)
   $interfaces[$entry.name] = @{ available = ($hr -eq 0 -and $pointer -ne [IntPtr]::Zero); hresult = $hr }
  } finally { if ($pointer -ne [IntPtr]::Zero) { [void][Runtime.InteropServices.Marshal]::Release($pointer) } }
 }
 $result.activeX = @{ activated = $true; clsid = [string]$clsid; interfaces = $interfaces; connectionAttempted = $false }
} catch {
 $result.activeX = @{ activated = $false; connectionAttempted = $false; error = $_.Exception.Message; hresult = $_.Exception.HResult }
} finally {
 if ($unknown -ne [IntPtr]::Zero) { [void][Runtime.InteropServices.Marshal]::Release($unknown) }
 if ($null -ne $instance -and [Runtime.InteropServices.Marshal]::IsComObject($instance)) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($instance) }
}
$result | ConvertTo-Json -Depth 8 -Compress
