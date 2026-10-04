"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const [receiptArgument, releaseArgument, stateRootArgument] = process.argv.slice(2);
if (!receiptArgument || !releaseArgument || !stateRootArgument) {
  throw new Error("Usage: check-prepared-devin-native-host.cjs <independent-prepared.json> <expected-release> <expected-state-root>");
}

function environmentDigest() {
  return createHash("sha256")
    .update(JSON.stringify(Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right))))
    .digest("hex");
}

function samePath(actual, expected) {
  assert.equal(path.resolve(actual).toLowerCase(), path.resolve(expected).toLowerCase());
}

const receiptPath = fs.realpathSync.native(receiptArgument);
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8").replace(/^\uFEFF/, ""));
const hostExtension = receipt.HostExtension ?? receipt.hostExtension;
const hostVsix = receipt.HostVsix ?? receipt.hostVsix;
assert.equal(typeof hostExtension, "string");
assert.equal(typeof hostVsix, "string");
const runtimePath = path.join(hostExtension, "out", "azrael-runtime.cjs");
const runtimeConfigPath = path.join(hostExtension, "out", "azrael-runtime.json");
const manifestPath = path.join(releaseArgument, "devin-native-build.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
const callerBefore = environmentDigest();

const loaded = require(runtimePath);

assert.equal(environmentDigest(), callerBefore);
samePath(loaded.runtime.codexHome, stateRootArgument);
samePath(loaded.runtime.devinNative.releaseDirectory, releaseArgument);
samePath(loaded.process.env.CODEX_HOME, stateRootArgument);
samePath(loaded.process.env.AZRAEL_DEVIN_NATIVE_HELPER, path.join(releaseArgument, "providers", "devin", "helper.mjs"));
samePath(loaded.process.env.AZRAEL_DEVIN_NODE, manifest.node.path);
samePath(loaded.process.env.TMP, path.join(stateRootArgument, "tmp", "devin-native"));
samePath(loaded.process.env.TEMP, path.join(stateRootArgument, "tmp", "devin-native"));
assert.equal("WINDSURF_API_KEY" in loaded.process.env, false);

process.stdout.write(JSON.stringify({
  passed: true,
  receiptPath,
  hostExtension: fs.realpathSync.native(hostExtension),
  hostVsix: fs.realpathSync.native(hostVsix),
  runtimePath: fs.realpathSync.native(runtimePath),
  runtimeConfigPath: fs.realpathSync.native(runtimeConfigPath),
  releaseDirectory: fs.realpathSync.native(releaseArgument),
  helper: loaded.process.env.AZRAEL_DEVIN_NATIVE_HELPER,
  node: loaded.process.env.AZRAEL_DEVIN_NODE,
  codexHome: loaded.process.env.CODEX_HOME,
  temporary: loaded.process.env.TMP,
  callerEnvironmentUnchanged: true,
}, null, 2));
