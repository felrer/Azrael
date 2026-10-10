"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const transformer = require("./namespace-azrael-host.cjs");
const { createAssetTransformCache } = require("./asset-transform-cache.cjs");
const project = path.resolve(__dirname, "..");
const tsPath = path.resolve(process.argv[2] || path.join(project,
  "artifacts/build/pdf_chrome_20261001_v2/companion/node_modules/typescript/lib/typescript.js"));
const original = path.resolve(process.argv[3] || path.join(project,
  "artifacts/upstream-ui/26.1007.21434"));
const ts = require(tsPath);
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
async function main() {
const runRoot = fs.mkdtempSync(path.join(project, "artifacts/verification/namespace-performance-"));
const rules = transformer.getTransformRules();
const base = { typescriptSha256: sha(fs.readFileSync(tsPath)), typescriptVersion: ts.version, transformRules: rules };
function legacyEdits(text, edits) {
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  }
  return text;
}
const legacyRewrite = vm.runInNewContext(`(${transformer.rewriteJavaScript.toString()})`, {
  rewriteValue: transformer.rewriteValue, applyEdits: legacyEdits,
});
for (const edits of [[], [{ start: 1, end: 3, replacement: "韓😀" }],
  [{ start: 1, end: 3, replacement: "X" }, { start: 5, end: 7, replacement: "long" }],
  [{ start: 1, end: 6, replacement: "a" }, { start: 3, end: 5, replacement: "😀bbb" }],
  [{ start: 2, end: 2, replacement: "A" }, { start: 2, end: 2, replacement: "H" }],
  [{ start: 0, end: 8, replacement: "A" }, { start: 1, end: 8, replacement: "H" }]]) {
  const text = "a韓😀bcdefghi";
  assert.equal(transformer.applyEdits(text, edits), legacyEdits(text, edits));
}
for (const source of [
  'const emoji="😀한글";const id="chatgpt.foo";const native="chatgpt";workspace.getConfiguration("chatgpt");',
  'const a=`codex-ipc`;const b=`chatgpt.${x}.codex-rules${y}codexViewContainer`;const c=`https://chatgpt.com/${z}/codex-ipc`;',
  'const titles=["Codex","Codex Chat","Codex Agent"];const a=`😀\\` chatgpt.foo`;const b="openai.chatgpt";',
]) {
  const next = transformer.rewriteJavaScript(source, "unicode-template.js", ts);
  const old = legacyRewrite(source, "unicode-template.js", ts);
  assert.equal(next.text, old.text);
  assert.equal(next.count, old.count);
}
console.log("PASS legacy byte equivalence: Unicode, multiple offsets, templates, overlaps and equal-offset insertions");

const quickSource = 'const id="chatgpt.foo";';
const quickPath = "webview/assets/cache-fixture.js";
const quickDirectory = path.join(runRoot, "cache-tests");
let calls = 0;
const transform = () => { calls += 1; return transformer.transformAsset(quickSource, quickPath, quickPath, ts); };
const statistics = { hits: 0, misses: 0 };
const quick = createAssetTransformCache({ ...base, cacheDirectory: quickDirectory, statistics });
const cold = quick.run(quickPath, quickSource, transform);
const warm = quick.run(quickPath, quickSource, transform);
assert.deepEqual(warm, cold);
assert.equal(calls, 1);
assert.deepEqual(statistics, { hits: 1, misses: 1 });
quick.run(quickPath, quickSource + "// changed", () => { calls += 1; return transformer.transformAsset(quickSource + "// changed", quickPath, quickPath, ts); });
quick.run(quickPath + ".js", quickSource, () => { calls += 1; return transformer.transformAsset(quickSource, quickPath + ".js", quickPath + ".js", ts); });
for (const override of [
  { transformRules: { ...rules, "inject-recovery.cjs": "1".repeat(64) } },
  { transformRules: { ...rules, "asset-transform-cache.cjs": "2".repeat(64) } },
  { typescriptSha256: "3".repeat(64) }, { typescriptVersion: "changed" },
]) createAssetTransformCache({ ...base, ...override, cacheDirectory: quickDirectory }).run(quickPath, quickSource, transform);
assert.equal(calls, 7, "source, path, helper, cache implementation, TS implementation and TS version invalidate");
const baseEntryPath = fs.readdirSync(quickDirectory).map((name) => path.join(quickDirectory, name))
  .find((filename) => {
    const key = JSON.parse(fs.readFileSync(filename)).key;
    return key.sourceSha256 === sha(quickSource) && key.relativePath === quickPath &&
      key.typescriptSha256 === base.typescriptSha256 && key.typescriptVersion === base.typescriptVersion &&
      key.rulesSha256 === sha(JSON.stringify(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b))));
  });
assert(baseEntryPath);
const intact = fs.readFileSync(baseEntryPath, "utf8");
for (const corrupt of ["{broken", JSON.stringify({}), JSON.stringify({ ...JSON.parse(intact), key: {} }),
  JSON.stringify({ ...JSON.parse(intact), outputSha256: "0".repeat(64) }),
  JSON.stringify({ ...JSON.parse(intact), result: { ...cold, text: "corrupt" } }),
  JSON.stringify({ ...JSON.parse(intact), result: { ...cold, asset: { ...cold.asset, namespaceEdits: 99 } } })]) {
  fs.writeFileSync(baseEntryPath, corrupt);
  const before = calls;
  assert.deepEqual(quick.run(quickPath, quickSource, transform), cold);
  assert.equal(calls, before + 1);
  assert.deepEqual(quick.run(quickPath, quickSource, transform), cold);
  assert.equal(calls, before + 1);
}
fs.unlinkSync(baseEntryPath);
const beforeMissing = calls;
assert.deepEqual(quick.run(quickPath, quickSource, transform), cold);
assert.equal(calls, beforeMissing + 1);
assert.throws(() => createAssetTransformCache({ ...base, typescriptSha256: undefined, cacheDirectory: quickDirectory }), /exact TypeScript/);
assert.throws(() => createAssetTransformCache({ ...base, cacheDirectory: path.join(project, "outside-cache") }), /under artifacts/);
console.log("PASS content cache: cold/warm counts and bytes, source/path/rule/helper/TS invalidation, malformed/wrong-key/hash/count corruption and missing-entry recovery");

const assetPaths = new Set([
  "out/extension.js", "webview/assets/app-initial-97d3534ad35f.js",
  ...Object.values(transformer.ASSET_RULE_PATHS).flat(),
]);
for (const name of Object.keys(rules).filter(name => name.startsWith("inject-"))) {
  for (const value of Object.values(require(`./${name}`))) {
    for (const asset of Array.isArray(value) ? value : [value]) {
      if (typeof asset === "string" && /^webview\/assets\/[^\n]+\.js$/.test(asset)) assetPaths.add(asset);
    }
  }
}
const localePath = "webview/assets/ko-KR-ebd6264cb102.js";
assetPaths.add(localePath);
const optionalLegacyAssets = new Set([
  "webview/assets/app-initial-4bd9e54bcd58.js",
  "webview/assets/app-initial-9cbfb5c07b41.js",
  "webview/assets/chatgpt-conversation-turn-content-8f307c03dd18.js",
]);
const assets = [...assetPaths].filter(relative => {
  const present = fs.existsSync(path.join(original, relative));
  assert(present || optionalLegacyAssets.has(relative), `Required pinned asset missing: ${relative}`);
  return present;
});
function prepare(name, accountVersion = "0.4.0") {
  const directory = path.join(runRoot, name);
  function put(relative, data) {
    const filename = path.join(directory, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, data);
  }
  for (const relative of [...assets, "package.json", "syntaxes/starlark.tmLanguage.json"]) {
    put(relative, fs.readFileSync(path.join(original, relative)));
  }
  const packageBytes = fs.readFileSync(path.join(original, "package.json"));
  put(".azrael-official-ui.json", JSON.stringify({ schema: 1, sourceVersion: "26.1007.21434",
    sourcePackageSha256: sha(packageBytes).toUpperCase(), sourceWebviewSha256: sha(fs.readFileSync(path.join(original, require("./inject-provider-model-picker.cjs").PROVIDER_PICKER_ASSET))).toUpperCase() }));
  put("out/azrael-runtime.cjs", "// test runtime placeholder; not executed\n");
  put("integrated-azrael-entry.cjs", "// test integrated entry placeholder; not executed\n");
  put("account-ui/dist/src/extension.js", "// test account entry placeholder; not executed\n");
  const account = JSON.parse(fs.readFileSync(path.join(project, "extensions/azrael-ex/package.json")));
  account.version = accountVersion;
  put("account-ui/package.json", JSON.stringify(account));
  return directory;
}
function timed(run) { const start = performance.now(); const value = run(); return { value, elapsedMs: performance.now() - start }; }
async function timedAsync(run) { const start = performance.now(); const value = await run(); return { value, elapsedMs: performance.now() - start }; }
const uncachedRoot = prepare("uncached");
const uncached = await timedAsync(() => transformer.transformExtension(uncachedRoot, ts, "0.5.101"));
const cacheDirectory = path.join(runRoot, "pipeline-cache");
const coldRoot = prepare("cold");
const coldPipeline = await timedAsync(() => transformer.transformExtension(coldRoot, ts, "0.5.101", { cacheDirectory, typescriptSha256: base.typescriptSha256 }));
const warmRoot = prepare("warm");
let astCalls = 0;
const warmTs = { ...ts, createSourceFile(...args) { astCalls += 1; return ts.createSourceFile(...args); } };
const warmPipeline = await timedAsync(() => transformer.transformExtension(warmRoot, warmTs, "0.5.102", { cacheDirectory, typescriptSha256: base.typescriptSha256 }));
assert.deepEqual(coldPipeline.value.assets, uncached.value.assets);
assert.deepEqual(warmPipeline.value.assets, uncached.value.assets);
assert.equal(astCalls, 0, "intact warm payload avoids AST reparsing");
assert.equal(coldPipeline.value.performance.cache.hits, 0);
assert.equal(warmPipeline.value.performance.cache.hits, assets.length);
assert.equal(warmPipeline.value.performance.cache.misses, 0);
assert.equal(warmPipeline.value.performance.fileCount, assets.length);
assert.equal(warmPipeline.value.performance.readBytes, assets.reduce((sum, relative) => sum + fs.statSync(path.join(original, relative)).size, 0));
for (const relative of assets) assert.deepEqual(fs.readFileSync(path.join(warmRoot, relative)), fs.readFileSync(path.join(uncachedRoot, relative)));
assert.equal(JSON.parse(fs.readFileSync(path.join(warmRoot, "package.json"))).version, "0.5.102");
const accountRoot = prepare("warm-account-change", "0.4.1");
const accountReport = await transformer.transformExtension(accountRoot, warmTs, "0.5.103", { cacheDirectory, typescriptSha256: base.typescriptSha256 });
assert.equal(JSON.parse(fs.readFileSync(path.join(accountRoot, "package.json"))).azraelAccountPayloadVersion, "0.4.1");
assert.deepEqual(accountReport.assets, uncached.value.assets);
assert.equal(accountReport.performance.cache.hits, assets.length);
for (const [directory, report] of [[uncachedRoot, uncached.value], [coldRoot, coldPipeline.value],
  [warmRoot, warmPipeline.value], [accountRoot, accountReport]]) {
  assert.equal(report.sourceUi.packageSha256, sha(fs.readFileSync(path.join(original, "package.json"))));
  assert.equal(report.sourceUi.webviewSha256, sha(fs.readFileSync(path.join(original, require("./inject-provider-model-picker.cjs").PROVIDER_PICKER_ASSET))));
  assert.equal(report.assets.reduce((sum, asset) => sum + (asset.windowControlEdits ?? 0), 0), 5);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json")));
  assert.equal(manifest.contributes.commands.filter(command => command.command === "azrael.windowControl").length, 1);
}
console.log("PASS all applicable pinned pipeline transforms: uncached/cold/warm identical assets and bytes, existing aggregate checks, warm AST bypass, per-invocation host/account versions");
console.log("PASS selected-window transformation: exactly 5 edits and 1 azrael.windowControl command across all pipeline fixtures");

const localeSource = fs.readFileSync(path.join(original, localePath), "utf8");
const oldLocale = timed(() => legacyRewrite(localeSource, localePath, ts));
const newLocale = timed(() => transformer.rewriteJavaScript(localeSource, localePath, ts));
assert.equal(newLocale.value.text, oldLocale.value.text);
assert.equal(newLocale.value.count, oldLocale.value.count);
const localeStatistics = { hits: 0, misses: 0 };
const localeCache = createAssetTransformCache({ ...base, cacheDirectory: path.join(runRoot, "locale-cache"), statistics: localeStatistics });
const localeCold = timed(() => localeCache.run(localePath, localeSource, () => transformer.transformAsset(localeSource, localePath, localePath, ts)));
const localeWarm = timed(() => localeCache.run(localePath, localeSource, () => { throw new Error("warm locale unexpectedly reran pipeline"); }));
assert.deepEqual(localeCold.value, localeWarm.value);
// Match the full tree's dominant workload without creating thousands of cache files.
const noopCount = 6000;
const noopDirectory = path.join(runRoot, "noop-cache");
const noopSource = (index) => `${index < 100 ? "// chatgpt.foo\n" : ""}const value=${index};`;
const noopPath = (index) => `webview/assets/noop-${index}.js`;
const noopColdStats = { hits: 0, misses: 0 };
const noopColdCache = createAssetTransformCache({ ...base, cacheDirectory: noopDirectory, statistics: noopColdStats });
const noopCold = timed(() => {
  for (let index = 0; index < noopCount; index += 1) {
    assert.deepEqual(noopColdCache.run(noopPath(index), noopSource(index),
      () => transformer.transformAsset(noopSource(index), noopPath(index), noopPath(index), ts)),
    { text: noopSource(index), asset: null });
  }
  noopColdCache.run(quickPath, quickSource, transform);
  assert.equal(fs.readdirSync(noopDirectory).length, 1, "no-op cache writes nothing before flush");
  noopColdCache.flush();
});
assert.equal(fs.readdirSync(noopDirectory).length, 2, "one compact no-op index plus one positive result");
const noopIndexPath = path.join(noopDirectory, fs.readdirSync(noopDirectory).find((name) => name.startsWith("noops-")));
const noopIndexBytes = fs.statSync(noopIndexPath).size;
assert(noopIndexBytes < 500000, "index contains digests without duplicate source text");
const noopIntact = fs.readFileSync(noopIndexPath, "utf8");
assert.equal(JSON.parse(noopIntact).keys.length, noopCount);
const noopWarmStats = { hits: 0, misses: 0 };
let noopWarmAstCalls = 0;
const noopWarmTs = { ...ts, createSourceFile(...args) { noopWarmAstCalls += 1; return ts.createSourceFile(...args); } };
const noopWarm = timed(() => {
  const cache = createAssetTransformCache({ ...base, cacheDirectory: noopDirectory, statistics: noopWarmStats });
  for (let index = 0; index < noopCount; index += 1) {
    assert.deepEqual(cache.run(noopPath(index), noopSource(index),
      () => transformer.transformAsset(noopSource(index), noopPath(index), noopPath(index), noopWarmTs)),
    { text: noopSource(index), asset: null });
  }
  assert.deepEqual(cache.run(quickPath, quickSource, () => { throw new Error("positive result cache miss"); }), cold);
  cache.flush();
});
assert.equal(noopWarmAstCalls, 0);
assert.deepEqual(noopWarmStats, { hits: noopCount + 1, misses: 0 });
let noopRecomputes = 0;
const recomputeNoop = () => { noopRecomputes += 1; return { text: noopSource(0), asset: null }; };
for (const override of [
  { transformRules: { ...rules, "inject-recovery.cjs": "1".repeat(64) } },
  { typescriptSha256: "3".repeat(64) }, { typescriptVersion: "changed" },
]) createAssetTransformCache({ ...base, ...override, cacheDirectory: noopDirectory }).run(noopPath(0), noopSource(0), recomputeNoop);
const changedNoopCache = createAssetTransformCache({ ...base, cacheDirectory: noopDirectory });
changedNoopCache.run(noopPath(0), noopSource(0) + "// change", () => { noopRecomputes += 1; return { text: noopSource(0) + "// change", asset: null }; });
changedNoopCache.run(noopPath(0) + ".js", noopSource(0), recomputeNoop);
assert.equal(noopRecomputes, 5, "no-op source/path/rule/TS implementation/version invalidation");
for (const corrupt of ["{broken", JSON.stringify({}),
  JSON.stringify({ ...JSON.parse(noopIntact), fingerprint: {} }),
  JSON.stringify({ ...JSON.parse(noopIntact), payloadSha256: "0".repeat(64) }),
  JSON.stringify({ ...JSON.parse(noopIntact), keys: ["invalid"] })]) {
  fs.writeFileSync(noopIndexPath, corrupt);
  const cache = createAssetTransformCache({ ...base, cacheDirectory: noopDirectory });
  const before = noopRecomputes;
  assert.deepEqual(cache.run(noopPath(0), noopSource(0), recomputeNoop), { text: noopSource(0), asset: null });
  assert.equal(noopRecomputes, before + 1);
  cache.flush();
  const recovered = createAssetTransformCache({ ...base, cacheDirectory: noopDirectory });
  recovered.run(noopPath(0), noopSource(0), () => { throw new Error("repaired no-op index missed"); });
  fs.writeFileSync(noopIndexPath, noopIntact);
}
fs.unlinkSync(noopIndexPath);
const missingNoop = createAssetTransformCache({ ...base, cacheDirectory: noopDirectory });
const beforeMissingNoop = noopRecomputes;
missingNoop.run(noopPath(0), noopSource(0), recomputeNoop);
assert.equal(noopRecomputes, beforeMissingNoop + 1);
missingNoop.flush();
// Independent writers merge a validated current index when flushing.
const concurrentA = createAssetTransformCache({ ...base, cacheDirectory: noopDirectory });
const concurrentB = createAssetTransformCache({ ...base, cacheDirectory: noopDirectory });
concurrentA.run(noopPath(1), noopSource(1), () => ({ text: noopSource(1), asset: null }));
concurrentB.run(noopPath(2), noopSource(2), () => ({ text: noopSource(2), asset: null }));
concurrentA.flush();
concurrentB.flush();
const merged = createAssetTransformCache({ ...base, cacheDirectory: noopDirectory });
for (const index of [0, 1, 2]) merged.run(noopPath(index), noopSource(index), () => { throw new Error("concurrent merge lost validated hints"); });
console.log(`PASS ${noopCount} no-op assets: compact index plus positive result, no per-noop writes, warm zero AST, invalidation/corruption/missing-index recovery and concurrent merge`);

const benchmark = { scope: `${assets.length} real pinned assets covering every pipeline transform; isolated placeholders for runtime/account entries, no packaging/install`,
  original, typescriptPath: tsPath, typescriptSha256: base.typescriptSha256, typescriptVersion: ts.version, runRoot,
  pipeline: { fileCount: assets.length, readBytes: coldPipeline.value.performance.readBytes,
    uncachedMs: uncached.elapsedMs, coldMs: coldPipeline.elapsedMs, warmMs: warmPipeline.elapsedMs,
    coldCache: coldPipeline.value.performance.cache, warmCache: warmPipeline.value.performance.cache },
  noops: { fileCount: noopCount, cacheFiles: 2, indexBytes: noopIndexBytes,
    coldMs: noopCold.elapsedMs, warmMs: noopWarm.elapsedMs, coldCache: noopColdStats, warmCache: noopWarmStats,
    warmAstCalls: noopWarmAstCalls },
  locale: { path: localePath, bytes: Buffer.byteLength(localeSource), edits: newLocale.value.count,
    legacyMs: oldLocale.elapsedMs, onePassMs: newLocale.elapsedMs, coldMs: localeCold.elapsedMs,
    warmMs: localeWarm.elapsedMs, statistics: localeStatistics }, exitCode: 0 };
const logRoot = path.resolve(process.argv[4] || path.join(project, "artifacts/logs/packaging-optimization"));
fs.mkdirSync(logRoot, { recursive: true });
fs.writeFileSync(path.join(logRoot, "namespace-benchmark.json"), JSON.stringify(benchmark, null, 2) + "\n");
console.log(`PASS real Korean locale byte equivalence (${benchmark.locale.bytes} bytes; ${benchmark.locale.edits} edits)`);
console.log(JSON.stringify({ pipeline: benchmark.pipeline, noops: benchmark.noops, locale: benchmark.locale, runRoot }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
