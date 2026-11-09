"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { beginArtifactRun, finishArtifactRun } = require("./artifact-run.cjs");
const { recordLifecycle } = require("./artifact-lifecycle.cjs");
const { runCargoTest, prepareCargoTests, buildCargoTestCommand, preflightCommands } = require("./cargo-verification.cjs");
const { selectCache } = require("./cargo-shared-cache.cjs");
const { inventory } = require("./cargo-stable-source.cjs");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const prepareTests = args.includes("--prepare-tests");
if (prepareTests) args.splice(args.indexOf("--prepare-tests"), 1);
let scope = "all";
const scopeIndex = args.indexOf("--scope");
if (scopeIndex >= 0) { scope = args[scopeIndex + 1]; args.splice(scopeIndex, 2); }
if (!["login", "all", "schema", "schema-stable", "schema-experimental"].includes(scope)) throw Error("Scope must be login, all, schema, schema-stable or schema-experimental");
let pinCommit;
const pinIndex = args.indexOf("--pin-devin-baseline");
if (pinIndex >= 0) { pinCommit = args[pinIndex + 1]; args.splice(pinIndex, 2); }
if (pinCommit !== undefined && !/^[a-f0-9]{40}$/.test(pinCommit)) throw Error("Exact Devin baseline commit required");
let waitForProcess;
const waitIndex = args.indexOf("--wait-for-process");
if (waitIndex >= 0) {
  const value = args[waitIndex + 1];
  if (!/^[1-9][0-9]*:[1-9][0-9]*$/.test(value || "") || process.platform !== "win32") throw Error("Windows PID:start-time-ms required");
  waitForProcess = value.split(":").map(Number); args.splice(waitIndex, 2);
}
const [requestedSource, ...extra] = args;
if (pinCommit && requestedSource) throw Error("Pins require a new owned source snapshot");
if (extra.length || (requestedSource && (!path.isAbsolute(requestedSource) || !fs.existsSync(path.join(requestedSource, "codex-rs/Cargo.toml"))))) {
  throw Error("Usage: check-service-auth-native.cjs [--scope login|all|schema|schema-stable|schema-experimental] [--prepare-tests] [--pin-devin-baseline SHA] [--wait-for-process PID:start-time-ms] [absolute frozen engine source root]");
}
if (prepareTests && scope.startsWith("schema")) throw Error("Schema generation does not select test preparation");
const selected = scope.startsWith("schema") ? [
  ["codex-app-server-protocol", "schema_fixtures_tests::write_schema_fixtures_from_env", "0"],
  ["codex-app-server-protocol", "schema_fixtures_tests::write_schema_fixtures_from_env", "1"],
].filter(([, , experimental]) => scope === "schema" || experimental === (scope === "schema-stable" ? "0" : "1")) : [
  ["codex-login", "auth::service_account::tests"],
  ["codex-core", "long_term_memories_cannot_be_enabled_for_azrael"],
  ["codex-memories-extension", "when_disabled"],
  ["codex-memories-extension", "prompt_contribution_uses_memory_summary_when_enabled"],
  ["codex-app-server", "azrael"],
  ["codex-app-server", "project_accounts_share_admission_without_sharing_policy_or_root_login"],
  ["codex-core", "service_policy"],
  ["codex-http-client", "service_policy"],
  ["codex-core", "guardian::review_session::setup::service_history_tests"],
  ["codex-connectors", "service_revision"],
  ["codex-core", "mcp_runtime_keeps_local_backend_without_a_selected_local_environment"],
  ["codex-app-server", "service_account"],
  ["codex-app-server", "service_http"],
  ["codex-app-server-protocol", "azrael"],
  ["codex-app-server-protocol", "schema_fixtures_tests::"],
  ["codex-web-search-extension", "only_explicit_custom_standalone_search_uses_chat_provider"],
  ["codex-mcp", "hosted_apps_service_auth_reaches_transport_without_conversation_fallback"],
  ["codex-image-generation-extension", ""],
  ["codex-core", "service_reviewer_spawn_pins_account_and_catalog_across_main_switch"],
  ["codex-core", "guardian_review_session_config_uses_requirements_guardian_policy_config"],
  ["codex-core", "hosted_web_search_and_standalone_image_generation_follow_runtime_gates"],
  ["codex-core", "no_main_omits_openai_hosted_web_search_and_native_devin_omits_custom_hosted_search"],
  ["codex-core", "hosted_web_search_fallback_follows_winning_browser_runtime"],
  ["codex-core", "allowed_tools_filter_sources_before_code_mode_and_discovery"],
  ["codex-core", "code_mode_only_can_expose_namespaced_multi_agent_v2_as_normal_tools"],
  ["codex-mcp-extension", "service_selection_keeps_started_streams_and_rebinds_retained_openers"],
  ["codex-mcp-extension", "event_connections_open_after_runtime_shutdown_with_current_auth"],
].filter(([crate]) => scope === "all" || crate === "codex-login");
const references = requestedSource ? require("./artifact-lifecycle.cjs").withCatalogLock(root, () => {
  const owners = require("./artifact-lifecycle.cjs").catalog(root).flatMap(record => record.members.map(member => ({ record, member }))).filter(({ member }) => {
    const relative = path.relative(member.path, requestedSource);
    return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
  }).sort((a, b) => b.member.path.length - a.member.path.length);
  const owner = owners[0];
  if (!owner) return [];
  return [{ id: owner.record.id, kind: "execution", reason: "Selected native verification consumes this immutable source snapshot", member_paths: [owner.member.path], target_revision: owner.record.revision }];
}) : [];
const run = beginArtifactRun(root, { references, workId: "FO-01-service-auth-native", owner: "scripts/check-service-auth-native.cjs",
  paths: { ...(!requestedSource ? { inputs: path.join(root, "artifacts/verification/fo01-" + crypto.randomBytes(4).toString("hex")) } : {}),
    temporary: path.join(root, "artifacts/verification/fo01-t-" + crypto.randomBytes(4).toString("hex")) } });
run.record = recordLifecycle(root, { ...run.record,
  members: run.record.members.map(member => ["inputs", "temporary"].includes(member.role) ? { ...member, generated: true, protection_known: true } : member),
  expected_revision: run.record.revision });
const content = record => JSON.stringify(Object.entries(record.files).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [name, value.sha256]));
let exitCode = 1, producerStopped = true;
try {
  const source = requestedSource || path.join(root, "engine"), frozen = requestedSource || path.join(run.inputs, "engine");
  let selectedClosure;
  if (scope.startsWith("schema")) {
    const metadata = require("node:child_process").spawnSync(path.join(require("node:os").homedir(), ".cargo/bin/cargo" + (process.platform === "win32" ? ".exe" : "")), ["metadata", "--offline", "--no-deps", "--format-version", "1"], { cwd: path.join(source, "codex-rs"), windowsHide: true, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    if (metadata.status !== 0 || metadata.error) throw Error("Schema dependency metadata failed: " + (metadata.error?.message || metadata.stderr));
    const packages = JSON.parse(metadata.stdout).packages;
    const canonical = directory => process.platform === "win32" ? path.resolve(directory).toLowerCase() : path.resolve(directory);
    const byDirectory = new Map(packages.map(pkg => [canonical(path.dirname(pkg.manifest_path)), pkg]));
    const found = new Set();
    const visit = pkg => {
      if (found.has(pkg)) return;
      found.add(pkg);
      for (const dependency of pkg.dependencies) if (dependency.path && (pkg.name === "codex-app-server-protocol" || dependency.kind !== "dev")) {
        const next = byDirectory.get(canonical(dependency.path));
        if (!next) throw Error("Schema path dependency lacks package metadata: " + dependency.path);
        visit(next);
      }
    };
    visit(packages.find(pkg => pkg.name === "codex-app-server-protocol"));
    selectedClosure = [...found].map(pkg => ({ name: pkg.name, directory: path.relative(source, path.dirname(pkg.manifest_path)).replaceAll("\\", "/") }));
    if (selectedClosure.some(pkg => pkg.directory.startsWith("..") || path.isAbsolute(pkg.directory))) throw Error("Schema dependency escapes selected engine");
  }
  const selectedInput = name => !selectedClosure || selectedClosure.some(pkg => name.startsWith(pkg.directory + "/")) || name.endsWith("/Cargo.toml") || name === "codex-rs/Cargo.lock" || /(?:^|\/)(?:rust-toolchain(?:\.toml)?|\.cargo\/config(?:\.toml)?)$/.test(name);
  const observed = inventory(source, true);
  const pins = [];
  if (pinCommit) {
    for (const name of ["codex-rs/core/src/devin/catalog_mapping.rs", "codex-rs/core/src/devin/catalog_tests.rs"]) {
      const gitPath = "engine/" + name;
      const result = require("node:child_process").spawnSync("git", ["show", pinCommit + ":" + gitPath], { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      if (result.status !== 0 || result.error) throw Error("Cannot load approved pinned input: " + gitPath);
      const sha256 = crypto.createHash("sha256").update(result.stdout).digest("hex");
      observed.files[name] = { ...observed.files[name], sha256 };
      pins.push({ commit: pinCommit, path: gitPath, sourcePath: name, sha256, bytes: result.stdout });
    }
  }
  const before = content(observed);
  if (!requestedSource) {
    // Copy the existing owner's exact source inventory, excluding its declared caches.
    for (const name of Object.keys(observed.files)) {
      const from = path.join(source, name), to = path.join(frozen, name);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      const pin = pins.find(pin => pin.sourcePath === name);
      if (pin) fs.writeFileSync(to, pin.bytes);
      else fs.copyFileSync(from, to);
    }
  }
  const after = inventory(source, true), copied = inventory(frozen, true);
  const changedNames = current => [...new Set([...Object.keys(observed.files), ...Object.keys(current.files)])].filter(name => observed.files[name]?.sha256 !== current.files[name]?.sha256);
  const drift = { live: changedNames(after).filter(name => selectedInput(name) && !pins.some(pin => pin.sourcePath === name)), copied: changedNames(copied).filter(selectedInput) };
  if (drift.live.length || drift.copied.length) {
    fs.writeFileSync(path.join(run.reports, "freeze-drift.json"), JSON.stringify(drift, null, 2));
    throw Error("Engine inputs changed while freezing service-auth tests: " + JSON.stringify(drift));
  }
  const frozenContent = selectedClosure ? content(copied) : before;
  const fixed = crypto.createHash("sha256").update(frozenContent).digest("hex");
  const pinnedInputs = pins.map(({ bytes, ...pin }) => pin);
  fs.writeFileSync(path.join(run.reports, "input-provenance.json"), JSON.stringify({ sourceRoot: source, frozenRoot: frozen, sourceSha256: fixed, pinnedInputs, selectedClosure, selectedFiles: JSON.parse(frozenContent).filter(([name]) => selectedInput(name)), files: JSON.parse(frozenContent) }, null, 2));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  const env = { ...inherited, PATH: path.join(require("node:os").homedir(), ".cargo/bin") + path.delimiter + process.env.PATH,
    AZRAEL_CARGO_CACHE_PROJECT_ROOT: root, AZRAEL_CARGO_RUN_ID: run.lifecycleId,
    AZRAEL_CARGO_CACHE_SCOPE: process.env.AZRAEL_CARGO_CACHE_SCOPE || "win017-ft02",
    CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG || "0",
    CARGO_PROFILE_TEST_DEBUG: process.env.CARGO_PROFILE_TEST_DEBUG || "0",
    TEMP: run.temporary, TMP: run.temporary, TMPDIR: run.temporary,
    INSTA_PENDING_DIR: path.join(run.temporary, "insta"), RUST_MIN_STACK: "33554432" };
  const cache = env.CARGO_TARGET_DIR ? { targetDirectory: env.CARGO_TARGET_DIR } : selectCache({ projectRoot: root, sourceRoot: frozen, env });
  env.CARGO_TARGET_DIR = cache.targetDirectory;
  const results = [];
  console.log(JSON.stringify({ phase: "frozen-inputs-ready", lifecycleId: run.lifecycleId, sourceRoot: frozen, sourceSha256: fixed, pinnedInputs, scope, targetDirectory: cache.targetDirectory, selected }));
  if (waitForProcess) {
    const [pid, startedMs] = waitForProcess;
    console.log(JSON.stringify({ phase: "waiting-for-target-coordinator", pid, startedMs }));
    const command = "$p = Get-Process -Id " + pid + " -ErrorAction SilentlyContinue; if ($p) { if (([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() -ne " + startedMs + ") { exit 3 }; Wait-Process -InputObject $p }";
    const waited = require("node:child_process").spawnSync(path.join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", command], { env, windowsHide: true, stdio: "inherit" });
    if (waited.status !== 0 || waited.error || waited.signal) throw Error("Target coordinator completion wait failed");
    const owner = require("./cargo-target-owner.cjs").inspectTargetOwner({ targetDirectory: cache.targetDirectory });
    if (owner.exists) throw Error("Cargo target still owned after coordinator exit: " + JSON.stringify({ run: owner.owner?.run, status: owner.owner?.status, coordinatorPid: owner.owner?.coordinatorPid }));
  }
  if (prepareTests) {
    const commands = new Map();
    for (const [crate, filter] of selected) {
      const cargoArgs = ["test", "-p", crate, "--lib", "--locked", "--offline", filter, "--", "--test-threads=1"];
      const spec = preflightCommands(buildCargoTestCommand(frozen, cargoArgs, { env, isolateHostEnvironment: true })).typeCheck;
      const key = JSON.stringify(spec.args);
      if (!commands.has(key)) commands.set(key, { crate, cargoArgs });
    }
    const preparations = [];
    for (const { crate, cargoArgs } of commands.values()) {
      const logDirectory = path.join(run.logs, "preparation-" + String(preparations.length).padStart(2, "0") + "-" + crate);
      console.log(JSON.stringify({ phase: "selected-preparation-start", crate, logDirectory }));
      const prepared = prepareCargoTests(frozen, cargoArgs, { env, isolateHostEnvironment: true, logDirectory });
      producerStopped = Number.isInteger(prepared.preparation?.exitCode) && !prepared.error && !prepared.signal;
      const succeeded = prepared.status === 0 && !prepared.error && !prepared.signal && !prepared.sourceVerificationError;
      const evidence = { crate, ...prepared.preparation, succeeded, logDirectory };
      preparations.push(evidence);
      fs.writeFileSync(path.join(run.reports, "preparation-summary.json"), JSON.stringify({ sourceSha256: fixed, sourceRoot: frozen, pinnedInputs, preparations }, null, 2));
      console.log(JSON.stringify({ phase: "selected-preparation-complete", crate, exitCode: evidence.exitCode, succeeded }));
      if (!succeeded) {
        if (prepared.stderr) console.error(prepared.stderr.slice(-12000));
        if (content(inventory(frozen, true)) !== frozenContent) throw Error("Frozen native preparation inputs changed during execution");
        throw Error("Native test type-check preparation failed for " + crate);
      }
    }
  }
  for (const [crate, filter, experimental] of selected) {
    console.log(JSON.stringify({ phase: "selected-test-start", crate, filter }));
    const generator = experimental !== undefined;
    const cargoEnv = generator ? Object.fromEntries(Object.entries(env).filter(([key]) => !/^(CODEX_|AZRAEL_)/i.test(key) || ["AZRAEL_CARGO_CACHE_PROJECT_ROOT", "AZRAEL_CARGO_RUN_ID", "AZRAEL_CARGO_CACHE_SCOPE"].includes(key))) : env;
    if (generator) {
      cargoEnv.CODEX_APP_SERVER_SCHEMA_ROOT = path.join(run.outputs, experimental === "1" ? "experimental" : "stable");
      cargoEnv.CODEX_APP_SERVER_SCHEMA_EXPERIMENTAL = experimental;
    }
    const result = runCargoTest(frozen, ["test", "-p", crate, "--lib", "--locked", "--offline", filter, "--", ...(generator ? ["--ignored", "--exact"] : []), "--test-threads=1"], { env: cargoEnv, isolateHostEnvironment: !generator, capture: true });
    const name = crate + "-" + filter.replace(/[^a-zA-Z0-9_-]/g, "_") + (generator ? "-" + experimental : "");
    fs.writeFileSync(path.join(run.logs, name + ".stdout.log"), result.stdout ?? "");
    fs.writeFileSync(path.join(run.logs, name + ".stderr.log"), result.stderr ?? "");
    producerStopped = !result.error && Number.isInteger(result.status);
    if (result.error && !result.preflight?.phases?.some(p => p.exitCode != null)) producerStopped = false;
    const evidence = { crate, filter, ...(generator ? { experimental, schemaRoot: cargoEnv.CODEX_APP_SERVER_SCHEMA_ROOT } : {}), exitCode: result.status ?? null, accepted: result.preflight?.accepted === true, actualCounts: result.preflight?.actualCounts, error: result.error?.message };
    results.push(evidence); console.log(JSON.stringify(evidence));
    fs.writeFileSync(path.join(run.reports, "summary.json"), JSON.stringify({ sourceSha256: fixed, sourceRoot: frozen, cache: cache.targetDirectory, scope, pinnedInputs, selected, results }, null, 2));
    if (result.status !== 0 || result.error || !evidence.accepted) { if (result.stderr) console.error(result.stderr.slice(-12000)); break; }
  }
  if (content(inventory(frozen, true)) !== frozenContent) throw Error("Frozen native test inputs changed during execution");
  exitCode = results.length === selected.length && results.every(r => r.accepted) ? 0 : 1;
} catch (error) { console.error(error.stack || error); }
finally {
  finishArtifactRun(run, { exitCode, producerStopped, reason: producerStopped ? "Selected native tests and owned synchronous producers ended" : "Native producer termination requires investigation" });
  console.log(JSON.stringify({ lifecycleId: run.lifecycleId, runRoot: run.runRoot, exitCode }));
  process.exitCode = exitCode;
}
