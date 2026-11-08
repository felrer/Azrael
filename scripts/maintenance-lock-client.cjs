"use strict";
// Private stdio adapter: physical removal remains in PowerShell, ownership in the shared owner.
const path = require("node:path");
const lifecycle = require("./artifact-lifecycle.cjs");
const { acquire } = require("./maintenance-lock-owner.cjs");
const { assertEnabled } = require("./maintenance-preferences.cjs");

function main(root, { claimBeforeCatalog = false } = {}) {
  if (!root || !path.isAbsolute(root)) throw Error("Absolute project root required");
  root = path.resolve(root);
  assertEnabled("deletion");
  // Artifact producers take claim -> catalog. Inspection must use the same
  // order and retain the claim until the catalog observation has finished.
  let claim, lease;
  try {
    if (claimBeforeCatalog) claim = acquire(path.join(root, "artifacts/maintenance/lifecycles/.run-claim.lock"), { operation: "artifact-run.inspect", waitMs: 0 });
    lease = acquire(path.join(root, "artifacts/maintenance/lifecycles/catalog.lock"), { operation: "lifecycle.cleanup", ...(claimBeforeCatalog ? { waitMs: 0 } : { queue: true }) });
  } catch (error) {
    if (claim) {
      try { claim.release(); } catch (releaseError) { throw new AggregateError([error, releaseError], `${error.message}; claim release: ${releaseError.message}`); }
    }
    throw error;
  }
  let reservations = [], released = false, reserved = false, finished = false, sequence = 0;
  let buffered = "";
  const maxFrameBytes = 64 * 1024 * 1024;
  const send = packet => {
    const frame = JSON.stringify(packet) + "\n";
    if (Buffer.byteLength(frame) > maxFrameBytes) throw Error("Maintenance lock client output exceeds frame bound");
    process.stdout.write(frame);
  };
  const release = () => {
    released = true;
    let result, claimResult;
    const failures = [];
    try { result = lease.release(); } catch (error) { failures.push(error); }
    if (claim) {
      try { claimResult = claim.release(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join("; "));
    return { ...result, ...(claim ? { claim: claimResult } : {}) };
  };
  const close = () => {
    if (!released) {
      try { release(); } catch (error) { process.stderr.write(error.message + "\n"); }
      process.exitCode = 1; // EOF is not confirmation that physical work finished.
    }
  };
  send({ ok: true, ready: true, ...(claim ? { claimBeforeCatalog: true } : {}) });
  function dispatch(line) {
    let request;
    try {
      request = JSON.parse(line);
      if (!request || !Number.isSafeInteger(request.id) || request.id !== sequence + 1) throw Error("Sequential bounded request ID required");
      sequence = request.id;
      let result;
      switch (request.operation) {
        case "plan":
          result = lifecycle.planCleanup(root, { paths: request.paths, protectedPaths: request.protectedPaths, reportPath: request.reportPath, reservations });
          break;
        case "reserve": {
          assertEnabled("deletion");
          if (reserved) throw Error("Cleanup already reserved");
          if (!Array.isArray(request.ids) || !request.ids.length || new Set(request.ids).size !== request.ids.length) throw Error("Unique cleanup IDs required");
          const records = lifecycle.catalog(root);
          const selected = request.ids.map(id => {
            const record = records.find(record => record.id === id);
            if (!record) throw Error("Unknown cleanup producer");
            if (record.record_type === "observation") throw Error("Observation records have no cleanup authority");
            if (!Number.isSafeInteger(record.revision) || record.revision < 1) throw Error("Current cleanup producer revision required");
            // catalog() normalizes optional reference identities for readers.
            // Let the native owner load and pin the unmodified ledger snapshot.
            return { id: record.id, revision: record.revision };
          });
          const reservationResult = lease.reserveProducers(selected);
          if (!Array.isArray(reservationResult.observed)) throw Error("Native producer reservation observers missing");
          reservations = reservationResult.observed;
          reserved = true;
          result = { reserved: true };
          break;
        }
        case "releaseCatalog":
          if (!reserved) throw Error("Cleanup reservation required");
          result = lease.releaseCatalog();
          break;
        case "finish":
          if (!reserved || finished) throw Error("Unfinished cleanup reservation required");
          result = lease.finishProducers(request.outcomes, request.evidenceRef, request.evidenceSha);
          finished = true;
          break;
        case "release":
          try { result = release(); }
          catch (error) { process.exitCode = 1; throw error; }
          finally { process.stdin.destroy(); }
          send({ id: request.id, ok: true, result });
          return;
        default: throw Error("Unsupported maintenance lock client operation");
      }
      send({ id: request.id, ok: true, result: result ?? null });
    } catch (error) {
      send({ id: request?.id ?? null, operation: request?.operation ?? "protocol", ok: false, error: error.message });
    }
  }
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline < 0) break;
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (Buffer.byteLength(line) + 1 > maxFrameBytes) { close(); process.stdin.destroy(); return; }
      dispatch(line);
      if (released) return;
    }
    if (Buffer.byteLength(buffered) + 1 > maxFrameBytes) { close(); process.stdin.destroy(); }
  });
  process.stdin.on("end", close);
  process.stdin.on("error", close);
}
if (require.main === module) {
  try {
    if (process.argv.length > 4 || (process.argv[3] !== undefined && process.argv[3] !== "--claim-before-catalog")) throw Error("Unknown private maintenance client option");
    main(process.argv[2], { claimBeforeCatalog: process.argv[3] === "--claim-before-catalog" });
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + "\n");
    process.exitCode = 1;
  }
}
module.exports = { main };
