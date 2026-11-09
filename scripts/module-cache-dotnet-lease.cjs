"use strict";
// The Windows module-cache owner uses FileShare.None, with no sentinel bytes.
const { Worker, isMainThread, workerData, MessageChannel, receiveMessageOnPort } = require("node:worker_threads");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const script = String.raw`
$ErrorActionPreference='Stop'
$stream=$null
try {
  $r=[Console]::In.ReadLine()|ConvertFrom-Json
  if($r.operation -cne 'acquire' -or $r.sequence -ne 1 -or $r.token -cnotmatch '^[a-f0-9]{64}$' -or -not [IO.Path]::IsPathRooted($r.path)){throw 'Invalid acquire frame'}
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ModuleLeaseInfo { [StructLayout(LayoutKind.Sequential)] public struct Info { public uint Attr,CL,CH,AL,AH,WL,WH,Volume,SizeH,SizeL,Links,IndexH,IndexL; } [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetFileInformationByHandle(IntPtr h,out Info i); }'
  $stream=[IO.File]::Open($r.path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  $info=New-Object ModuleLeaseInfo+Info
  if(-not [ModuleLeaseInfo]::GetFileInformationByHandle($stream.SafeFileHandle.DangerousGetHandle(),[ref]$info)){throw 'Handle identity unavailable'}
  if($info.Links -ne 1){throw 'Unlinked regular module lock required'}
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$digest=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
  $stream.Position=0
  $identity=@{dev=[string]$info.Volume;ino=[string](([decimal]$info.IndexH*4294967296)+$info.IndexL);birthtimeNs=[string]((([decimal]$info.CH*4294967296)+$info.CL-116444736000000000)*100)}
  [Console]::Out.WriteLine((@{type='ready';sequence=1;token=$r.token;path=$r.path;pid=$PID;process_start_ticks=[string]([Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().Ticks);identity=$identity;sha256=$digest}|ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
  $sequence=1
  while($true){
    $line=[Console]::In.ReadLine()
    if($null -eq $line){throw 'EOF before explicit lease release'}
    $release=$line|ConvertFrom-Json;$sequence++
    if($release.sequence -ne $sequence -or $release.token -cne $r.token){throw 'Invalid lease frame ownership'}
    if($release.operation -ceq 'assert'){
      if($stream.SafeFileHandle.IsClosed -or -not $stream.CanWrite){throw 'Module lease handle is closed'}
      [Console]::Out.WriteLine((@{type='held';sequence=$sequence;token=$r.token;pid=$PID}|ConvertTo-Json -Compress));[Console]::Out.Flush();continue
    }
    if($release.operation -cne 'release'){throw 'Invalid lease operation'}
    $stream.Dispose();$stream=$null
    [Console]::Out.WriteLine((@{type='released';sequence=$sequence;token=$r.token;pid=$PID}|ConvertTo-Json -Compress));[Console]::Out.Flush();break
  }
} catch {
  [Console]::Out.WriteLine((@{type='error';message=$_.Exception.Message}|ConvertTo-Json -Compress))
  [Console]::Out.Flush();exit 1
} finally {if($null -ne $stream){$stream.Dispose()}}
`;
function workerMain() {
  const { port, signal, filename, token, executable } = workerData;
  const notify = value => { port.postMessage(value); Atomics.add(signal, 0, 1); Atomics.notify(signal, 0); };
  const child = require("node:child_process").spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let buffered = "", stderr = "", failed = false;
  const fail = message => { if (!failed) { failed = true; notify({ type: "error", message, process_pid: child.pid }); child.kill(); } };
  child.on("error", error => fail(error.message)); child.stdin.on("error", error => fail(error.message));
  child.stderr.on("data", bytes => { stderr += bytes.toString(); if (Buffer.byteLength(stderr) > 65536) fail("Module lease stderr exceeds frame bound"); });
  child.stdout.setEncoding("utf8"); child.stdout.on("data", bytes => {
    buffered += bytes;
    if (Buffer.byteLength(buffered) > 65536) return fail("Module lease stdout exceeds frame bound");
    for (;;) { const end = buffered.indexOf("\n"); if (end < 0) break; const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
      try { notify({ ...JSON.parse(line), process_pid: child.pid }); } catch { fail("Malformed module lease frame"); }
    }
  });
  child.on("close", (code, exitSignal) => { notify({ type: "closed", process_pid: child.pid, process_exit_code: code, process_signal: exitSignal, stderr }); port.close(); });
  port.on("message", request => {
    if (request.operation === "terminate") child.kill();
    else if (request.operation === "eof") child.stdin.end();
    else if (request.operation === "release") child.stdin.end(JSON.stringify(request) + "\n");
    else child.stdin.write(JSON.stringify(request) + "\n");
  });
  child.stdin.write(JSON.stringify({ operation: "acquire", sequence: 1, token, path: filename }) + "\n");
}
function acquire(filename) {
  if (process.platform !== "win32") throw new Error("Windows module-cache FileShare.None provider required");
  if (!path.isAbsolute(filename) || path.resolve(filename) !== filename) throw new Error("Absolute canonical module lock required");
  const before = fs.lstatSync(filename, { bigint: true }), bytes = fs.readFileSync(filename);
  if (!before.isFile() || before.nlink !== 1n) throw new Error("Existing plain module lock required");
  const token = crypto.randomBytes(32).toString("hex"), signal = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  const worker = new Worker(__filename, { workerData: { kind: "module-cache-dotnet", filename, token, executable, port: port2, signal }, transferList: [port2] });
  worker.on("error", () => {}); worker.unref();
  let closed, failure, released = false, sequence = 1;
  function wait(type, timeout = 15000) {
    if (closed) { if (type === "closed") return closed; throw new Error(`Module lease process is already closed before ${type}`); }
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const tick = Atomics.load(signal, 0), packet = receiveMessageOnPort(port1)?.message;
      if (packet) {
        if (packet.type === "closed") { closed = packet; if (type === "closed") return packet; throw new Error(`Module lease exited before ${type}: ${packet.process_exit_code}/${packet.process_signal}: ${packet.stderr}`); }
        if (packet.type === "error") { failure = new Error(packet.message); if (type !== "closed") throw failure; }
        else if (packet.type === type) return packet;
        else throw new Error("Unexpected module lease response sequence");
      } else Atomics.wait(signal, 0, tick, Math.max(1, Math.min(100, deadline - Date.now())));
    }
    throw new Error(`Module lease ${type} timed out`);
  }
  function shutdown() {
    if (!closed) { port1.postMessage({ operation: "terminate" }); try { wait("closed"); } catch {} }
    port1.close(); worker.terminate();
  }
  let ready;
  try {
    ready = wait("ready");
    if (ready.sequence !== 1 || ready.token !== token || ready.path !== filename || ready.pid !== ready.process_pid || !Number.isSafeInteger(ready.pid) ||
        !/^[0-9]+$/.test(ready.process_start_ticks || "") || ready.sha256 !== hash(bytes) ||
        !["dev", "ino", "birthtimeNs"].every(key => ready.identity?.[key] === String(before[key]))) throw new Error("Module lease handle identity, ownership or bytes changed");
  } catch (error) { shutdown(); error.module_cache_process = closed || { process_exit_observed: false }; throw error; }
  return { backend: "windows-dotnet-file-share-none", owner: { schema: 1, pid: ready.pid, token, process_start_ticks: ready.process_start_ticks,
      operation: "module-cache.consumer-retirement" }, handle: ready,
    assertHeld() {
      if (released) throw new Error("Module lease already released");
      port1.postMessage({ operation: "assert", sequence: ++sequence, token });
      const ack = wait("held");
      if (ack.sequence !== sequence || ack.token !== token || ack.pid !== ready.pid || ack.process_pid !== ready.pid) throw new Error("Module lease held acknowledgment mismatch");
    },
    release() {
      if (released) throw new Error("Module lease already released"); released = true;
      try {
        port1.postMessage({ operation: "release", sequence: ++sequence, token });
        const ack = wait("released");
        if (ack.sequence !== sequence || ack.token !== token || ack.pid !== ready.pid || ack.process_pid !== ready.pid) throw new Error("Module lease release ownership mismatch");
        const terminal = wait("closed");
        if (terminal.process_pid !== ready.pid || terminal.process_exit_code !== 0 || terminal.process_signal !== null || failure) throw failure || new Error("Module lease process did not close successfully");
        const after = fs.lstatSync(filename, { bigint: true });
        if (!["dev", "ino", "birthtimeNs", "size"].every(key => after[key] === before[key]) || !fs.readFileSync(filename).equals(bytes)) throw new Error("Module lock identity or bytes changed before release completion");
        return { released: true, process_exit_observed: true, process_exit_code: terminal.process_exit_code, process_signal: terminal.process_signal, process_close_observed: true, process_pid: ready.pid };
      } catch (error) { shutdown(); error.module_cache_process = closed ? { ...closed, process_exit_observed: true, process_close_observed: true } : { process_exit_observed: false }; throw error;
      } finally { shutdown(); }
    } };
}
if (!isMainThread && workerData?.kind === "module-cache-dotnet") workerMain();
else module.exports = { acquire };
