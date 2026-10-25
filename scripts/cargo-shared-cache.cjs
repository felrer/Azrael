"use strict";

// Compilation storage is independent of a release or source-copy address.
// Cargo fingerprints still decide what to compile; this is never test evidence.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const lifecycle = require("./artifact-lifecycle.cjs");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function plain(filename) {
  if (!path.isAbsolute(filename) || filename.split(/[\\/]/).includes("..")) throw Error("Absolute plain cache path required");
  filename = path.resolve(filename);
  for (let current = filename; ; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error("Linked shared cache path rejected"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (current === path.dirname(current)) break;
  }
  return filename;
}
function tool(command, args, cwd, env) {
  const installed = path.join(env.CARGO_HOME || path.join(require("node:os").homedir(), ".cargo"), "bin", command + (process.platform === "win32" ? ".exe" : ""));
  if (fs.existsSync(installed)) command = installed;
  const result = spawnSync(command, args, { cwd, env, windowsHide: true, encoding: "utf8" });
  if (result.error || result.signal || result.status !== 0) throw Error(`Cannot identify Cargo cache tool ${command}: ${result.error?.message || result.stderr || result.signal}`);
  return result.stdout.trim();
}
function selectCache({ projectRoot, sourceRoot, target, env = process.env, tools }) {
  projectRoot = plain(projectRoot); sourceRoot = plain(sourceRoot);
  if (!fs.statSync(projectRoot).isDirectory() || !fs.statSync(sourceRoot).isDirectory()) throw Error("Existing cache owner and source roots required");
  const cwd = path.join(sourceRoot, "codex-rs");
  if (!fs.existsSync(path.join(cwd, "Cargo.toml"))) throw Error("Selected engine Cargo manifest required");
  tools ??= { rustc: tool("rustc", ["-vV"], cwd, env), cargo: tool("cargo", ["-V"], cwd, env) };
  if (typeof tools.rustc !== "string" || !tools.rustc || typeof tools.cargo !== "string" || !tools.cargo) throw Error("Complete Cargo tool identity required");
  target ||= /^host: (.+)$/m.exec(tools.rustc)?.[1];
  if (typeof target !== "string" || !/^[A-Za-z0-9_.-]+$/.test(target)) throw Error("Explicit Cargo target identity required");
  const configuration = [];
  // Include effective ancestor config bytes, but not the source-copy address.
  for (let directory = cwd; ; directory = path.dirname(directory)) {
    for (const name of [".cargo/config", ".cargo/config.toml"]) {
      const file = path.join(directory, name);
      if (fs.existsSync(file)) { plain(file); configuration.push([path.relative(cwd, file).replaceAll("\\", "/"), hash(fs.readFileSync(file).toString("base64"))]); }
    }
    if (directory === path.dirname(directory)) break;
  }
  const flags = Object.fromEntries(Object.entries(env).filter(([name]) => name !== "CARGO_TARGET_DIR" && /^(?:CARGO_(?:ENCODED_RUSTFLAGS|BUILD_RUSTFLAGS|BUILD_TARGET|TARGET_.*|PROFILE_.*)|RUSTFLAGS|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER)$/.test(name)).sort(([a], [b]) => a.localeCompare(b)));
  const identity = { schema: 1, platform: process.platform, arch: process.arch, target, tools, configuration, flags };
  const key = hash(identity), directory = plain(path.join(projectRoot, "artifacts/cache/cargo", key));
  return { projectRoot, key, identity, directory, targetDirectory: path.join(directory, "target"), lifecycleId: `shared:cargo-target:${key}` };
}
function beginExecution(selection, token) {
  const { projectRoot, lifecycleId, directory, identity } = selection;
  plain(directory);
  const marker = path.join(directory, "identity.json");
  const old = lifecycle.catalog(projectRoot).find(record => record.id === lifecycleId);
  if (old && (!old.producer || old.producer.status !== "stopped" || old.producer.outcome === "unknown")) throw Error("Shared Cargo cache has an unresolved producer; explicit recovery required");
  if (fs.existsSync(directory) && (!fs.existsSync(marker) || fs.readFileSync(marker, "utf8") !== JSON.stringify(identity))) throw Error("Shared Cargo cache identity missing or changed");
  // Claim the full entry before creating either marker, target or Cargo lease.
  const record = lifecycle.recordLifecycle(projectRoot, { id: lifecycleId, kind: "work", owner: "cargo-shared-cache", state: "pending", membership_complete: false,
    generation: token, expected_revision: old?.revision || 0, references: [], members: [{ role: "cargo-cache", path: directory, generated: true, protection_known: true }] });
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, JSON.stringify(identity), { flag: "wx" });
  return { ...selection, record };
}
function finishExecution(selection, result, owner) {
  if (result.error || result.signal || !Number.isInteger(result.status)) return; // Preserve unknown producer protection.
  const directory = plain(path.join(selection.projectRoot, "artifacts/maintenance/cargo-terminal"));
  fs.mkdirSync(directory, { recursive: true });
  const evidence = path.join(directory, `${selection.key}-cache.json`);
  fs.writeFileSync(evidence, JSON.stringify({ ...owner, cacheIdentity: selection.identity }) + "\n");
  lifecycle.closeLifecycle(selection.projectRoot, selection.lifecycleId, { owner: "cargo-shared-cache", expected_revision: selection.record.revision,
    producer_stopped_verified: true, outcome: result.status === 0 ? "success" : "failure", exit_code: result.status,
    reason: "Managed Cargo actual synchronous close; unresolved outcomes stay protected", evidence_ref: evidence,
    evidence_sha256: crypto.createHash("sha256").update(fs.readFileSync(evidence)).digest("hex") });
}
module.exports = { selectCache, beginExecution, finishExecution };
if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!["--project-root", "--source-root", "--target"].includes(args[i]) || !args[i + 1] || options[args[i]]) throw Error("Usage: cargo-shared-cache --project-root ABS --source-root ABS [--target TARGET]");
      options[args[i]] = args[i + 1];
    }
    console.log(JSON.stringify(selectCache({ projectRoot: options["--project-root"], sourceRoot: options["--source-root"], target: options["--target"] })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
