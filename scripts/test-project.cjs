"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const QUEUE = ["queue-refresh", "queued-compaction", "queued-input", "queue-consumption", "compaction-progress", "account-switch-queue"].map(name => `scripts/test-${name}.cjs`);
const RECOVERY = ["recovery-state", "recovery-bridge", "fetch-response", "queue-consumption", "send-result-integration", "immediate-stop", "edit-stop-integration"].map(name => `scripts/test-${name}.cjs`);
const NAMESPACE = ["scripts/test-integrated-entry.cjs", "scripts/test-namespace-source.cjs"];
const BUILD = ["scripts/test-incremental-extension-build.cjs", "scripts/test-ordered-asset-reader.cjs", "scripts/test-deployment-input-snapshot.cjs", "scripts/test-build-metrics.ps1", "scripts/test-deploy-azrael.ps1"];
const AREAS = ["current", "extension", "standalone", "queue", "recovery", "ui", "namespace", "build"];
const SHARED = new Set(["scripts/namespace-azrael-host.cjs", "scripts/integrated-azrael-entry.cjs", "scripts/asset-transform-cache.cjs", "scripts/test-project.cjs"]);
const normalize = value => value.replace(/\\/g, "/").replace(/^\.\//, "");

function parseArgs(args) {
  const options = { areas: [], changed: [], list: false, logDirectory: "artifacts/logs/project-tests" };
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === "--list") { options.list = true; continue; }
    if (!["--area", "--changed", "--log-directory"].includes(option)) throw new Error(`Unknown option: ${option}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
    if (option === "--area") {
      if (!AREAS.includes(value)) throw new Error(`Unknown area: ${value}`);
      options.areas.push(value);
    } else if (option === "--changed") options.changed.push(normalize(value));
    else options.logDirectory = value;
  }
  return options;
}

function discover(root) {
  const files = [];
  for (const name of fs.readdirSync(path.join(root, "scripts"))) {
    if (/^test-.*\.cjs$/.test(name)) {
      const file = `scripts/${name}`;
      if (/require\s*\(\s*["']node:test["']\s*\)/.test(fs.readFileSync(path.join(root, file), "utf8"))) files.push(file);
    }
  }
  const directory = path.join(root, "scripts/tests");
  if (fs.existsSync(directory)) {
    for (const name of fs.readdirSync(directory)) if (name.endsWith(".test.cjs")) files.push(`scripts/tests/${name}`);
  }
  return files.sort();
}

function changedFiles(root) {
  const files = new Set();
  for (const args of [["diff", "HEAD", "--name-only", "-z"], ["ls-files", "--others", "--exclude-standard", "-z"]]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.error || result.status !== 0) throw new Error(`git discovery failed: ${result.error?.message || result.stderr.trim()}`);
    for (const file of result.stdout.split("\0")) if (file) files.add(normalize(file));
  }
  return [...files].sort();
}

function select(options, root = ROOT) {
  const discovered = discover(root);
  const files = new Set();
  const areas = new Set();
  const reasons = [];
  const separateChecks = new Set();
  const ui = discovered.filter(file => file.startsWith("scripts/test-") && ![...QUEUE, ...RECOVERY, ...NAMESPACE].includes(file));
  const add = (area, reason) => {
    reasons.push({ area, reason });
    if (areas.has(area)) return;
    areas.add(area);
    const selected = { queue: QUEUE, recovery: RECOVERY, namespace: NAMESPACE, ui, current: [...discovered, ...NAMESPACE] }[area];
    if (selected) for (const file of selected) files.add(file);
    if (area === "current") areas.add("extension");
  };
  const changed = options.changed.length ? options.changed : options.areas.length ? [] : changedFiles(root);
  const owners = new Map();
  for (const file of discovered) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of text.matchAll(/require\(["'](\.\/[^"']+)["']\)/g)) {
      const module = normalize(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
      if (!owners.has(module)) owners.set(module, new Set());
      owners.get(module).add(file);
    }
  }
  for (const area of options.areas) add(area, "explicit --area");
  for (const file of changed) {
    if (/\.(md|markdown)$/i.test(file)) { reasons.push({ path: file, reason: "Markdown documentation only; no source tests selected" }); continue; }
    if (/(?:engine|provider|codex-rs|artifacts\/worktrees|^scripts\/(?:install-|prepare-|deploy-|deployment-input-snapshot|test-deployment-input-snapshot|test-deploy-))/i.test(file)) separateChecks.add("Packaged, native, install/preparation and live acceptance belongs to the separate operational checks; source tests do not establish it.");
    const buildChange = /(?:^scripts\/(?:build-|install-|prepare-|deploy-|package-|test-(?:incremental-extension-build|ordered-asset-reader|deployment-input-snapshot|build-metrics|deploy-azrael|preparation-routing))|^scripts\/(?:ordered-asset-reader|preparation-state|deployment-input-snapshot)\.|^extensions\/azrael-ex\/scripts\/build-)/.test(file);
    if (buildChange) add("build", `build tooling changed: ${file}`);
    if (SHARED.has(file)) { add("current", `shared source changed: ${file}`); continue; }
    if (file.startsWith("extensions/azrael-ex/")) {
      add("extension", `extension changed: ${file}`);
      if (/\/(?:chatSession|appServerTransport|hostRuntime)\.[^/]+$|\/standalone[^/]*\.test\.ts$/.test(file)) add("standalone", `standalone owner changed: ${file}`);
      if (/^extensions\/azrael-ex\/(?:scripts\/|package(?:-lock)?\.json$|tsconfig[^/]*\.json$)/.test(file)) {
        add("current", `extension runner/config/dependency changed: ${file}`);
        add("standalone", `extension runner/config/dependency changed: ${file}`);
      } else if (/^extensions\/azrael-ex\/src\/(?:.*(?:runtime|transport|types|config|dependency).*|extension\.ts)$/i.test(file)) {
        add("current", `shared extension runtime input changed: ${file}`);
        add("standalone", `shared extension runtime input changed: ${file}`);
      }
      continue;
    }
    if (NAMESPACE.includes(file)) { add("namespace", `namespace test changed: ${file}`); continue; }
    const matching = owners.get(file) || (discovered.includes(file) ? new Set([file]) : null);
    if (matching) {
      for (const test of matching) {
        if (QUEUE.includes(test)) add("queue", `owner test ${test} for ${file}`);
        if (RECOVERY.includes(test)) add("recovery", `owner test ${test} for ${file}`);
        if (!QUEUE.includes(test) && !RECOVERY.includes(test)) { files.add(test); reasons.push({ path: file, test, reason: "direct source owner" }); }
      }
    } else add("current", `unmapped change conservatively selects current: ${file}`);
  }
  if (!changed.length && !options.areas.length) reasons.push({ reason: "No changed paths; no tests selected" });
  const commands = [];
  if (files.size) commands.push({ name: "source", executable: process.execPath, args: ["--test", "--test-concurrency=4", ...[...files].sort()], cwd: root, files: [...files].sort() });
  if (areas.has("extension") || areas.has("standalone")) {
    const both = areas.has("extension") && areas.has("standalone");
    commands.push({ name: both ? "extension-all" : areas.has("extension") ? "extension" : "standalone", executable: "npm", args: ["run", `test:${both ? "all" : areas.has("extension") ? "current" : "standalone"}`], cwd: path.join(root, "extensions/azrael-ex"), files: [] });
  }
  if (areas.has("build")) for (const file of BUILD) commands.push({ name: path.basename(file, path.extname(file)), executable: file.endsWith(".ps1") ? "pwsh" : process.execPath, args: file.endsWith(".ps1") ? ["-NoProfile", "-File", file] : [file], cwd: root, files: [file] });
  return { changed, areas: [...areas], files: [...files].sort(), reasons, separateChecks: [...separateChecks], commands };
}

async function runCommand(command, directory, index) {
  const stem = `${String(index + 1).padStart(2, "0")}-${command.name}`;
  const stdout = path.join(directory, `${stem}.stdout.log`);
  const stderr = path.join(directory, `${stem}.stderr.log`);
  const out = fs.openSync(stdout, "w"), err = fs.openSync(stderr, "w");
  const started = Date.now();
  let executable = command.executable, args = command.args;
  if (process.platform === "win32" && executable === "npm") {
    // Only our fixed npm commands enter cmd.exe; changed paths never enter shell text.
    if (args.length !== 2 || args[0] !== "run" || !["test:current", "test:standalone", "test:all"].includes(args[1])) throw new Error("Unexpected npm command");
    executable = process.env.ComSpec || "cmd.exe";
    args = ["/d", "/s", "/c", `npm.cmd run ${args[1]}`];
  }
  try {
    return await new Promise(resolve => {
      const child = spawn(executable, args, { cwd: command.cwd, stdio: ["ignore", out, err], windowsHide: true });
      child.once("error", error => {
        fs.writeSync(err, `${error.stack}\n`);
        resolve({ ...command, exitCode: null, status: "spawn-error", error: error.message, durationMs: Date.now() - started, stdout, stderr });
      });
      child.once("close", (exitCode, signal) => resolve({ ...command, exitCode, signal, status: exitCode === 0 ? "passed" : "failed", durationMs: Date.now() - started, stdout, stderr }));
    });
  } finally { fs.closeSync(out); fs.closeSync(err); }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const selection = select(options);
  if (options.list) { console.log(JSON.stringify(selection, null, 2)); return 0; }
  const directory = path.resolve(ROOT, options.logDirectory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`);
  fs.mkdirSync(directory, { recursive: true });
  const results = [];
  for (const command of selection.commands) {
    const result = await runCommand(command, directory, results.length);
    results.push(result);
    console.log(`${command.name}: ${result.status} (exit ${result.exitCode}, ${result.durationMs}ms)`);
  }
  const resultPath = path.join(directory, "results.json");
  fs.writeFileSync(resultPath, JSON.stringify({ ...selection, results }, null, 2) + "\n");
  console.log(`${selection.files.length} source files selected; results: ${resultPath}`);
  for (const check of selection.separateChecks) console.log(check);
  const failure = results.find(result => result.status !== "passed");
  return failure ? (failure.exitCode > 0 ? failure.exitCode : 1) : 0;
}

module.exports = { parseArgs, discover, changedFiles, select, runCommand, main };
if (require.main === module) main().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
