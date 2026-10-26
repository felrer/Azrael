"use strict";
// Registry and extracted-function behavior checks: never invoke preparation or deployment.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH ??
  require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const read = name => fs.readFileSync(path.join(__dirname, name), "utf8");
const namespace = read("namespace-azrael-host.cjs");
function parsed(name, source = read(name)) {
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, `${name} must parse`);
  return ast;
}
function declaration(name, symbol, source) {
  const ast = parsed(name, source);
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === symbol) return node.getText(ast);
    if (ts.isVariableStatement(node)) {
      const item = node.declarationList.declarations.find(d => d.name.getText(ast) === symbol);
      if (item) return item.initializer.getText(ast);
    }
  }
  throw new Error(`Missing ${symbol} in ${name}`);
}

test("the real preservation registry covers every production UI injector", () => {
  const gate = require("./feature-preservation.cjs");
  const root = path.resolve(__dirname, "..");
  const manifest = gate.loadManifest(root);
  const rules = require("./namespace-azrael-host.cjs").getTransformRules();
  assert.equal(gate.validateManifest(manifest, root, rules), manifest);
  const links = manifest.features.find(feature => feature.id === "ui.session-links");
  assert.ok(links.owners.includes("scripts/inject-session-links.cjs"));
  assert.deepEqual(links.reportFields, ["sessionLinkEdits"]);
  const missingImage = manifest.features.find(feature => feature.id === "ui.missing-image");
  assert.equal(missingImage.area, "ui");
  assert.ok(missingImage.owners.includes("scripts/inject-missing-image.cjs"));
  for (const feature of manifest.features.filter(feature => feature.area === "ui")) {
    for (const owner of ["scripts/namespace-cache-owner.cjs", "scripts/test-namespace-cache-owner.cjs"]) {
      assert.ok(feature.owners.includes(owner), `${feature.id}: mandatory namespace owner ${owner}`);
    }
    const guards = feature.checks.filter(check => check.id === `${feature.id}.namespace-cache-owner`);
    assert.deepEqual(guards[0], { id: `${feature.id}.namespace-cache-owner`, executable: "node",
      args: ["--test", "scripts/test-namespace-cache-owner.cjs"], level: "source" });
  }
  assert.equal(missingImage.contract, "docs/architecture/ui-presentation.md");
  assert.deepEqual(missingImage.reportFields, ["missingImageEdits"]);
  const behaviorChecks = missingImage.checks.filter(check => check.id === "ui.missing-image.behavior");
  assert.deepEqual(behaviorChecks[0], { id: "ui.missing-image.behavior", executable: "node",
    args: ["--test", "scripts/test-missing-image.cjs"], level: "source",
    cacheInputs: { schema: 1, files: ["scripts/test-missing-image.cjs", "scripts/inject-missing-image.cjs"] } });
  const unregistered = { ...manifest, features: manifest.features.filter(feature => feature !== missingImage) };
  assert.throws(() => gate.validateManifest(unregistered, root, rules), /Unregistered UI injector: inject-missing-image\.cjs/);
});

test("Max targets reach the pipeline after provider transformation and produce one report edit", () => {
  const assets = vm.runInNewContext(declaration("inject-max-reasoning.cjs", "MAX_REASONING_ASSETS"));
  const body = declaration("namespace-azrael-host.cjs", "transformAsset", namespace);
  const context = { MAX_REASONING_ASSETS: assets, sha: () => "fixture-hash" };
  // Isolate the production function from unrelated injectors. Only Max edits;
  // empty input and empty other target lists exercise its fast no-op boundary.
  for (const symbol of new Set(body.match(/\b[A-Z][A-Z_]+\b/g))) {
    if (!(symbol in context)) context[symbol] = symbol.endsWith("_ASSETS") ? [] : "unrelated-asset";
  }
  for (const symbol of new Set(body.match(/\b(?:inject\w+|runProviderContext|rewriteJavaScript|markRecentThreadListRequest)\b/g))) {
    context[symbol] = text => ({ text, count: 0 });
  }
  context.injectProviderModelPicker = text => ({ text: text + "provider-applied", count: 0 });
  context.injectMaxReasoning = (text, asset) => {
    assert.equal(text, "provider-applied", "Max must consume provider output");
    assert.ok(assets.includes(asset));
    return { text: text + "max-applied", count: 1 };
  };
  const transform = vm.runInNewContext(`(${body})`, context);
  for (const asset of assets) {
    const result = transform("", asset, asset, {});
    assert.ok(result.asset, `${asset} must not become a cache no-op`);
    assert.equal(result.asset.path, asset);
    assert.equal(result.asset.maxReasoningEdits, 1);
    assert.equal(result.asset.edits, 1);
    assert.equal(result.asset.recentChatFilterEdits, 0);
    assert.equal(result.text, "provider-appliedmax-applied");
  }
});

test("transform fingerprints bind registry inputs", () => {
  const rules = require("./namespace-azrael-host.cjs").getTransformRules();
  for (const input of ["inject-max-reasoning.cjs", "inject-missing-image.cjs", "asset-transform-cache.cjs", "namespace-cache-owner.cjs", "feature-preservation.cjs", "azrael-feature-contracts.json"]) {
    assert.match(rules[input] ?? "", /^[a-f\d]{64}$/i, input);
  }
});
