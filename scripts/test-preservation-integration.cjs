"use strict";
// Source and extracted-function checks: never invoke preparation or deployment.
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
function ordered(source, anchors) {
  let previous = -1;
  for (const anchor of anchors) {
    const index = source.indexOf(anchor, previous + 1);
    assert.ok(index > previous, `Missing or out-of-order gate: ${anchor}`);
    previous = index;
  }
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
  assert.deepEqual(missingImage.owners, ["scripts/inject-missing-image.cjs"]);
  assert.equal(missingImage.contract, "docs/architecture/ui-presentation.md");
  assert.deepEqual(missingImage.reportFields, ["missingImageEdits"]);
  assert.deepEqual(missingImage.checks, [{ id: "ui.missing-image.behavior", executable: "node",
    args: ["--test", "scripts/test-missing-image.cjs"], level: "source" }]);
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
  assert.match(namespace, /for \(const assetPath of MAX_REASONING_ASSETS\)[\s\S]*?asset\.path === assetPath && asset\.maxReasoningEdits === 1/);
});

test("cache and checkpoints bind Max, report counts, and registry inputs", () => {
  const fields = vm.runInNewContext(declaration("asset-transform-cache.cjs", "COUNT_FIELDS"));
  for (const field of ["maxReasoningEdits", "recentChatFilterEdits", "missingImageEdits"]) assert.ok(fields.includes(field));
  const rules = declaration("namespace-azrael-host.cjs", "getTransformRules", namespace);
  for (const input of ["inject-max-reasoning.cjs", "inject-missing-image.cjs", "asset-transform-cache.cjs", "feature-preservation.cjs", "azrael-feature-contracts.json"]) assert.ok(rules.includes(`"${input}"`));
  assert.match(namespace, /"inject-max-reasoning\.cjs": MAX_REASONING_ASSETS/);
  const inputs = declaration("preparation-state.cjs", "inputs");
  for (const input of ["feature-preservation.cjs", "azrael-feature-contracts.json"]) assert.ok(inputs.includes(`"${input}"`));
  ordered(declaration("namespace-azrael-host.cjs", "transformExtension", namespace), [
    "validateManifest(featureManifest", "const cache = createAssetTransformCache(",
    "validateTransformReport(featureManifest, report)", '".azrael-independent-host.json"',
  ]);
});

test("preparation verifies UI before consuming checkpoints and binds the exact package", () => {
  const source = read("prepare-independent-vscode.ps1");
  ordered(source, ["$checkpointTool init", "area = 'ui'", "'feature-preservation.cjs') run --config",
    "$namespaceCheckpoint =", "$checkpointTool load $OutputDirectory namespace", "'namespace-azrael-host.cjs')",
    "'archive-contract'", "$preservationBindingConfig.packagePath = $vsix", "'feature-preservation.cjs') bind --config", "PreservationReceipt ="]);
  assert.match(source, /PreservationReport = \$preservationReportPath; PreservationBinding = \$preservationBindingPath/);
  assert.match(source, /UI feature preservation failed/);
  assert.match(source, /UI preservation could not be bound/);
});

test("deployment verifies package identity and rechecks engine before installation", () => {
  const source = read("deploy-azrael.ps1");
  ordered(source, ["Wait-OwnedCommands @($sourceTests, $build)", "area = 'engine'", "'engine-preservation'",
    "Wait-OwnedCommands @($enginePreservation)", "$enginePreservationConfig.receiptPath = [string]$enginePreservationResult.receiptPath",
    "Invoke-Stage 'prepare'", "Assert-ProjectSnapshot 'pre-install'",
    "'engine-preservation-recheck'", "'verify-receipt', '--config', $enginePreservationConfigPath",
    "Wait-OwnedCommands @($engineRecheck)", "Start-OwnedCommand 'install'"]);
  const packageCheck = source.slice(source.indexOf("function Assert-Package"), source.indexOf("try {", source.indexOf("function Assert-Package")));
  assert.match(packageCheck, /receiptPath = \$prepared\.PreservationReceipt; reportPath = \$prepared\.PreservationReport/);
  assert.match(packageCheck, /packagePath = \$prepared\.HostVsix; bindingPath = \$prepared\.PreservationBinding/);
  assert.match(packageCheck, /outputDirectory = \(Join-Path \$logs 'package-preservation'\)/);
  assert.match(packageCheck, /'feature-preservation\.cjs'\) verify --config/);
  assert.match(packageCheck, /Package feature preservation verification failed/);
});

test("namespace test selection includes registry and integration acceptance", () => {
  const selection = vm.runInNewContext(declaration("test-project.cjs", "NAMESPACE"));
  assert.ok(selection.includes("scripts/test-feature-preservation.cjs"));
  assert.ok(selection.includes("scripts/test-preservation-integration.cjs"));
});
