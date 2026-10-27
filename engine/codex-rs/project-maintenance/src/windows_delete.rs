use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};

const STDERR_LIMIT: usize = 16 * 1024;
const STARTUP_ACK: &[u8] = b"azrael-delete-contained-v1\n";

fn gated_script(script: &str) -> String {
    // EOF (including owner death before assignment) exits before Add-Type or
    // any other trusted script setup can create work or descendants.
    // Set encoding before the first read: changing InputEncoding afterward
    // replaces Console.In and discards any prefetched deletion request bytes.
    format!(
        "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)\n\
         [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)\n\
         if ([Console]::In.ReadLine() -cne 'azrael-delete-contained-v1') {{ exit 125 }}\n{script}"
    )
}

/// One sequential shell owned by a single maintenance dispatch. Communication
/// failures abandon this worker; a deletion is never sent a second time.
pub(crate) struct Worker {
    child: Child,
    job: Option<OwnedHandle>,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    stderr: Arc<Mutex<VecDeque<u8>>>,
    drain: Option<JoinHandle<()>>,
    sequence: u64,
    stopped: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    sequence: u64,
    report: Value,
}

impl Worker {
    pub(crate) fn new() -> Result<Self, String> {
        Self::spawn(SCRIPT)
    }

    fn spawn(script: &str) -> Result<Self, String> {
        let script = gated_script(script);
        let mut child = codex_utils_process::background_command("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &script,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("deletion worker spawn failed: {e}"))?;
        // The private gate blocks all setup until assignment succeeds. The
        // deletion protocol then independently waits for its first request.
        let job = match contain_worker(&child) {
            Ok(job) => job,
            Err(error) => {
                drop(child.stdin.take());
                let killed = child.kill();
                let waited = child.wait();
                return Err(format!(
                    "deletion worker containment failed: {error}; kill: {killed:?}; wait: {waited:?}"
                ));
            }
        };
        // These handles are guaranteed by the three piped configurations above.
        let stdin = child.stdin.take().expect("piped deletion stdin");
        let stdout = BufReader::new(child.stdout.take().expect("piped deletion stdout"));
        let mut error_pipe = child.stderr.take().expect("piped deletion stderr");
        let stderr = Arc::new(Mutex::new(VecDeque::new()));
        let diagnostic = Arc::clone(&stderr);
        let drain = thread::spawn(move || {
            let mut buffer = [0; 4096];
            loop {
                match error_pipe.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        let mut tail = diagnostic.lock().unwrap_or_else(|e| e.into_inner());
                        for byte in &buffer[..count] {
                            if tail.len() == STDERR_LIMIT {
                                tail.pop_front();
                            }
                            tail.push_back(*byte);
                        }
                    }
                }
            }
        });
        let mut worker = Self {
            child,
            job: Some(job),
            stdin: Some(stdin),
            stdout,
            stderr,
            drain: Some(drain),
            sequence: 0,
            stopped: false,
        };
        let stdin = worker.stdin.as_mut().expect("piped deletion stdin");
        if let Err(error) = stdin.write_all(STARTUP_ACK).and_then(|()| stdin.flush()) {
            worker.abort();
            return Err(format!("deletion worker startup handshake failed: {error}"));
        }
        Ok(worker)
    }

    pub(crate) fn delete(
        &mut self,
        path: &Path,
        entries: &[PathBuf],
        junctions: &[Value],
    ) -> Result<Value, String> {
        let outcome = self.exchange(path, entries, junctions);
        if let Err(error) = outcome {
            self.abort();
            let diagnostic = self
                .stderr
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .iter()
                .copied()
                .collect::<Vec<_>>();
            return Err(format!(
                "deletion worker communication failed (deletion outcome unknown; not retried): {error}; {}",
                String::from_utf8_lossy(&diagnostic)
            ));
        }
        outcome
    }

    fn exchange(
        &mut self,
        path: &Path,
        entries: &[PathBuf],
        junctions: &[Value],
    ) -> Result<Value, String> {
        if self.stopped {
            return Err("worker already stopped".into());
        }
        if let Some(status) = self.child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!("worker exited before request: {status}"));
        }
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or("request sequence exhausted")?;
        let request = json!({"sequence":self.sequence,"request":{"path":path,"entries":entries,"junctions":junctions}});
        let mut input = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        input.push(b'\n');
        let stdin = self.stdin.as_mut().ok_or("missing worker stdin")?;
        stdin
            .write_all(&input)
            .and_then(|()| stdin.flush())
            .map_err(|e| e.to_string())?;
        self.receive_reply()
    }

    fn receive_reply(&mut self) -> Result<Value, String> {
        let mut line = String::new();
        if self
            .stdout
            .read_line(&mut line)
            .map_err(|e| e.to_string())?
            == 0
            || !line.ends_with('\n')
        {
            return Err("worker exited before a complete reply".into());
        }
        let reply: Reply =
            serde_json::from_str(&line).map_err(|e| format!("invalid reply: {e}"))?;
        if reply.sequence != self.sequence {
            return Err("reply sequence mismatch".into());
        }
        validate_report(&reply.report)?;
        // Once a complete matching report is observed, a later process exit
        // cannot turn its known deletion outcome into an unknown one.
        match self.child.try_wait() {
            Ok(None) => {}
            Ok(Some(_)) => {
                self.stdin.take();
                let _ = self.child.wait();
                // Descendants may still own the stderr pipe after shell exit.
                self.job.take();
                self.stopped = true;
                self.join_stderr();
            }
            Err(_) => self.abort(),
        }
        Ok(reply.report)
    }

    fn abort(&mut self) {
        if !self.stopped {
            self.stdin.take();
            // Closing our non-inherited job handle kills the complete tree,
            // including descendants that might otherwise keep pipes open.
            self.job.take();
            let _ = self.child.wait();
            self.stopped = true;
        }
        self.join_stderr();
    }

    fn join_stderr(&mut self) {
        if let Some(drain) = self.drain.take() {
            let _ = drain.join();
        }
    }

    pub(crate) fn is_stopped(&self) -> bool {
        self.stopped
    }

    #[cfg(test)]
    pub(crate) fn process_id(&self) -> u32 {
        self.child.id()
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        if !self.stopped {
            if std::thread::panicking() {
                self.abort();
                return;
            }
            // EOF terminates the loop normally, after its last completed report.
            self.stdin.take();
            let _ = self.child.wait();
            self.job.take();
            self.stopped = true;
        }
        self.join_stderr();
    }
}

fn contain_worker(child: &Child) -> Result<OwnedHandle, std::io::Error> {
    // Null security attributes make the unnamed handle non-inheritable. Only
    // this request owns it; process death also closes it without running Drop.
    let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if job.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    let owned = unsafe { OwnedHandle::from_raw_handle(job) };
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    // No breakaway flag: descendants must remain in this request's job.
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of_val(&limits) as u32,
        )
    } == 0
        || unsafe { AssignProcessToJobObject(job, child.as_raw_handle()) } == 0
    {
        return Err(std::io::Error::last_os_error());
    }
    Ok(owned)
}

fn validate_report(report: &Value) -> Result<(), String> {
    let remaining = &report["remaining"];
    let error = &report["error"];
    let status = report["status"].as_str();
    if !report.is_object()
        || !matches!(status, Some("deleted" | "failed"))
        || !(remaining.is_boolean() || remaining.is_null())
        || !(error.is_string() || error.is_null())
        || report.get("remaining").is_none()
        || report.get("error").is_none()
        || report.get("physical_bytes_reclaimed") != Some(&Value::Null)
        || !report["attributes"].as_array().is_some_and(|changes| {
            changes.iter().all(|change| {
                change["path"].is_string()
                    && change["before"].as_u64().is_some()
                    && change["after"].as_u64().is_some()
            })
        })
        || (status == Some("deleted")) != (remaining == &Value::Bool(false) && error.is_null())
    {
        return Err("invalid deletion report".into());
    }
    Ok(())
}

// Bootstrap definitions and native compilation are reused; Invoke-Deletion has
// fresh local state on every request, including failure and attribute audits.
const SCRIPT: &str = r#"
$ErrorActionPreference='Stop'
if($true) {
    # Reuse the non-following Windows identity boundary used by the producer
    # cleanup helper; pin the full FILE_ID_INFO and mount-point payload here.
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
public static class MaintenanceJunctionNative {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string p, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle h, int c, IntPtr b, uint n);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool DeviceIoControl(SafeFileHandle h, uint c, IntPtr i, uint ni, byte[] o, uint no, out uint n, IntPtr ov);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool RemoveDirectoryW(string p);
    public static string NormalizationPin(string path) {
        using(var h=CreateFileW(path,128,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
            if(h.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var info=Marshal.AllocHGlobal(24);
            try {
                if(!GetFileInformationByHandleEx(h,1,info,24)) throw new Win32Exception(Marshal.GetLastWin32Error());
                uint links=unchecked((uint)Marshal.ReadInt32(info,16));
                if(links==0) throw new InvalidOperationException("Normalization link count unavailable");
                if(!GetFileInformationByHandleEx(h,18,info,24)) throw new Win32Exception(Marshal.GetLastWin32Error());
                var id=new byte[16]; Marshal.Copy(IntPtr.Add(info,8),id,0,16);
                ulong volume=unchecked((ulong)Marshal.ReadInt64(info));
                if(volume==0 || Array.TrueForAll(id,b=>b==0)) throw new InvalidOperationException("Normalization file identity unavailable");
                return volume.ToString()+":"+String.Join(",",id)+":"+links.ToString();
            } finally {Marshal.FreeHGlobal(info);}
        }
    }
    public static void Unlink(string path, string expectedPin) {
        if(Pin(path)!=expectedPin) throw new InvalidOperationException("Approved junction identity changed before unlink");
        // RemoveDirectoryW removes the directory junction entry itself. It
        // never enumerates or recursively removes the linked directory.
        if(!RemoveDirectoryW(path)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    public static string Pin(string path) {
        using(var h=CreateFileW(path,128,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
            if(h.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var info=Marshal.AllocHGlobal(24);
            try {
                if(!GetFileInformationByHandleEx(h,18,info,24)) throw new Win32Exception(Marshal.GetLastWin32Error());
                var id=new byte[16]; Marshal.Copy(IntPtr.Add(info,8),id,0,16);
                var raw=new byte[16384]; uint n;
                if(!DeviceIoControl(h,0x900a8,IntPtr.Zero,0,raw,16384,out n,IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
                if(n<16 || BitConverter.ToUInt32(raw,0)!=0xa0000003) throw new InvalidOperationException("Mount-point junction required");
                using(var sha=SHA256.Create()) {
                    var digest=BitConverter.ToString(sha.ComputeHash(raw,0,(int)n)).Replace("-", "").ToLowerInvariant();
                    return unchecked((ulong)Marshal.ReadInt64(info)).ToString()+":"+String.Join(",",id)+":"+digest;
                }
            } finally {Marshal.FreeHGlobal(info);}
        }
    }
}
'@
}
function Extended-Literal([string]$literal) {
    # Normalize provider-returned and approved paths into the same literal key.
    # Do not resolve through the filesystem or use MAX_PATH-limited .NET helpers.
    $plain=$literal.Replace('/','\')
    if($plain.StartsWith('\\?\UNC\',[StringComparison]::OrdinalIgnoreCase)){$plain='\\'+$plain.Substring(8)}
    elseif($plain.StartsWith('\\?\')){$plain=$plain.Substring(4)}
    if($plain -match '^[A-Za-z]:\\') {
        $root=$plain.Substring(0,3); $tail=$plain.Substring(3)
        if($tail.Contains(':')){throw 'Alternate stream rejected'}
        $prefix='\\?\'
    } elseif($plain -match '^\\\\([^\\]+)\\([^\\]+)(?:\\|$)') {
        $root='\\'+$Matches[1]+'\'+$Matches[2]+'\'
        $tail=$plain.Substring([Math]::Min($root.Length,$plain.Length))
        if($plain.Contains(':') -or $Matches[1] -eq '.' -or $Matches[1] -eq '?'){throw 'Device/stream path rejected'}
        $prefix='\\?\UNC\'; $plain=$plain.Substring(2)
    } else {throw 'Absolute drive or UNC path required'}
    foreach($part in $tail.Split('\')) {
        if($part -eq '.' -or $part -eq '..'){throw 'Ambiguous path rejected'}
    }
    $result=$prefix+$plain.TrimEnd('\')
    if($tail.TrimEnd('\').Length -eq 0){$result+='\'}
    return $result
}
function Literal-Root([string]$literal) {
    if($literal -match '^\\\\\?\\[A-Za-z]:\\'){return $literal.Substring(0,7)}
    if($literal -match '^\\\\\?\\UNC\\[^\\]+\\[^\\]+(?:\\|$)'){return $Matches[0].TrimEnd('\')+'\'}
    throw 'Invalid extended root'
}
function Assert-Ancestors($literal) {
    $cursor=$literal; $root=Literal-Root $literal
    while($cursor) {
        $attributes=[int][IO.File]::GetAttributes($cursor)
        if(($attributes -band 1024) -ne 0){
            if($cursor -ne $literal -or !$junctions.ContainsKey($literal)){throw 'Ancestor reparse path protected'}
            Assert-Junction $literal
        }
        if($cursor.TrimEnd('\') -eq $root.TrimEnd('\')){break}
        $parent=$cursor.Substring(0,$cursor.TrimEnd('\').LastIndexOf('\'))
        if($parent.Length -lt $root.Length){$cursor=$root}else{$cursor=$parent}
    }
}
function Assert-Junction($literal) {
    $spec=$junctions[$literal]
    $entry=Get-Item -LiteralPath $literal -Force -ErrorAction Stop
    if($entry.LinkType -ne 'Junction' -or ([int]$entry.Attributes -band 4) -ne 0 -or
       (Extended-Literal ([string]$entry.Target)) -ne (Extended-Literal ([string]$spec.target)) -or
       [MaintenanceJunctionNative]::Pin($literal) -cne [string]$spec.identity.pin) {throw 'Approved junction changed'}
}
function Assert-Tree {
    $pending=[Collections.Generic.Stack[string]]::new(); $pending.Push($target)
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    while($pending.Count -gt 0) {
        $literal=$pending.Pop()
        if(!$approved.ContainsKey($literal)){throw 'Unreviewed descendant appeared'}
        if(!$seen.Add($literal)){throw 'Duplicate observed descendant'}
        Assert-Ancestors $literal
        $attributes=[int][IO.File]::GetAttributes($literal)
        if(($attributes -band 4) -ne 0){throw 'System attributes protected'}
        # Top-level literal enumeration includes hidden/system entries. The
        # checked leaf must be a plain directory before enumeration starts.
        if(($attributes -band 16) -ne 0 -and !$junctions.ContainsKey($literal)){foreach($child in [IO.Directory]::EnumerateFileSystemEntries($literal)){$pending.Push((Extended-Literal $child))}}
    }
    if($seen.Count -ne $approved.Count){throw 'Approved descendant disappeared'}
}
function Invoke-Deletion($request) {
$changes=[Collections.Generic.List[object]]::new(); $failure=$null; $target=$null
$junctions=@{}; $approved=@{}

try {
    $target=Extended-Literal $request.path
    foreach($original in $request.entries) {
        $literal=Extended-Literal $original
        if($literal -ne $target -and !$literal.StartsWith($target.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Approved path escapes target'}
        if($approved.ContainsKey($literal)){throw 'Duplicate approved path'}
        $approved[$literal]=$original
    }
    foreach($spec in $request.junctions) {
        $literal=Extended-Literal $spec.path
        if($literal -eq $target -or !$approved.ContainsKey($literal) -or $junctions.ContainsKey($literal)){throw 'Invalid junction deletion approval'}
        $junctions[$literal]=$spec
    }
    Assert-Tree
    # Preflight every attribute-changing file before modifying any entry.
    # Count every approved regular-file name in this one deletion root.
    $normalizationPins=@{}
    foreach($literal in $approved.Keys) {
        Assert-Ancestors $literal
        if($junctions.ContainsKey($literal)){continue}
        $attributes=[int][IO.File]::GetAttributes($literal)
        if(($attributes -band 16) -eq 0 -and (($attributes -band 3) -ne 0)) {
            $normalizationPins[$literal]=[MaintenanceJunctionNative]::NormalizationPin($literal)
        }
    }
    if($normalizationPins.Count -gt 0) {
        $linkCounts=@{}
        foreach($literal in $approved.Keys) {
            Assert-Ancestors $literal
            if($junctions.ContainsKey($literal)){continue}
            $attributes=[int][IO.File]::GetAttributes($literal)
            if(($attributes -band 16) -eq 0) {
                $pin=[MaintenanceJunctionNative]::NormalizationPin($literal)
                if(!$linkCounts.ContainsKey($pin)){$linkCounts[$pin]=0}
                $linkCounts[$pin]++
            }
        }
        foreach($pin in $normalizationPins.Values) {
            $links=[uint32]($pin.Split(':')[-1])
            if(!$linkCounts.ContainsKey($pin) -or $linkCounts[$pin] -ne $links) {throw 'ReadOnly/Hidden normalization blocked: multiple hardlinks extend outside one selected deletion root; cross-member link ownership is not verified'}
        }
    }
    # Assert-Tree checked the exact full authorized set before normalization.
    foreach($literal in $approved.Keys) {
        Assert-Ancestors $literal
        if($junctions.ContainsKey($literal)){continue}
        $before=[int][IO.File]::GetAttributes($literal)
        if(($before -band 4) -ne 0 -or ($before -band 1024) -ne 0) {throw 'System/reparse attributes protected'}
        $after=$before -band (-bnot 3)
        if($before -ne $after){
            if(($before -band 16) -eq 0) {
                if(!$normalizationPins.ContainsKey($literal) -or [MaintenanceJunctionNative]::NormalizationPin($literal) -cne $normalizationPins[$literal]) {throw 'Normalization file identity or link count changed'}
            }
            [IO.File]::SetAttributes($literal,[IO.FileAttributes]$after)
            $changes.Add(@{path=$approved[$literal];before=$before;after=[int][IO.File]::GetAttributes($literal)})
        }
    }
    Assert-Tree
    foreach($literal in $junctions.Keys) {
        Assert-Ancestors $literal
        Assert-Junction $literal
        [MaintenanceJunctionNative]::Unlink($literal, [string]$junctions[$literal].identity.pin)
    }
    # Ordinary recursive removal starts only after all approved links are gone.
    $junctions.Clear()
    foreach($original in $request.junctions){$approved.Remove((Extended-Literal $original.path))}
    Assert-Tree
    Remove-Item -LiteralPath $target -Recurse -ErrorAction Stop
} catch { $failure=$_.Exception.Message }
$remaining=$null
if($target) {
    # Only explicit absence exceptions establish removal; access or other
    # metadata failures preserve an unknown remaining state.
    try {$null=[IO.File]::GetAttributes($target); $remaining=$true}
    catch [IO.FileNotFoundException] {$remaining=$false}
    catch [IO.DirectoryNotFoundException] {$remaining=$false}
    catch {if(!$failure){$failure=$_.Exception.Message}}
}
@{status=$(if($remaining -eq $false -and !$failure){'deleted'}else{'failed'});attributes=@($changes.ToArray());error=$failure;remaining=$remaining;physical_bytes_reclaimed=$null}
}

while($null -ne ($line=[Console]::In.ReadLine())) {
    $envelope=$line | ConvertFrom-Json
    $report=Invoke-Deletion $envelope.request
    [Console]::Out.WriteLine((@{sequence=$envelope.sequence;report=$report} | ConvertTo-Json -Depth 10 -Compress))
    [Console]::Out.Flush()
}
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AccessMode, Context, paths};
    use std::fs;
    use std::os::windows::fs::OpenOptionsExt;

    fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
        Ok(())
    }

    #[test]
    fn startup_eof_exits_before_script_evaluation() {
        let output = codex_utils_process::background_command("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &gated_script("[Console]::Out.WriteLine('setup must not run'); exit 0"),
            ])
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(125));
        assert!(output.stdout.is_empty());
    }

    // These fixtures start a descendant only after the same stdin handshake as
    // the real script. There is no pre-assignment process creation in the shell.
    const TREE_SCRIPT: &str = r#"
$null=[Console]::In.ReadLine()
$descendant=Start-Process -WindowStyle Hidden -PassThru powershell.exe -ArgumentList '-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 120'
[Console]::Out.WriteLine($descendant.Id)
[Console]::Out.Flush()
$null=[Console]::In.ReadLine()
"#;

    fn tree_worker() -> (Worker, OwnedHandle, OwnedHandle) {
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
        };

        let mut worker = Worker::spawn(TREE_SCRIPT).unwrap();
        writeln!(worker.stdin.as_mut().unwrap(), "start").unwrap();
        worker.stdin.as_mut().unwrap().flush().unwrap();
        let mut line = String::new();
        worker.stdout.read_line(&mut line).unwrap();
        let descendant: u32 = line.trim().parse().unwrap();
        let open = |pid| {
            let handle = unsafe {
                OpenProcess(
                    PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                    0,
                    pid,
                )
            };
            assert!(!handle.is_null(), "{}", std::io::Error::last_os_error());
            unsafe { OwnedHandle::from_raw_handle(handle) }
        };
        let process = open(worker.process_id());
        let descendant = open(descendant);
        (worker, process, descendant)
    }

    fn assert_stopped(process: &OwnedHandle) {
        use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
        use windows_sys::Win32::System::Threading::WaitForSingleObject;

        assert_eq!(
            unsafe { WaitForSingleObject(process.as_raw_handle(), 10_000) },
            WAIT_OBJECT_0
        );
    }

    #[test]
    fn abort_and_graceful_drop_terminate_descendants() {
        let (mut worker, process, descendant) = tree_worker();
        worker.abort();
        assert!(worker.is_stopped());
        assert_stopped(&process);
        assert_stopped(&descendant);

        let (worker, process, descendant) = tree_worker();
        drop(worker);
        assert_stopped(&process);
        assert_stopped(&descendant);
    }

    #[test]
    fn parent_loss_worker_fixture() {
        if std::env::var_os("AZRAEL_DELETE_PARENT_LOSS_FIXTURE").is_none() {
            return;
        }
        let (worker, _process, descendant) = tree_worker();
        // The harness parent's process handles pin these exact objects before
        // it kills us, bypassing Rust Drop just as an actual owner crash does.
        let descendant_pid = unsafe {
            windows_sys::Win32::System::Threading::GetProcessId(descendant.as_raw_handle())
        };
        assert_ne!(descendant_pid, 0);
        println!("WORKER_TREE:{},{}", worker.process_id(), descendant_pid);
        std::io::stdout().flush().unwrap();
        loop {
            std::thread::park();
        }
    }

    #[test]
    fn parent_process_loss_terminates_worker_and_descendants() {
        // Reuse the native test binary rather than introduce another executable.
        // Keep the owner kill/wait guarded even if fixture assertions fail.
        struct Parent(Child);
        impl Drop for Parent {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let mut parent = Parent(
            codex_utils_process::background_command(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "windows_delete::tests::parent_loss_worker_fixture",
                    "--nocapture",
                ])
                .env("AZRAEL_DELETE_PARENT_LOSS_FIXTURE", "1")
                .stdout(Stdio::piped())
                .spawn()
                .unwrap(),
        );
        let mut output = BufReader::new(parent.0.stdout.take().unwrap());
        let mut line = String::new();
        loop {
            line.clear();
            assert_ne!(output.read_line(&mut line).unwrap(), 0, "fixture exited");
            if let Some((_, pids)) = line.trim().split_once("WORKER_TREE:") {
                use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE};
                let processes: Vec<OwnedHandle> = pids
                    .split(',')
                    .map(|pid| {
                        let pid: u32 = pid.parse().unwrap();
                        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
                        assert!(!handle.is_null(), "{}", std::io::Error::last_os_error());
                        unsafe { OwnedHandle::from_raw_handle(handle) }
                    })
                    .collect();
                assert_eq!(processes.len(), 2);
                parent.0.kill().unwrap();
                parent.0.wait().unwrap();
                for process in &processes {
                    assert_stopped(process);
                }
                break;
            }
        }
    }

    #[test]
    fn verified_deletions_reuse_child_with_independent_reports() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("first");
        let second = root.path().join("second");
        fs::write(&first, "first payload").unwrap();
        fs::write(&second, "second payload").unwrap();
        let mut permissions = fs::metadata(&first).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&first, permissions).unwrap();
        let context = Context::new(&allow);
        let first_report =
            paths::delete_verified(root.path(), &first, std::slice::from_ref(&first), &context)
                .unwrap();
        let pid = context
            .windows_delete
            .borrow()
            .as_ref()
            .unwrap()
            .process_id();
        assert_eq!(first_report["status"], "deleted");
        assert_eq!(first_report["attributes"].as_array().unwrap().len(), 1);
        assert!(!first.exists());
        let second_report = paths::delete_verified(
            root.path(),
            &second,
            std::slice::from_ref(&second),
            &context,
        )
        .unwrap();
        assert_eq!(
            context
                .windows_delete
                .borrow()
                .as_ref()
                .unwrap()
                .process_id(),
            pid
        );
        assert_eq!(second_report["status"], "deleted");
        assert_eq!(second_report["attributes"], json!([]));
        assert_eq!(second_report["error"], Value::Null);
        assert_eq!(second_report["remaining"], false);
        assert!(!second.exists());
    }

    #[test]
    fn failed_request_does_not_leak_audit_or_failure_into_next_root() {
        let root = tempfile::tempdir().unwrap();
        let locked = root.path().join("locked");
        let next = root.path().join("next");
        fs::write(&locked, "locked payload").unwrap();
        fs::write(&next, "next payload").unwrap();
        // Permit reading/writing attributes but deny ordinary deletion.
        let handle = fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(&locked)
            .unwrap();
        let mut permissions = fs::metadata(&locked).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&locked, permissions).unwrap();
        let context = Context::new(&allow);
        let failed = paths::delete_verified(
            root.path(),
            &locked,
            std::slice::from_ref(&locked),
            &context,
        )
        .unwrap();
        let pid = context
            .windows_delete
            .borrow()
            .as_ref()
            .unwrap()
            .process_id();
        assert_eq!(failed["status"], "failed");
        assert_eq!(failed["remaining"], true);
        assert!(failed["error"].is_string());
        assert_eq!(failed["attributes"].as_array().unwrap().len(), 1);
        let success =
            paths::delete_verified(root.path(), &next, std::slice::from_ref(&next), &context)
                .unwrap();
        assert_eq!(
            context
                .windows_delete
                .borrow()
                .as_ref()
                .unwrap()
                .process_id(),
            pid
        );
        assert_eq!(success["status"], "deleted");
        assert_eq!(success["attributes"], json!([]));
        assert_eq!(success["error"], Value::Null);
        assert!(!next.exists());
        drop(handle);
        fs::remove_file(&locked).unwrap();
    }

    #[test]
    fn complete_report_survives_worker_exit_and_later_item_gets_new_worker() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("retained");
        fs::write(&target, "retained payload").unwrap();
        let mut worker = Worker::spawn(r#"
$request=[Console]::In.ReadLine() | ConvertFrom-Json
$report=@{status='failed';attributes=@(@{path=$request.request.path;before=3;after=0});error='ordinary removal failed';remaining=$true;physical_bytes_reclaimed=$null}
[Console]::Out.WriteLine((@{sequence=$request.sequence;report=$report} | ConvertTo-Json -Depth 8 -Compress))
[Console]::Out.Flush()
exit 17
"#).unwrap();
        worker.sequence = 1;
        // Wait for exact process exit before reading its complete buffered reply
        // so the post-report exit branch is exercised without a timing race.
        writeln!(
            worker.stdin.as_mut().unwrap(),
            "{}",
            json!({"sequence":1,"request":{"path":target}})
        )
        .unwrap();
        worker.stdin.as_mut().unwrap().flush().unwrap();
        assert_eq!(worker.child.wait().unwrap().code(), Some(17));
        let report = worker.receive_reply().unwrap();
        assert_eq!(report["status"], "failed");
        assert_eq!(report["remaining"], true);
        assert_eq!(report["error"], "ordinary removal failed");
        assert_eq!(
            report["attributes"],
            json!([{"path":target,"before":3,"after":0}])
        );
        assert!(worker.is_stopped());
        assert!(worker.stdin.is_none());
        assert!(worker.drain.is_none());
        assert_eq!(fs::read_to_string(&target).unwrap(), "retained payload");
        drop(worker);
        let context = Context::new(&allow);
        let later = root.path().join("later");
        fs::write(&later, "independent payload").unwrap();
        let next =
            paths::delete_verified(root.path(), &later, std::slice::from_ref(&later), &context)
                .unwrap();
        assert_eq!(next["status"], "deleted");
        assert!(target.exists());
        assert!(!later.exists());
    }

    #[test]
    fn dropping_worker_closes_eof_and_terminates_exact_process() {
        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
        };

        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("generated");
        fs::write(&target, "generated payload").unwrap();
        let context = Context::new(&allow);
        paths::delete_verified(
            root.path(),
            &target,
            std::slice::from_ref(&target),
            &context,
        )
        .unwrap();
        let pid = context
            .windows_delete
            .borrow()
            .as_ref()
            .unwrap()
            .process_id();
        // Holding the handle pins this exact process object across PID reuse.
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        assert!(!handle.is_null(), "{}", std::io::Error::last_os_error());
        let worker = context.windows_delete.borrow_mut().take().unwrap();
        drop(context);
        // Drop on another thread keeps the handle wait bounded if EOF shutdown
        // regresses. Join only after this exact process is confirmed signaled.
        let dropping = std::thread::spawn(move || drop(worker));
        let outcome = unsafe { WaitForSingleObject(handle, 10_000) };
        unsafe {
            CloseHandle(handle);
        }
        assert_eq!(outcome, WAIT_OBJECT_0);
        dropping.join().unwrap();
    }

    #[test]
    fn abrupt_exit_returns_unknown_without_retry_and_discards_worker() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("untouched");
        fs::write(&target, "must not be retried").unwrap();
        let context = Context::new(&allow);
        *context.windows_delete.borrow_mut() =
            Some(Worker::spawn("$null=[Console]::In.ReadLine(); exit 17").unwrap());
        let error = paths::delete_verified(
            root.path(),
            &target,
            std::slice::from_ref(&target),
            &context,
        )
        .unwrap_err();
        assert!(error.contains("outcome unknown; not retried"), "{error}");
        assert!(context.windows_delete.borrow().is_none());
        assert_eq!(fs::read_to_string(&target).unwrap(), "must not be retried");
        // An independently requested later item may create a fresh worker.
        let later = root.path().join("later");
        fs::write(&later, "later payload").unwrap();
        let report =
            paths::delete_verified(root.path(), &later, std::slice::from_ref(&later), &context)
                .unwrap();
        assert_eq!(report["status"], "deleted");
        assert!(target.exists());
        assert!(!later.exists());
    }

    #[test]
    fn unreviewed_descendant_stops_before_attributes_and_next_request_is_fresh() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("generated");
        fs::create_dir(&target).unwrap();
        let file = target.join("unreviewed");
        fs::write(&file, "unreviewed payload").unwrap();
        let mut permissions = fs::metadata(&file).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&file, permissions).unwrap();
        let mut worker = Worker::new().unwrap();
        let failed = worker
            .delete(&target, std::slice::from_ref(&target), &[])
            .unwrap();
        assert_eq!(failed["status"], "failed");
        assert!(
            failed["error"]
                .as_str()
                .unwrap()
                .contains("Unreviewed descendant")
        );
        assert_eq!(failed["attributes"], json!([]));
        assert!(fs::metadata(&file).unwrap().permissions().readonly());
        let success = worker
            .delete(&target, &[target.clone(), file.clone()], &[])
            .unwrap();
        assert_eq!(success["status"], "deleted");
        assert_eq!(success["attributes"].as_array().unwrap().len(), 1);
        assert!(!target.exists());
    }
}
