"use strict";
// Admission only: never suspend, terminate or reserve memory for running work.
const os = require("node:os");
const { setTimeout: delay } = require("node:timers/promises");
const MINIMUM_FREE_BYTES = 4 * 1024 ** 3;
const POLL_MS = 2000;
const sleepSlot = new Int32Array(new SharedArrayBuffer(4));

function sample(readMemory) {
  const freeBytes = readMemory();
  if (!Number.isSafeInteger(freeBytes) || freeBytes < 0) throw Error("Cannot read available physical memory; task was not started");
  return freeBytes;
}
function reporter(label, log) {
  let waiting = false;
  return freeBytes => {
    if (freeBytes < MINIMUM_FREE_BYTES) {
      if (!waiting) log(`[memory admission] Waiting to start ${label}: ${(freeBytes / 1024 ** 3).toFixed(2)} GiB available; 4 GiB required. Running work is unchanged.\n`);
      waiting = true;
      return false;
    }
    if (waiting) log(`[memory admission] Starting ${label}: ${(freeBytes / 1024 ** 3).toFixed(2)} GiB available.\n`);
    return true;
  };
}
function waitForBuildMemorySync({ label = "build task", readMemory = () => os.freemem(), sleep = ms => Atomics.wait(sleepSlot, 0, 0, ms), log = text => process.stderr.write(text) } = {}) {
  const ready = reporter(label, log);
  while (!ready(sample(readMemory))) sleep(POLL_MS);
}
async function waitForBuildMemory({ label = "build task", signal, readMemory = () => os.freemem(), sleep = ms => delay(ms, undefined, { signal }), log = text => process.stderr.write(text) } = {}) {
  const ready = reporter(label, log);
  for (;;) {
    signal?.throwIfAborted();
    if (ready(sample(readMemory))) return;
    await sleep(POLL_MS);
  }
}
if (require.main === module) {
  if (process.argv.length > 3) { console.error("Usage: node build-resource-admission.cjs [task label]"); process.exitCode = 1; }
  else try { waitForBuildMemorySync({ label: process.argv[2] || "build task" }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { MINIMUM_FREE_BYTES, POLL_MS, waitForBuildMemory, waitForBuildMemorySync };
