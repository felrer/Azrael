"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { test } = require("node:test");
const state = require("./preparation-state.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-preparation-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("azrael-preparation-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const config = Object.fromEntries(["release", "source", "stateRoot", "sourceCodexHome", "toolDirectory"].map(name => [name, path.join(root, name)]));
  config.skipSnapshot = true;
  for (const directory of Object.values(config).filter(value => typeof value === "string")) fs.mkdirSync(directory);
  const write = (file, contents) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  };
  write(path.join(config.source, "nested", "host.js"), "original");
  write(path.join(config.release, "engine.exe"), "engine");
  const build = { sha256: { "engine.exe": crypto.createHash("sha256").update("engine").digest("hex") } };
  write(path.join(config.release, "build-info.json"), JSON.stringify(build));
  for (const name of ["typescript/lib/typescript.js", "@vscode/vsce/out/package.js", "@vscode/vsce/out/secretLint.js"]) {
    write(path.join(config.toolDirectory, "companion/node_modules", name), "fixture tool");
  }
  const output = path.join(root, "output");
  fs.mkdirSync(output);
  return { root, config, output, write };
}

test("unchanged preparation resumes and absent stages are explicit", async t => {
  const { config, output } = fixture(t);
  const initial = await state.initialize(output, config, false);
  assert.deepEqual(await state.initialize(output, config, true), initial);
  assert.deepEqual(await state.load(output, "namespace"), { found: false });
  assert.deepEqual(await state.load(output, "complete"), { found: false });
});

test("resume refuses changed source content even at the same size and timestamp", async t => {
  const { config, output } = fixture(t);
  await state.initialize(output, config, false);
  const file = path.join(config.source, "nested", "host.js");
  const stat = fs.statSync(file);
  fs.writeFileSync(file, "modified");
  fs.utimesSync(file, stat.atime, stat.mtime);
  await assert.rejects(state.initialize(output, config, true), /Preparation inputs changed/);
});

test("resume refuses configuration, build receipt, bundle and tool changes", async t => {
  const { config, output } = fixture(t);
  await state.initialize(output, config, false);
  await assert.rejects(state.initialize(output, { ...config, skipSnapshot: false }, true), /Preparation inputs changed/);
  const buildFile = path.join(config.release, "build-info.json");
  const originalBuild = fs.readFileSync(buildFile);
  fs.appendFileSync(buildFile, "\n");
  await assert.rejects(state.initialize(output, config, true), /Preparation inputs changed/);
  fs.writeFileSync(buildFile, originalBuild);
  fs.writeFileSync(path.join(config.release, "engine.exe"), "broken");
  await assert.rejects(state.initialize(output, config, true), /Release hash mismatch/);
  fs.writeFileSync(path.join(config.release, "engine.exe"), "engine");
  fs.writeFileSync(path.join(config.toolDirectory, "companion/node_modules/@vscode/vsce/out/package.js"), "changed tool");
  await assert.rejects(state.initialize(output, config, true), /Preparation inputs changed/);
});

test("resume refuses a changed transform rule fingerprint", async t => {
  const { config, output } = fixture(t);
  await state.initialize(output, config, false);
  const transformer = require("./namespace-azrael-host.cjs");
  const original = transformer.getTransformRules;
  // Change the dependency's returned fingerprint without editing shared source files.
  transformer.getTransformRules = () => ({ ...original(), "namespace-azrael-host.cjs": "changed" });
  try {
    await assert.rejects(state.initialize(output, config, true), /Preparation inputs changed/);
  } finally { transformer.getTransformRules = original; }
});

test("namespace checkpoint reloads data and refuses damaged host contents", async t => {
  const { config, output, root, write } = fixture(t);
  await state.initialize(output, config, false);
  const host = path.join(root, "host");
  const file = path.join(host, "extension.js");
  write(file, "original");
  const data = { prepared: { OfficialExtension: host }, hostVersion: "0.5.123" };
  await state.save(output, "namespace", data);
  assert.deepEqual(await state.load(output, "namespace"), { found: true, data });
  const stat = fs.statSync(file);
  fs.writeFileSync(file, "modified");
  fs.utimesSync(file, stat.atime, stat.mtime);
  await assert.rejects(state.load(output, "namespace"), /Completed namespace stage changed/);
  fs.writeFileSync(file, "original");
  fs.unlinkSync(file);
  await assert.rejects(state.load(output, "namespace"), /Completed namespace stage changed/);
});

test("complete checkpoint reloads data and refuses archive or receipt corruption", async t => {
  const { config, output, write } = fixture(t);
  await state.initialize(output, config, false);
  const archive = path.join(output, "host.vsix");
  const receipt = path.join(output, "independent-prepared.json");
  write(archive, "archive");
  write(receipt, JSON.stringify({ HostVsix: archive }));
  const data = { HostVsix: archive };
  await state.save(output, "complete", data);
  assert.deepEqual(await state.load(output, "complete"), { found: true, data });
  fs.writeFileSync(archive, "damaged");
  await assert.rejects(state.load(output, "complete"), /Completed package changed/);
  fs.writeFileSync(archive, "archive");
  fs.writeFileSync(receipt, "{corrupt");
  await assert.rejects(state.load(output, "complete"), /Completed package changed/);
  fs.writeFileSync(path.join(output, "preparation-state.json"), "{corrupt");
  await assert.rejects(state.load(output, "complete"), SyntaxError);
});
