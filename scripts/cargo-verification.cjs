"use strict";

const path = require("node:path");
const { createHash } = require("node:crypto");
const { physicalPath, runManagedCargoSync } = require("./cargo-target-owner.cjs");

// Pure command construction is shared by execution and verification identity.
// Cargo owns compilation reuse; every requested test filter still executes.
function buildCargoTestCommand(sourceRoot, cargoArgs, {
  env = process.env, pathImpl = path, isolateHostEnvironment = false,
} = {}) {
  if (!sourceRoot || !pathImpl.isAbsolute(sourceRoot)) {
    throw new Error("Cargo verification requires an absolute frozen engine source root");
  }
  if (cargoArgs[0] !== "test") throw new Error("Cargo verification requires cargo test");
  const cwd = pathImpl.join(pathImpl.normalize(sourceRoot), "codex-rs");
  const targetDirectory = env.CARGO_TARGET_DIR || pathImpl.join(cwd, "target");
  if (!pathImpl.isAbsolute(targetDirectory)) {
    throw new Error("CARGO_TARGET_DIR must be absolute for frozen-source verification");
  }
  const args = [...cargoArgs];
  const options = [];
  if (env.AZRAEL_CARGO_TARGET) options.push("--target", env.AZRAEL_CARGO_TARGET);
  // Unset preserves Cargo's test profile (including [profile.test] overrides).
  if (env.AZRAEL_CARGO_PROFILE) options.push("--profile", env.AZRAEL_CARGO_PROFILE);
  const separator = args.indexOf("--");
  args.splice(separator < 0 ? args.length : separator, 0, ...options);
  const cargoEnv = { ...env };
  if (isolateHostEnvironment) {
    for (const key of Object.keys(cargoEnv)) {
      if (/^(AZRAEL_|CODEX_)/i.test(key)) delete cargoEnv[key];
    }
  }
  cargoEnv.CARGO_TARGET_DIR = pathImpl.normalize(targetDirectory);
  cargoEnv.RUST_MIN_STACK ||= "33554432";
  cargoEnv.INSTA_UPDATE = "no";
  const physical = value => pathImpl === path ? physicalPath(value) : pathImpl.normalize(value);
  const identity = value => pathImpl === path.win32 || (pathImpl === path && process.platform === "win32") ? value.toLowerCase() : value;
  const targetIdentity = identity(physical(cargoEnv.CARGO_TARGET_DIR));
  const outputRoot = pathImpl === path ? path.join(__dirname, "..", "artifacts", "verification", "cargo-pending")
    : pathImpl.join(pathImpl.dirname(sourceRoot), "artifacts", "verification", "cargo-pending");
  cargoEnv.INSTA_PENDING_DIR ||= pathImpl.join(outputRoot, createHash("sha256").update(targetIdentity).digest("hex"));
  if (!pathImpl.isAbsolute(cargoEnv.INSTA_PENDING_DIR)) throw new Error("INSTA_PENDING_DIR must be absolute and outside selected engine source");
  const relative = pathImpl.relative(identity(physical(sourceRoot)), identity(physical(cargoEnv.INSTA_PENDING_DIR)));
  if (relative === "" || (!relative.startsWith(`..${pathImpl.sep}`) && relative !== ".." && !pathImpl.isAbsolute(relative))) {
    throw new Error("INSTA_PENDING_DIR must be outside selected engine source");
  }
  return { command: "cargo", args, cwd, selectedSourceRoot: physical(sourceRoot), env: cargoEnv, stdio: "inherit", windowsHide: true };
}

function runCargoTest(sourceRoot, cargoArgs, options) {
  return runManagedCargoSync(buildCargoTestCommand(sourceRoot, cargoArgs, options));
}

module.exports = { buildCargoTestCommand, runCargoTest, runManagedCargoSync };
