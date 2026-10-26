"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { planSourceTests, pinnedAssetMatrix, matrixTestName } = require("./source-test-policy.cjs");
const files = ["scripts/test-asset-transform-cache.cjs", "scripts/test-feature-preservation-cache.cjs", "scripts/test-session-links.cjs", "scripts/test-project-selection.cjs", "scripts/test-unknown.cjs"];

test("routine policy omits only registered expensive cases and the runner regression file", () => {
  const result = planSourceTests({ files, changedPaths: ["docs/README.md"] });
  for (const file of files.slice(0, -1)) assert.ok(result.omitted.some(item => item.file === file));
  assert.deepEqual(result.files, files.filter(file => !file.endsWith("test-project-selection.cjs")));
  const skipped = new RegExp(result.skipPattern);
  for (const item of result.omitted.filter(item => item.test)) {
    assert.ok(skipped.test(item.test));
    assert.ok(!skipped.test(`prefix ${item.test}`));
    assert.ok(!skipped.test(`${item.test} suffix`));
  }
  assert.ok(!skipped.test("guarded pinned 26X928X31416 outgoing links, parsing, allowlists and preservation"));
  assert.ok(!skipped.test("guarded pinned 26.1007.21434 outgoing links, parsing, allowlists and preservation"));
});

test("unknown tests and empty input preserve their exact scope", () => {
  for (const selected of [[], ["scripts/test-future.cjs"]]) {
    assert.deepEqual(planSourceTests({ files: selected, changedPaths: [] }), { files: selected, skipPattern: "", omitted: [] });
  }
});

test("exhaustive and helper changes retain every supplied file and case", () => {
  for (const options of [{ exhaustive: true }, { changedPaths: ["scripts/source-test-policy.cjs"] }])
    assert.deepEqual(planSourceTests({ files, ...options }), { files, skipPattern: "", omitted: [] });
});

test("a directly changed test runs all its cases without expanding other selected files", () => {
  for (const file of files) {
    const result = planSourceTests({ files, changedPaths: [file.replaceAll("/", "\\")] });
    assert.ok(result.files.includes(file));
    assert.ok(!result.omitted.some(item => item.file === file));
    assert.ok(result.files.every(item => files.includes(item)));
  }
});

test("cache, transform, manifest, compiler and pinned UI owner edits retain matrices", () => {
  const matrices = files.slice(0, 3);
  for (const changed of ["scripts/asset-transform-cache.cjs", "scripts/verification-result-cache.cjs", "scripts/namespace-azrael-host.cjs", "scripts/azrael-feature-contracts.json", "extensions/azrael-ex/package-lock.json", "extensions/azrael-ex/node_modules/typescript/lib/typescript.js", "artifacts/upstream-ui/26.1007.21434/webview/assets/app.js"]) {
    const result = planSourceTests({ files: matrices, changedPaths: [changed] });
    assert.equal(result.omitted.length, 0, changed);
    assert.equal(result.skipPattern, "", changed);
  }
});

test("migration, preservation and selection owners retain their bounded candidate", () => {
  for (const [changed, file] of [["scripts/session-links.cjs", files[2]], ["scripts/feature-preservation.cjs", files[1]], ["scripts/test-project.cjs", files[3]], ["extensions/azrael-ex/tsconfig.json", files[3]]]) {
    const result = planSourceTests({ files, changedPaths: [changed] });
    assert.ok(!result.omitted.some(item => item.file === file), changed);
  }
  const result = planSourceTests({ files, changedPaths: ["scripts/inject-btw.cjs"] });
  assert.ok(result.omitted.some(item => item.file === files[3]));
});

test("one or several closed injectors select exactly the union of their asset targets", () => {
  const { assets, rulePaths } = pinnedAssetMatrix();
  for (const rules of [["inject-composer-draft.cjs"], ["inject-provider-context.cjs"],
    ["inject-composer-draft.cjs", "inject-instruction-settings.cjs"], ["inject-content-fonts.cjs"]]) {
    const result = planSourceTests({ files, changedPaths: rules.map(rule => `scripts\\${rule}`) });
    const skipped = new RegExp(result.skipPattern);
    const targets = new Set(rules.flatMap(rule => rulePaths[rule]));
    for (const asset of assets) {
      const omitted = result.omitted.find(item => item.test === matrixTestName(asset));
      assert.equal(!!omitted, !targets.has(asset), `${rules}: ${asset}`);
      assert.equal(skipped.test(matrixTestName(asset)), !targets.has(asset), asset);
      if (omitted) assert.ok(omitted.reason);
    }
    assert.ok(result.files.includes(files[0]));
  }
});

test("unknown inputs, missing gates, helpers, owners and mixed inputs preserve the complete matrix", () => {
  const { assets } = pinnedAssetMatrix();
  for (const changedPaths of [["unmapped-source.js"], ["scripts/inject-future.cjs"],
    ["scripts/inject-deferred-turn.cjs"],
    ["scripts/provider-context-labels.cjs"], ["scripts/asset-transform-cache.cjs"],
    ["scripts/source-test-policy.cjs"], [files[0]], ["scripts/namespace-azrael-host.cjs"],
    ["artifacts/upstream-ui/pin/webview/assets/app.js"],
    ["scripts/inject-composer-draft.cjs", "scripts/unknown-helper.cjs"]]) {
    const result = planSourceTests({ files, changedPaths });
    const skipped = result.skipPattern ? new RegExp(result.skipPattern) : null;
    for (const asset of assets) assert.ok(!skipped?.test(matrixTestName(asset)), `${changedPaths}: ${asset}`);
    assert.ok(!result.omitted.some(item => item.file === files[0]));
  }
  const exhaustive = planSourceTests({ files, changedPaths: ["scripts/inject-composer-draft.cjs"], exhaustive: true });
  assert.equal(exhaustive.skipPattern, "");
  assert.deepEqual(exhaustive.omitted, []);
});
