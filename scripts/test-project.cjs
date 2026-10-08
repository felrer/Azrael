"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const QUEUE = ["queue-refresh", "queued-compaction", "queued-input", "queue-consumption", "compaction-progress", "account-switch-queue"].map(name => `scripts/test-${name}.cjs`);
const RECOVERY = ["recovery-state", "recovery-bridge", "fetch-response", "queue-consumption", "send-result-integration", "immediate-stop", "edit-stop-integration"].map(name => `scripts/test-${name}.cjs`);
const NAMESPACE = ["scripts/test-integrated-entry.cjs", "scripts/test-namespace-source.cjs", "scripts/test-feature-preservation.cjs", "scripts/test-preservation-integration.cjs"];
const BUILD = ["scripts/test-build-module-cache.ps1", "scripts/test-incremental-extension-build.cjs", "scripts/test-ordered-asset-reader.cjs", "scripts/test-deployment-input-snapshot.cjs", "scripts/test-build-metrics.ps1", "scripts/test-deploy-azrael.ps1"];
const AREAS = ["current", "extension", "standalone", "queue", "recovery", "ui", "namespace", "build", "settings", "accounts", "window-control", "build-cache"];
const FEATURE_TESTS = {
  settings: /(?:test-(?:instruction-settings|account-settings|student-design|student-avatar-assets|pets-cleanup)\.cjs$|\/(?:instructionService|instructionView|studentDesign)\.test\.ts$)/,
  accounts: /(?:test-(?:account-settings|account-switch-queue|provider-accounts-host|provider-context|provider-model-picker)\.cjs$|\/(?:accountService|accountPresentation|autoAccountSwitch|providerAccountService|resetCredit|unifiedAccountsPresentation|usage[^/]*)\.test\.ts$)/,
  "window-control": /\/test-(?:window-(?:control|use|task)[^/]*|window-approval-notifications|selected-window-native|computer-use[^/]*)\.cjs$/,
  "build-cache": /\/test-(?:build-module-cache\.ps1|incremental-extension-build\.cjs|ordered-asset-reader\.cjs|asset-transform-cache(?:-retention)?\.cjs)$/,
};
// Approved argument-free fixture scripts that do not import node:test.
const FEATURE_FIXTURES = ["student-avatar-assets", "window-control-policy", "window-control-host", "window-control-backend", "window-control-mcp", "window-control-approval", "window-task-macros", "computer-use-runtime"]
  .map(name => `scripts/test-${name}.cjs`);
const SHARED = new Set(["scripts/namespace-azrael-host.cjs", "scripts/integrated-azrael-entry.cjs", "scripts/asset-transform-cache.cjs", "scripts/test-project.cjs"]);
const normalize = value => value.replace(/\\/g, "/").replace(/^\.\//, "");

function parseArgs(args) {
  const options = { areas: [], changed: [], changedOnly: false, list: false, logDirectory: "artifacts/logs/project-tests" };
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === "--list") { options.list = true; continue; }
    if (option === "--changed-only") { options.changedOnly = true; continue; }
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
  // Explicit areas retain their full-area contracts, even with --changed-only.
  if (options.changedOnly && !options.areas.length) return selectChanged(options, root);
  const discovered = discover(root);
  const files = new Set();
  const areas = new Set();
  const reasons = [];
  const separateChecks = new Set();
  const extensionFiles = new Set();
  let extension;
  const fixtures = FEATURE_FIXTURES.filter(file => fs.existsSync(path.join(root, file)));
  const ui = [...new Set([...discovered.filter(file => file.startsWith("scripts/test-") && ![...QUEUE, ...RECOVERY, ...NAMESPACE].includes(file)), ...fixtures])];
  const add = (area, reason) => {
    reasons.push({ area, reason });
    if (areas.has(area)) return;
    areas.add(area);
    const selected = { queue: QUEUE, recovery: RECOVERY, namespace: NAMESPACE, build: BUILD, ui, current: [...discovered, ...NAMESPACE, ...fixtures] }[area];
    if (selected) for (const file of selected) files.add(file);
    if (FEATURE_TESTS[area]) {
      for (const file of new Set([...discovered, ...BUILD, ...FEATURE_FIXTURES])) {
        if (FEATURE_TESTS[area].test(file) && fs.existsSync(path.join(root, file))) files.add(file);
      }
      if (["settings", "accounts"].includes(area)) {
        extension ||= extensionOwners(root);
        for (const file of extension.tests) if (FEATURE_TESTS[area].test(file)) extensionFiles.add(file);
      }
    }
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
  const scripts = new Set([...files].filter(file => BUILD.includes(file)));
  if (areas.has("build")) for (const file of BUILD) scripts.add(file);
  const source = [...files].filter(file => !scripts.has(file)).sort();
  if (source.length) commands.push({ name: "source", executable: process.execPath, args: ["--test", "--test-concurrency=4", ...source], cwd: root, files: source });
  if (areas.has("standalone") && !areas.has("extension") && extensionFiles.size) {
    const { STANDALONE_FILES } = require(path.join(extension.extension, "scripts/run-tests.cjs"));
    for (const file of extension.tests) if (STANDALONE_FILES.includes(path.basename(file).replace(/\.ts$/, ".js"))) extensionFiles.add(file);
    commands.push(...selectedExtensionCommands([...extensionFiles].sort(), extension.extension, root));
  } else if (areas.has("extension") || areas.has("standalone")) {
    const both = areas.has("extension") && areas.has("standalone");
    commands.push({ name: both ? "extension-all" : areas.has("extension") ? "extension" : "standalone", executable: "npm", args: ["run", `test:${both ? "all" : areas.has("extension") ? "current" : "standalone"}`], cwd: path.join(root, "extensions/azrael-ex"), files: [] });
  } else if (extensionFiles.size) {
    commands.push(...selectedExtensionCommands([...extensionFiles].sort(), extension.extension, root));
  }
  for (const file of [...scripts].sort()) commands.push({ name: path.basename(file, path.extname(file)), executable: file.endsWith(".ps1") ? "pwsh" : process.execPath, args: file.endsWith(".ps1") ? ["-NoProfile", "-File", file] : [file], cwd: root, files: [file] });
  return { changed, areas: [...areas], files: [...files].sort(), extensionFiles: [...extensionFiles].sort(), reasons, separateChecks: [...separateChecks], coverageStatus: separateChecks.size ? "requires-separate-checks" : "selected-source-scope", commands };
}

function selectedExtensionCommands(files, extension, root) {
  const compiled = files.map(file => normalize(path.relative(extension, path.join(root, file))).replace(/\.ts$/, ".js"));
  return [
    { name: "extension-build", executable: "npm", args: ["run", "build:incremental"], cwd: extension, files: [] },
    { name: "extension-changed", executable: process.execPath, args: ["--test", "--test-concurrency=4", ...compiled.map(file => `dist/${file}`)], cwd: extension, files },
  ];
}

function extensionOwners(root) {
  const extension = path.join(root, "extensions/azrael-ex");
  const ts = require(require.resolve("typescript", { paths: [extension] }));
  const configPath = path.join(extension, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, extension);
  if (parsed.errors.length) throw new Error(ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, "\n"));
  const tests = parsed.fileNames.filter(file => /\.test\.ts$/.test(file));
  const owners = new Map(), dependencies = new Map();
  for (const file of tests) {
    const test = normalize(path.relative(root, file));
    const visited = new Set();
    const visit = filename => {
      if (visited.has(filename) || !fs.existsSync(filename)) return;
      visited.add(filename);
      if (!dependencies.has(filename)) {
        const imports = ts.preProcessFile(fs.readFileSync(filename, "utf8"), true, true).importedFiles;
        const resolvedImports = [];
        for (const imported of imports) {
          if (!imported.fileName.startsWith(".")) continue;
          const resolved = ts.resolveModuleName(imported.fileName, filename, parsed.options, ts.sys).resolvedModule;
          // Keep deleted imports visible too; NodeNext .js imports refer to .ts sources.
          const fallback = path.resolve(path.dirname(filename), imported.fileName).replace(/\.js$/, ".ts");
          const dependency = resolved?.resolvedFileName || (path.extname(fallback) ? fallback : `${fallback}.ts`);
          const source = normalize(path.relative(root, dependency));
          if (!source.startsWith("../") && !source.includes("/node_modules/")) resolvedImports.push(dependency);
        }
        dependencies.set(filename, resolvedImports);
      }
      for (const dependency of dependencies.get(filename)) {
        const source = normalize(path.relative(root, dependency));
        if (!owners.has(source)) owners.set(source, new Set());
        owners.get(source).add(test);
        visit(dependency);
      }
    };
    visit(file);
  }
  return { owners, tests: tests.map(file => normalize(path.relative(root, file))), extension };
}

function scriptOwners(candidates, root, owners = new Map()) {
  const dependencies = new Map();
  for (const test of candidates.filter(file => /\.(?:cjs|mjs)$/.test(file))) {
    const visited = new Set();
    const visit = file => {
      if (visited.has(file)) return;
      visited.add(file);
      // Namespace composes every UI feature; its declared feature owners below
      // prevent one feature test from inheriting every unrelated injector.
      if (file === "scripts/namespace-azrael-host.cjs") return;
      if (!dependencies.has(file)) {
        const imports = [];
        const filename = path.join(root, file);
        if (fs.existsSync(filename) && /\.(?:cjs|mjs|js)$/.test(file)) {
          const source = fs.readFileSync(filename, "utf8");
          for (const match of source.matchAll(/require\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
            let dependency = path.resolve(path.dirname(filename), match[1]);
            try { dependency = require.resolve(dependency); } catch {
              // An unresolved literal still owns its deleted path.
            }
            const relative = normalize(path.relative(root, dependency));
            if (!relative.startsWith("../") && !relative.includes("/node_modules/")) imports.push(relative);
          }
        }
        dependencies.set(file, imports);
      }
      for (const dependency of dependencies.get(file)) {
        if (!owners.has(dependency)) owners.set(dependency, new Set());
        owners.get(dependency).add(test);
        visit(dependency);
      }
    };
    visit(test);
    // Declared dynamic feature inputs also retain their local helper dependencies.
    for (const [source, tests] of owners) if (tests.has(test)) visit(source);
  }
  return owners;
}

function declaredFeatureOwners(owners, candidates, root) {
  const manifestPath = path.join(root, "scripts/azrael-feature-contracts.json");
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  for (const feature of manifest.features) {
    if (feature.area !== "ui") continue;
    for (const check of feature.checks) {
      if (check.level !== "source") continue;
      const tests = check.args.filter(argument => candidates.includes(argument));
      for (const input of [...feature.owners, ...(check.cacheInputs?.files || [])]) {
        if (!owners.has(input)) owners.set(input, new Set());
        for (const test of tests) owners.get(input).add(test);
      }
    }
  }
}

function selectChanged(options, root) {
  const changed = options.changed.length ? options.changed : changedFiles(root);
  const discovered = discover(root);
  // Script-style build tests are intentionally outside node:test discovery.
  const operationalTestPhases = {
    "scripts/test-accepted-input-engine.mjs": "Post-build engine acceptance requires fresh engine and output arguments",
    "scripts/test-parked-root-steering.mjs": "Post-build parked-root acceptance requires fresh engine and output arguments",
    "scripts/test-independent-namespace.cjs": "Six-stage host verification requires a prepared extension",
    "scripts/test-namespace-performance.cjs": "Optional benchmark is disabled for changed-only source verification",
    "scripts/tests/check-release-source-root.ps1": "Release provenance verification requires explicit source and release context",
  };
  const candidates = [...new Set([...discovered, ...NAMESPACE, ...BUILD, ...FEATURE_FIXTURES])]
    .filter(file => !operationalTestPhases[file] && fs.existsSync(path.join(root, file)));
  const owners = new Map();
  // Owners using dynamic paths or PowerShell dot-sourcing cannot enter require discovery.
  for (const [source, test] of [
    ["extensions/azrael-ex/scripts/build-incremental.cjs", "scripts/test-incremental-extension-build.cjs"],
    ["scripts/build-metrics.ps1", "scripts/test-build-metrics.ps1"],
    ["scripts/build-module-cache.ps1", "scripts/test-build-module-cache.ps1"],
    ["scripts/deploy-azrael.ps1", "scripts/test-deploy-azrael.ps1"],
    ["scripts/feature-preservation.cjs", "scripts/test-feature-preservation.cjs"],
    ["scripts/azrael-feature-contracts.json", "scripts/test-feature-preservation.cjs"],
    ["scripts/verification-result-cache.cjs", "scripts/test-verification-result-cache.cjs"],
    ["scripts/native-verification-cache.cjs", "scripts/test-native-verification-cache.cjs"],
  ]) {
    if (candidates.includes(test)) {
      if (!owners.has(source)) owners.set(source, new Set());
      owners.get(source).add(test);
    }
  }
  const files = new Set(), extensionFiles = new Set(), reasons = [], separateChecks = new Set();
  try { declaredFeatureOwners(owners, candidates, root); }
  catch (error) { separateChecks.add(`Declared feature owner discovery requires a separate check: ${error.message}`); }
  scriptOwners(candidates, root, owners);
  const newInputs = new Set();
  for (const args of [["ls-files", "--others", "--exclude-standard", "-z"], ["diff", "HEAD", "--diff-filter=A", "--name-only", "-z"]]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status === 0) for (const file of result.stdout.split("\0")) if (file) newInputs.add(normalize(file));
  }
  let extension;
  const add = (file, test, reason) => { files.add(test); reasons.push({ path: file, test, reason }); };
  for (const file of changed) {
    if (/\.(md|markdown)$/i.test(file)) {
      reasons.push({ path: file, reason: "Documentation only; no code tests selected" });
      continue;
    }
    if (!fs.existsSync(path.join(root, file)) || newInputs.has(file))
      separateChecks.add(`${file}: New or deleted input requires a separate review of owner coverage`);
    if (/(?:engine|provider|codex-rs|artifacts\/worktrees|^scripts\/(?:install-|prepare-|deploy-|deployment-input-snapshot|test-deployment-input-snapshot|test-deploy-))/i.test(file))
      separateChecks.add("Packaged, native, install/preparation and live acceptance belongs to the separate operational checks; source tests do not establish it.");
    let matched = false;
    if (candidates.includes(file)) { add(file, file, "changed test selects itself"); matched = true; }
    else if (file !== "scripts/test-project.cjs" && /^scripts\/(?:test-[^/]+\.(?:cjs|mjs|ps1)|tests\/[^/]+\.(?:test\.(?:cjs|mjs)|ps1))$/.test(file)) {
      const reason = operationalTestPhases[file] || "Script-style test has no approved argument-free source runner; its owning operational phase must supply context";
      reasons.push({ path: file, reason });
      separateChecks.add(`${file}: ${reason}`);
      continue;
    }
    else {
      for (const test of owners.get(file) || []) { add(file, test, "source dependency owner"); matched = true; }
      if (/^extensions\/azrael-ex\/media\/student-avatars\//.test(file) && candidates.includes("scripts/test-student-avatar-assets.cjs")) {
        add(file, "scripts/test-student-avatar-assets.cjs", "student avatar asset contract owner");
        matched = true;
      }
      if (SHARED.has(file) && file !== "scripts/test-project.cjs") {
        for (const test of NAMESPACE.filter(test => candidates.includes(test))) add(file, test, "shared namespace identity/registry integration check");
        matched = true;
      }
    }
    if (/^extensions\/azrael-ex\/(?:src|test)\/.*\.ts$/.test(file)) {
      try {
        extension ||= extensionOwners(root);
        const tests = extension.tests.includes(file) ? [file] : [...(extension.owners.get(file) || [])];
        for (const test of tests) {
          extensionFiles.add(test);
          reasons.push({ path: file, test, reason: test === file ? "changed extension test selects itself" : "TypeScript dependency owner" });
          matched = true;
        }
      } catch (error) {
        separateChecks.add(`Extension owner discovery requires a separate check for ${file}: ${error.message}`);
      }
    }
    if (!matched) {
      const reason = "No direct test owner mapped; separate check required (no whole-suite fallback)";
      reasons.push({ path: file, reason });
      separateChecks.add(`${file}: ${reason}`);
    }
  }
  if (!changed.length) reasons.push({ reason: "No changed paths; no tests selected" });
  const commands = [];
  const source = [...files].filter(file => !BUILD.includes(file)).sort();
  if (source.length) commands.push({ name: "source", executable: process.execPath, args: ["--test", "--test-concurrency=4", ...source], cwd: root, files: source });
  for (const file of [...files].filter(file => BUILD.includes(file)).sort())
    commands.push({ name: path.basename(file, path.extname(file)), executable: file.endsWith(".ps1") ? "pwsh" : process.execPath,
      args: file.endsWith(".ps1") ? ["-NoProfile", "-File", file, ...(file === "scripts/test-deploy-azrael.ps1" ? ["-ChangedOnly"] : [])] : [file], cwd: root, files: [file] });
  const selectedExtension = [...extensionFiles].sort();
  if (selectedExtension.length) {
    // Incremental build decides whether compilation is stale; never clean dist or run a partition wholesale.
    commands.push(...selectedExtensionCommands(selectedExtension, extension.extension, root));
  }
  return { changed, areas: [], files: [...files].sort(), extensionFiles: selectedExtension, reasons, separateChecks: [...separateChecks], coverageStatus: separateChecks.size ? "requires-separate-checks" : "selected-source-scope", commands };
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
    if (args.length !== 2 || args[0] !== "run" || !["test:current", "test:standalone", "test:all", "build:incremental"].includes(args[1])) throw new Error("Unexpected npm command");
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
    if (command.name === "extension-build" && result.status !== "passed") break;
  }
  const resultPath = path.join(directory, "results.json");
  fs.writeFileSync(resultPath, JSON.stringify({ ...selection, results }, null, 2) + "\n");
  console.log(`${selection.files.length} source files selected; results: ${resultPath}`);
  console.log(`Coverage status: ${selection.coverageStatus}`);
  for (const reason of selection.reasons) console.log(`${reason.path ? `${reason.path}: ` : ""}${reason.reason}${reason.test ? ` (${reason.test})` : ""}`);
  for (const check of selection.separateChecks) console.log(check);
  const failure = results.find(result => result.status !== "passed");
  return failure ? (failure.exitCode > 0 ? failure.exitCode : 1) : 0;
}

module.exports = { AREAS, parseArgs, discover, changedFiles, select, runCommand, main };
if (require.main === module) main().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
