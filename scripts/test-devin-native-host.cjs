"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { configureEnvironment, readBundle } = require("./devin-native-host.cjs");

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function environmentDigest() {
  return createHash("sha256")
    .update(JSON.stringify(Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right))))
    .digest("hex");
}

function syntheticBundle(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-devin-native-host-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const releaseDirectory = path.join(root, "release");
  const helper = path.join(releaseDirectory, "providers", "devin", "helper.mjs");
  const node = path.join(root, "node.exe");
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  fs.writeFileSync(helper, "export const fixture = true;\n");
  fs.writeFileSync(node, "synthetic node runtime\n");
  const manifestPath = path.join(releaseDirectory, "devin-native-build.json");
  const writeManifest = (overrides = {}) => {
    const manifest = {
      schema: 1,
      model: "devin/swe-2-high",
      files: { "providers/devin/helper.mjs": sha256(helper) },
      node: { path: node, sha256: sha256(node) },
      ...overrides,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    return manifest;
  };
  writeManifest();
  return { root, releaseDirectory, helper, node, manifestPath, writeManifest };
}

test("readBundle accepts a verified synthetic release", (t) => {
  const bundle = syntheticBundle(t);

  assert.deepEqual(readBundle(bundle.releaseDirectory, true), {
    releaseDirectory: fs.realpathSync.native(bundle.releaseDirectory),
    helper: bundle.helper,
    node: bundle.node,
  });
});

test("legacy host clears ambient native selection without changing the caller process", () => {
  const before = {
    helper: process.env.AZRAEL_DEVIN_NATIVE_HELPER,
    node: process.env.AZRAEL_DEVIN_NODE,
    temp: process.env.TEMP,
    tmp: process.env.TMP,
  };
  const env = {
    AZRAEL_DEVIN_NATIVE_HELPER: "C:\\ambient\\helper.mjs",
    AZRAEL_DEVIN_NODE: "C:\\ambient\\node.exe",
    TEMP: "C:\\ambient\\temp",
    TMP: "C:\\ambient\\tmp",
    KEEP_ME: "unchanged",
  };

  configureEnvironment(env, { codexHome: "C:\\synthetic-state" });

  assert.equal("AZRAEL_DEVIN_NATIVE_HELPER" in env, false);
  assert.equal("AZRAEL_DEVIN_NODE" in env, false);
  assert.equal(env.TEMP, "C:\\ambient\\temp");
  assert.equal(env.TMP, "C:\\ambient\\tmp");
  assert.equal(env.KEEP_ME, "unchanged");
  assert.deepEqual({
    helper: process.env.AZRAEL_DEVIN_NATIVE_HELPER,
    node: process.env.AZRAEL_DEVIN_NODE,
    temp: process.env.TEMP,
    tmp: process.env.TMP,
  }, before);
});

test("ordinary runtime loads its native host dependency with a private environment", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-ordinary-runtime-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimePath = path.join(root, "ordinary-runtime.cjs");
  const nativeHostPath = path.join(root, "devin-native-host.cjs");
  const engine = path.join(root, "codex.exe");
  const bridge = path.join(root, "azrael-bridge.exe");
  const state = path.join(root, "state");
  fs.copyFileSync(path.join(__dirname, "ordinary-runtime.cjs"), runtimePath);
  fs.copyFileSync(path.join(__dirname, "devin-native-host.cjs"), nativeHostPath);
  fs.copyFileSync(path.join(__dirname, "provider-accounts-host.cjs"), path.join(root, "provider-accounts-host.cjs"));
  fs.writeFileSync(engine, "synthetic engine\n");
  fs.writeFileSync(bridge, "synthetic bridge\n");
  fs.writeFileSync(path.join(root, "azrael-runtime.json"), JSON.stringify({
    schema: 1,
    engine,
    bridge,
    codexHome: state,
    engineVersion: "0.159.3",
  }));
  const originalHelper = process.env.AZRAEL_DEVIN_NATIVE_HELPER;
  const originalNode = process.env.AZRAEL_DEVIN_NODE;
  process.env.AZRAEL_DEVIN_NATIVE_HELPER = "C:\\ambient\\helper.mjs";
  process.env.AZRAEL_DEVIN_NODE = "C:\\ambient\\node.exe";
  t.after(() => {
    if (originalHelper === undefined) delete process.env.AZRAEL_DEVIN_NATIVE_HELPER;
    else process.env.AZRAEL_DEVIN_NATIVE_HELPER = originalHelper;
    if (originalNode === undefined) delete process.env.AZRAEL_DEVIN_NODE;
    else process.env.AZRAEL_DEVIN_NODE = originalNode;
    delete require.cache[runtimePath];
  });
  const globalBefore = environmentDigest();

  const loaded = require(runtimePath);

  assert.equal(loaded.runtime.codexHome, state);
  assert.equal(loaded.process.env.CODEX_HOME, state);
  assert.equal("AZRAEL_DEVIN_NATIVE_HELPER" in loaded.process.env, false);
  assert.equal("AZRAEL_DEVIN_NODE" in loaded.process.env, false);
  assert.equal(loaded.process.env.AZRAEL_EX_PLAINTEXT_AGENTS, "1");
  assert.equal(environmentDigest(), globalBefore);
});

test("configured host activates only the verified helper, Node and isolated temp", (t) => {
  const bundle = syntheticBundle(t);
  const state = path.join(bundle.root, "state");
  const env = {
    AZRAEL_DEVIN_NATIVE_HELPER: "ambient helper",
    AZRAEL_DEVIN_NODE: "ambient node",
    WINDSURF_API_KEY: "ambient credential",
    KEEP_ME: "unchanged",
  };
  const globalBefore = environmentDigest();

  configureEnvironment(env, {
    codexHome: state,
    devinNative: { releaseDirectory: bundle.releaseDirectory },
  });

  const temporary = path.join(state, "tmp", "devin-native");
  assert.equal(env.AZRAEL_DEVIN_NATIVE_HELPER, bundle.helper);
  assert.equal(env.AZRAEL_DEVIN_NODE, bundle.node);
  assert.equal(env.RUST_LOG, "error,devin_native_progress=info");
  assert.equal(env.TMP, temporary);
  assert.equal(env.TEMP, temporary);
  assert.equal(fs.statSync(temporary).isDirectory(), true);
  assert.equal("WINDSURF_API_KEY" in env, false);
  assert.equal(env.KEEP_ME, "unchanged");
  assert.equal(environmentDigest(), globalBefore);
});

test("native diagnostics preserve an explicit log filter", (t) => {
  const bundle = syntheticBundle(t);
  const env = { RUST_LOG: "warn" };
  configureEnvironment(env, {
    codexHome: path.join(bundle.root, "state"),
    devinNative: { releaseDirectory: bundle.releaseDirectory },
  });
  assert.equal(env.RUST_LOG, "warn");
});

test("missing manifest is optional only for release discovery", (t) => {
  const bundle = syntheticBundle(t);
  fs.rmSync(bundle.manifestPath);

  assert.equal(readBundle(bundle.releaseDirectory), undefined);
  assert.throws(
    () => configureEnvironment({}, {
      codexHome: path.join(bundle.root, "state"),
      devinNative: { releaseDirectory: bundle.releaseDirectory },
    }),
  );
});

test("invalid manifest identity fails closed", (t) => {
  const bundle = syntheticBundle(t);
  bundle.writeManifest({ model: "devin/other-model" });

  assert.throws(
    () => readBundle(bundle.releaseDirectory, true),
    /Invalid Devin native bundle/,
  );
});

test("missing or tampered helper fails closed", async (t) => {
  await t.test("missing helper", (t) => {
    const bundle = syntheticBundle(t);
    fs.rmSync(bundle.helper);
    assert.throws(() => readBundle(bundle.releaseDirectory, true));
  });
  await t.test("tampered helper", (t) => {
    const bundle = syntheticBundle(t);
    fs.appendFileSync(bundle.helper, "tampered\n");
    assert.throws(() => readBundle(bundle.releaseDirectory, true), /integrity check failed/);
  });
});

test("missing or tampered Node fails closed", async (t) => {
  await t.test("missing Node", (t) => {
    const bundle = syntheticBundle(t);
    fs.rmSync(bundle.node);
    assert.throws(() => readBundle(bundle.releaseDirectory, true));
  });
  await t.test("tampered Node", (t) => {
    const bundle = syntheticBundle(t);
    fs.appendFileSync(bundle.node, "tampered\n");
    assert.throws(() => readBundle(bundle.releaseDirectory, true), /Node runtime changed/);
  });
});

test("manifest file paths cannot escape the release directory", (t) => {
  const bundle = syntheticBundle(t);
  const outside = path.join(bundle.root, "outside.txt");
  fs.writeFileSync(outside, "outside\n");
  const original = JSON.parse(fs.readFileSync(bundle.manifestPath, "utf8"));
  bundle.writeManifest({
    files: {
      ...original.files,
      "../outside.txt": sha256(outside),
    },
  });

  assert.throws(() => readBundle(bundle.releaseDirectory, true), /integrity check failed/);
});

test("manifest files cannot escape through a directory link", (t) => {
  const bundle = syntheticBundle(t);
  const providers = path.join(bundle.releaseDirectory, "providers");
  const outsideProviders = path.join(bundle.root, "outside-providers");
  const outsideHelper = path.join(outsideProviders, "devin", "helper.mjs");
  fs.mkdirSync(path.dirname(outsideHelper), { recursive: true });
  fs.writeFileSync(outsideHelper, "export const outside = true;\n");
  fs.rmSync(providers, { recursive: true, force: true });
  fs.symlinkSync(outsideProviders, providers, process.platform === "win32" ? "junction" : "dir");
  bundle.writeManifest({
    files: { "providers/devin/helper.mjs": sha256(outsideHelper) },
  });

  assert.throws(() => readBundle(bundle.releaseDirectory, true), /integrity check failed/);
});

test("invalid configured bundle does not fall back to ambient native selection", (t) => {
  const bundle = syntheticBundle(t);
  fs.appendFileSync(bundle.helper, "tampered\n");
  const env = {
    AZRAEL_DEVIN_NATIVE_HELPER: "ambient helper",
    AZRAEL_DEVIN_NODE: "ambient node",
  };

  assert.throws(
    () => configureEnvironment(env, {
      codexHome: path.join(bundle.root, "state"),
      devinNative: { releaseDirectory: bundle.releaseDirectory },
    }),
    /integrity check failed/,
  );
  assert.equal("AZRAEL_DEVIN_NATIVE_HELPER" in env, false);
  assert.equal("AZRAEL_DEVIN_NODE" in env, false);
});
