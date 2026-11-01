"use strict";

// Retained because host upgrades can bypass migration, commit acknowledgement,
// and cross-window record isolation when replacing the persistence adapter.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { createStore } = require("./persisted-atoms.cjs");

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "azrael-persisted-atoms-test-"));
  const stores = new Set();
  t.after(async () => {
    // Close all SQLite handles before ordinary deletion, including on failure.
    await Promise.all([...stores].map(store => store.close()));
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), (await fs.realpath(os.tmpdir())).toLowerCase());
    assert.match(path.basename(resolved), /^azrael-persisted-atoms-test-/);
    await fs.rm(resolved, { recursive: true });
    await assert.rejects(fs.stat(resolved), { code: "ENOENT" });
  });
  return {
    directory,
    async open(options = {}) {
      const store = await createStore({ directory, legacyState: {}, clearLegacy: async () => {}, batchMs: 10, ...options });
      stores.add(store);
      return store;
    },
    async close(store) {
      await store.close();
      stores.delete(store);
    },
  };
}

const mergeRecord = (current, update) => ({ ...(current ?? {}), ...update.set });

test("migration commits every legacy atom before clearing and does not reseed after reset", async t => {
  const f = await fixture(t);
  const legacyState = { drafts: { thread: "unsent" }, history: ["thread"], "mcp-cache": { tools: ["large"] } };
  let clearCalls = 0;
  const store = await f.open({ legacyState, clearLegacy: async () => { clearCalls++; } });
  assert.equal(clearCalls, 1);
  assert.deepEqual(store.snapshot(), legacyState);
  await f.close(store);
  const reopened = await f.open({ legacyState: { drafts: "stale" }, clearLegacy: async () => { clearCalls++; } });
  assert.deepEqual(reopened.snapshot(), legacyState);
  await reopened.reset();
  await f.close(reopened);
  const afterReset = await f.open({ legacyState });
  assert.deepEqual(afterReset.snapshot(), {});
});

test("a legacy-clear failure preserves committed data for recovery", async t => {
  const f = await fixture(t);
  try {
    const store = await f.open({ legacyState: { draft: "recover me" }, clearLegacy: async () => { throw Error("legacy unavailable"); } });
    await f.close(store);
  } catch (error) {
    assert.match(error.message, /legacy unavailable/);
  }
  const recovered = await f.open({ legacyState: { draft: "stale" } });
  assert.equal(recovered.snapshot().draft, "recover me");
  // Reopening must never overwrite the committed migration, regardless of
  // whether retrying the legacy cleanup is supported.
});

test("identical JSON values are skipped and burst acknowledgements are durable", async t => {
  const f = await fixture(t);
  const diagnostics = [];
  const store = await f.open({ diagnostic: stats => diagnostics.push(stats) });
  const value = { text: "draft", nested: [1, true, null] };
  assert.deepEqual(await store.update("draft", value), { changed: true, value });
  assert.deepEqual(await store.update("draft", JSON.parse(JSON.stringify(value))), { changed: false, value });
  await f.close(store);
  assert.ok(diagnostics.at(-1).skipped >= 1);
  const burstDiagnostics = [];
  const writer = await f.open({ diagnostic: stats => burstDiagnostics.push(stats) });
  const updates = Array.from({ length: 20 }, (_, i) => writer.update(`atom-${i}`, { i }));
  const results = await Promise.all(updates);
  assert.ok(results.every(result => result.changed));
  const reader = await f.open();
  assert.equal(reader.snapshot().draft.text, "draft");
  for (let i = 0; i < updates.length; i++) assert.deepEqual(reader.snapshot()[`atom-${i}`], { i });
  await f.close(writer);
  assert.equal(burstDiagnostics.at(-1).transactions, 1, "one queued burst must commit in one transaction");
  for (const stats of [...diagnostics, ...burstDiagnostics]) {
    assert.equal(typeof stats, "object");
    assert.ok(Object.values(stats).every(value => typeof value === "number" && Number.isFinite(value)), "diagnostics must contain numeric statistics only");
  }
});

test("record updates preserve the legacy storage-key fallback", async t => {
  const f = await fixture(t);
  const store = await f.open({ legacyState: { legacyDrafts: { existing: "unsent" } } });
  const result = await store.update("drafts", undefined, { legacyStorageKey: "legacyDrafts", set: { added: "new" } }, mergeRecord);
  assert.deepEqual(result, { changed: true, value: { existing: "unsent", added: "new" } });
  assert.deepEqual(store.snapshot().drafts, result.value);
  await store.update("drafts", null);
  const afterNull = await store.update("drafts", undefined, { legacyStorageKey: "legacyDrafts", set: { fresh: "only" } }, mergeRecord);
  assert.deepEqual(afterNull.value, { existing: "unsent", fresh: "only" }, "native record updates also use the legacy fallback for null");
});

test("two windows merge records against committed data without replacing unrelated atoms", async t => {
  const f = await fixture(t);
  const first = await f.open();
  const second = await f.open();
  await first.update("mcp-cache", { tools: Array.from({ length: 1000 }, (_, i) => `tool-${i}`) });
  const calls = [];
  for (let i = 0; i < 20; i++) {
    calls.push((i % 2 ? first : second).update("drafts", undefined, { set: { [`thread-${i}`]: `draft-${i}` } }, mergeRecord));
  }
  await Promise.all(calls);
  const reader = await f.open();
  const snapshot = reader.snapshot();
  assert.equal(Object.keys(snapshot.drafts).length, 20);
  for (let i = 0; i < 20; i++) assert.equal(snapshot.drafts[`thread-${i}`], `draft-${i}`);
  assert.equal(snapshot["mcp-cache"].tools.length, 1000);
});

test("an independent process holding SQLite's write lock retries without losing either window's edits", { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const store = await f.open();
  const childSource = `
    const { createStore } = require(process.argv[1]);
    const { DatabaseSync } = require('node:sqlite');
    const path = require('node:path');
    (async () => {
      const directory = process.argv[2];
      const store = await createStore({ directory, batchMs: 10 });
      const lock = new DatabaseSync(path.join(directory, 'persisted-atoms.sqlite'));
      lock.exec('BEGIN IMMEDIATE');
      process.send('locked');
      await new Promise(resolve => setTimeout(resolve, 100));
      lock.exec('COMMIT');
      lock.close();
      await Promise.all(Array.from({ length: 20 }, (_, i) => store.update('drafts', undefined,
        { set: { ['child-' + i]: 'child draft ' + i } }, (current, update) => ({ ...current, ...update.set }))));
      await store.close();
      process.disconnect();
    })().catch(error => { console.error(error); process.exitCode = 1; if (process.connected) process.disconnect(); });
  `;
  const child = spawn(process.execPath, ["-e", childSource, require.resolve("./persisted-atoms.cjs"), f.directory], { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", data => { stderr += data; });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  try {
    await Promise.race([
      new Promise(resolve => child.once("message", message => { assert.equal(message, "locked"); resolve(); })),
      exited.then(result => { throw Error(`child exited before acquiring lock: ${JSON.stringify(result)} ${stderr}`); }),
    ]);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.update("drafts", undefined,
      { set: { [`parent-${i}`]: `parent draft ${i}` } }, mergeRecord)));
    assert.deepEqual(await exited, { code: 0, signal: null }, stderr);
    const drafts = store.snapshot().drafts;
    assert.equal(Object.keys(drafts).length, 40);
    for (let i = 0; i < 20; i++) {
      assert.equal(drafts[`parent-${i}`], `parent draft ${i}`);
      assert.equal(drafts[`child-${i}`], `child draft ${i}`);
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
});

test("reset is ordered with queued writes and close drains the queue", async t => {
  const f = await fixture(t);
  const store = await f.open();
  const before = store.update("before-reset", "remove");
  const reset = store.reset();
  const after = store.update("after-reset", "keep");
  await Promise.all([before, reset, after]);
  assert.deepEqual(store.snapshot(), { "after-reset": "keep" });
  const pending = store.update("on-close", "committed");
  await Promise.all([f.close(store), store.close()]);
  await pending;
  const reader = await f.open();
  assert.deepEqual(reader.snapshot(), { "after-reset": "keep", "on-close": "committed" });
});

test("a failed batch rolls back every write, rejects acknowledgements, and permits recovery", async t => {
  const f = await fixture(t);
  const store = await f.open({ batchMs: 20 });
  await store.update("stable", { original: true });
  const writes = [
    store.update("must-roll-back", "temporary"),
    store.update("stable", undefined, { set: { broken: true } }, () => { throw Error("controlled merge failure"); }),
  ];
  const results = await Promise.allSettled(writes);
  assert.ok(results.every(result => result.status === "rejected"), "all acknowledgements in a failed transaction must reject");
  assert.deepEqual(store.snapshot(), { stable: { original: true } });
  const reader = await f.open();
  assert.deepEqual(reader.snapshot(), { stable: { original: true } });
  assert.deepEqual(await store.update("recovered", true), { changed: true, value: true });
});
