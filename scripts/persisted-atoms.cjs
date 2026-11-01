"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { DatabaseSync } = require("node:sqlite");
const stores = new WeakMap();
const STATE_KEY = "persisted-atom-state";

// SQLite owns cross-process admission and crash recovery. Never wait for its
// lock synchronously on the extension-host event loop.
async function retryBusy(action) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try { return action(); } catch (error) {
      if (![5, 6].includes(error.errcode) || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  }
}

async function createStore({ directory, legacyState, clearLegacy, diagnostic = () => {}, batchMs = 10 }) {
  await fs.mkdir(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, "persisted-atoms.sqlite"));
  const stats = { transactions: 0, updates: 0, skipped: 0, bytesWritten: 0, failedBatches: 0, elapsedMs: 0 };
  let lastDiagnostic = Date.now(), timer, running, closePromise, closed = false, closing = false;
  let queue = [];
  function report(force = false) {
    if (!force && Date.now() - lastDiagnostic < 60000) return;
    lastDiagnostic = Date.now();
    try { diagnostic({ ...stats }); } catch { /* Diagnostics cannot fail a save. */ }
  }
  function transaction(action) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* Keep the original failure. */ }
      throw error;
    }
  }
  try {
    db.exec("PRAGMA busy_timeout=0");
    await retryBusy(() => db.exec("PRAGMA journal_mode=WAL"));
    db.exec("PRAGMA synchronous=FULL");
    await retryBusy(() => transaction(() => {
      db.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS atoms(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
      const version = db.prepare("SELECT value FROM meta WHERE key='schema'").get()?.value;
      if (version !== undefined && version !== "1") throw new Error("Unsupported Azrael atom storage schema");
      if (version === undefined) {
        const insert = db.prepare("INSERT INTO atoms(key,value) VALUES(?,?)");
        for (const [key, value] of Object.entries(legacyState ?? {})) {
          const json = JSON.stringify(value);
          if (json !== undefined) insert.run(key, json);
        }
        db.prepare("INSERT INTO meta(key,value) VALUES('schema','1')").run();
      }
    }));
    // A failed cleanup leaves both the committed database and legacy source
    // intact. Next activation retries cleanup without reseeding the database.
    if (legacyState !== undefined) await clearLegacy();
  } catch (error) { db.close(); throw error; }

  const select = db.prepare("SELECT value FROM atoms WHERE key=?");
  const put = db.prepare("INSERT INTO atoms(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const remove = db.prepare("DELETE FROM atoms WHERE key=?");
  const read = key => {
    const row = select.get(key);
    return row === undefined ? undefined : JSON.parse(row.value);
  };
  function snapshot() {
    if (closed) throw new Error("Azrael atom storage is closed");
    return Object.fromEntries(db.prepare("SELECT key,value FROM atoms").all().map(row => [row.key, JSON.parse(row.value)]));
  }
  async function drain() {
    if (running) return running;
    const batch = queue.splice(0);
    if (!batch.length) return;
    const started = performance.now();
    running = (async () => {
      try {
        const { results, skipped, bytes } = await retryBusy(() => transaction(() => {
          let skipped = 0, bytes = 0;
          const results = batch.map(op => {
            if (op.replace) {
              db.exec("DELETE FROM atoms");
              for (const [key, value] of Object.entries(op.value ?? {})) {
                const json = JSON.stringify(value);
                if (json !== undefined) { put.run(key, json); bytes += Buffer.byteLength(json); }
              }
              return;
            }
            const current = read(op.key);
            const value = op.recordUpdate == null ? op.value : op.mergeRecord(
              current ?? (op.recordUpdate.legacyStorageKey == null ? undefined : read(op.recordUpdate.legacyStorageKey)), op.recordUpdate);
            if (isDeepStrictEqual(current, value)) { skipped++; return { changed: false, value: current }; }
            if (value === undefined) remove.run(op.key);
            else {
              const json = JSON.stringify(value);
              if (json === undefined) throw new Error("Azrael atom value must be JSON serializable");
              put.run(op.key, json);
              bytes += Buffer.byteLength(json);
            }
            return { changed: true, value };
          });
          return { results, skipped, bytes };
        }));
        stats.transactions++; stats.updates += batch.length; stats.skipped += skipped; stats.bytesWritten += bytes;
        batch.forEach((op, i) => op.resolve(results[i]));
      } catch (error) {
        stats.failedBatches++;
        batch.forEach(op => op.reject(error));
      } finally {
        stats.elapsedMs += performance.now() - started;
        running = undefined;
        report();
        if (queue.length) schedule();
      }
    })();
    // Even a synchronous transaction must complete before clearing running.
    return running;
  }
  function schedule() {
    if (!closing && !timer && !running) timer = setTimeout(() => { timer = undefined; void drain(); }, batchMs);
  }
  function enqueue(op) {
    if (closing || closed) return Promise.reject(new Error("Azrael atom storage is closed"));
    const result = new Promise((resolve, reject) => queue.push({ ...op, resolve, reject }));
    schedule();
    return result;
  }
  async function flush() {
    clearTimeout(timer); timer = undefined;
    while (running || queue.length) { if (running) await running; else await drain(); }
  }
  return {
    snapshot,
    flush,
    update: (key, value, recordUpdate, mergeRecord) => enqueue({ key, value, recordUpdate, mergeRecord }),
    replace: value => enqueue({ replace: true, value }),
    reset: () => enqueue({ replace: true, value: {} }),
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await flush();
        report(true);
        db.close(); closed = true;
      })();
      return closePromise;
    },
  };
}

async function initialize(context, diagnostic) {
  const store = await createStore({
    directory: path.join(context.globalStorageUri.fsPath, "atoms-v1"),
    legacyState: context.globalState.get(STATE_KEY),
    clearLegacy: () => context.globalState.update(STATE_KEY, undefined), diagnostic,
  });
  stores.set(context.globalState, store);
  return store;
}
function getStore(memento) {
  const store = stores.get(memento);
  if (!store) throw new Error("Azrael atom storage was not initialized");
  return store;
}
module.exports = { createStore, initialize, getStore };
