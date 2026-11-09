"use strict";

// Native preservation through the existing frozen-input, runtime and Cargo owners.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { beginArtifactRun, finishArtifactRun } = require("./artifact-run.cjs");
const { copyTree, inventoryTree } = require("./freeze-platform-inputs.cjs");
const { inventory } = require("./cargo-stable-source.cjs");
const { selectCache } = require("./cargo-shared-cache.cjs");
const { runCargoTest } = require("./cargo-verification.cjs");
const runtime = require("./find-names-runtime.cjs");

const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sourceIdentity = root => crypto.createHash("sha256").update(JSON.stringify(
  Object.entries(inventory(root, true).files).sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => [name, entry.sha256]),
)).digest("hex");

// The caller may supply its already registered run paths. CLI usage creates its
// own artifact run; this entry point never creates an independent cache owner.
function runChecks({ root, run, resume = false, frozenRoot, expectedHelperSha256 }) {
  const source = path.join(root, "engine");
  const frozen = frozenRoot || path.join(run.inputs, "engine");
  const reportPath = path.join(run.reports, "native-find-names.json");
  const previous = resume ? JSON.parse(fs.readFileSync(reportPath, "utf8")) : null;
  const report = { schema: 1, startedUtc: new Date().toISOString(), platform: process.platform,
    arch: process.arch, sourceRoot: source, frozenRoot: frozen, results: [], accepted: false, producerStopped: true,
    ...(previous ? { previousAttempt: previous } : {}) };
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  try {
    report.sourceSha256 = sourceIdentity(source);
    console.log(JSON.stringify({ phase: "freeze-start", source, frozen, resume }));
    if (resume) {
      if (report.sourceSha256 !== previous.sourceSha256 || inventoryTree(frozen).sha256 !== previous.frozenSha256) {
        throw Error("Resume requires unchanged frozen and source identities");
      }
    } else {
      if (fs.existsSync(frozen)) throw Error("Refusing existing frozen identity");
      copyTree(source, frozen);
    }
    if (sourceIdentity(source) !== report.sourceSha256 || sourceIdentity(frozen) !== report.sourceSha256) {
      throw Error("Engine changed while freezing find_names inputs");
    }
    report.frozenSha256 = inventoryTree(frozen).sha256;
    report.callerSha256 = hash(path.join(frozen, "codex-rs/core/src/tools/handlers/find_names.rs"));
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (/^(AZRAEL_|CODEX_)/i.test(name)) delete env[name];
    const pathKey = Object.keys(env).find(name => name.toLowerCase() === "path") || "PATH";
    env[pathKey] = path.join(require("node:os").homedir(), ".cargo/bin") + path.delimiter + env[pathKey];
    Object.assign(env, { AZRAEL_CARGO_CACHE_PROJECT_ROOT: root, AZRAEL_CARGO_RUN_ID: run.lifecycleId,
      AZRAEL_CARGO_CACHE_SCOPE: process.env.AZRAEL_CARGO_CACHE_SCOPE ?? "find-names-verification",
      RUSTUP_TOOLCHAIN: "1.95.0", CARGO_BUILD_JOBS: "2", TEMP: run.temporary, TMP: run.temporary,
      TMPDIR: run.temporary, INSTA_PENDING_DIR: path.join(run.temporary, "insta"), RUST_MIN_STACK: "33554432" });
    fs.mkdirSync(run.temporary, { recursive: true });
    const cache = selectCache({ projectRoot: root, sourceRoot: frozen, env });
    env.CARGO_TARGET_DIR = cache.targetDirectory;
    report.cache = { key: cache.key, targetDirectory: cache.targetDirectory, identity: cache.identity };
    report.environment = Object.fromEntries(["RUSTUP_TOOLCHAIN", "CARGO_BUILD_JOBS", "TEMP", "TMP", "TMPDIR", "INSTA_PENDING_DIR"].map(name => [name, env[name]]));
    if (expectedHelperSha256 && hash(path.join(root, "scripts/find-names-helper.cjs")) !== expectedHelperSha256) {
      throw Error("Selected helper identity changed before staging");
    }
    const typescript = path.join(root, "extensions/azrael-ex/node_modules/typescript/lib/typescript.js");
    const typescriptRoot = path.dirname(path.dirname(typescript));
    const helperInputs = ["find-names-helper.cjs", "find-names-casefold.json", "find-names-Unicode-LICENSE.txt", "find-names-runtime.cjs"]
      .map(name => path.join(root, "scripts", name))
      .concat(typescript, path.join(typescriptRoot, "package.json"), path.join(typescriptRoot, "LICENSE.txt"),
        path.join(typescriptRoot, "ThirdPartyNoticeText.txt"), process.execPath);
    const helperIdentity = () => helperInputs.map(file => ({ path: file, sha256: hash(file) }));
    report.helperInputs = helperIdentity();
    const staged = runtime.stage(path.join(run.outputs, resume ? "native-runtime-resumed" : "native-runtime"),
      root, typescript, process.execPath);
    if (JSON.stringify(helperIdentity()) !== JSON.stringify(report.helperInputs)) throw Error("Helper inputs changed while staging");
    report.helper = { node: staged.nodeExecutable, nodeSha256: hash(staged.nodeExecutable), helper: staged.helper,
      manifest: staged.manifest };
    save();
    const selected = [
      { id: "find-names", filter: "find_names" },
      { id: "find-names-policy", filter: "reviewer_tool_policy" },
      { id: "find-names-tool-free", filter: "api_tool_free_model_closes_catalog_and_native_dispatch_registry" },
      { id: "find-names-helper", filter: "find_names_with_packaged_helper", runtime: true, ignored: true },
      { id: "find-names-missing-runtime", filter: "find_names_missing_runtime", ignored: true },
    ];
    for (const item of selected) {
      const childEnv = { ...env };
      if (item.runtime) runtime.configureEnvironment(childEnv, { nodeExecutable: staged.nodeExecutable, findNamesHelper: staged.helper });
      const args = ["test", "-p", "codex-core", "--lib", "--locked", "--offline", item.filter,
        "--", "--test-threads=1", ...(item.ignored ? ["--ignored"] : [])];
      console.log(JSON.stringify({ phase: "selected-test-start", id: item.id, args,
        startedUtc: new Date().toISOString(), cache: cache.targetDirectory }));
      report.producerStopped = false;
      const result = runCargoTest(frozen, args, { env: childEnv, capture: true });
      report.producerStopped = !result.error && !result.signal && Number.isInteger(result.status);
      const stdout = path.join(run.logs, `cargo-${item.id}.stdout.log`);
      const stderr = path.join(run.logs, `cargo-${item.id}.stderr.log`);
      fs.writeFileSync(stdout, result.stdout || "");
      fs.writeFileSync(stderr, result.stderr || "");
      const evidence = { id: item.id, args, actualExitCode: result.preflight?.phases?.[0]?.exitCode ?? result.status ?? null,
        wrapperExitCode: result.status ?? null, signal: result.signal ?? null, error: result.error?.message,
        accepted: result.preflight?.accepted === true, preflight: result.preflight, stdout, stderr };
      report.results.push(evidence);
      save();
      console.log(JSON.stringify(evidence));
      if (!evidence.accepted) break;
    }
    report.frozenUnchanged = inventoryTree(frozen).sha256 === report.frozenSha256;
    report.sourceUnchanged = sourceIdentity(source) === report.sourceSha256;
    report.helperSourceUnchanged = JSON.stringify(helperIdentity()) === JSON.stringify(report.helperInputs);
    report.accepted = report.results.length === selected.length && report.results.every(item => item.accepted)
      && report.frozenUnchanged && report.sourceUnchanged && report.helperSourceUnchanged;
  } catch (error) {
    report.error = { message: error.message, stack: error.stack };
    fs.writeFileSync(path.join(run.logs, "cargo-find-names.coordinator.log"), error.stack + "\n");
    console.error(error.stack);
  } finally {
    report.finishedUtc = new Date().toISOString();
    save();
    console.log(JSON.stringify({ reportPath, accepted: report.accepted === true, error: report.error?.message }));
  }
  return report;
}

module.exports = { runChecks };

if (require.main === module) {
  if (process.argv.length !== 2) throw Error("Usage: check-find-names.cjs");
  const root = path.resolve(__dirname, "..");
  const run = beginArtifactRun(root, { workId: "FI-01-find-names", owner: "scripts/check-find-names.cjs",
    paths: { inputs: path.join(root, "artifacts/verification/fn-" + crypto.randomBytes(4).toString("hex")) } });
  run.record = require("./artifact-lifecycle.cjs").recordLifecycle(root, { ...run.record,
    members: run.record.members.map(member => member.role === "inputs" ? { ...member, generated: true, protection_known: true } : member),
    expected_revision: run.record.revision });
  const report = runChecks({ root, run });
  const exitCode = report.accepted ? 0 : 1;
  finishArtifactRun(run, { exitCode, producerStopped: report.producerStopped,
    reason: report.producerStopped ? "Selected synchronous native producers ended" : "Native producer termination requires investigation" });
  process.exitCode = exitCode;
}
