"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { captureProject: capture, parents } = require("./capture-project-inputs.cjs");
const { snapshotProject } = require("./deployment-input-snapshot.cjs");

const fixtureRoot = path.resolve(__dirname, "../artifacts/verification/deployment-optimization", `capture-${Date.now()}-${process.pid} spaces 한글`);
fs.mkdirSync(fixtureRoot, { recursive: true });
let passed = 0;
let suiteRoot = fixtureRoot, smallFileMaxBytes = 128 * 1024;
const captureProject = (root, destination, options = {}) => capture(root, destination, { smallFileMaxBytes, ...options });
function git(root, ...args) {
  const result = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-C", root, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return result.stdout.trim();
}
function repository(name) {
  const root = path.join(suiteRoot, name);
  fs.mkdirSync(root);
  git(root, "init", "--quiet");
  fs.writeFileSync(path.join(root, ".gitignore"), "ignored/\n");
  fs.mkdirSync(path.join(root, "dir"));
  fs.writeFileSync(path.join(root, "dir/input.txt"), "alpha\n");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "fixture");
  return root;
}
function clone(source, name) {
  const destination = path.join(suiteRoot, name);
  git(fixtureRoot, "clone", "--quiet", "--no-checkout", source, destination);
  return destination;
}
async function test(name, action) {
  await action(); passed++; console.log(`PASS [threshold=${smallFileMaxBytes}] ${name}`);
}
// Trigger at a real opened-file stat boundary after inventory, without adding product test hooks.
async function interceptOpen(target, onOpened, action) {
  const original = fs.promises.open;
  fs.promises.open = async function(filename, ...args) {
    const handle = await original.call(this, filename, ...args);
    if (filename === target) {
      const stat = handle.stat.bind(handle);
      let calls = 0;
      handle.stat = async (...statArgs) => {
        calls++;
        const replacement = await onOpened(calls, handle);
        return replacement || stat(...statArgs);
      };
    }
    return handle;
  };
  try { await action(); } finally { fs.promises.open = original; }
}
async function main() {
  assert.equal(typeof fs.realpathSync.native, "function", "Supported Node must expose native realpath");
  for (smallFileMaxBytes of [128 * 1024, 0]) {
  suiteRoot = path.join(fixtureRoot, `threshold-${smallFileMaxBytes}`);
  fs.mkdirSync(suiteRoot);
  await test("selected bytes include dirty/untracked/deleted paths and nested repositories", async () => {
    const root = repository("selection"), vendor = repository("vendor");
    git(root, "-c", "protocol.file.allow=always", "submodule", "add", "--quiet", vendor, "modules/vendor");
    git(root, "commit", "--quiet", "-am", "nested");
    fs.unlinkSync(path.join(root, "dir/input.txt"));
    fs.writeFileSync(path.join(root, "new 한글.txt"), Buffer.from([0, 255, 13, 10, 0]));
    fs.writeFileSync(path.join(root, "modules/vendor/dir/input.txt"), "dirty nested\n");
    fs.writeFileSync(path.join(root, "modules/vendor/untracked.txt"), "nested new\n");
    fs.mkdirSync(path.join(root, "ignored"));
    fs.writeFileSync(path.join(root, "ignored/cache"), "excluded");
    const destination = clone(root, "selection-frozen");
    fs.mkdirSync(path.join(destination, "modules"));
    git(fixtureRoot, "clone", "--quiet", "--no-checkout", vendor, path.join(destination, "modules/vendor"));
    const expected = await snapshotProject(root);
    const result = await captureProject(root, destination, { concurrency: 2 });
    assert.equal(result.sha256, expected.sha256);
    assert.equal(result.fileCount, expected.fileCount);
    assert.equal(result.bytes, expected.bytes);
    assert.equal(result.copyIo.bufferedFileCount + result.copyIo.streamedFileCount, result.fileCount);
    assert.equal(smallFileMaxBytes ? result.copyIo.streamedFileCount : result.copyIo.bufferedFileCount, 0);
    assert.equal(fs.existsSync(path.join(destination, "dir/input.txt")), false);
    assert.equal(fs.existsSync(path.join(destination, "ignored/cache")), false);
    assert.deepEqual(fs.readFileSync(path.join(destination, "new 한글.txt")), fs.readFileSync(path.join(root, "new 한글.txt")));
    assert.match(git(destination, "ls-files", "--stage"), /dir\/input\.txt/);
    for (const phase of ["inventory", "copy", "git", "finalHash"]) assert.ok(result.phasesMs[phase] >= 0);
  });
  await test("file and directory modes are copied once per directory", async () => {
    const root = repository("modes"), destination = clone(root, "modes-frozen");
    fs.writeFileSync(path.join(root, "dir/second.txt"), "second");
    fs.chmodSync(path.join(root, "dir/input.txt"), 0o444);
    const original = fs.chmodSync, directoryCalls = new Map();
    fs.chmodSync = function(filename, mode) {
      if (fs.statSync(filename).isDirectory()) directoryCalls.set(filename, (directoryCalls.get(filename) || 0) + 1);
      return original(filename, mode);
    };
    let result;
    try { result = await captureProject(root, destination); } finally { fs.chmodSync = original; }
    assert.equal(result.state, "succeeded");
    for (const count of directoryCalls.values()) assert.equal(count, 1);
    for (const relative of ["", "dir", "dir/input.txt", "dir/second.txt"]) {
      assert.equal(fs.statSync(path.join(destination, relative)).mode & 0o777, fs.statSync(path.join(root, relative)).mode & 0o777);
    }
    fs.chmodSync(path.join(root, "dir/input.txt"), 0o666);
    fs.chmodSync(path.join(destination, "dir/input.txt"), 0o666);
  });
  await test("physical root resolves once per parent inspection", async () => {
    const root = repository("parents");
    fs.mkdirSync(path.join(root, "a/b/c"), { recursive: true });
    const original = fs.realpathSync.native;
    assert.equal(original(root), fs.realpathSync(root));
    assert.equal(original(path.join(root, "a/b/c")), fs.realpathSync(path.join(root, "a/b/c")));
    let rootCalls = 0;
    fs.realpathSync.native = function(filename, ...args) { if (filename === root) rootCalls++; return original(filename, ...args); };
    try { assert.equal(parents(root, path.join(root, "a/b/c/file")).length, 4); } finally { fs.realpathSync.native = original; }
    // One root baseline and the root's own mandatory parent realpath check.
    assert.equal(rootCalls, 2);
  });
  await test("source change before open-stat and during streaming fails closed", async () => {
    for (const boundary of [1, 2]) {
      const root = repository(`source-change-${boundary}`), destination = clone(root, `source-change-${boundary}-frozen`);
      const target = path.join(root, "dir/input.txt");
      await interceptOpen(target, async call => { if (call === boundary) fs.appendFileSync(target, "changed"); },
        () => assert.rejects(captureProject(root, destination, { concurrency: 1 }), /Selected source changed/));
    }
  });
  await test("source parent identity replacement fails closed", async () => {
    const root = repository("source-parent"), destination = clone(root, "source-parent-frozen");
    const target = path.join(root, "dir/input.txt");
    await interceptOpen(target, async (call, handle) => {
      if (call === 2) {
        // Windows denies renaming a directory with this open handle. Complete its
        // actual after-read stat/close before exposing the replacement to path guards.
        const after = fs.statSync(target);
        await handle.close();
        fs.renameSync(path.join(root, "dir"), path.join(root, "old-dir"));
        fs.mkdirSync(path.join(root, "dir"));
        fs.renameSync(path.join(root, "old-dir/input.txt"), target);
        return after;
      }
    }, () => assert.rejects(captureProject(root, destination, { concurrency: 1 }), /Selected source changed/));
  });
  await test("destination parent replacement fails closed", async () => {
    const root = repository("destination-parent"), destination = clone(root, "destination-parent-frozen");
    await interceptOpen(path.join(root, "dir/input.txt"), async call => {
      if (call === 2) {
        fs.renameSync(path.join(destination, "dir"), path.join(destination, "old-dir"));
        fs.mkdirSync(path.join(destination, "dir"));
      }
    }, () => assert.rejects(captureProject(root, destination, { concurrency: 1 }), /Frozen parent changed/));
  });
  await test("source junction and destination junction escape are rejected", async () => {
    const outside = repository("outside");
    const root = repository("source-link"), destination = clone(root, "source-link-frozen");
    fs.renameSync(path.join(root, "dir"), path.join(root, "original-dir"));
    fs.symlinkSync(path.join(outside, "dir"), path.join(root, "dir"), "junction");
    await assert.rejects(captureProject(root, destination), /link\/junction/);
    const root2 = repository("destination-link"), destination2 = clone(root2, "destination-link-frozen");
    fs.mkdirSync(path.join(root2, "dir/deep"));
    fs.writeFileSync(path.join(root2, "dir/deep/new.txt"), "must not escape");
    fs.symlinkSync(path.join(outside, "dir"), path.join(destination2, "dir"), "junction");
    await assert.rejects(captureProject(root2, destination2, { concurrency: 1 }), /Frozen parent is a link/);
    assert.equal(fs.existsSync(path.join(outside, "dir/deep")), false);
    assert.equal(fs.readFileSync(path.join(outside, "dir/input.txt"), "utf8"), "alpha\n");
  });
  await test("existing destination files preserve exclusive-create behavior", async () => {
    const root = repository("exclusive"), destination = clone(root, "exclusive-frozen");
    fs.writeFileSync(path.join(destination, ".gitignore"), "existing");
    await assert.rejects(captureProject(root, destination, { concurrency: 1 }), /EEXIST/);
    assert.equal(fs.readFileSync(path.join(destination, ".gitignore"), "utf8"), "existing");
  });
  await test("final frozen hash rejects destination byte mutation", async () => {
    const root = repository("final-hash"), destination = clone(root, "final-hash-frozen");
    const original = fs.chmodSync, target = path.join(destination, "dir/input.txt");
    fs.chmodSync = function(filename, mode) {
      const result = original(filename, mode);
      if (filename === target) fs.appendFileSync(target, "changed frozen bytes");
      return result;
    };
    try { await assert.rejects(captureProject(root, destination), /Frozen project aggregate differs/); }
    finally { fs.chmodSync = original; }
  });
  await test("syntax-invalid selected files remain exact bytes; helper syntax and CLI failures", async () => {
    const root = repository("syntax"), destination = clone(root, "syntax-frozen");
    fs.writeFileSync(path.join(root, "invalid.cjs"), "function { invalid syntax\n");
    const invalid = spawnSync(process.execPath, ["--check", path.join(root, "invalid.cjs")], { encoding: "utf8" });
    assert.notEqual(invalid.status, 0);
    await captureProject(root, destination);
    assert.deepEqual(fs.readFileSync(path.join(root, "invalid.cjs")), fs.readFileSync(path.join(destination, "invalid.cjs")));
    for (const file of ["capture-project-inputs.cjs", "test-capture-project-inputs.cjs"]) {
      const checked = spawnSync(process.execPath, ["--check", path.join(__dirname, file)], { encoding: "utf8" });
      assert.equal(checked.status, 0, checked.stderr);
    }
    await assert.rejects(captureProject(root, destination, { concurrency: 0 }), /Invalid capture concurrency/);
    for (const threshold of [-1, 0.5, 1048577, NaN]) {
      await assert.rejects(captureProject(root, destination, { smallFileMaxBytes: threshold }), /Invalid capture small-file threshold/);
    }
    await assert.rejects(captureProject(root, path.join(root, "bad")), /independent artifact root/);
    const cli = spawnSync(process.execPath, [path.join(__dirname, "capture-project-inputs.cjs")], { encoding: "utf8" });
    assert.notEqual(cli.status, 0);
    assert.equal(cli.stdout, "");
  });
  }
  await test("mixed buffered and streamed files preserve identical selected bytes", async () => {
    const root = repository("mixed"), destination = clone(root, "mixed-frozen");
    fs.writeFileSync(path.join(root, "boundary.bin"), Buffer.alloc(128 * 1024, 0xa5));
    fs.writeFileSync(path.join(root, "large.bin"), Buffer.alloc(128 * 1024 + 1, 0x5a));
    fs.writeFileSync(path.join(root, "empty.bin"), "");
    const result = await capture(root, destination);
    assert.equal(result.copyIo.streamedFileCount, 1);
    assert.equal(result.copyIo.bufferedFileCount, result.fileCount - 1);
    assert.equal(result.sha256, (await snapshotProject(root)).sha256);
    console.log(JSON.stringify({ mixedCopyPhasesMs: result.phasesMs, copyIo: result.copyIo }));
  });
  console.log(JSON.stringify({ passed, failed: 0, platform: process.platform, arch: process.arch, node: process.version, fixtures: fixtureRoot }));
}
main().catch(error => { console.error(error.stack); console.error(JSON.stringify({ passed, failed: 1, fixtures: fixtureRoot })); process.exitCode = 1; });
