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
  if (compiled.error || compiled.signal || compiled.status !== 0) return { ...compiled, status: compiled.status === 0 ? 1 : compiled.status };
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
  // Inbox Windows PowerShell must discover its own modules. A PowerShell 7
  // parent's PSModulePath can load incompatible or untrusted PSReadLine files
  // before the unchanged interactive PTY probes receive their first command.
  let runtimeOptions = captureOptions;
  if (crate === "codex-utils-pty") {
    const moduleKeys = Object.keys(captureOptions.env).filter(key => key.toLowerCase() === "psmodulepath");
    if (moduleKeys.length) {
      runtimeOptions = { ...captureOptions, env: { ...captureOptions.env } };
      for (const key of moduleKeys) delete runtimeOptions.env[key];
    }
  }
  const listed = spawnSync([...executables][0], [filter, "--list", "--format=terse"], runtimeOptions);
  emit(listed);
  const selectedTests = (String(listed.stdout || "").match(/^.+: test\r?$/gm) || []).length;
  process.stderr.write(`[cargo-preflight] ${JSON.stringify({ phase: "selection", executable: [...executables][0], filter, selectedTests, exitCode: listed.status ?? null, signal: listed.signal ?? null })}\n`);
  if (listed.error || listed.signal || listed.status !== 0) return { ...listed, status: listed.status === 0 ? 1 : listed.status };
  if (selectedTests === 0) {
    return { ...listed, status: 1, error: new Error(`Cargo preflight selected zero tests for ${crate}`) };
  }
  const tested = spawnSync([...executables][0], [filter, "--test-threads=1", ...(crate === "codex-utils-pty" ? ["--nocapture"] : [])], runtimeOptions);
  emit(tested);
  return tested;
}

function selectedScopes() {
  return {
    accounts: [["codex-login", "auth::manager::profiles::tests::"],
      ["codex-app-server", "config_manager::window_context_tests::"],
      ["codex-app-server", "request_processors::account_processor::azrael_state::durable_recovery_tests::"],
      ["codex-app-server", "request_processors::account_processor::azrael::tests::"],
      ["codex-app-server", "request_processors::account_processor::retirement::durable_recovery_tests::"],
      ["codex-app-server", "azrael_shared_server::tests::"]],
    handoff: [["codex-app-server-daemon", "session_handoff::tests::real_websocket_sessions_callbacks_busy_release_and_no_turn_replay"],
      ["codex-app-server-daemon", "session_handoff::tests::read_only_preview_reads_source_then_reauthenticates_before_resume"],
      ["codex-app-server", "azrael_session_handoff::tests::target_resume_preserves_source_computer_use_ceiling_including_absence"],
      ["codex-app-server", "azrael_session_handoff::tests::scoped_source_resume_keeps_presentation_and_strips_all_runtime_overrides"],
      ["codex-app-server", "azrael_session_handoff::tests::nonapproval_callback_has_exact_thread_ownership_until_canceled"],
      ["codex-app-server", "azrael_session_handoff::tests::scope_does_not_grant_account_or_other_session_authority"]],
    bridge: [["codex-app-server-client", "remote::tests::", ["--no-default-features", "--lib"]],
      ["codex-app-server-client", "terminal_", ["--no-default-features", "--bin", "azrael-bridge"]]],
    appserver: [["codex-app-server-daemon", "azrael_storage::tests::"],
      ["codex-app-server-daemon", "registration::tests::"],
      ["codex-app-server-daemon", "backend::pid::tests::update_loop_uses_hidden_app_server_subcommand"],
      ["codex-app-server-daemon", "backend::pid::tests::app_server_remote_control_uses_runtime_flag"],
      ["codex-app-server-daemon", "backend::pid::tests::app_server_disabled_remote_control_uses_compatible_args_and_runtime_env"],
      ["codex-install-context", "azrael_entry_resolves_its_own_code_mode_host"],
      ["codex-app-server", "entry::tests::azrael_proxy_preserves_global_startup_options_and_rejects_listener_changes", ["--bin", "azrael"]]],
    manual: [["codex-core", "azrael_manual_resume::tests::"],
      ["codex-core", "manual_resume_marker"],
      ["codex-queue-extension", "manual_resume_marker", "queue_service"]],
  };
}

function main() {
  const [sourceRoot, scope, ...extra] = process.argv.slice(2);
  const scopes = selectedScopes();
  if (!sourceRoot || !path.isAbsolute(sourceRoot) || !Object.hasOwn(scopes, scope) || extra.length) {
    throw new Error("Usage: check-shared-engine-native.cjs <absolute frozen engine source root> <appserver|manual|bridge|handoff|accounts>");
  }
  if (!fs.statSync(path.join(sourceRoot, "codex-rs", "Cargo.toml")).isFile()) {
    throw new Error("Selected engine source has no Cargo workspace");
  }
  for (const [crate, filter, target] of scopes[scope]) {
    const result = runCargoTest(sourceRoot, ["test", "-p", crate, ...(Array.isArray(target) ? target : target ? ["--test", target] : ["--lib"]), filter,
        "--locked", "--offline", "--", "--test-threads=1", ...(crate === "codex-utils-pty" ? ["--nocapture"] : [])], { isolateHostEnvironment: true });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  }
}

module.exports = { runWindowsNativeTests, selectedScopes };
if (require.main === module) main();
