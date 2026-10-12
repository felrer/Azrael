"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { sync } = require("./local-history-host.cjs");

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
