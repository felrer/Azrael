"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { resolvePlatform, validateRuntimePlatform, platformIdentity, executableName,
  engineBinaryNames, canonicalPath, defaultReleasesRoot } = require("./platform-runtime.cjs");

const hosts = [
  { platform: "win32", arch: "x64" },
  { platform: "linux", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
];

test("platform selection rejects unsupported OS and CPU combinations", () => {
  for (const [platform, arch] of [["freebsd", "x64"], ["win32", "arm64"], ["linux", "arm64"], ["darwin", "x64"]]) {
    assert.throws(() => resolvePlatform(platform, arch), /Unsupported Azrael platform/);
  }
});

test("legacy runtime identity is accepted only for Windows x64", () => {
  assert.equal(validateRuntimePlatform(undefined, hosts[0]).target, "x86_64-pc-windows-msvc");
  for (const host of hosts.slice(1)) {
    assert.throws(() => validateRuntimePlatform(undefined, host), /no platform identity/);
  }
});

test("explicit runtime authorization rejects OS, CPU, target and Linux ABI mismatch", () => {
  for (const host of hosts) {
    const identity = platformIdentity(resolvePlatform(host.platform, host.arch));
    assert.equal(validateRuntimePlatform(identity, host).os, host.platform);
    for (const field of ["os", "arch", "target"]) {
      assert.throws(() => validateRuntimePlatform({ ...identity, [field]: "other" }, host), /platform does not match/);
    }
    for (const invalid of [null, [], "linux"]) {
      assert.throws(() => validateRuntimePlatform(invalid, host), /platform does not match/);
    }
    if (host.platform === "linux") {
      for (const libc of [undefined, "musl"]) {
        assert.throws(() => validateRuntimePlatform({ ...identity, libc }, host), /platform does not match/);
      }
    }
  }
});

test("actual Linux runtime refuses musl while accepting a glibc report", t => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...descriptor, value: "linux" });
  try {
    const host = hosts[1];
    const identity = platformIdentity(resolvePlatform(host.platform, host.arch));
    const report = t.mock.method(process.report, "getReport", () => ({ header: {} }));
    assert.throws(() => validateRuntimePlatform(identity, host), /requires GNU\/glibc/);
    report.mock.mockImplementation(() => ({ header: { glibcVersionRuntime: "2.36" } }));
    assert.equal(validateRuntimePlatform(identity, host).libc, "glibc");
  } finally { Object.defineProperty(process, "platform", descriptor); }
});

test("binary names use platform executable suffixes", () => {
  for (const host of hosts) {
    const descriptor = resolvePlatform(host.platform, host.arch);
    const suffix = host.platform === "win32" ? ".exe" : "";
    assert.equal(executableName("node", descriptor), "node" + suffix);
    assert.deepEqual(engineBinaryNames(descriptor), ["codex", "azrael-bridge", "codex-code-mode-host"].map(name => name + suffix));
    assert.throws(() => executableName("../node", descriptor), /Invalid Azrael executable name/);
  }
});

test("state identity preserves Unix case and folds Windows path aliases", () => {
  for (const platform of ["linux", "darwin"]) {
    assert.notEqual(canonicalPath("/users/A/.codex", platform), canonicalPath("/users/A/.CODEX", platform));
    assert.equal(canonicalPath("/users/A/../A/.codex", platform), "/users/A/.codex");
  }
  assert.equal(canonicalPath("C:\\Users\\A\\.CODEX", "win32"), canonicalPath("c:\\users\\a\\.codex", "win32"));
});

test("release roots follow native Windows, macOS and XDG conventions", () => {
  assert.equal(defaultReleasesRoot({ LOCALAPPDATA: "C:\\Users\\A\\AppData\\Local" }, "win32", "C:\\Users\\A"), "C:\\Users\\A\\AppData\\Local\\azrael-ex\\releases");
  assert.throws(() => defaultReleasesRoot({}, "win32", "C:\\Users\\A"), /LOCALAPPDATA is required/);
  assert.equal(defaultReleasesRoot({}, "darwin", "/Users/a"), "/Users/a/Library/Application Support/Azrael/releases");
  assert.equal(defaultReleasesRoot({}, "linux", "/home/a"), "/home/a/.local/share/azrael-ex/releases");
  assert.equal(defaultReleasesRoot({ XDG_DATA_HOME: "/custom/data" }, "linux", "/home/a"), "/custom/data/azrael-ex/releases");
  assert.throws(() => defaultReleasesRoot({ XDG_DATA_HOME: "relative/data" }, "linux", "/home/a"), /XDG_DATA_HOME must be absolute/);
  for (const platform of ["linux", "darwin", "win32"]) {
    assert.throws(() => defaultReleasesRoot({ AZRAEL_RELEASES_ROOT: "relative/releases" }, platform), /must be absolute/);
    const root = platform === "win32" ? "D:\\Azrael\\releases" : "/custom/releases";
    assert.equal(defaultReleasesRoot({ AZRAEL_RELEASES_ROOT: root }, platform), root);
  }
});
