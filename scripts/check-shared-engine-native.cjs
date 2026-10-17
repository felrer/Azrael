"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildCargoTestCommand, runCargoTest, runManagedCargoSync } = require("./cargo-verification.cjs");

const windowsNativePackages = {
  "codex-app-server-daemon": { directory: "app-server-daemon", target: "codex_app_server_daemon" },
  "codex-utils-pty": { directory: path.join("utils", "pty"), target: "codex_utils_pty" },
};

function runWindowsNativeTests(sourceRoot, crate, filter) {
  // Cargo's Windows job can deny breakaway even when the outer host supports
  // it. Compile with Cargo, then exercise the unchanged native launch contract
  // directly from this runner, outside Cargo's test-process job.
  if (!Object.hasOwn(windowsNativePackages, crate)) throw new Error(`Unsupported Windows native test package: ${crate}`);
  const selected = windowsNativePackages[crate];
  const { command, args, ...options } = buildCargoTestCommand(sourceRoot,
    ["test", "-p", crate, "--lib", filter, "--locked", "--offline", "--no-run", "--message-format=json"],
    { isolateHostEnvironment: true });
  const captureOptions = { ...options, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
  const spawnSync = require("node:child_process").spawnSync;
  const emit = result => {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  };
  const compiled = runManagedCargoSync({ command, args, ...captureOptions });
  emit(compiled);
  if (compiled.error || compiled.status !== 0) return compiled;
  const normalized = value => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  const manifest = normalized(path.join(sourceRoot, "codex-rs", selected.directory, "Cargo.toml"));
  const source = normalized(path.join(sourceRoot, "codex-rs", selected.directory, "src", "lib.rs"));
  const executables = new Set();
  for (const line of compiled.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let artifact;
    try { artifact = JSON.parse(line); }
    catch { throw new Error(`Cargo emitted invalid JSON while locating the ${crate} test executable`); }
    if (artifact.reason !== "compiler-artifact" || artifact.target?.name !== selected.target
      || !artifact.target.kind?.includes("lib") || artifact.profile?.test !== true || !artifact.executable
      || typeof artifact.manifest_path !== "string" || typeof artifact.target.src_path !== "string"
      || normalized(artifact.manifest_path) !== manifest || normalized(artifact.target.src_path) !== source) continue;
    if (typeof artifact.executable !== "string" || !path.isAbsolute(artifact.executable)) {
      throw new Error(`Cargo's ${crate} test executable must be an absolute path`);
    }
    executables.add(artifact.executable);
  }
  if (executables.size !== 1) {
    throw new Error(`Expected exactly one ${crate} libtest executable from the selected frozen package; found ${executables.size}`);
  }
  const tested = spawnSync([...executables][0], [filter, "--test-threads=1", ...(crate === "codex-utils-pty" ? ["--nocapture"] : [])], captureOptions);
  emit(tested);
  return tested;
}

function main() {
  const [sourceRoot, scope, ...extra] = process.argv.slice(2);
  const scopes = {
    appserver: [...(process.platform === "win32" ? [["codex-utils-pty", "windows_tests::"],
      ["codex-utils-pty", "win::process_tree::tests::"],
      ["codex-utils-pty", "pipe::tests::process_fallback_interrupt_terminates_root"]] : []),
      ["codex-app-server-daemon", "azrael::tests::"],
      ["codex-app-server-daemon", "azrael_storage::tests::"],
      ["codex-app-server-daemon", "backend::pid::tests::"],
      ["codex-app-server", "azrael_shared_server::tests::"],
      ["codex-app-server", "azrael_shared_server::instance_tests::"],
      ["codex-app-server", "azrael_thread_engines::tests::"],
      ["codex-app-server", "azrael_state::"],
      ["codex-app-server", "config_manager::window_context_tests::"],
      ["codex-install-context", "azrael_entry_resolves_its_own_code_mode_host"],
      ["codex-app-server", "entry::tests::", ["--bin", "azrael"]],
      ["codex-app-server", "entry::endpoint_tests::", ["--bin", "azrael"]]],
    manual: [["codex-core", "azrael_manual_resume::tests::"],
      ["codex-core", "manual_resume_marker"],
      ["codex-queue-extension", "manual_resume_marker", "queue_service"]],
  };
  if (!sourceRoot || !path.isAbsolute(sourceRoot) || !Object.hasOwn(scopes, scope) || extra.length) {
    throw new Error("Usage: check-shared-engine-native.cjs <absolute frozen engine source root> <appserver|manual>");
  }
  if (!fs.statSync(path.join(sourceRoot, "codex-rs", "Cargo.toml")).isFile()) {
    throw new Error("Selected engine source has no Cargo workspace");
  }
  for (const [crate, filter, target] of scopes[scope]) {
    const result = process.platform === "win32" && (crate === "codex-utils-pty" || (crate === "codex-app-server-daemon" && filter === "backend::pid::tests::"))
      ? runWindowsNativeTests(sourceRoot, crate, filter)
      : runCargoTest(sourceRoot, ["test", "-p", crate, ...(Array.isArray(target) ? target : target ? ["--test", target] : ["--lib"]), filter,
        "--locked", "--offline", "--", "--test-threads=1", ...(crate === "codex-utils-pty" ? ["--nocapture"] : [])], { isolateHostEnvironment: true });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  }
}

module.exports = { runWindowsNativeTests };
if (require.main === module) main();
