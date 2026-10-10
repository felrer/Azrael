"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { validateRuntimePlatform, requireExecutable } = require("./platform-runtime.cjs");

const MANIFEST = "opencodex-accounts-build.json";
const REVISION = "9f7397ed1582d95c6c1fcf4ae9951213b3fa2d19";
const BUN_VERSION = "1.4.2";

function digest(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function containedFile(release, relative, expected) {
  if (typeof relative !== "string" || !relative || typeof expected !== "string" ||
      path.isAbsolute(relative)) {
    throw new Error("Provider accounts bundle integrity check failed. Rebuild and redeploy Azrael.");
  }
  const candidate = path.resolve(release, relative);
  const lexical = path.relative(release, candidate);
  if (!lexical || lexical.startsWith("..") || path.isAbsolute(lexical)) {
    throw new Error("Provider accounts bundle integrity check failed. Rebuild and redeploy Azrael.");
  }
  let physical;
  try {
    physical = fs.realpathSync.native(candidate);
  } catch {
    throw new Error("Provider accounts bundle integrity check failed. Rebuild and redeploy Azrael.");
  }
  const physicalRelative = path.relative(release, physical);
  if (!physicalRelative || physicalRelative.startsWith("..") || path.isAbsolute(physicalRelative) ||
      !fs.statSync(physical).isFile() || digest(physical) !== expected.toLowerCase()) {
    throw new Error("Provider accounts bundle integrity check failed. Rebuild and redeploy Azrael.");
  }
  return physical;
}

function readBundle(releaseDirectory, required = false) {
  if (typeof releaseDirectory !== "string" || !path.isAbsolute(releaseDirectory)) {
    throw new Error("Provider accounts release path must be absolute.");
  }
  const release = fs.realpathSync.native(releaseDirectory);
  const manifestPath = path.join(release, MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    if (!required) return undefined;
    throw new Error("Provider accounts bundle is missing. Rebuild and redeploy Azrael.");
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Invalid provider accounts bundle. Rebuild and redeploy Azrael.");
  }
  validateRuntimePlatform(manifest.platform);
  if (![1, 2].includes(manifest.schema) || manifest.upstreamRevision !== REVISION ||
      manifest.bun?.version !== BUN_VERSION || typeof manifest.helper !== "string" ||
      typeof manifest.bun?.path !== "string" || !manifest.files ||
      manifest.files[manifest.helper] === undefined || manifest.files[manifest.bun.path] === undefined ||
      typeof manifest.bun.sha256 !== "string" ||
      manifest.bun.sha256.toLowerCase() !== String(manifest.files[manifest.bun.path]).toLowerCase()) {
    throw new Error("Invalid provider accounts bundle. Rebuild and redeploy Azrael.");
  }
  if (manifest.schema === 2 && (typeof manifest.inferenceHelper !== "string" ||
      manifest.files[manifest.inferenceHelper] === undefined)) {
    throw new Error("Provider inference bundle is missing. Rebuild and redeploy Azrael.");
  }
  const verified = new Map();
  for (const [relative, expected] of Object.entries(manifest.files)) {
    verified.set(relative, containedFile(release, relative, expected));
  }
  requireExecutable(verified.get(manifest.bun.path));
  return Object.freeze({
    releaseDirectory: release,
    helper: verified.get(manifest.helper),
    inferenceHelper: manifest.schema === 2 ? verified.get(manifest.inferenceHelper) : undefined,
    bun: verified.get(manifest.bun.path),
  });
}

function configureEnvironment(env, config) {
  delete env.AZRAEL_PROVIDER_ACCOUNTS_HELPER;
  delete env.AZRAEL_PROVIDER_INFERENCE_HELPER;
  delete env.AZRAEL_PROVIDER_BUN;
  delete env.OPENCODEX_HOME;
  if (!config.providerAccounts) return;
  const bundle = readBundle(config.providerAccounts.releaseDirectory, true);
  env.AZRAEL_PROVIDER_ACCOUNTS_HELPER = bundle.helper;
  if (bundle.inferenceHelper) env.AZRAEL_PROVIDER_INFERENCE_HELPER = bundle.inferenceHelper;
  env.AZRAEL_PROVIDER_BUN = bundle.bun;
  env.OPENCODEX_HOME = path.join(config.codexHome, "azrael", "providers", "opencodex");
}

module.exports = { readBundle, configureEnvironment };

if (require.main === module) {
  const bundle = readBundle(path.resolve(process.argv[2]));
  process.stdout.write(JSON.stringify(bundle ? { releaseDirectory: bundle.releaseDirectory } : null));
}
