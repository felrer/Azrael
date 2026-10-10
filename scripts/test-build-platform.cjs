"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { buildPlan, parse, validateToolIdentity, validateExecutableHeader, assertEngineVersion, validateV8Inputs, linuxPtyBuild } = require("./build-platform.cjs");
const { freezeProject, hash, inventoryTree, copyTree } = require("./freeze-platform-inputs.cjs");
test("only Linux rebuilds node-pty with frozen headers and the selected npm node-gyp", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-pty-input-"));
  try {
    for (const osName of ["win32", "darwin"]) assert.equal(linuxPtyBuild({ os: osName }, root, root), null);
    assert.throws(() => linuxPtyBuild({ os: "linux" }, root, root), /frozen selected Node headers/);
    for (const relative of ["npm/node_modules/node-gyp/bin/node-gyp.js", "node-headers/include/node/node.h", "node-headers/include/node/node_version.h"]) {
      const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "frozen input");
    }
    assert.deepEqual(linuxPtyBuild({ os: "linux" }, root, root), { args: [path.join(root, "npm/node_modules/node-gyp/bin/node-gyp.js"), "rebuild", "--nodedir=" + path.join(root, "node-headers")], cwd: path.join(root, "node_modules/node-pty") });
  } finally { fs.rmSync(root, { recursive: true }); }
});
test("reviewed vendor mapping is independent of traversal order and rejects source or manifest tampering", () => {
  const { vendorSourceManifest, validateVendorEntries } = require("./provider-vendor-manifest.cjs");
  const provider = path.join(__dirname, "../providers/opencodex");
  const manifest = JSON.parse(fs.readFileSync(path.join(provider, "vendor-source-manifest.json"), "utf8"));
  assert.equal(vendorSourceManifest(path.join(provider, "vendor/src")), manifest.reviewedWindowsManifestSha256);
  assert.equal(validateVendorEntries([...manifest.files].reverse(), manifest), manifest.reviewedWindowsManifestSha256);
  const changed = manifest.files.map(entry => ({ ...entry })); changed[0].sha256 = "0".repeat(64);
  assert.throws(() => validateVendorEntries(changed, manifest), /sources differ/);
  assert.throws(() => validateVendorEntries(manifest.files.slice(1), manifest), /sources differ/);
  assert.throws(() => validateVendorEntries(manifest.files, { ...manifest, files: changed }), /canonical identity/);
  assert.throws(() => validateVendorEntries(manifest.files, { ...manifest, reviewedWindowsManifestSha256: "0".repeat(64) }), /canonical identity/);
});
test("source-built code mode rejects unselected V8 overrides before filesystem or Cargo work", () => {
  for (const key of ["RUSTY_V8_ARCHIVE", "RUSTY_V8_MIRROR", "RUSTY_V8_SRC_BINDING_PATH"]) {
    const environment = { V8_FROM_SOURCE: "1", [key]: "/unselected/v8-input" };
    assert.throws(() => buildPlan({}, "darwin", "arm64", environment), error => /unselected external V8 inputs/.test(error.message) && error.message.includes(key));
    assert.doesNotThrow(() => validateV8Inputs({ "code-mode-host": "/selected/native-host" }, environment));
  }
  assert.doesNotThrow(() => validateV8Inputs({}, { V8_FROM_SOURCE: "1", V8_FORCE_DEBUG: "true", GN_ARGS: "is_debug=false" }));
  assert.doesNotThrow(() => validateV8Inputs({}, { RUSTY_V8_ARCHIVE: "", RUSTY_V8_MIRROR: "", RUSTY_V8_SRC_BINDING_PATH: "" }));
});
test("engine version binds frozen Cargo declaration to the reported compiled version", () => {
  assert.equal(assertEngineVersion("0.162.0", "codex-cli 0.162.0"), "0.162.0");
  assert.equal(assertEngineVersion("0.162.0-alpha.1", "codex-cli 0.162.0-alpha.1\n"), "0.162.0-alpha.1");
  assert.throws(() => assertEngineVersion("0.162.0", "codex-cli 0.159.3"), /does not match/);
  assert.throws(() => assertEngineVersion(undefined, "codex-cli 0.162.0"), /no valid engine version/);
  assert.throws(() => assertEngineVersion("0.162.0", "diagnostic without a version"), /does not match/);
});
test("selected tool identities reject Rosetta and foreign native runtimes", () => {
  const expected = { os: "darwin", arch: "arm64" };
  validateToolIdentity(JSON.stringify(expected), expected, "Selected Node");
  assert.throws(() => validateToolIdentity('{"os":"darwin","arch":"x64"}', expected, "Selected Node"), /does not match/);
  assert.throws(() => validateToolIdentity('{"os":"linux","arch":"arm64"}', expected, "Selected Bun"), /does not match/);
  assert.throws(() => validateToolIdentity("invalid", expected, "Selected Bun"), /valid native platform identity/);
});
test("imported executable headers bind supported native OS and CPU", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-header-"));
  try {
    const elf = Buffer.alloc(64); elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]); elf.writeUInt16LE(2, 16); elf.writeUInt16LE(62, 18); elf.writeUInt32LE(1, 20);
    const macho = Buffer.alloc(64); macho.writeUInt32LE(0xfeedfacf, 0); macho.writeUInt32LE(0x0100000c, 4); macho.writeUInt32LE(2, 12);
    const pe = Buffer.alloc(128); pe.writeUInt16LE(0x5a4d, 0); pe.writeUInt32LE(64, 60); pe.writeUInt32LE(0x00004550, 64); pe.writeUInt16LE(0x8664, 68); pe.writeUInt16LE(0x20b, 88);
    const fixtures = [["linux", "x64", elf], ["darwin", "arm64", macho], ["win32", "x64", pe]];
    for (const [osName, arch, bytes] of fixtures) {
      const file = path.join(root, osName); fs.writeFileSync(file, bytes);
      validateExecutableHeader(file, { os: osName, arch });
      for (const [otherOs, otherArch] of fixtures.filter(([candidate]) => candidate !== osName)) assert.throws(() => validateExecutableHeader(file, { os: otherOs, arch: otherArch }), /does not match/);
    }
    macho.writeUInt32LE(0x01000007, 4); fs.writeFileSync(path.join(root, "darwin"), macho);
    assert.throws(() => validateExecutableHeader(path.join(root, "darwin"), { os: "darwin", arch: "arm64" }), /does not match/);
    elf.writeUInt16LE(183, 18); fs.writeFileSync(path.join(root, "linux"), elf);
    assert.throws(() => validateExecutableHeader(path.join(root, "linux"), { os: "linux", arch: "x64" }), /does not match/);
    pe.writeUInt16LE(0xaa64, 68); fs.writeFileSync(path.join(root, "win32"), pe);
    assert.throws(() => validateExecutableHeader(path.join(root, "win32"), { os: "win32", arch: "x64" }), /does not match/);
    const universal = Buffer.alloc(64); universal.writeUInt32BE(0xcafebabe, 0); fs.writeFileSync(path.join(root, "universal"), universal);
    assert.throws(() => validateExecutableHeader(path.join(root, "universal"), { os: "darwin", arch: "arm64" }), /universal/);
    fs.writeFileSync(path.join(root, "truncated"), Buffer.from("MZ"));
    assert.throws(() => validateExecutableHeader(path.join(root, "truncated"), { os: "win32", arch: "x64" }), /truncated/);
  } finally { fs.rmSync(root, { recursive: true }); }
});
test("native target plans never reuse cross-platform executables", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-plan-"));
  try {
    const options = { "project-root": root, "ui-root": root, bun: path.join(root, "bun"), output: path.join(root, "new-release"), "target-directory": root };
    for (const [osName, arch, target, suffix] of [["win32", "x64", "x86_64-pc-windows-msvc", ".exe"], ["linux", "x64", "x86_64-unknown-linux-gnu", ""], ["darwin", "arm64", "aarch64-apple-darwin", ""]]) {
      const plan = buildPlan({ ...options, target }, osName, arch);
      assert.equal(plan.engineReuse, false);
      assert.deepEqual(plan.binaries, ["codex", "azrael-bridge", "codex-code-mode-host"].map(name => name + suffix));
      assert.throws(() => buildPlan({ ...options, target: "foreign-target" }, osName, arch), /Native-only/);
    }
    assert.throws(() => buildPlan(options, "linux", "arm64"), /Unsupported/);
    assert.throws(() => buildPlan({ ...options, output: root }), /new path/);
    assert.throws(() => parse(["--engine-reuse", "yes"]), /Invalid/);
  } finally { fs.rmSync(root, { recursive: true }); }
});
test("safe internal file and directory links survive immutable and working copies", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-links-"));
  try {
    const source = path.join(root, "source"), frozen = path.join(root, "frozen"), working = path.join(root, "working");
    fs.mkdirSync(path.join(source, "lib"), { recursive: true });
    fs.writeFileSync(path.join(source, "lib/tool.js"), "selected bytes");
    fs.mkdirSync(path.join(source, "node_modules/.bin"), { recursive: true });
    fs.mkdirSync(path.join(source, "node_modules/npm/bin"), { recursive: true });
    fs.writeFileSync(path.join(source, "node_modules/npm/bin/npm-cli.js"), "selected npm bytes");
    try {
      fs.symlinkSync("lib/tool.js", path.join(source, "tool.js"), "file");
      fs.symlinkSync("lib", path.join(source, "current"), "dir");
      fs.symlinkSync("../npm/bin/npm-cli.js", path.join(source, "node_modules/.bin/npm"), "file");
    } catch (error) { if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code)) { t.skip("Windows symlink creation requires host privilege"); return; } throw error; }
    copyTree(source, frozen, []); copyTree(frozen, working, []);
    assert.equal(fs.readlinkSync(path.join(working, "tool.js")), fs.readlinkSync(path.join(source, "tool.js")));
    assert.equal(fs.readlinkSync(path.join(working, "current")), fs.readlinkSync(path.join(source, "current")));
    assert.equal(fs.readFileSync(path.join(working, "current/tool.js"), "utf8"), "selected bytes");
    assert.equal(fs.readFileSync(path.join(working, "node_modules/.bin/npm"), "utf8"), "selected npm bytes");
    assert.equal(inventoryTree(source).sha256, inventoryTree(frozen).sha256);
    assert.equal(inventoryTree(frozen).sha256, inventoryTree(working).sha256);
    const before = inventoryTree(frozen).sha256;
    fs.unlinkSync(path.join(frozen, "tool.js")); fs.symlinkSync("current/tool.js", path.join(frozen, "tool.js"), "file");
    assert.notEqual(inventoryTree(frozen).sha256, before, "link identity changes even when target bytes match");
  } finally { fs.rmSync(root, { recursive: true }); }
});
test("links escaping the input root, absolute links and dangling links are rejected", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-unsafe-links-"));
  try {
    const source = path.join(root, "source"); fs.mkdirSync(source); fs.writeFileSync(path.join(root, "outside"), "outside bytes");
    for (const [target, expected] of [["../outside", /escapes/], [path.join(root, "outside"), /escapes/], ["missing", /dangling/]]) {
      const link = path.join(source, "link");
      try { fs.symlinkSync(target, link, "file"); }
      catch (error) { if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code)) { t.skip("Windows symlink creation requires host privilege"); return; } throw error; }
      assert.throws(() => copyTree(source, path.join(root, "copy"), []), expected);
      assert.throws(() => inventoryTree(source), expected);
      fs.unlinkSync(link);
    }
  } finally { fs.rmSync(root, { recursive: true }); }
});
test("Unix executable modes are preserved and permission mutations change input identity", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-modes-"));
  try {
    const source = path.join(root, "source"), frozen = path.join(root, "frozen"); fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "tool"), "#!/bin/sh\nexit 0\n"); fs.chmodSync(path.join(source, "tool"), 0o755);
    copyTree(source, frozen, []);
    assert.equal(fs.statSync(path.join(frozen, "tool")).mode & 0o777, 0o755);
    const before = inventoryTree(frozen).sha256;
    fs.chmodSync(path.join(frozen, "tool"), 0o644);
    assert.notEqual(inventoryTree(frozen).sha256, before);
    const fileMutation = inventoryTree(frozen).sha256; fs.chmodSync(frozen, 0o700);
    assert.notEqual(inventoryTree(frozen).sha256, fileMutation);
  } finally { fs.rmSync(root, { recursive: true }); }
});
test("frozen Git input binds uncommitted bytes and remains stable after live edits", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-freeze-"));
  try {
    const source = path.join(root, "source"), frozen = path.join(root, "frozen"); fs.mkdirSync(source);
    const git = args => { const result = spawnSync("git", ["-C", source, ...args]); assert.equal(result.status, 0, result.stderr.toString()); };
    git(["init", "--quiet"]);
    fs.writeFileSync(path.join(source, "package-lock.json"), "selected uncommitted lock\n");
    fs.mkdirSync(path.join(source, "providers/devin"), { recursive: true });
    fs.writeFileSync(path.join(source, "providers/devin/mapping.mjs"), "export const selected = true;\n");
    const receipt = await freezeProject(source, frozen);
    assert.equal(receipt.fileCount, 2);
    assert.equal(fs.readFileSync(path.join(frozen, "providers/devin/mapping.mjs"), "utf8"), "export const selected = true;\n");
    const before = inventoryTree(frozen).sha256;
    fs.writeFileSync(path.join(source, "package-lock.json"), "later task\n");
    assert.equal(inventoryTree(frozen).sha256, before);
    assert.notEqual(hash(path.join(source, "package-lock.json")), hash(path.join(frozen, "package-lock.json")));
  } finally { fs.rmSync(root, { recursive: true }); }
});
test("nested Git inventories retain project-relative ownership", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-nested-freeze-"));
  try {
    const source = path.join(root, "source"), nested = path.join(source, "nested"), frozen = path.join(root, "frozen");
    fs.mkdirSync(nested, { recursive: true });
    const git = (cwd, args) => { const result = spawnSync("git", ["-C", cwd, ...args]); assert.equal(result.status, 0, result.stderr.toString()); };
    git(source, ["init", "--quiet"]); git(nested, ["init", "--quiet"]);
    fs.writeFileSync(path.join(nested, "tracked.txt"), "nested source bytes");
    git(nested, ["add", "tracked.txt"]);
    git(nested, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "nested fixture"]);
    git(source, ["add", "nested"]);
    fs.writeFileSync(path.join(nested, "uncommitted.txt"), "selected nested uncommitted bytes");
    const receipt = await freezeProject(source, frozen);
    assert.equal(receipt.inventory.length, 2);
    assert.equal(fs.readFileSync(path.join(frozen, "nested/tracked.txt"), "utf8"), "nested source bytes");
    assert.equal(fs.readFileSync(path.join(frozen, "nested/uncommitted.txt"), "utf8"), "selected nested uncommitted bytes");
    assert.equal(fs.existsSync(path.join(frozen, "tracked.txt")), false);
  } finally { fs.rmSync(root, { recursive: true }); }
});
