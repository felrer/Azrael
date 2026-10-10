"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { validateRuntimePlatform, requireExecutable } = require("./platform-runtime.cjs");

function digest(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readBundle(releaseDirectory, required = false) {
  if (!path.isAbsolute(releaseDirectory)) throw new Error("Devin native release path must be absolute.");
  const release = fs.realpathSync.native(releaseDirectory);
  const manifestPath = path.join(release, "devin-native-build.json");
  if (!fs.existsSync(manifestPath) && !required) return undefined;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  validateRuntimePlatform(manifest.platform);
  if (manifest.schema !== 1 || manifest.model !== "devin/swe-2-high" ||
      !manifest.files || !manifest.files["providers/devin/helper.mjs"] ||
      !manifest.node || !path.isAbsolute(manifest.node.path)) {
    throw new Error("Invalid Devin native bundle. Rebuild and redeploy Azrael.");
  }
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const file = path.resolve(release, relative);
    const contained = path.relative(release, file);
    if (!contained || contained.startsWith("..") || path.isAbsolute(contained) ||
        typeof expected !== "string") {
      throw new Error("Devin native bundle integrity check failed. Rebuild and redeploy Azrael.");
    }
    const physical = fs.realpathSync.native(file);
    const physicalRelative = path.relative(release, physical);
    if (!physicalRelative || physicalRelative.startsWith("..") || path.isAbsolute(physicalRelative) ||
        digest(physical) !== expected.toLowerCase()) {
      throw new Error("Devin native bundle integrity check failed. Rebuild and redeploy Azrael.");
    }
  }
  if (typeof manifest.node.sha256 !== "string" || digest(manifest.node.path) !== manifest.node.sha256.toLowerCase()) {
    throw new Error("Devin native Node runtime changed. Rebuild and redeploy Azrael.");
  }
  requireExecutable(manifest.node.path);
  return {
    releaseDirectory: release,
    helper: path.join(release, "providers/devin/helper.mjs"),
    node: manifest.node.path,
  };
}

function configureEnvironment(env, config) {
  // Native selection belongs to the installed host, not the launching shell.
  delete env.AZRAEL_DEVIN_NATIVE_HELPER;
  delete env.AZRAEL_DEVIN_NODE;
  if (!config.devinNative) return;
  const native = readBundle(config.devinNative.releaseDirectory, true);
  const temporary = path.join(config.codexHome, "tmp", "devin-native");
  fs.mkdirSync(temporary, { recursive: true });
  env.AZRAEL_DEVIN_NATIVE_HELPER = native.helper;
  env.AZRAEL_DEVIN_NODE = native.node;
  // Enable only content-free lifecycle telemetry; preserve explicit filters.
  if (!env.RUST_LOG?.trim()) env.RUST_LOG = "error,devin_native_progress=info";
  env.TMP = temporary;
  env.TEMP = temporary;
  if (process.platform !== "win32") env.TMPDIR = temporary;
  delete env.WINDSURF_API_KEY;
}

module.exports = { readBundle, configureEnvironment };

if (require.main === module) {
  const bundle = readBundle(path.resolve(process.argv[2]));
  process.stdout.write(JSON.stringify(bundle ? { releaseDirectory: bundle.releaseDirectory } : null));
}
