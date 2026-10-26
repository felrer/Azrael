"use strict";
// Create-new sentinels are shared with native maintenance. Existence always means busy.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");

function checked(filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename) || filename.includes("\0") || filename.split(/[\\/]/).includes("..")) throw Error("Absolute lock path without traversal required");
  filename = path.resolve(filename);
  let current = path.parse(filename).root;
  for (const part of filename.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (current === filename ? !stat.isFile() : !stat.isDirectory())) throw Error("Lock path requires plain file and directory ancestors");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return filename;
}
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
function ownerSummary(filename) {
  try {
    checked(filename);
    const descriptor = fs.openSync(filename, "r");
    try {
      if (fs.fstatSync(descriptor).size > 4096) return null;
      const buffer = Buffer.alloc(4097);
      const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
      if (length > 4096) return null;
      const data = JSON.parse(buffer.subarray(0, length).toString("utf8"));
      if (data.schema !== 1) return null;
      // Only bounded, typed fields may enter diagnostics; never expose arbitrary file text.
      return Object.fromEntries(Object.entries(data).filter(([key, value]) =>
        (["pid", "parent_pid", "acquired_at_ms"].includes(key) && Number.isSafeInteger(value) && value >= 0) ||
        (key === "token" && typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value)) ||
        (key === "process_started_at" && typeof value === "string" && value.length === 24 && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value)) ||
        (key === "operation" && typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value))));
    } finally { fs.closeSync(descriptor); }
  } catch { return null; }
}
function refuse(filename, message) {
  return Object.assign(Error(`${message}: ${filename}; explicit recovery required`), { code: "ELOCKOWNERSHIP", path: filename, recovery_required: true });
}
function verify(filename, identity, bytes) {
  checked(filename);
  const stat = fs.lstatSync(filename, { bigint: true });
  if (!same(identity, stat) || !fs.readFileSync(filename).equals(bytes)) throw refuse(filename, "Lock owner changed; release refused");
}
function acquire(filename, { operation, waitMs = 0 } = {}) {
  filename = checked(filename);
  if (typeof operation !== "string" || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(operation)) throw Error("Bounded lock operation required");
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 5000) throw Error("Lock wait must be between 0 and 5000ms");
  const deadline = performance.now() + waitMs;
  let descriptor;
  try {
    for (;;) {
      try { descriptor = fs.openSync(filename, "wx"); break; }
      catch (error) {
        const remaining = deadline - performance.now();
        if (error.code !== "EEXIST" || remaining <= 0) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(25, remaining));
        checked(filename);
      }
    }
  }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw Object.assign(Error(`EEXIST: maintenance lock busy: ${filename}; explicit recovery required`), {
      code: "EEXIST", path: filename, recovery_required: true, owner: ownerSummary(filename), cause: error,
    });
  }
  let identity;
  const owner = { schema: 1, pid: process.pid, token: randomUUID(), acquired_at_ms: Date.now(), operation,
    process_started_at: new Date(performance.timeOrigin).toISOString(), parent_pid: process.ppid };
  const bytes = Buffer.from(JSON.stringify(owner) + "\n");
  try {
    identity = fs.fstatSync(descriptor, { bigint: true });
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    verify(filename, identity, bytes);
  } catch (error) {
    const failures = [error];
    // A partial initialization can clean only the exact inode and bytes still held by us.
    let observed;
    try { observed = fs.readFileSync(filename); if (!identity || !same(identity, fs.lstatSync(filename, { bigint: true })) || !bytes.subarray(0, observed.length).equals(observed)) observed = undefined; }
    catch (cleanupError) { failures.push(cleanupError); }
    try { fs.closeSync(descriptor); } catch (closeError) { failures.push(closeError); observed = undefined; }
    if (observed) try { verify(filename, identity, observed); fs.unlinkSync(filename); } catch (cleanupError) { failures.push(cleanupError); }
    throw failures.length === 1 ? error : new AggregateError(failures, "Lock initialization and cleanup failed");
  }
  let released = false;
  return { owner, release() {
    if (released) throw refuse(filename, "Lock already released");
    let verificationError;
    try { verify(filename, identity, bytes); } catch (error) { verificationError = error; }
    // Always close our descriptor, including when a replaced marker prevents removal.
    released = true; // A failed close has unknown descriptor state and cannot safely be retried.
    try { fs.closeSync(descriptor); } catch (error) { throw verificationError ? new AggregateError([verificationError, error], "Lock release failed") : error; }
    if (verificationError) throw verificationError;
    verify(filename, identity, bytes);
    fs.unlinkSync(filename);
  } };
}
module.exports = { acquire };
