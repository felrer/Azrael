"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cache = require("./cargo-shared-cache.cjs");
const lifecycle = require("./artifact-lifecycle.cjs");
const defaultRun = process.env.AZRAEL_SHARED_CARGO_TEST_ROOT ? null : require("./artifact-run.cjs").beginArtifactRun(path.resolve(__dirname, ".."), { workId: "cargo-cache-tests", owner: "cargo-cache-tests" });
const base = process.env.AZRAEL_SHARED_CARGO_TEST_ROOT || defaultRun.temporary;
if (!path.isAbsolute(base)) throw Error("Absolute shared Cargo test fixture root required");
fs.mkdirSync(base, { recursive: true });
const owned = [];
function fixture() {
  const projectRoot = fs.mkdtempSync(path.join(base, "case-")); owned.push(projectRoot);
  const sourceRoot = path.join(projectRoot, "source");
  fs.mkdirSync(path.join(sourceRoot, "codex-rs"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "codex-rs/Cargo.toml"), "[workspace]\n");
  return { projectRoot, sourceRoot, target: "x86_64-pc-windows-msvc", env: {}, tools: { rustc: "rustc fixture\nhost: x86_64-pc-windows-msvc", cargo: "cargo fixture" } };
}
after(() => { for (const directory of owned) fs.rmSync(directory, { recursive: true }); });
test("same compiler/configuration shares storage across source copies, without creating outputs during selection", () => {
  const options = fixture(), first = cache.selectCache(options);
  const other = path.join(options.projectRoot, "other");
  fs.mkdirSync(path.join(other, "codex-rs"), { recursive: true }); fs.writeFileSync(path.join(other, "codex-rs/Cargo.toml"), "[workspace]\n");
  assert.equal(first.targetDirectory, cache.selectCache({ ...options, sourceRoot: other }).targetDirectory);
  assert.equal(fs.existsSync(first.directory), false);
  assert.equal(first.key, cache.selectCache({ ...options, env: { CARGO_TARGET_DIR: first.targetDirectory } }).key);
  for (const changed of [{ target: "aarch64-apple-darwin" }, { tools: { ...options.tools, rustc: "different" } }, { env: { RUSTFLAGS: "-C debuginfo=0" } }]) assert.notEqual(first.key, cache.selectCache({ ...options, ...changed }).key);
  fs.mkdirSync(path.join(options.sourceRoot, "codex-rs/.cargo")); fs.writeFileSync(path.join(options.sourceRoot, "codex-rs/.cargo/config.toml"), "[build]\njobs=1\n");
  assert.notEqual(first.key, cache.selectCache(options).key);
});
test("cache lifecycle precedes payload, permits known-close reuse and blocks unresolved producers", () => {
  const options = fixture(), selection = cache.selectCache(options);
  const first = cache.beginExecution(selection, "first");
  assert.equal(lifecycle.catalog(options.projectRoot)[0].state, "pending");
  assert.throws(() => cache.beginExecution(selection, "competing"), /unresolved/);
  cache.finishExecution(first, { status: null, signal: "SIGTERM" }, {});
  assert.equal(lifecycle.catalog(options.projectRoot)[0].state, "pending");
  // Independent test fixture's actual-close simulation; not recovery evidence.
  cache.finishExecution(first, { status: 1 }, { exitCode: 1 });
  const failed = lifecycle.catalog(options.projectRoot)[0];
  assert.equal(failed.producer.outcome, "failure"); assert.equal(failed.membership_complete, true);
  const second = cache.beginExecution(selection, "second");
  cache.finishExecution(second, { status: 0 }, { exitCode: 0 });
  assert.equal(lifecycle.catalog(options.projectRoot)[0].producer.outcome, "success");
  fs.writeFileSync(path.join(selection.directory, "identity.json"), "changed");
  assert.throws(() => cache.beginExecution(selection, "third"), /identity/);
});
test("unowned preexisting directory and invalid paths cannot become shared cache", () => {
  const options = fixture(), selection = cache.selectCache(options);
  fs.mkdirSync(selection.directory, { recursive: true });
  assert.throws(() => cache.beginExecution(selection, "first"), /identity/);
  assert.throws(() => cache.selectCache({ ...options, projectRoot: "relative" }), /Absolute/);
  const linked = path.join(options.projectRoot, "linked");
  if (process.platform === "win32") fs.symlinkSync(options.sourceRoot, linked, "junction");
  else fs.symlinkSync(options.sourceRoot, linked, "dir");
  assert.throws(() => cache.selectCache({ ...options, sourceRoot: linked }), /Linked/);
  fs.unlinkSync(linked);
});
