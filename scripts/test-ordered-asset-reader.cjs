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
    {
      const concurrency = 4;
      const names = Array.from({ length: 19 }, (_, i) => i);
      const finished = [], consumed = [];
      let active = 0;
      fs.promises.readFile = async name => {
        active++;
        await delay(name % 3 === 0 ? 9 : 1);
        active--;
        finished.push(name);
        return Buffer.from(String(name));
      };
      await readAssetsInOrder(names, async (name, bytes) => {
        assert.equal(bytes.toString(), String(name));
        consumed.push(name);
        await delay(1);
      }, { concurrency });
      assert.deepEqual(consumed, names);
      assert.equal(active, 0);
      assert.notDeepEqual(finished, names, "fixture actually completes out of order");
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
    console.log("PASS ordered reads: out-of-order completion consumed in input order; drained read/consumer/enumeration failures without unhandled rejections");
  } finally {
    fs.promises.readFile = original;
    process.removeListener("unhandledRejection", onUnhandled);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
