"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { Worker, MessageChannel, receiveMessageOnPort } = require("node:worker_threads");
const STARTUP_RESPONSE_GRACE_MS = 60000;
// Native registry records remain bounded at 16 MiB. The worker/native lease
// transport accepts 64 MiB JSON frames, including their newline; reservation
// batches are conservatively preflighted before any durable fence is created.
function resolveOwner() {
  const command = require("./maintenance-owner-config.cjs").resolveMaintenanceCommand();
  const filename = command.executable;
  if (typeof filename !== "string" || !path.isAbsolute(filename) || !fs.statSync(filename).isFile()) throw Error("Absolute existing maintenance owner binary required");
  return { ...command, executable: filename };
}
function leaseError(packet, filename, initial) {
  const value = packet.error;
  let details = packet;
  if (!packet.code && typeof value === "string") {
    try { details = JSON.parse(value); } catch { /* Plain native diagnostics remain ownership errors. */ }
  }
  const structured = !packet.transport_failure && details && typeof details === "object" && details.code === "maintenance_busy" && details.retryable === true &&
    typeof details.lock_path === "string" && (details.owner === null || typeof details.owner === "object");
  const message = typeof details?.error === "string" ? details.error : typeof value === "string" ? value : "Native lease failed";
  const busy = structured || !packet.transport_failure && !packet.code && initial && /OS lock busy/.test(message);
  return Object.assign(Error(message), { code: busy ? "EEXIST" : "ELOCKOWNERSHIP", path: filename,
    recovery_required: /explicit recovery/.test(message),
    ...(structured ? { maintenance_code: details.code, retryable: details.retryable, owner: details.owner, lock_path: details.lock_path } : {}) });
}
function acquire(filename, { operation, waitMs, queue = false, command } = {}) {
  if (typeof filename !== "string" || !path.isAbsolute(filename) || filename.includes("\0") || filename.split(/[\\/]/).some(x => x === ".." || x === ".")) throw Error("Absolute lock path without traversal required");
  if (typeof operation !== "string" || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(operation)) throw Error("Bounded lock operation required");
  if (typeof queue !== "boolean") throw Error("Boolean lock queue option required");
  if (waitMs !== undefined && (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 600000)) throw Error("Lock wait must be between 0 and 600000ms");
  const { port1, port2 } = new MessageChannel();
  const signal = new Int32Array(new SharedArrayBuffer(8));
  const ownerCommand = command || resolveOwner();
  if (typeof ownerCommand.executable !== "string" || !path.isAbsolute(ownerCommand.executable) || !Array.isArray(ownerCommand.args) || ownerCommand.args.some(value => typeof value !== "string")) throw Error("Verified maintenance owner command required");
  // Only accepted installations advertise the extended queue budget. Older
  // owners retain their 5s bound; explicit zero remains nonblocking.
  if (waitMs === undefined) waitMs = queue ? (ownerCommand.maxLockWaitMs ?? 5000) : 0;
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 600000) throw Error("Invalid installed lock wait capability");
  const worker = new Worker(require.resolve("./maintenance-lock-worker.cjs"), { workerData: { port: port2, signal: signal.buffer, binary: ownerCommand.executable, args: ownerCommand.args, filename, operation, waitMs, parentPid: process.pid }, transferList: [port2] });
  worker.on("error", () => {});
  worker.unref(); port1.unref();
  let closed = false, observerClosed = false, shutdownRequested = false, killRequested = false;
  let next = 1, nativePid = null, nativeClosed = false, lateResponse = null;
  let nativeExit = { observed: false, code: null, signal: null };
  let currentRequest = { id: 0, operation: "acquire" };
  function observe(packet) {
    if (Number.isSafeInteger(packet?.native_pid) && packet.native_pid > 0) nativePid = packet.native_pid;
    if (packet?.native_exit_observed === true) nativeExit = { observed: true,
      code: Number.isInteger(packet.native_exit_code) ? packet.native_exit_code : null,
      signal: typeof packet.native_signal === "string" ? packet.native_signal : null };
    if (packet?.native_close_observed === true || packet?.type === "closed") nativeClosed = true;
  }
  function contextual(error, packet) {
    observe(packet);
    error.lease = { lock_path: filename, operation, request_operation: currentRequest.operation, request_id: currentRequest.id,
      native_pid: nativePid, native_exit_observed: nativeExit.observed, native_exit_code: nativeExit.code, native_signal: nativeExit.signal,
      native_close_observed: nativeClosed, worker_shutdown_requested: shutdownRequested,
      native_kill_requested: killRequested, worker_termination_requested: observerClosed,
      ...(lateResponse ? { late_response: lateResponse } : {}),
      ...(packet?.transport_failure || error.lease?.transport_failure ? { transport_failure: true } : {}) };
    return error;
  }
  function drainUntil(until) {
    while (!nativeClosed) {
      const tick = Atomics.load(signal, 0), packet = receiveMessageOnPort(port1)?.message;
      if (packet) {
        observe(packet);
        // The caller's original failure remains a failure, even if a commit reply arrives later.
        if (packet.id === currentRequest.id && typeof packet.ok === "boolean" && !packet.transport_failure) {
          lateResponse = { id: packet.id, ok: packet.ok,
            ...(typeof packet.error === "string" ? { error: packet.error.slice(0, 4096) } : {}) };
        }
        continue;
      }
      const remaining = until - performance.now();
      if (remaining <= 0) break;
      Atomics.wait(signal, 0, tick, Math.min(remaining, 100));
    }
  }
  function close() {
    closed = true;
    if (!shutdownRequested && !nativeClosed) {
      shutdownRequested = true;
      try { port1.postMessage({ control: "shutdown" }); } catch { /* Preserve the first operation failure. */ }
      drainUntil(performance.now() + 10000);
    }
    if (!nativeClosed && !killRequested) {
      killRequested = true;
      try { port1.postMessage({ control: "kill" }); } catch { /* A missing close stays unknown. */ }
      drainUntil(performance.now() + 5000);
    }
    if (nativeClosed && !observerClosed) {
      observerClosed = true;
      port1.close(); worker.terminate();
    }
    // An unobserved native close does not authorize destroying its observer or claiming termination.
  }
  function abort(error, packet) {
    close();
    throw contextual(error, packet);
  }
  function wait(id, timeout) {
    const started = performance.now(), until = started + timeout;
    let delayed = false;
    for (;;) {
      const tick = Atomics.load(signal, 0);
      const packet = receiveMessageOnPort(port1)?.message;
      if (packet) {
        observe(packet);
        if (packet.type === "closed") abort(Error("Native lease terminated; outcome unknown"), packet);
        if (packet.id === null && !packet.ok) abort(Error(packet.error || "Native lease terminated; outcome unknown"), packet);
        if (packet.id !== id) abort(Error("Native lease protocol response mismatch; outcome unknown"), packet);
        if (!packet.ok) {
          const error = leaseError(packet, filename, id === 0);
          if (packet.transport_failure) abort(error, packet);
          throw contextual(error, packet);
        }
        return packet.result;
      }
      if (Atomics.load(signal, 1) !== 0) abort(Error("Native lease terminated; outcome unknown"));
      if (!delayed && performance.now() - started >= 10000) {
        delayed = true;
        try { process.stderr.write(JSON.stringify({ component: "maintenance-lease", event: "response-delayed",
          operation: currentRequest.operation, request_id: id, native_pid: nativePid }) + "\n"); } catch { /* Diagnostics do not change the result. */ }
      }
      const remaining = until - performance.now();
      if (remaining <= 0) abort(Error("Native lease timeout; outcome unknown"));
      Atomics.wait(signal, 0, tick, Math.min(remaining, 100));
    }
  }
  function request(operation, fields = {}) {
    const id = next++;
    currentRequest = { id, operation };
    if (closed) throw contextual(Error("Native lease already released"));
    port1.postMessage({ id, operation, ...fields });
    // The native lease may wait for scope admission, catalog reacquisition, or
    // physical-I/O capacity before replying. Preserve its bounded wait budget.
    const admission = ["write_record", "remove_record", "reserve_producers"].includes(operation);
    const boundedWait = admission ? 2 * waitMs : ["release_catalog", "finish_producers"].includes(operation) ? waitMs : 0;
    const responseDeadlineMs = boundedWait + 60000;
    return wait(id, responseDeadlineMs);
  }
  let owner;
  // Native --wait-ms remains the caller's OS contention budget. Starting the
  // worker/process and persisting the initial lease need separate response time.
  try { owner = wait(0, waitMs + STARTUP_RESPONSE_GRACE_MS); } catch (error) {
    close();
    throw contextual(error);
  }
  if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) nativePid = owner.pid;
  return { owner,
    writeRecord(record, expectedSha) { return request("write_record", { record, expected_sha256: expectedSha }); },
    removeRecord(recordId, expectedSha) { return request("remove_record", { record_id: recordId, expected_sha256: expectedSha }); },
    reserveProducers(records) { return request("reserve_producers", { records }); },
    releaseCatalog() { return request("release_catalog"); },
    finishProducers(outcomes, evidenceRef, evidenceSha) { return request("finish_producers", { outcomes, evidence_ref: evidenceRef, evidence_sha256: evidenceSha }); },
    release() {
      let result, failure;
      try { result = request("release"); }
      catch (error) { failure = error; }
      close();
      if (failure) throw contextual(failure);
      if (!nativeClosed || !nativeExit.observed || nativeExit.code !== 0 || nativeExit.signal !== null) {
        throw contextual(Error("Native lease release did not close successfully; outcome unknown"));
      }
      return { ...result, native_exit_observed: true, native_exit_code: 0, native_signal: null, native_close_observed: true };
    }
  };
}
module.exports = { acquire };
