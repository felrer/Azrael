"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { planSourceTests } = require("./source-test-policy.cjs");
const files = ["scripts/test-asset-transform-cache.cjs", "scripts/test-feature-preservation-cache.cjs", "scripts/test-session-links.cjs", "scripts/test-namespace-source.cjs", "scripts/test-project-selection.cjs", "scripts/test-unknown.cjs"];

test("routine policy omits only registered expensive cases and the runner regression file", () => {
  const result = planSourceTests({ files, changedPaths: ["docs/README.md", "unmapped-source.js"] });
  assert.equal(result.omitted.length, 5);
  assert.deepEqual(result.files, files.filter(file => !file.endsWith("test-project-selection.cjs")));
  const skipped = new RegExp(result.skipPattern);
  for (const item of result.omitted.filter(item => item.test)) {
    assert.ok(skipped.test(item.test));
    assert.ok(!skipped.test(`prefix ${item.test}`));
    assert.ok(!skipped.test(`${item.test} suffix`));
  }
  assert.ok(!skipped.test("display branding preserves backend HTTP header names and accepted app brand"));
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
  const matrices = files.slice(0, 4);
  for (const changed of ["scripts/asset-transform-cache.cjs", "scripts/verification-result-cache.cjs", "scripts/inject-btw.cjs", "scripts/namespace-azrael-host.cjs", "scripts/azrael-feature-contracts.json", "extensions/azrael-ex/package-lock.json", "extensions/azrael-ex/node_modules/typescript/lib/typescript.js", "artifacts/upstream-ui/26.1007.21434/webview/assets/app.js"]) {
    const result = planSourceTests({ files: matrices, changedPaths: [changed] });
    assert.equal(result.omitted.length, 0, changed);
    assert.equal(result.skipPattern, "", changed);
  }
});

test("migration, preservation and selection owners retain their bounded candidate", () => {
  for (const [changed, file] of [["scripts/session-links.cjs", files[2]], ["scripts/feature-preservation.cjs", files[1]], ["scripts/test-project.cjs", files[4]], ["extensions/azrael-ex/tsconfig.json", files[4]]]) {
    const result = planSourceTests({ files, changedPaths: [changed] });
    assert.ok(!result.omitted.some(item => item.file === file), changed);
  }
  const result = planSourceTests({ files, changedPaths: ["scripts/inject-btw.cjs"] });
  assert.ok(result.omitted.some(item => item.file === files[4]));
});
