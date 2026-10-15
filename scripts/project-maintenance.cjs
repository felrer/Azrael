"use strict";

// Project command translation only. Durable registration, leases and deletion belong
// to the engine's project-maintenance tool, not this adapter.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const project = require("./test-project.cjs");
const ROOT = path.resolve(__dirname, "..");
const normalize = value => value.replace(/\\/g, "/");

function confined(root, value, allowed = ["artifacts"]) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.split(/[\\/]/).includes("..")) throw new Error("Unsafe path");
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !allowed.some(prefix => relative === prefix || relative.startsWith(prefix + path.sep))) throw new Error("Path outside allowed roots");
  let current = root;
  if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Linked root");
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Linked path");
  }
  return resolved;
}

function commandChecks(command) {
  if (command.files?.length) return command.files.map(file => `project-test:${normalize(file)}`);
  return [`project-test:${command.name}`];
}

function planSelection(options, root = ROOT) {
  const selection = project.select(options, root);
  const commands = [];
  const extension = path.join(root, "extensions/azrael-ex");
  const prepare = () => {
    if (!commands.some(command => command.phase === "prepare")) commands.push({
      name: "extension-build", executable: process.execPath, args: ["scripts/build-incremental.cjs"], cwd: extension,
      files: [], phase: "prepare", checkIds: ["extension.prepare"], dependsOn: [],
    });
  };
  for (const original of selection.commands) {
    if (original.name === "extension-build") { prepare(); continue; }
    let command = { ...original, phase: "test", checkIds: commandChecks(original), dependsOn: [] };
    if (original.executable === "npm") {
      const modes = { "test:current": "current", "test:standalone": "standalone", "test:all": "all" };
      const mode = original.args.length === 2 && original.args[0] === "run" && modes[original.args[1]];
      if (!mode) throw new Error(`Unclassified npm command: ${original.name}`);
      prepare();
      command = { ...command, executable: process.execPath, args: ["scripts/run-tests.cjs", mode] };
    }
    if (original.cwd === extension) command.dependsOn = ["extension-build"];
    commands.push(command);
  }
  return { ...selection, schema_version: 1, project_id: "azrael", commands,
    preparationRequired: commands.some(command => command.phase === "prepare"),
    cacheOwner: "existing project and feature verification owners; no adapter success cache" };
}

function assertTestPlan(plan, { allowPrepare = false, prepared = false } = {}) {
  if (prepared) throw new Error("--prepared is unsupported without trusted owner evidence; use the native extension-prepare dependency and compiled runner, or --allow-prepare");
  for (const command of plan.commands) {
    if (!["test", "prepare"].includes(command.phase)) throw new Error("Test invocation cannot execute a product build");
    if (command.executable === "npm" || command.args.some(arg => /(?:build-platform|build-engine-source-release|install-.*vscode|deploy-azrael)\.(?:cjs|py|ps1)$/.test(arg) && !/(?:^|[\\/])test-/.test(arg))) throw new Error("Hidden product build or installation rejected");
  }
  if (plan.preparationRequired && !allowPrepare) throw new Error("Explicit extension prepare required: use the native extension-prepare dependency and compiled runner, or --allow-prepare");
  return { ...plan, preparation: allowPrepare ? "explicit" : "unneeded" };
}

async function executeTests(plan, options = {}, root = ROOT) {
  const selection = assertTestPlan(plan, options);
  // The runner owns default work/run allocation and producer registration.
  // Keep explicit legacy log roots usable during gradual migration.
  const outputRoots = [path.join("artifacts", "logs"), path.join("artifacts", "tasks")];
  if (options.logDirectory) confined(root, options.logDirectory, outputRoots);
  if (options.directory) confined(root, options.directory, outputRoots);
  // Existing runner preserves grouping, failure checkpoints and individual logs.
  // It recognizes extension-build -> extension-changed; enforce all preparation
  // dependencies too, including current/standalone, with collection enabled.
  let preparationFailed = false;
  const runner = options.runCommand || project.runCommand;
  const report = await project.runSelection(selection, { ...options, root,
    runCommand: async (...args) => {
      const command = args[0];
      if (preparationFailed && command.dependsOn.includes("extension-build")) return { status: "blocked", exitCode: null, error: "Explicit preparation failed" };
      let result;
      try { result = await runner(...args); }
      catch (error) { if (command.phase === "prepare") preparationFailed = true; throw error; }
      if (command.phase === "prepare" && !(result.status === "passed" && result.exitCode === 0 && !result.signal && !result.error)) preparationFailed = true;
      return result;
    },
  });
  return { status: report.status, exitCode: report.exitCode, resultPath: report.resultPath,
    lifecycleId: report.lifecycleId, runRoot: report.runRoot, logDirectory: report.logDirectory,
    coverageStatus: report.coverageStatus, separateChecks: report.separateChecks,
    results: report.results.map(({ name, phase, checkIds, status, exitCode, stdout, stderr }) => ({ name, phase, checkIds, status, exitCode, stdout, stderr })),
    skipped: report.skipped.map(({ name, phase, checkIds, reason }) => ({ name, phase, checkIds, reason })) };
}

function catalog(root = ROOT) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "project-maintenance.json"), "utf8"));
  return { schema_version: 1, project_id: config.project_id, selectorAreas: project.AREAS,
    bundles: config.bundles.map(bundle => ({ ...bundle, phase: bundle.kind,
      checkIds: bundle.id.startsWith("source-") ? planSelection(project.parseArgs(["--area", bundle.id.slice(7)]), root).commands.flatMap(command => command.checkIds) : [bundle.id] })) };
}

// Known producer receipt only; no filename/age scan. A historical receipt cannot
// establish current absence of leases, installation or recovery consumers.
function collectRegistrationCandidates(sources, root = ROOT) {
  return sources.flatMap(source => {
    if (source.owner !== "install-native-vscode") throw new Error("Unknown receipt owner");
    const manifest = confined(root, source.manifest);
    if (path.basename(manifest) !== "deployment.json") throw new Error("Expected deployment receipt");
    const bytes = fs.readFileSync(manifest);
    const receipt = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    if (receipt.schema !== 1 || !Array.isArray(receipt.previousOwnExtensions)) throw new Error("Unsupported native installation receipt");
    return receipt.previousOwnExtensions.map(entry => {
      const filename = confined(root, entry.backup);
      if (!filename.startsWith(path.dirname(manifest) + path.sep)) throw new Error("Backup outside receipt directory");
      const stat = fs.statSync(filename);
      return { path: normalize(path.relative(root, filename)), kind: "backup", owner: source.owner,
        provenance: { manifest: normalize(path.relative(root, manifest)), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), source: entry.source || null },
        version: typeof entry.version === "string" ? entry.version : null,
        created_at: typeof receipt.generatedAt === "string" && Number.isFinite(Date.parse(receipt.generatedAt)) ? receipt.generatedAt : null,
        logical_bytes: stat.isFile() ? stat.size : null,
        protection_known: false, references: [`recovery-receipt:${normalize(path.relative(root, manifest))}`],
        uncertainty: "Receipt records provenance, not current consumers; directory size is unmeasured" };
    });
  });
}

async function main(args = process.argv.slice(2)) {
  const action = args.shift();
  if (action === "catalog" && !args.length) { console.log(JSON.stringify(catalog(), null, 2)); return 0; }
  if (action === "collect") {
    if (args.length !== 2 || args[0] !== "--native-install-receipt") throw new Error("collect --native-install-receipt <explicit deployment.json>");
    console.log(JSON.stringify(collectRegistrationCandidates([{ owner: "install-native-vscode", manifest: args[1] }]), null, 2)); return 0;
  }
  if (!["plan", "test"].includes(action)) throw new Error("Expected catalog, plan, test or collect; cleanup is owned by the native tool");
  if (args.includes("--prepared")) throw new Error("--prepared is unsupported without trusted owner evidence; use the native extension-prepare dependency and compiled runner, or --allow-prepare");
  const flags = { allowPrepare: args.includes("--allow-prepare") };
  const options = project.parseArgs(args.filter(arg => arg !== "--allow-prepare"));
  const plan = planSelection(options);
  if (action === "plan" || options.list) { console.log(JSON.stringify(plan, null, 2)); return 0; }
  const report = await executeTests(plan, { ...options, ...flags });
  console.log(JSON.stringify(report, null, 2)); return report.exitCode;
}

module.exports = { confined, planSelection, assertTestPlan, executeTests, catalog, collectRegistrationCandidates, main };
if (require.main === module) main().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
