"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { test, after } = require("node:test");
const { createAssetTransformCache } = require("./asset-transform-cache.cjs");
const transformer = require("./namespace-azrael-host.cjs");
const tsPath = process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH ?? require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] });
const ts = require(tsPath);
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const root = fs.mkdtempSync(path.resolve(__dirname, "../artifacts/cache-retention-test-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const base = { typescriptSha256: sha(fs.readFileSync(tsPath)), typescriptVersion: ts.version,
  transformRules: { rule: "current" } };
const cache = (name, options = {}) => createAssetTransformCache({ ...base,
  cacheDirectory: path.join(root, name), ...options });
const assetPath = "webview/assets/retention.js";
const source = 'const id="chatgpt.foo";';
const transform = (text = source) => transformer.transformAsset(text, assetPath, assetPath, ts);
const hit = () => { throw new Error("expected a retained cache hit"); };
const entries = name => fs.readdirSync(path.join(root, name)).filter(file => /^[a-f0-9]{64}\.json$/.test(file));
const index = name => JSON.parse(fs.readFileSync(path.join(root, name,
  fs.readdirSync(path.join(root, name)).find(file => /^noops-[a-f0-9]{64}\.json$/.test(file))), "utf8"));

test("successful pruning retains warm entries and removes obsolete source, rule and fingerprint files", () => {
  for (const [name, stale] of [
    ["source", { text: source + "//obsolete" }],
    ["rule", { options: { transformRules: { rule: "obsolete" } } }],
    ["fingerprint", { options: { typescriptSha256: "0".repeat(64) } }],
  ]) {
    const old = cache(name, stale.options);
    const oldText = stale.text || source;
    old.run(assetPath, oldText, () => transform(oldText));
    old.run("old-noop.js", "old", () => ({ text: "old", asset: null }));
    old.flush();
    const cold = cache(name);
    const expected = cold.run(assetPath, source, () => transform());
    cold.flush();
    assert.equal(entries(name).length, 2);
    const warm = cache(name, { pruneUnused: true });
    assert.deepEqual(warm.run(assetPath, source, hit), expected);
    warm.flush();
    assert.equal(entries(name).length, 1);
    assert.equal(fs.readdirSync(path.join(root, name)).length, 2);
    assert.deepEqual(cache(name).run(assetPath, source, hit), expected);
    assert.deepEqual(index(name).keys, []);
  }
});

test("pruning filters old no-op hints even when all visited assets hit", () => {
  const cold = cache("noops");
  for (const name of ["keep.js", "unused.js"]) cold.run(name, "noop", () => ({ text: "noop", asset: null }));
  cold.flush();
  assert.equal(index("noops").keys.length, 2);
  const warm = cache("noops", { pruneUnused: true });
  warm.run("keep.js", "noop", hit);
  // Another writer's hint must not be merged into the completed invocation.
  const concurrent = cache("noops");
  concurrent.run("concurrent.js", "noop", () => ({ text: "noop", asset: null }));
  concurrent.flush();
  warm.flush();
  assert.equal(index("noops").keys.length, 1);
  const next = cache("noops");
  next.run("keep.js", "noop", hit);
  let calls = 0;
  for (const name of ["unused.js", "concurrent.js"]) next.run(name, "noop", () => {
    calls++; return { text: "noop", asset: null };
  });
  assert.equal(calls, 2);
});

test("failed unflushed transformation and failed index commit preserve previous cache files", () => {
  const cold = cache("failure");
  cold.run(assetPath, source, () => transform());
  cold.run("old.js", "noop", () => ({ text: "noop", asset: null }));
  cold.flush();
  const directory = path.join(root, "failure");
  const before = new Map(fs.readdirSync(directory).map(file => [file, fs.readFileSync(path.join(directory, file))]));
  const failed = cache("failure", { pruneUnused: true });
  assert.throws(() => failed.run("bad.js", "bad", () => { throw Error("transform failed"); }), /transform failed/);
  for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(directory, file)), bytes);
  const cannotFlush = cache("failure", { pruneUnused: true, typescriptSha256: "f".repeat(64) });
  const fingerprint = { schema: 3, typescriptSha256: "f".repeat(64), typescriptVersion: ts.version };
  const blockedIndex = path.join(directory, `noops-${sha(JSON.stringify(fingerprint))}.json`);
  fs.mkdirSync(blockedIndex);
  assert.throws(() => cannotFlush.flush());
  for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(directory, file)), bytes);
});

test("pruning preserves unknown files, temporary files, directories and directory links", () => {
  const current = cache("unknown", { pruneUnused: true });
  const directory = path.join(root, "unknown");
  for (const file of ["README.json", "A".repeat(64) + ".json", "a".repeat(64) + ".json.123.tmp"]) {
    fs.writeFileSync(path.join(directory, file), "keep");
  }
  const nested = path.join(directory, "b".repeat(64) + ".json");
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, "c".repeat(64) + ".json"), "keep");
  const linkedTarget = path.join(root, "linked-target");
  fs.mkdirSync(linkedTarget);
  fs.writeFileSync(path.join(linkedTarget, "d".repeat(64) + ".json"), "keep");
  const link = path.join(directory, "e".repeat(64) + ".json");
  fs.symlinkSync(linkedTarget, link, process.platform === "win32" ? "junction" : "dir");
  current.flush();
  for (const file of ["README.json", "A".repeat(64) + ".json", "a".repeat(64) + ".json.123.tmp"]) {
    assert.equal(fs.readFileSync(path.join(directory, file), "utf8"), "keep");
  }
  assert.equal(fs.readFileSync(path.join(nested, "c".repeat(64) + ".json"), "utf8"), "keep");
  assert(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.readFileSync(path.join(linkedTarget, "d".repeat(64) + ".json"), "utf8"), "keep");
});

test("default cache mode preserves obsolete entries and merges concurrent no-op hints", () => {
  const a = cache("default"), b = cache("default");
  a.run(assetPath, source, () => transform());
  a.run("a.js", "noop", () => ({ text: "noop", asset: null }));
  a.flush();
  b.run("b.js", "noop", () => ({ text: "noop", asset: null }));
  b.flush();
  assert.equal(entries("default").length, 1);
  assert.equal(index("default").keys.length, 2);
  const next = cache("default");
  for (const name of ["a.js", "b.js"]) next.run(name, "noop", hit);
  next.flush();
  assert.equal(entries("default").length, 1);
});
