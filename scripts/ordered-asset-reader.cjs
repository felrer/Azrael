"use strict";
const fs = require("node:fs");

// Keep only a bounded window of reads, while consuming the original file order.
// Each promise resolves to an outcome so failures in later slots cannot escape.
async function readAssetsInOrder(filenames, consume, { concurrency = 4, statistics = {}, readMetrics } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("Asset read concurrency must be an integer from 1 to 8.");
  }
  const iterator = filenames[Symbol.iterator]();
  const pending = [];
  let active = 0;
  let exhausted = false;
  statistics.readConcurrencyHighWater = 0;
  statistics.queuedReadHighWater = 0;
  statistics.readWaitMs = 0;
  function schedule(filename) {
    const started = performance.now();
    active += 1;
    statistics.readConcurrencyHighWater = Math.max(statistics.readConcurrencyHighWater, active);
    let read;
    try { read = fs.promises.readFile(filename); } catch (error) { read = Promise.reject(error); }
    return read.then(bytes => ({ filename, bytes }), error => ({ filename, error })).then(outcome => {
      active -= 1;
      if (readMetrics) {
        readMetrics.elapsedMs += performance.now() - started;
        readMetrics.count += 1;
        if (outcome.bytes) readMetrics.bytes += outcome.bytes.length;
      }
      return outcome;
    });
  }
  function fill() {
    while (!exhausted && pending.length < concurrency) {
      const next = iterator.next();
      if (next.done) { exhausted = true; break; }
      pending.push(schedule(next.value));
      statistics.queuedReadHighWater = Math.max(statistics.queuedReadHighWater, pending.length);
    }
  }
  try {
    fill();
    while (pending.length) {
      const waitStarted = performance.now();
      const outcome = await pending.shift();
      const readWaitMs = performance.now() - waitStarted;
      statistics.readWaitMs += readWaitMs;
      if (outcome.error) throw outcome.error;
      // Launch the replacement before CPU-bound transformation of this buffer.
      fill();
      await consume(outcome.filename, outcome.bytes, readWaitMs);
    }
  } finally {
    await Promise.all(pending);
    if (typeof iterator.return === "function") iterator.return();
  }
}

module.exports = { readAssetsInOrder };
