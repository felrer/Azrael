"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { test, after } = require("node:test");
const transformer = require("./namespace-azrael-host.cjs");
const { createAssetTransformCache, CACHE_SCHEMA } = require("./asset-transform-cache.cjs");
const { CONTEXT_ASSET, SETTINGS_ASSET } = require("./inject-provider-context.cjs");
const { COMPOSER_DRAFT_ASSET } = require("./inject-composer-draft.cjs");
const { UI_CLEANUP_ASSETS } = require("./inject-ui-cleanup.cjs");
const { AUTO_REVIEW_ASSETS } = require("./inject-auto-review.cjs");
const { PETS_CLEANUP_ASSETS } = require("./inject-pets-cleanup.cjs");
const { CONTENT_FONT_ASSETS, CONTENT_FONT_CSS_ASSET } = require("./inject-content-fonts.cjs");
const { getContentFontRules } = require("./content-fonts.cjs");
const { INSTRUCTION_SETTINGS_ASSETS } = require("./inject-instruction-settings.cjs");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const tsPath = require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] });
const vp = require(tsPath);
const rules = transformer.getTransformRules();
const base = { transformRules: rules, getAssetTransformRules: transformer.getAssetTransformRules,
  typescriptSha256: sha(fs.readFileSync(tsPath)), typescriptVersion: vp.version };
const artifacts = path.resolve(__dirname, "../artifacts");
const root = fs.mkdtempSync(path.join(artifacts, "cache-scope-test-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const cache = (name, overrides = {}) => createAssetTransformCache({ ...base,
  cacheDirectory: path.join(root, name), ...overrides });
const changedPath = "webview/assets/cache-changed.js";
const changedSource = 'const id="chatgpt.foo";';
const noopPath = "webview/assets/cache-noop.js";
const noopSource = "const value=1;";
const changeRule = name => ({ transformRules: { ...rules, [name]: "1".repeat(64) } });
const transform = (asset, source) => transformer.transformAsset(source, asset, asset, vp);
const miss = () => { throw Error("expected a cache hit"); };

test("closed path dependencies scope controls/instructions/composer; generic and helper rules stay shared", () => {
  assert.equal(CACHE_SCHEMA, 3);
  for (const [rule, paths] of [
    ["inject-provider-context.cjs", [CONTEXT_ASSET, SETTINGS_ASSET]],
    ["inject-instruction-settings.cjs", ["out/extension.js", ...INSTRUCTION_SETTINGS_ASSETS]],
    ["inject-composer-draft.cjs", [COMPOSER_DRAFT_ASSET]],
    ["inject-ui-input-diagnostics.cjs", [COMPOSER_DRAFT_ASSET,
      "webview/assets/app-initial-efe028fd535e.js", "webview/assets/app-initial-5120fa5fe295.js"]],
    ["ui-input-diagnostics-runtime.cjs", [COMPOSER_DRAFT_ASSET,
      "webview/assets/app-initial-efe028fd535e.js", "webview/assets/app-initial-5120fa5fe295.js"]],
    ["inject-ui-cleanup.cjs", UI_CLEANUP_ASSETS],
    ["inject-auto-review.cjs", AUTO_REVIEW_ASSETS],
    ["inject-pets-cleanup.cjs", PETS_CLEANUP_ASSETS],
    ["inject-content-fonts.cjs", CONTENT_FONT_ASSETS],
    ["content-fonts.cjs", [CONTENT_FONT_CSS_ASSET]],
    ...Object.keys(getContentFontRules()).map(rule => [rule, [CONTENT_FONT_CSS_ASSET]]),
  ]) {
    for (const asset of paths) assert.equal(transformer.getAssetTransformRules(asset, rules)[rule], rules[rule]);
    assert.equal(transformer.getAssetTransformRules(changedPath, rules)[rule], undefined);
  }
  for (const rule of ["namespace-azrael-host.cjs", "asset-transform-cache.cjs", "provider-context-labels.cjs",
    "root-resume-wait.cjs", "provider-model-picker.cjs", "thread-branch.cjs", "immediate-stop.cjs", "pdf-file-open.cjs"]) {
    assert.equal(transformer.getAssetTransformRules(changedPath, rules)[rule], rules[rule]);
  }
  const unknown = { ...rules, "future-generic.cjs": "2".repeat(64) };
  assert.equal(transformer.getAssetTransformRules(changedPath, unknown)["future-generic.cjs"], unknown["future-generic.cjs"]);
});

test("unrelated scoped rule edits retain changed and persisted no-op results", () => {
  const cold = cache("unrelated");
  const expected = cold.run(changedPath, changedSource, () => transform(changedPath, changedSource));
  cold.run(noopPath, noopSource, () => transform(noopPath, noopSource));
  cold.flush();
  for (const rule of ["inject-provider-context.cjs", "inject-instruction-settings.cjs", "inject-composer-draft.cjs"]) {
    const statistics = { hits: 0, misses: 0 };
    const next = cache("unrelated", { ...changeRule(rule), statistics });
    assert.deepEqual(next.run(changedPath, changedSource, miss), expected);
    assert.deepEqual(next.run(noopPath, noopSource, miss), { text: noopSource, asset: null });
    assert.deepEqual(statistics, { hits: 2, misses: 0 });
  }
});

test("generic descriptor labels still transform off the controls paths and retain marker idempotence", () => {
  const asset = "webview/assets/generic-label-fixture.js";
  const source = 'const label={id:`settings.title`,defaultMessage:`Codex settings`};const rpc=`Codex CLI`;const url=`https://example.com/Codex`;';
  const injection = require("./inject-provider-context.cjs");
  const original = injection.injectProviderContext(source, asset);
  const namespaced = transform(asset, source);
  assert(original.count > 0);
  assert.deepEqual(require("./provider-context-labels.cjs").runProviderContext(source, asset), original);
  assert.match(namespaced.text, /Azrael settings/);
  assert.match(namespaced.text, /rpc=`Codex CLI`/);
  assert.match(namespaced.text, /https:\/\/example.com\/Codex/);
  assert.deepEqual(injection.injectProviderContext(original.text, asset), { text: original.text, count: 0 });
  const cold = cache("generic-label");
  const expected = cold.run(asset, source, () => transform(asset, source)); cold.flush();
  assert.deepEqual(cache("generic-label", changeRule("inject-provider-context.cjs")).run(asset, source, miss), expected);
  let called = false;
  cache("generic-label", changeRule("provider-context-labels.cjs")).run(asset, source, () => {
    called = true; return transform(asset, source);
  });
  assert(called);
});

test("related rules, shared dependencies, source/path and exact TypeScript invalidate changed and no-op keys", () => {
  let calls = 0;
  const run = (instance, asset, source) => instance.run(asset, source, () => { calls++; return transform(asset, source); });
  const cold = cache("invalidations");
  for (const [asset, source] of [[changedPath, changedSource], [noopPath, noopSource]]) run(cold, asset, source);
  // A target with no matching source pattern still depends on its path-scoped rule.
  const targetNoop = INSTRUCTION_SETTINGS_ASSETS[0];
  // Bypass actual injection anchors here: this test exercises key selection independently.
  const targetRun = instance => instance.run(targetNoop, noopSource, () => { calls++; return { text: noopSource, asset: null }; });
  targetRun(cold); cold.flush();
  const before = calls;
  targetRun(cache("invalidations", changeRule("inject-instruction-settings.cjs")));
  for (const override of [changeRule("namespace-azrael-host.cjs"), changeRule("asset-transform-cache.cjs"),
    changeRule("provider-context-labels.cjs"), changeRule("root-resume-wait.cjs"),
    { typescriptSha256: "3".repeat(64) }, { typescriptVersion: "changed" }]) {
    const next = cache("invalidations", override);
    for (const [asset, source] of [[changedPath, changedSource], [noopPath, noopSource]]) run(next, asset, source);
  }
  for (const [asset, source] of [[changedPath, changedSource], [noopPath, noopSource]]) {
    run(cold, asset + ".js", source); run(cold, asset, source + "//changed");
  }
  assert.equal(calls - before, 17);
});

test("malformed output/key/result hashes and corrupt to-op index recompute safely; writers merge hints", () => {
  const directory = path.join(root, "corrupt");
  let calls = 0;
  const recompute = () => { calls++; return transform(changedPath, changedSource); };
  const cold = cache("corrupt");
  const expected = cold.run(changedPath, changedSource, recompute);
  const entryPath = path.join(directory, fs.readdirSync(directory)[0]);
  const intact = JSON.parse(fs.readFileSync(entryPath));
  for (const broken of ["{broken", "{}", JSON.stringify({ ...intact, key: {} }),
    JSON.stringify({ ...intact, outputSha256: "0".repeat(64) }),
    JSON.stringify({ ...intact, resultSha256: "0".repeat(64) }),
    JSON.stringify({ ...intact, result: { ...intact.result, text: "corrupt" } })]) {
    fs.writeFileSync(entryPath, broken);
    const before = calls;
    assert.deepEqual(cache("corrupt").run(changedPath, changedSource, recompute), expected);
    assert.equal(calls, before + 1);
    assert.deepEqual(cache("corrupt").run(changedPath, changedSource, miss), expected);
  }
  cold.run(noopPath, noopSource, () => ({ text: noopSource, asset: null })); cold.flush();
  const indexPath = path.join(directory, fs.readdirSync(directory).find(name => name.startsWith("noops-")));
  const index = JSON.parse(fs.readFileSync(indexPath));
  for (const broken of ["{broken", "{}", JSON.stringify({ ...index, payloadSha256: "0".repeat(64) }),
    JSON.stringify({ ...index, keys: ["invalid"] })]) {
    fs.writeFileSync(indexPath, broken);
    let recomputed = false;
    const next = cache("corrupt");
    next.run(noopPath, noopSource, () => { recomputed = true; return { text: noopSource, asset: null }; });
    assert(recomputed); next.flush();
    cache("corrupt").run(noopPath, noopSource, miss);
  }
  const o = cache("corrupt"), b = cache("corrupt", changeRule("inject-composer-draft.cjs"));
  for (const [next, suffix] of [[o, "o"], [b, "b"]]) {
    next.run(noopPath + suffix, noopSource, () => ({ text: noopSource, asset: null })); next.flush();
  }
  const merged = cache("corrupt");
  for (const suffix of ["o", "b"]) merged.run(noopPath + suffix, noopSource, miss);
});

test("all pinned injector target fixtures: uncached/cold/warm byte and metadata equality; related edits miss", () => {
  const original = path.join(artifacts, "upstream-ui/26.930.61225");
  const paths = new Set(["out/extension.js", "webview/assets/ko-KR-669e0b3acfd6.js"]);
  for (const name of Object.keys(rules).filter(name => name.startsWith("inject-"))) {
    // Legacy migration targets ire exercised against their own pinned version
    // by test-session-links; this cache contract covers the active UI only.
    for (const [exportName, value] of Object.entries(require(`./${name}`))) {
      if (exportName.startsWith("LEGACY_")) continue;
      for (const asset of Array.isArray(value) ? value : [value]) {
        if (typeof asset === "string" && /^webview\/assets\/[^\n]+\.js$/.test(asset)) paths.add(asset);
      }
    }
  }
  const statistics = { hits: 0, misses: 0 };
  const cold = cache("pinned", { statistics });
  const results = new Map();
  for (const asset of paths) {
    const source = fs.readFileSync(path.join(original, asset), "utf8");
    const expected = transform(asset, source);
    assert.deepEqual(cold.run(asset, source, () => transform(asset, source)), expected, asset);
    results.set(asset, { source, expected });
  }
  cold.flush();
  const warm = cache("pinned", { statistics });
  for (const [asset, { source, expected }] of results) assert.deepEqual(warm.run(asset, source, miss), expected, asset);
  assert.deepEqual(statistics, { hits: paths.size, misses: paths.size });
  for (const [rule, targets] of [["inject-provider-context.cjs", [CONTEXT_ASSET, SETTINGS_ASSET]],
    ["inject-composer-draft.cjs", [COMPOSER_DRAFT_ASSET]],
    ["inject-instruction-settings.cjs", INSTRUCTION_SETTINGS_ASSETS]]) {
    const stats = { hits: 0, misses: 0 };
    const edited = cache("pinned", { ...changeRule(rule), statistics: stats });
    for (const asset of targets) {
      const { source, expected } = results.get(asset);
      assert.deepEqual(edited.run(asset, source, () => transform(asset, source)), expected);
    }
    assert.deepEqual(stats, { hits: 0, misses: targets.length });
    for (const [asset, { source, expected }] of results) {
      if (transformer.getAssetTransformRules(asset, rules)[rule]) continue;
      assert.deepEqual(edited.run(asset, source, miss), expected);
    }
    console.log(`${rule} edit: ${stats.hits} retained hits, ${stats.misses} target misses across ${paths.size} pinned fixtures`);
  }
  console.log(`uncached/cold/warm equality: ${paths.size} pinned fixtures`);
});
