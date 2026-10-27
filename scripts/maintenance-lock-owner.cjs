"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { Worker, MessageChannel, receiveMessageOnPort } = require("node:worker_threads");
// Native registry records remain bounded at 16 MiB. The worker/native lease
// transport accepts 64 MiB JSON frames, including their newline; reservation
// batches are conservatively preflighted before any durable fence is created.
function resolveOwner() {
  const filename = require("./maintenance-owner-config.cjs").resolveMaintenanceOwner();
  if (typeof filename !== "string" || !path.isAbsolute(filename) || !fs.statSync(filename).isFile()) throw Error("Absolute existing maintenance owner binary required");
  return filename;
}
function acquire(filename, { operation, waitMs = 0 } = {}) {
  if (typeof filename !== "string" || !path.isAbsolute(filename) || filename.includes("\0") || filename.split(/[\\/]/).some(x => x === ".." || x === ".")) throw Error("Absolute lock path without traversal required");
  if (typeof operation !== "string" || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(operation)) throw Error("Bounded lock operation required");
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 5000) throw Error("Lock wait must be between 0 and 5000ms");
  const { port1, port2 } = new MessageChannel();
  const signal = new Int32Array(new SharedArrayBuffer(8));
  const worker = new Worker(require.resolve("./maintenance-lock-worker.cjs"), { workerData: { port: port2, signal: signal.buffer, binary: resolveOwner(), filename, operation, waitMs, parentPid: process.pid }, transferList: [port2] });
  worker.on("error", () => {});
  worker.unref(); port1.unref();
  let closed = false, next = 1;
  function wait(id, timeout) {
    const until = performance.now() + timeout;
    for (;;) {
      const tick = Atomics.load(signal, 0);
      const packet = receiveMessageOnPort(port1)?.message;
      if (packet) {
        if (packet.id === null && !packet.ok) { close(); throw Error(packet.error || "Native lease terminated; outcome unknown"); }
        if (packet.id !== id) { close(); throw Error("Native lease protocol response mismatch; outcome unknown"); }
        if (!packet.ok) { const busy = id === 0 && /OS lock busy|legacy or unknown lock/.test(packet.error || ""); const error = Object.assign(Error(packet.error || "Native lease failed"), { code: busy ? "EEXIST" : "ELOCKOWNERSHIP", path: filename, recovery_required: /explicit recovery/.test(packet.error || "") }); throw error; }
        return packet.result;
      }
      if (Atomics.load(signal, 1) !== 0) { close(); throw Error("Native lease terminated; outcome unknown"); }
      const remaining = until - performance.now();
      if (remaining <= 0) { close(); throw Error("Native lease timeout; outcome unknown"); }
      Atomics.wait(signal, 0, tick, Math.min(remaining, 100));
    }
  }
  function close() { if (!closed) { closed = true; port1.close(); worker.terminate(); } }
  function request(operation, fields = {}) {
    if (closed) throw Error("Native lease already released");
    const id = next++; port1.postMessage({ id, operation, ...fields });
    const responseDeadlineMs = ["reserve_producers", "finish_producers"].includes(operation) ? 60000 : 10000;
    return wait(id, responseDeadlineMs);
  }
  let owner;
  try { owner = wait(0, waitMs + 10000); } catch (error) { close(); throw error; }
  return { owner,
    writeRecord(record, expectedSha) { return request("write_record", { record, expected_sha256: expectedSha }); },
    removeRecord(recordId, expectedSha) { return request("remove_record", { record_id: recordId, expected_sha256: expectedSha }); },
    reserveProducers(records) { return request("reserve_producers", { records }); },
    releaseCatalog() { return request("release_catalog"); },
    finishProducers(outcomes, evidenceRef, evidenceSha) { return request("finish_producers", { outcomes, evidence_ref: evidenceRef, evidence_sha256: evidenceSha }); },
    release() { try { return request("release"); } finally { close(); } }
  };
}
module.exports = { acquire };
