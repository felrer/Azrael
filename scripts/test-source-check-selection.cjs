"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const selection = require("./source-check-selection.cjs");
const lifecycleChecks = require("./check-artifact-lifecycle.cjs");

test('product deployment separates module regression while retaining core/prompt integration and explicit module scope', () => {
  const feature = require('./azrael-feature-contracts.json').features.find(feature => feature.id === 'tool.project-maintenance');
  const config = { projectRoot: path.join(__dirname, '..'), sourceCheckPaths: ['scripts/azrael-feature-contracts.json'] };
  const product = selection.select([feature], { ...config, productBuild: true });
  const ids = product.features.flatMap(feature => feature.checks.map(check => check.id));
  for (const suffix of ['adapter', 'lifecycle-source', 'writers', 'library', 'windows-cleanup']) {
    const id = `tool.project-maintenance.${suffix}`;
    assert.ok(!ids.includes(id));
    assert.ok(product.selection.deferred.some(item => item.checkId === id));
    assert.ok(selection.select([feature], config).features[0].checks.some(check => check.id === id));
  }
  for (const suffix of ['core', 'prompts']) assert.ok(ids.includes(`tool.project-maintenance.${suffix}`));
});

function fixture(t) {
  const parent = process.env.AZRAEL_SOURCE_SELECTION_TEST_ROOT || path.join(__dirname, "../artifacts/verification");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "selection-"));
  t.after(() => fs.rmSync(root, { recursive: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  const write = (name, text) => fs.writeFileSync(path.join(root, "scripts", name), text);
  write("first.cjs", "require('./leaf.cjs')"); write("leaf.cjs", "require('./cycle.cjs')");
  write("cycle.cjs", "require('./leaf.cjs')"); write("second.cjs", "module.exports = 2");
  const check = (id, file) => ({ id, level: "source", executable: "node", args: ["--test", file], sourceSelection: { files: [file] } });
  const feature = { id: "fixture", owners: ["scripts/leaf.cjs", "scripts/unmapped.ps1"], checks: [
    check("first", "scripts/first.cjs"), check("second", "scripts/second.cjs"),
    { id: "native", level: "native", executable: "node", args: ["native.cjs"] } ] };
  return { root, feature, plan: files => selection.select([feature], { projectRoot: root, sourceCheckPaths: files }) };
}

test("source selection follows transitive cyclic imports and direct test changes without expanding unrelated checks", t => {
  const { plan, root } = fixture(t);
  for (const file of ["scripts/leaf.cjs", "scripts/cycle.cjs", "scripts/first.cjs"]) {
    assert.deepEqual(plan([file]).features[0].checks.map(check => check.id), ["first", "native"]);
  }
  assert.deepEqual(plan(["scripts/second.cjs"]).features[0].checks.map(check => check.id), ["second", "native"]);
  assert.deepEqual(plan(["scripts/leaf.cjs", "scripts/second.cjs"]).features[0].checks.map(check => check.id), ["first", "second", "native"]);
  fs.writeFileSync(path.join(root, 'scripts/second.cjs'), 'function load(specifier) { require(specifier); }');
  assert.ok(plan(['scripts/leaf.cjs']).selection.unresolved.some(item => item.source === 'scripts/second.cjs'));
  fs.unlinkSync(path.join(root, 'scripts/leaf.cjs'));
  assert.deepEqual(plan(['scripts/leaf.cjs']).features[0].checks.map(check => check.id), ['first', 'native']);
});

test("unmapped feature owners, global selection inputs and omitted scope retain full checks", t => {
  const { plan, root, feature } = fixture(t);
  for (const files of [[], ["scripts/unmapped.ps1"], ["scripts/azrael-feature-contracts.json"]]) {
    assert.deepEqual(plan(files).features[0].checks.map(check => check.id), ["first", "second", "native"]);
    assert.ok(plan(files).selection.checks.every(check => check.fallback));
  }
  assert.strictEqual(selection.select([feature], { projectRoot: root }).features[0], feature);
  assert.deepEqual(plan(['work/session/verification.json']).features[0].checks.map(check => check.id), ['native']);
  assert.strictEqual(selection.select([feature], { projectRoot: root, fullRegression: true, sourceCheckPaths: ["scripts/first.cjs"] }).features[0], feature);
  for (const files of [null, ["../escape"], ["C:\\escape"], ["/escape"], [""]]) {
    assert.throws(() => plan(files), /sourceCheckPaths/);
  }
});

test("lifecycle subcommands retain arguments and reject unknown, duplicated or unsupported selection", () => {
  const source = lifecycleChecks.selectCommands(["--stage", "source", "--test-file", "scripts/test-build-platform.cjs"], process.platform, ".", ".");
  assert.deepEqual(source, [[process.execPath, ["--test", "scripts/test-build-platform.cjs"]]]);
  const writers = lifecycleChecks.selectCommands(["--stage", "writers", "--test-file", "scripts/test-deployment-workspace.cjs"], process.platform, ".", "owned-run");
  assert.deepEqual(writers, [[process.execPath, ["scripts/test-deployment-workspace.cjs", path.join("owned-run", "temporary/workspace")]]]);
  for (const args of [["--stage", "source", "--test-file", "unknown"],
    ["--stage", "source", "--test-file", "scripts/test-build-platform.cjs", "--test-file", "scripts/test-build-platform.cjs"],
    ["--stage", "pipeline", "--test-file", "scripts/test-pipeline-state.cjs"]]) {
    assert.throws(() => lifecycleChecks.selectCommands(args, process.platform, ".", "owned-run"));
  }
});

test("inventory preserves all source files once and validates exact lifecycle dispatcher coverage", () => {
  const feature = require("./azrael-feature-contracts.json").features.find(feature => feature.id === "tool.project-maintenance");
  const checks = feature.checks.filter(check => check.sourceSelection);
  assert.equal(checks.length, 3);
  const files = checks.flatMap(check => check.sourceSelection.files);
  assert.equal(files.filter(file => file === "scripts/test-artifact-lifecycle.cjs").length, 1);
  for (const check of checks) selection.validate(check, file => assert.ok(fs.statSync(path.join(__dirname, "..", file)).isFile()));
  const invalid = structuredClone(checks.find(check => check.id.endsWith("lifecycle-source")));
  invalid.sourceSelection.files.pop();
  assert.throws(() => selection.validate(invalid, () => {}), /Incomplete/);
});
