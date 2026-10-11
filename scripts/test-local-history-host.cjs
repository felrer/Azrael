"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sync } = require("./local-history-host.cjs");

test("history parent retries a killed importer and completes", async () => {
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
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
