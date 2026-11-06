"use strict";
const { workerData } = require("node:worker_threads");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const decoder = new StringDecoder("utf8");
// Includes JSON and newline; matches native lease MAX_FRAME_BYTES.
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const { port } = workerData;
const signal = new Int32Array(workerData.signal);
let pending = 0, buffer = "", bufferBytes = 0, stderr = "", faulted = false;
let shutdownRequested = false, killRequested = false, releaseAcknowledged = false, closed = false;
let nativeExit = { native_exit_observed: false, native_exit_code: null, native_signal: null };
function reply(value) {
  port.postMessage({ ...value, native_pid: child.pid ?? null, ...nativeExit,
    native_close_observed: closed, native_stdin_eof_requested: shutdownRequested, native_kill_requested: killRequested });
  Atomics.add(signal, 0, 1); Atomics.notify(signal, 0);
}
function fail(message) {
  if (!faulted) { faulted = true; reply({ id: pending, ok: false, error: message, transport_failure: true }); }
}
function shutdown() {
  if (!shutdownRequested && !closed) {
    shutdownRequested = true;
    try { child.stdin.end(); } catch (error) { fail(error.message); }
  }
}
const child = spawn(workerData.binary, [...(workerData.args || []), "--lease", workerData.filename, "--operation", workerData.operation, "--wait-ms", String(workerData.waitMs), "--parent-pid", String(workerData.parentPid)], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
child.on("error", error => fail(error.message));
child.stdin.on("error", error => fail(error.message));
child.stderr.on("data", bytes => { stderr = (stderr + bytes.toString()).slice(0, 4096); });
child.stdout.on("data", bytes => {
  if (faulted) return; // Keep draining the pipe without retaining unbounded invalid output.
  bufferBytes += bytes.length;
  buffer += decoder.write(bytes);
  if (bufferBytes > MAX_FRAME_BYTES) return fail("Native lease output exceeds bound");
  for (;;) {
    const at = buffer.indexOf("\n"); if (at < 0) break;
    const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
    bufferBytes -= Buffer.byteLength(line, "utf8") + 1;
    try {
      const value = JSON.parse(line);
      if (value.id !== pending || typeof value.ok !== "boolean") throw Error("Invalid native lease response");
      if (value.ok && releaseRequestId === pending) releaseAcknowledged = true;
      reply(value); pending = null;
    }
    catch (error) { fail(error.message); break; }
  }
});
child.on("exit", (code, signalName) => {
  nativeExit = { native_exit_observed: true, native_exit_code: code, native_signal: signalName };
});
// 'exit' can precede the final stdout data. Only 'close' proves pipe draining ended.
child.on("close", () => {
  closed = true;
  if (!faulted && bufferBytes) fail("Native lease closed with an incomplete response; " + stderr);
  else if (!faulted && (pending !== null || !shutdownRequested && !releaseAcknowledged)) {
    fail("Native lease exited before response: " + nativeExit.native_exit_code + "/" + nativeExit.native_signal + "; " + stderr);
  }
  reply({ type: "closed" });
  Atomics.store(signal, 1, 1);
  port.close();
});
let releaseRequestId = null;
port.on("message", message => {
  if (message?.control === "shutdown") { shutdown(); return; }
  if (message?.control === "kill") {
    if (closed) return;
    killRequested = true;
    try { child.kill(); } catch (error) { fail(error.message); }
    return;
  }
  if (faulted || shutdownRequested || closed || pending !== null) return fail("Native lease concurrent request refused");
  pending = message.id;
  if (message.operation === "release") releaseRequestId = pending;
  const line = JSON.stringify(message) + "\n";
  if (Buffer.byteLength(line) > MAX_FRAME_BYTES) return fail("Native lease request exceeds bound");
  child.stdin.write(line, error => { if (error) fail(error.message); });
});
port.on("close", shutdown);
process.on("exit", () => { child.stdin.destroy(); });
