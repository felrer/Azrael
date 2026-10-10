"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { platformIdentity } = require("./platform-runtime.cjs");
const { configureEnvironment, readBundle } = require("./provider-accounts-host.cjs");

const REVISION = "9f7397ed1582d95c6c1fcf4ae9951213b3fa2d19";
const sha256 = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-provider-accounts-"));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const release = path.join(root, "release");
  const helper = path.join(release, "providers", "opencodex", "helper.ts");
  const inferenceHelper = path.join(release, "providers", "opencodex", "inference-helper.ts");
  const bun = path.join(release, "providers", "opencodex", "runtime", "bun.exe");
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  fs.mkdirSync(path.dirname(bun), { recursive: true });
  fs.writeFileSync(helper, "export const fixture = true;\n");
  fs.writeFileSync(inferenceHelper, "export const inferenceFixture = true;\n");
  fs.writeFileSync(bun, "synthetic bun\n");
  fs.chmodSync(bun, 0o755);
  const manifestPath = path.join(release, "opencodex-accounts-build.json");
  const writeManifest = (overrides = {}) => fs.writeFileSync(manifestPath, JSON.stringify({
    platform: platformIdentity(),
    schema: 1,
    upstreamRevision: REVISION,
    helper: "providers/opencodex/helper.ts",
    bun: { path: "providers/opencodex/runtime/bun.exe", version: "1.4.2", sha256: sha256(bun) },
    files: {
      "providers/opencodex/helper.ts": sha256(helper),
      "providers/opencodex/runtime/bun.exe": sha256(bun),
    },
    ...overrides,
  }));
  writeManifest();
  const writeInferenceManifest = (overrides = {}) => writeManifest({
    schema: 2,
    inferenceHelper: "providers/opencodex/inference-helper.ts",
    files: {
      "providers/opencodex/helper.ts": sha256(helper),
      "providers/opencodex/inference-helper.ts": sha256(inferenceHelper),
      "providers/opencodex/runtime/bun.exe": sha256(bun),
    },
    ...overrides,
  });
  return { root, release, helper, inferenceHelper, bun, manifestPath, writeManifest, writeInferenceManifest };
}

test("provider bundle rejects mismatched platform before executable validation", t => {
  const value = fixture(t);
  for (const field of ["os", "arch", "target"]) {
    value.writeManifest({ platform: { ...platformIdentity(), [field]: "other" } });
    assert.throws(() => readBundle(value.release, true), /platform does not match/);
  }
});

test("Unix provider executes Bun and keeps helper scripts as readable files", t => {
  const value = fixture(t);
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const arch = Object.getOwnPropertyDescriptor(process, "arch");
  t.mock.method(process.report, "getReport", () => ({ header: { glibcVersionRuntime: "2.36" } }));
  Object.defineProperty(process, "platform", { ...descriptor, value: "linux" });
  Object.defineProperty(process, "arch", { ...arch, value: "x64" });
  try {
    value.writeManifest();
    const calls = [];
    t.mock.method(fs, "accessSync", file => { calls.push(file); });
    readBundle(value.release, true);
    assert.deepEqual(calls, [fs.realpathSync.native(value.bun)]);
    t.mock.method(fs, "accessSync", () => { throw new Error("execute denied"); });
    assert.throws(() => readBundle(value.release, true), /execute denied/);
    value.writeManifest({ platform: undefined });
    assert.throws(() => readBundle(value.release, true), /no platform identity/);
  } finally {
    Object.defineProperty(process, "platform", descriptor);
    Object.defineProperty(process, "arch", arch);
  }
});

test("verified bundle configures only the private host environment", (t) => {
  const value = fixture(t);
  const home = path.join(value.root, "codex-home");
  const env = {
    AZRAEL_PROVIDER_ACCOUNTS_HELPER: "ambient helper",
    AZRAEL_PROVIDER_INFERENCE_HELPER: "ambient inference helper",
    AZRAEL_PROVIDER_BUN: "ambient bun",
    OPENCODEX_HOME: "ambient home",
    CODEX_HOME: home,
    KEEP_ME: "ordinary",
  };
  configureEnvironment(env, { codexHome: home, providerAccounts: { releaseDirectory: value.release } });
  assert.equal(env.AZRAEL_PROVIDER_ACCOUNTS_HELPER, value.helper);
  assert.equal(Object.hasOwn(env, "AZRAEL_PROVIDER_INFERENCE_HELPER"), false);
  assert.equal(readBundle(value.release, true).inferenceHelper, undefined);
  assert.equal(env.AZRAEL_PROVIDER_BUN, value.bun);
  assert.equal(env.OPENCODEX_HOME, path.join(home, "azrael", "providers", "opencodex"));
  assert.equal(env.CODEX_HOME, home);
  assert.equal(env.KEEP_ME, "ordinary");
});

test("schema 2 configures verified inference only in the supplied host environment", (t) => {
  const value = fixture(t);
  value.writeInferenceManifest();
  const caller = { ...process.env };
  const env = { ...caller, AZRAEL_PROVIDER_INFERENCE_HELPER: "ambient inference" };
  const home = path.join(value.root, "state");
  const bundle = readBundle(value.release, true);
  assert.equal(bundle.inferenceHelper, value.inferenceHelper);
  configureEnvironment(env, { codexHome: home, providerAccounts: { releaseDirectory: value.release } });
  assert.equal(env.AZRAEL_PROVIDER_INFERENCE_HELPER, value.inferenceHelper);
  assert.equal(env.AZRAEL_PROVIDER_ACCOUNTS_HELPER, value.helper);
  assert.equal(env.AZRAEL_PROVIDER_BUN, value.bun);
  assert.equal(env.OPENCODEX_HOME, path.join(home, "azrael", "providers", "opencodex"));
  assert.deepEqual({ ...process.env }, caller);
});

test("schema 2 rejects missing inference declaration, hash, or file", async (t) => {
  await t.test("helper declaration", (t) => {
    const value = fixture(t);
    value.writeInferenceManifest({ inferenceHelper: undefined });
    assert.throws(() => readBundle(value.release, true), /inference bundle is missing/);
  });
  await t.test("helper hash", (t) => {
    const value = fixture(t);
    value.writeInferenceManifest({ files: {
      "providers/opencodex/helper.ts": sha256(value.helper),
      "providers/opencodex/runtime/bun.exe": sha256(value.bun),
    } });
    assert.throws(() => readBundle(value.release, true), /inference bundle is missing/);
  });
  await t.test("helper file", (t) => {
    const value = fixture(t);
    value.writeInferenceManifest();
    fs.rmSync(value.inferenceHelper);
    assert.throws(() => readBundle(value.release, true), /integrity check failed/);
  });
});

test("tampered inference helper fails closed without publishing provider paths", (t) => {
  const value = fixture(t);
  value.writeInferenceManifest();
  fs.appendFileSync(value.inferenceHelper, "tamper");
  const caller = { ...process.env };
  const env = {
    AZRAEL_PROVIDER_ACCOUNTS_HELPER: "ambient",
    AZRAEL_PROVIDER_INFERENCE_HELPER: "ambient",
    AZRAEL_PROVIDER_BUN: "ambient",
    OPENCODEX_HOME: "ambient",
    KEEP_ME: "yes",
  };
  assert.throws(() => configureEnvironment(env, { codexHome: path.join(value.root, "state"), providerAccounts: { releaseDirectory: value.release } }), /integrity check failed/);
  assert.deepEqual(env, { KEEP_ME: "yes" });
  assert.deepEqual({ ...process.env }, caller);
});

test("legacy release clears ambient provider selection", (t) => {
  const value = fixture(t);
  fs.rmSync(value.manifestPath);
  assert.equal(readBundle(value.release), undefined);
  const env = { AZRAEL_PROVIDER_ACCOUNTS_HELPER: "ambient", AZRAEL_PROVIDER_INFERENCE_HELPER: "ambient", AZRAEL_PROVIDER_BUN: "ambient", OPENCODEX_HOME: "ambient", KEEP_ME: "yes" };
  configureEnvironment(env, { codexHome: path.join(value.root, "state") });
  assert.deepEqual(env, { KEEP_ME: "yes" });
});

test("configured missing manifest fails closed", (t) => {
  const value = fixture(t);
  fs.rmSync(value.manifestPath);
  assert.throws(() => configureEnvironment({}, { codexHome: path.join(value.root, "state"), providerAccounts: { releaseDirectory: value.release } }), /bundle is missing/);
});

test("tampered helper and Bun fail closed", async (t) => {
  await t.test("helper", (t) => {
    const value = fixture(t);
    fs.appendFileSync(value.helper, "tamper");
    assert.throws(() => readBundle(value.release, true), /integrity check failed/);
  });
  await t.test("bun", (t) => {
    const value = fixture(t);
    fs.appendFileSync(value.bun, "tamper");
    assert.throws(() => readBundle(value.release, true), /integrity check failed/);
  });
});

test("physical junction escape is rejected", (t) => {
  const value = fixture(t);
  const outside = path.join(value.root, "outside");
  fs.mkdirSync(outside);
  const escaped = path.join(outside, "helper.ts");
  fs.writeFileSync(escaped, "outside\n");
  const linked = path.join(value.release, "linked");
  fs.symlinkSync(outside, linked, "junction");
  value.writeManifest({
    helper: "linked/helper.ts",
    files: {
      "linked/helper.ts": sha256(escaped),
      "providers/opencodex/runtime/bun.exe": sha256(value.bun),
    },
  });
  assert.throws(() => readBundle(value.release, true), /integrity check failed/);
});
