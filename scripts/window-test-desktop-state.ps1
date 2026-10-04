#requires -Version 7.0
[CmdletBinding(DefaultParameterSetName='Snapshot')]
param(
    [Parameter(Mandatory,ParameterSetName='Snapshot')][string]$OutputPath,
    [Parameter(Mandatory,ParameterSetName='Definitions')][switch]$DefinitionsOnly
)
function Test-AzraelProtectedWindow {
    param([Parameter(Mandatory)]$Window)
    if (-not $Window.visible) { return $false }
    foreach ($key in @('className','popup','toolWindow','style','extendedStyle','ownerHwnd')) {
        $present = if ($Window -is [Collections.IDictionary]) { $Window.Contains($key) } else { $null -ne $Window.PSObject.Properties[$key] }
        if (-not $present -or $null -eq $Window.$key) { return $true }
    }
    $extendedStyle = 0L
    if (-not [long]::TryParse([string]$Window.extendedStyle, [ref]$extendedStyle)) { return $true }
    $style = 0L
    if (-not [long]::TryParse([string]$Window.style, [ref]$style)) { return $true }
    $knownOverlay = $Window.className -ceq 'Chrome_WidgetWin_1' -and $Window.popup -is [bool] -and $Window.popup -eq $true -and $Window.toolWindow -is [bool] -and $Window.toolWindow -eq $false -and
        (($style -band 0x80000000L) -ne 0) -and $Window.ownerHwnd -ceq '0x0' -and (($extendedStyle -band 0x08000028L) -eq 0x08000028L)
    return -not $knownOverlay
}
if ($DefinitionsOnly) { return }
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathFullyQualified($OutputPath)) { throw 'OutputPath must be absolute.' }
if (-not ('AzraelTestDesktopState' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class AzraelTestDesktopState {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr arg);
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] public struct Cursor { public int cbSize; public uint flags; public IntPtr handle; public Point position; }
  [StructLayout(LayoutKind.Sequential)] public struct LastInput { public uint cbSize, tick; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref Cursor value);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LastInput value);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr arg);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder value, int count);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowStyle(IntPtr hwnd, int index);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  public static string WindowClass(IntPtr hwnd) {
    var name = new System.Text.StringBuilder(256);
    return GetClassName(hwnd, name, name.Capacity) > 0 ? name.ToString() : "";
  }
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr handle, int index, System.Text.StringBuilder name, int length, out int needed);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr handle);
  public static string InputDesktop() {
    var desktop = OpenInputDesktop(0, false, 1);
    if (desktop == IntPtr.Zero) throw new InvalidOperationException("Input desktop unavailable");
    try { int needed; var name = new System.Text.StringBuilder(256);
      if (!GetUserObjectInformation(desktop, 2, name, 512, out needed)) throw new InvalidOperationException("Input desktop name unavailable");
      return name.ToString();
    } finally { CloseDesktop(desktop); }
  }
  public static long[] Windows() {
    var result = new List<long>();
    if (!EnumWindows((h,a) => { result.Add(h.ToInt64()); return true; }, IntPtr.Zero)) throw new InvalidOperationException("Window inventory unavailable");
    return result.ToArray();
  }
}
'@
}
$desktop = [AzraelTestDesktopState]::InputDesktop()
if ($desktop -cne 'Default') { throw "Input desktop is not Default: $desktop" }
$cursor = [AzraelTestDesktopState+Cursor]::new()
$cursor.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($cursor)
if (-not [AzraelTestDesktopState]::GetCursorInfo([ref]$cursor)) { throw 'Cursor state unavailable.' }
$inputState = [AzraelTestDesktopState+LastInput]::new()
$inputState.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($inputState)
if (-not [AzraelTestDesktopState]::GetLastInputInfo([ref]$inputState)) { throw 'Last input state unavailable.' }
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'Code.exe' OR Name = 'Code - Insiders.exe'" | ForEach-Object {
    if (-not $_.CreationDate -or -not $_.ExecutablePath) { throw "Code identity unavailable for PID $($_.ProcessId)" }
    [ordered]@{ pid = [int]$_.ProcessId; processCreated = $_.CreationDate.ToUniversalTime().ToString('o'); executable = $_.ExecutablePath; commandLine = $_.CommandLine }
})
$byPid = @{}
foreach ($entry in $processes) { $byPid[$entry.pid] = $entry }
$windows = @([AzraelTestDesktopState]::Windows() | ForEach-Object {
    $handle = [IntPtr]::new($_); [uint32]$windowPid = 0
    [void][AzraelTestDesktopState]::GetWindowThreadProcessId($handle, [ref]$windowPid)
    if ($byPid.ContainsKey([int]$windowPid)) {
        $identity = $byPid[[int]$windowPid]
        $ownerHandle = [AzraelTestDesktopState]::GetWindow($handle, 4)
        $style = [AzraelTestDesktopState]::GetWindowStyle($handle, -16)
        $extendedStyle = [AzraelTestDesktopState]::GetWindowStyle($handle, -20)
        [ordered]@{ hwnd = ('0x{0:x}' -f $handle.ToInt64()); pid = [int]$windowPid; processCreated = $identity.processCreated; executable = $identity.executable; visible = [AzraelTestDesktopState]::IsWindowVisible($handle); minimized = [AzraelTestDesktopState]::IsIconic($handle); className = [AzraelTestDesktopState]::WindowClass($handle); ownerHwnd = ('0x{0:x}' -f $ownerHandle.ToInt64()); style = $style; extendedStyle = $extendedStyle; toolWindow = (($extendedStyle -band 0x80) -ne 0); popup = (($style -band [int]::MinValue) -ne 0) }
    }
})
foreach ($window in $windows) { $window['protectedWindow'] = Test-AzraelProtectedWindow -Window $window }
$result = [ordered]@{ schema = 1; observedAt = [DateTime]::UtcNow.ToString('o'); inputDesktop = $desktop; foregroundHwnd = ('0x{0:x}' -f [AzraelTestDesktopState]::GetForegroundWindow().ToInt64()); cursor = @{ visible = (($cursor.flags -band 1) -ne 0); x = $cursor.position.x; y = $cursor.position.y }; lastInputTick = $inputState.tick; codeProcesses = $processes; codeWindows = $windows }
$parent = Split-Path -Parent $OutputPath
[void][IO.Directory]::CreateDirectory($parent)
[IO.File]::WriteAllText($OutputPath, ($result | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
Write-Output $OutputPath
