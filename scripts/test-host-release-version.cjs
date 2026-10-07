"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const transformer = require("./namespace-azrael-host.cjs");
const state = require("./preparation-state.cjs");

test("numeric release and legacy generated host versions pass the transform boundary", async () => {
  const missing = path.join(os.tmpdir(), "azrael-version-absent-" + require("node:crypto").randomUUID());
  for (const version of ["2026.0.0", "0.5.1791324000000", "0.0.0", "9007199254740991.0.0"]) {
    const original = JSON.parse(fs.readFileSync(path.join(__dirname, "../artifacts/upstream-ui/26.930.61225/package.json"), "utf8"));
    assert.equal(transformer.transformManifest(original, version).version, version);
    // A missing source must be reached only after accepting the version.
    await assert.rejects(transformer.transformExtension(missing, {}, version), error => error.code === "ENOENT");
  }
});

test("host transform rejects leading zeros, unsafe integers and nonnumeric versions before source access", async () => {
  for (const version of ["02026.0.0", "2026.00.0", "2026.0.00", "9007199254740992.0.0", "0.9007199254740992.0", "0.0.9007199254740992", "2026.0", "2026.0.0-rc1", "2026.0.0+build", "-1.0.0", " 2026.0.0"]) {
    await assert.rejects(transformer.transformExtension("missing", {}, version), /numeric major.minor.patch/);
  }
});

test("preparation checkpoint binds explicit host version and invalidates changes", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-version-checkpoint-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("azrael-version-checkpoint-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const config = { hostVersion: "2026.0.0", release: path.join(root, "release"), source: path.join(root, "source"), toolDirectory: path.join(root, "tools") };
  const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
  write(path.join(config.release, "build-info.json"), JSON.stringify({ sha256: {} }));
  fs.mkdirSync(config.source);
  for (const file of ["typescript/lib/typescript.js", "@vscode/vsce/out/package.js", "@vscode/vsce/out/secretLint.js"]) write(path.join(config.toolDirectory, "companion/node_modules", file), "fixture");
  const output = path.join(root, "output"); fs.mkdirSync(output);
  const first = await state.initialize(output, config, false);
  assert.deepEqual(await state.initialize(output, config, true), first);
  for (const hostVersion of ["2026.0.1", "0.5.1791324000000", ""]) await assert.rejects(state.initialize(output, { ...config, hostVersion }, true), /Preparation inputs changed/);
});
