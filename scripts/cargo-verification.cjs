"use strict";

const path = require("node:path");

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
  return { command: "cargo", args, cwd, env: cargoEnv, stdio: "inherit", windowsHide: true };
}

function runCargoTest(sourceRoot, cargoArgs, options) {
  const { command, args, ...spawnOptions } = buildCargoTestCommand(sourceRoot, cargoArgs, options);
  return require("node:child_process").spawnSync(command, args, spawnOptions);
}

module.exports = { buildCargoTestCommand, runCargoTest };
