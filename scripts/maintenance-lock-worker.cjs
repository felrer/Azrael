"use strict";
const { workerData } = require("node:worker_threads");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const decoder = new StringDecoder("utf8");
// Includes JSON and newline; matches native lease MAX_FRAME_BYTES.
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const { port } = workerData;
const signal = new Int32Array(workerData.signal);
let pending = 0, buffer = "", bufferBytes = 0, stderr = "", finished = false;
function reply(value) { port.postMessage(value); Atomics.add(signal, 0, 1); Atomics.notify(signal, 0); }
function fail(message) { if (!finished) { finished = true; Atomics.store(signal, 1, 1); reply({ id: pending, ok: false, error: message }); child.stdin.destroy(); child.kill(); } }
const child = spawn(workerData.binary, ["--lease", workerData.filename, "--operation", workerData.operation, "--wait-ms", String(workerData.waitMs), "--parent-pid", String(workerData.parentPid)], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
child.on("error", error => fail(error.message));
child.stderr.on("data", bytes => { stderr = (stderr + bytes.toString()).slice(0, 4096); });
child.stdout.on("data", bytes => {
  bufferBytes += bytes.length;
  buffer += decoder.write(bytes);
  if (bufferBytes > MAX_FRAME_BYTES) return fail("Native lease output exceeds bound");
  for (;;) {
    const at = buffer.indexOf("\n"); if (at < 0) break;
    const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
    bufferBytes -= Buffer.byteLength(line, "utf8") + 1;
    try { const value = JSON.parse(line); if (value.id !== pending || typeof value.ok !== "boolean") throw Error("Invalid native lease response"); reply(value); pending = null; }
    catch (error) { fail(error.message); break; }
  }
});
child.on("exit", (code, signalName) => { if (!finished) fail("Native lease exited before response: " + code + "/" + signalName + "; " + stderr); });
port.on("message", message => {
  if (finished || pending !== null) return fail("Native lease concurrent request refused");
  pending = message.id;
  const line = JSON.stringify(message) + "\n";
  if (Buffer.byteLength(line) > MAX_FRAME_BYTES) return fail("Native lease request exceeds bound");
  child.stdin.write(line, error => { if (error) fail(error.message); });
});
port.on("close", () => { child.stdin.destroy(); });
process.on("exit", () => { child.stdin.destroy(); });
