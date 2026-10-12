"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { sync: importHistory } = require("./local-history-host.cjs");
const sync = (runtime, output, options = {}) => importHistory(runtime, output, { appVersion: "2026.0.6", ...options });

test("history parent retries a killed importer and completes", { skip: process.platform !== "linux" }, async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-history-parent-"));
  let children = 0;
  try {
    const result = await sync({ codexHome: path.join(fixture, "target"), localHistory: { sourceHome: path.join(fixture, "missing-source") } },
      undefined, { maxAttempts: 3, cooldownMs: 10, onChild(child) { if (++children === 1) child.kill("SIGKILL"); } });
    assert.equal(children, 2);
    assert.equal(result.sourceMissing, true);
    const status = JSON.parse(fs.readFileSync(path.join(fixture, "target/local-history-supervisor.json")));
    assert.equal(status.state, "complete");
    assert.equal(status.attempt, 2);
  } finally { fs.rmSync(fixture, { recursive: true }); }
});

function importerSequence(exits) {
  let children = 0;
  return { get attempts() { return children; }, spawnChild() {
    const child = new EventEmitter();
    child.pid = ++children;
    child.stdout = new EventEmitter();
    child.stderr = { resume() {} };
    queueMicrotask(() => {
      const code = exits[Math.min(children - 1, exits.length - 1)];
      if (code === 0) child.stdout.emit("data", Buffer.from('{"imported":1}\n'));
      child.emit("exit", code);
    });
    return child;
  } };
}

test("permanent import failure stops after the default retry limit", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-history-failure-"));
  const importer = importerSequence([1]);
  try {
    await assert.rejects(sync({ codexHome: fixture, localHistory: { sourceHome: "/fixture/source" } },
      undefined, { spawnChild: importer.spawnChild, cooldownMs: 1 }), /Local history import failed/);
    assert.equal(importer.attempts, 3);
    const status = JSON.parse(fs.readFileSync(path.join(fixture, "local-history-supervisor.json")));
    assert.equal(status.state, "failed");
    assert.equal(status.attempt, 3);
  } finally { fs.rmSync(fixture, { recursive: true }); }
});

test("transient import failure still retries and returns the successful result", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-history-retry-"));
  const importer = importerSequence([1, 0]);
  try {
    const result = await sync({ codexHome: fixture, localHistory: { sourceHome: "/fixture/source" } },
      undefined, { spawnChild: importer.spawnChild, cooldownMs: 1 });
    assert.equal(importer.attempts, 2);
    assert.equal(result.imported, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, "local-history-supervisor.json"))).state, "complete");
  } finally { fs.rmSync(fixture, { recursive: true }); }
});

test("unbounded and invalid retry limits are rejected before spawning", async () => {
  for (const maxAttempts of [0, -1, 1.5, Infinity]) {
    await assert.rejects(sync({ localHistory: { sourceHome: "/fixture/source" } }, undefined,
      { maxAttempts, spawnChild() { throw new Error("must not spawn"); } }), /Invalid history import retry limit/);
  }
});

test("first activation imports once per app version across reloads and concurrent windows", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-history-version-"));
  const importer = importerSequence([0]);
  const runtime = { codexHome: fixture, localHistory: { sourceHome: "/fixture/source" } };
  try {
    const options = { spawnChild: importer.spawnChild };
    const results = await Promise.all([sync(runtime, undefined, options), sync(runtime, undefined, options)]);
    assert.equal(importer.attempts, 1);
    assert.equal(results.filter(result => result.skipped).length, 1);
    assert.equal((await sync(runtime, undefined, options)).skipped, true);
    assert.equal(importer.attempts, 1);
    await sync(runtime, undefined, { ...options, appVersion: "2026.0.7" });
    assert.equal(importer.attempts, 2);
    assert.equal((await sync(runtime, undefined, { ...options, appVersion: "2026.0.7" })).skipped, true);
  } finally { fs.rmSync(fixture, { recursive: true }); }
});

test("failed import does not restart its retry budget on reload at the same version", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-history-version-failure-"));
  const importer = importerSequence([1]);
  const runtime = { codexHome: fixture, localHistory: { sourceHome: "/fixture/source" } };
  try {
    const options = { spawnChild: importer.spawnChild, cooldownMs: 1 };
    await assert.rejects(sync(runtime, undefined, options), /Local history import failed/);
    assert.equal(importer.attempts, 3);
    assert.equal((await sync(runtime, undefined, options)).skipped, true);
    assert.equal(importer.attempts, 3);
    await assert.rejects(sync(runtime, undefined, { ...options, appVersion: "2026.0.7" }), /Local history import failed/);
    assert.equal(importer.attempts, 6);
  } finally { fs.rmSync(fixture, { recursive: true }); }
});
