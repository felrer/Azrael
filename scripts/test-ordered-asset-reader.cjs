"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readAssetsInOrder } = require("./ordered-asset-reader.cjs");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const original = fs.promises.readFile;
  const unhandled = [];
  const onUnhandled = error => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    for (const concurrency of [1, 4, 8]) {
      const names = Array.from({ length: 19 }, (_, i) => i);
      const started = [], finished = [], consumed = [];
      let active = 0, highWater = 0;
      fs.promises.readFile = async name => {
        started.push(name);
        highWater = Math.max(highWater, ++active);
        await delay(name % 3 === 0 ? 9 : 1);
        active--;
        finished.push(name);
        return Buffer.from(String(name));
      };
      const statistics = {}, readMetrics = { elapsedMs: 0, count: 0, bytes: 0 };
      await readAssetsInOrder(names, async (name, bytes) => {
        assert.equal(bytes.toString(), String(name));
        assert(started.includes(Math.min(name + concurrency, names.length - 1)), "replacement starts before consumer");
        consumed.push(name);
        await delay(1);
      }, { concurrency, statistics, readMetrics });
      assert.deepEqual(consumed, names);
      assert.deepEqual(started, names);
      assert.equal(active, 0);
      assert.equal(highWater, concurrency);
      assert.equal(statistics.readConcurrencyHighWater, concurrency);
      assert.equal(statistics.queuedReadHighWater, concurrency);
      assert.equal(readMetrics.count, names.length);
      assert.equal(readMetrics.bytes, Buffer.byteLength(names.join("")));
      if (concurrency > 1) assert.notDeepEqual(finished, names, "fixture actually completes out of order");
    }
    for (const failure of ["read", "consumer", "enumeration"]) {
      const expected = new Error(failure);
      let active = 0, scheduled = 0, completed = 0, closed = false;
      fs.promises.readFile = async name => {
        active++; scheduled++;
        try { await delay(name === 0 ? 1 : 8); if (name === 2 || (failure === "read" && name === 0)) throw (name === 0 ? expected : new Error("later read")); return Buffer.from(String(name)); }
        finally { active--; completed++; }
      };
      const iterable = {
        *[Symbol.iterator]() {
          try { for (let i = 0; i < 10; i++) { if (failure === "enumeration" && i === 3) throw expected; yield i; } }
          finally { closed = true; }
        },
      };
      await assert.rejects(readAssetsInOrder(iterable, () => { if (failure === "consumer") throw expected; }, { concurrency: 4 }), error => error === expected);
      assert.equal(active, 0, "scheduled reads drain before rejection");
      assert.equal(completed, scheduled);
      assert(closed);
      await delay(10);
      assert.deepEqual(unhandled, []);
    }
    let calls = 0;
    fs.promises.readFile = async () => { calls++; return Buffer.alloc(0); };
    for (const concurrency of [0, 9, 1.5, NaN, "4", null]) await assert.rejects(readAssetsInOrder([], () => {}, { concurrency }), /integer from 1 to 8/);
    const statistics = {};
    await readAssetsInOrder([], () => { throw new Error("empty consumer"); }, { statistics });
    assert.equal(calls, 0);
    assert.equal(statistics.queuedReadHighWater, 0);
    assert.equal(statistics.readConcurrencyHighWater, 0);
    console.log("PASS ordered reads: staggered completion, order, bounds 1/4/8, replacement before consumer, drained read/consumer/enumeration errors, no unhandled rejections, invalid options, empty input");
  } finally {
    fs.promises.readFile = original;
    process.removeListener("unhandledRejection", onUnhandled);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
