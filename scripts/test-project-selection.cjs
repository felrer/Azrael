"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { AREAS, parseArgs, select, runCommand } = require("./test-project.cjs");
const selection = args => select(parseArgs(args));

test("twelve areas retain the eight original scopes and expose bounded feature/cache selections", () => {
  assert.equal(AREAS.length, 12);
  for (const area of ["current", "extension", "standalone", "queue", "recovery", "ui", "namespace", "build"]) assert.ok(AREAS.includes(area));
  const settings = selection(["--area", "settings"]);
  assert.ok(settings.files.includes("scripts/test-instruction-settings.cjs"));
  assert.ok(settings.extensionFiles.includes("extensions/azrael-ex/test/instructionView.test.ts"));
  assert.ok(!settings.files.includes("scripts/test-window-control-policy.cjs"));
  assert.ok(!settings.extensionFiles.includes("extensions/azrael-ex/test/accountService.test.ts"));
  const accounts = selection(["--area", "accounts"]);
  assert.ok(accounts.extensionFiles.includes("extensions/azrael-ex/test/accountService.test.ts"));
  assert.ok(accounts.extensionFiles.includes("extensions/azrael-ex/test/usageRefresh.test.ts"));
  assert.ok(!accounts.extensionFiles.includes("extensions/azrael-ex/test/instructionView.test.ts"));
  const window = selection(["--area", "window-control"]);
  assert.ok(window.files.includes("scripts/test-window-control-policy.cjs"));
  assert.ok(window.files.includes("scripts/test-computer-use-runtime.cjs"));
  assert.ok(!window.commands.some(command => command.executable === "npm"));
  const cache = selection(["--area", "build-cache"]);
  assert.ok(cache.commands.some(command => command.files.includes("scripts/test-build-module-cache.ps1")));
  assert.ok(!cache.commands.some(command => command.files.includes("scripts/test-deploy-azrael.ps1")));
  assert.ok(!cache.files.includes("scripts/test-instruction-settings.cjs"));
});

test("feature unions run shared files once and build TypeScript once with only selected tests", () => {
  const settings = selection(["--area", "settings"]);
  const accounts = selection(["--area", "accounts"]);
  const union = selection(["--area", "settings", "--area", "accounts", "--area", "settings"]);
  assert.deepEqual(union.extensionFiles, [...new Set([...settings.extensionFiles, ...accounts.extensionFiles])].sort());
  assert.equal(union.commands.filter(command => command.name === "extension-build").length, 1);
  assert.equal(union.commands.filter(command => command.name === "extension-changed").length, 1);
  const executed = union.commands.flatMap(command => command.files);
  assert.equal(new Set(executed).size, executed.length);
  assert.ok(!union.commands.some(command => command.args.includes("test:all")));
});

test("broad source/build/cache unions never repeat a build regression", () => {
  for (const args of [["--area", "ui", "--area", "build", "--area", "build-cache"], ["--area", "current", "--area", "build"]]) {
    const result = selection(args);
    const executed = result.commands.flatMap(command => command.files);
    assert.equal(executed.length, new Set(executed).size);
    for (const file of ["scripts/test-ordered-asset-reader.cjs", "scripts/test-incremental-extension-build.cjs"]) {
      assert.equal(executed.filter(test => test === file).length, 1);
    }
  }
});

test("standalone and feature union retains both contracts without a whole extension sweep", () => {
  const result = selection(["--area", "standalone", "--area", "settings"]);
  assert.ok(result.extensionFiles.includes("extensions/azrael-ex/test/standaloneHostContract.test.ts"));
  assert.ok(result.extensionFiles.includes("extensions/azrael-ex/test/instructionView.test.ts"));
  assert.ok(!result.extensionFiles.includes("extensions/azrael-ex/test/accountService.test.ts"));
  assert.equal(result.commands.filter(command => command.name === "extension-build").length, 1);
  assert.ok(!result.commands.some(command => command.args.includes("test:all")));
});

test("registered fixture owners enter changed-only selection without live native or broad build checks", () => {
  for (const [source, owner] of [["scripts/window-control-policy.cjs", "scripts/test-window-control-policy.cjs"], ["scripts/student-avatar-assets.cjs", "scripts/test-student-avatar-assets.cjs"]]) {
    const result = selection(["--changed-only", "--changed", source]);
    assert.ok(result.files.includes(owner));
    assert.ok(!result.files.includes("scripts/test-window-use-native.cjs"));
    assert.ok(!result.files.includes("scripts/test-deploy-azrael.ps1"));
    assert.ok(!result.commands.some(command => command.executable === "npm"));
    assert.ok(!result.separateChecks.some(check => check.startsWith(source + ":")));
  }
});

test("queue/recovery union executes each file once in one isolated Node test command", () => {
  const result = selection(["--area", "queue", "--area", "recovery"]);
  assert.equal(result.files.filter(file => file.endsWith("test-queue-consumption.cjs")).length, 1);
  assert.equal(result.commands.length, 1);
  assert.deepEqual(result.commands[0].args.slice(0, 2), ["--test", "--test-concurrency=4"]);
  assert.equal(result.files.length, 12);
});

test("shared and unknown sources select current including new root and tooling tests", () => {
  for (const changed of ["scripts/namespace-azrael-host.cjs", "some-new-source.js"]) {
    const result = selection(["--changed", changed]);
    assert.ok(result.areas.includes("current"));
    assert.ok(result.files.includes("scripts/test-project-selection.cjs"));
    assert.ok(result.files.includes("scripts/tests/sync-codex-environment.test.cjs"));
    assert.ok(result.commands.some(command => command.name === "extension"));
    assert.ok(!result.areas.includes("build"));
  }
});

test("standalone owners select extension and standalone; configs select the full partition", () => {
  for (const changed of ["extensions/azrael-ex/src/chatSession.ts", "extensions/azrael-ex/src/appServerTransport.ts", "extensions/azrael-ex/src/hostRuntime.ts", "extensions/azrael-ex/src/extension.ts", "extensions/azrael-ex/src/sharedTypes.ts", "extensions/azrael-ex/test/standaloneHostContract.test.ts"]) {
    const result = selection(["--changed", changed]);
    assert.ok(result.areas.includes("extension"));
    assert.ok(result.areas.includes("standalone"));
    const npmCommands = result.commands.filter(command => command.executable === "npm");
    assert.equal(npmCommands.length, 1);
    assert.deepEqual(npmCommands[0].args, ["run", "test:all"]);
  }
  const result = selection(["--changed", "extensions/azrael-ex/package.json"]);
  assert.ok(result.areas.includes("current"));
  assert.ok(result.areas.includes("standalone"));
  assert.deepEqual(selection(["--area", "extension"]).commands.at(-1).args, ["run", "test:current"]);
  assert.deepEqual(selection(["--area", "standalone"]).commands.at(-1).args, ["run", "test:standalone"]);
});

test("docs select none; direct module owners select bounded areas; build changes select build", () => {
  const docs = selection(["--changed", "docs/README.md"]);
  assert.equal(docs.commands.length, 0);
  assert.match(docs.reasons[0].reason, /documentation/i);
  const queue = selection(["--changed", "scripts/inject-queue-consumption.cjs"]);
  assert.ok(queue.areas.includes("queue"));
  assert.ok(queue.areas.includes("recovery"));
  assert.ok(!queue.areas.includes("current"));
  const build = selection(["--changed", "scripts/build-metrics.ps1"]);
  assert.ok(build.areas.includes("build"));
  assert.ok(build.areas.includes("current"));
  for (const changed of ["scripts/install-independent-vscode.ps1", "scripts/prepare-independent-host.ps1"]) {
    const operational = selection(["--changed", changed]);
    assert.ok(operational.areas.includes("current"));
    assert.ok(operational.areas.includes("build"));
    assert.equal(operational.separateChecks.length, 1);
  }
  assert.equal(selection(["--changed", "artifacts/worktrees/engine/src/foo.rs"]).separateChecks.length, 1);
});

test("invalid CLI flags and areas reject", () => {
  assert.throws(() => parseArgs(["--other"]), /Unknown option/);
  assert.throws(() => parseArgs(["--area", "other"]), /Unknown area/);
  assert.throws(() => parseArgs(["--changed"]), /Missing value/);
});

test("deployment tooling selects its isolated build regressions without running installation", () => {
  for (const changed of ["scripts/deploy-azrael.ps1", "scripts/test-deploy-azrael.ps1", "scripts/deployment-input-snapshot.cjs", "scripts/test-deployment-input-snapshot.cjs"]) {
    const result = selection(["--changed", changed]);
    const commands = result.commands.filter(command => command.files.includes("scripts/test-deploy-azrael.ps1"));
    assert.equal(commands.length, 1);
    assert.equal(commands[0].executable, "pwsh");
    assert.deepEqual(commands[0].args, ["-NoProfile", "-File", "scripts/test-deploy-azrael.ps1"]);
    assert.ok(result.commands.every(command => !command.args.includes("scripts/deploy-azrael.ps1")));
    assert.ok(result.separateChecks.length > 0);
  }
});

test("new root node:test files are discovered as current and unclassified UI; list is read-only", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-project-selection-"));
  try {
    fs.mkdirSync(path.join(directory, "scripts/tests"), { recursive: true });
    fs.writeFileSync(path.join(directory, "scripts/test-future.cjs"), "const test = require ('node:test');\n");
    fs.writeFileSync(path.join(directory, "scripts/tests/future-tool.test.cjs"), "// source tooling test\n");
    const current = select(parseArgs(["--area", "current"]), directory);
    assert.ok(current.files.includes("scripts/test-future.cjs"));
    assert.ok(current.files.includes("scripts/tests/future-tool.test.cjs"));
    const ui = select(parseArgs(["--area", "ui"]), directory);
    assert.deepEqual(ui.files, ["scripts/test-future.cjs"]);
    const logs = path.join(directory, "unused-logs");
    const listed = spawnSync(process.execPath, [path.join(__dirname, "test-project.cjs"), "--changed", "docs/README.md", "--list", "--log-directory", logs], { encoding: "utf8" });
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).commands.length, 0);
    assert.equal(fs.existsSync(logs), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("child failures retain their actual exit status and bounded file logs", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-project-runner-"));
  try {
    const result = await runCommand({ name: "failure", executable: process.execPath, args: ["-e", "console.error('intentional failure'); process.exit(7)"], cwd: process.cwd(), files: [] }, directory, 0);
    assert.equal(result.exitCode, 7);
    assert.equal(result.status, "failed");
    assert.match(fs.readFileSync(result.stderr, "utf8"), /intentional failure/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("changed-only selects direct queue/recovery owners without whole-area expansion", () => {
  const result = selection(["--changed-only", "--changed", "scripts/inject-queue-consumption.cjs"]);
  assert.equal(result.areas.length, 0);
  assert.ok(result.files.includes("scripts/test-queue-consumption.cjs"));
  assert.ok(!result.files.includes("scripts/test-queue-refresh.cjs"));
  assert.ok(!result.files.includes("scripts/test-recovery-state.cjs"));
  for (const file of result.files) {
    assert.match(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), /require\(["']\.\/inject-queue-consumption\.cjs["']\)/);
  }
});

test("changed-only shared inputs retain namespace checks without selecting current or extension", () => {
  const result = selection(["--changed-only", "--changed", "scripts/namespace-azrael-host.cjs"]);
  assert.ok(result.files.includes("scripts/test-namespace-source.cjs"));
  assert.ok(result.files.includes("scripts/test-preservation-integration.cjs"));
  assert.ok(!result.files.includes("scripts/test-project-selection.cjs"));
  assert.ok(!result.commands.some(command => command.executable === "npm"));
  assert.deepEqual(result.areas, []);
});

test("changed-only unknowns are visible, docs/assets select none, changed tests select only themselves", () => {
  const unknown = selection(["--changed-only", "--changed", "some-new-source.js"]);
  assert.equal(unknown.commands.length, 0);
  assert.match(unknown.reasons[0].reason, /No direct test owner/);
  assert.ok(unknown.separateChecks.some(reason => reason.includes("some-new-source.js")));
  const docs = selection(["--changed-only", "--changed", "docs/README.md", "--changed", "extensions/azrael-ex/media/chat.svg"]);
  assert.equal(docs.commands.length, 0);
  assert.equal(docs.reasons.length, 2);
  const changedTest = selection(["--changed-only", "--changed", "scripts/test-queue-consumption.cjs"]);
  assert.deepEqual(changedTest.files, ["scripts/test-queue-consumption.cjs"]);
  const runner = selection(["--changed-only", "--changed", "scripts/test-project.cjs"]);
  assert.deepEqual(runner.files, ["scripts/test-project-selection.cjs"]);
  assert.deepEqual(selection(["--changed-only", "--area", "standalone"]).commands.at(-1).args, ["run", "test:standalone"]);
});

test("changed-only build owners do not select deployment mocks by association", () => {
  for (const [source, owner] of [
    ["scripts/ordered-asset-reader.cjs", "scripts/test-ordered-asset-reader.cjs"],
    ["scripts/deployment-input-snapshot.cjs", "scripts/test-deployment-input-snapshot.cjs"],
    ["scripts/build-metrics.ps1", "scripts/test-build-metrics.ps1"],
    ["extensions/azrael-ex/scripts/build-incremental.cjs", "scripts/test-incremental-extension-build.cjs"],
  ]) {
    const result = selection(["--changed-only", "--changed", source]);
    assert.deepEqual(result.files, [owner]);
    assert.equal(result.commands.length, 1);
  }
  const changedTest = selection(["--changed-only", "--changed", "scripts/test-deploy-azrael.ps1"]);
  assert.deepEqual(changedTest.files, ["scripts/test-deploy-azrael.ps1"]);
  assert.deepEqual(changedTest.commands[0].args, ["-NoProfile", "-File", "scripts/test-deploy-azrael.ps1", "-ChangedOnly"]);
  const deploy = selection(["--changed-only", "--changed", "scripts/deploy-azrael.ps1"]);
  assert.deepEqual(deploy.commands[0].args, changedTest.commands[0].args);
});

test("changed-only operational engine, host, provenance and benchmark scripts require their owning phases", () => {
  const operational = [
    ["scripts/test-accepted-input-engine.mjs", /Post-build engine acceptance.*arguments/],
    ["scripts/test-parked-root-steering.mjs", /Post-build parked-root acceptance.*arguments/],
    ["scripts/test-independent-namespace.cjs", /Six-stage host verification.*prepared extension/],
    ["scripts/test-namespace-performance.cjs", /benchmark is disabled/],
    ["scripts/tests/check-release-source-root.ps1", /Release provenance verification.*context/],
    ["scripts/test-future-operational.mjs", /no approved argument-free source runner/],
  ];
  for (const [file, reason] of operational) {
    const result = selection(["--changed-only", "--changed", file]);
    assert.deepEqual(result.files, []);
    assert.deepEqual(result.commands, []);
    assert.match(result.reasons.find(item => item.path === file).reason, reason);
    assert.ok(result.separateChecks.some(check => check.includes(file) && reason.test(check)));
  }
});

test("changed-only TypeScript owners preserve affected standalone tests and compile only selected test execution", () => {
  for (const owner of ["chatSession", "appServerTransport", "hostRuntime"]) {
    const result = selection(["--changed-only", "--changed", `extensions/azrael-ex/src/${owner}.ts`]);
    assert.ok(result.extensionFiles.includes(`extensions/azrael-ex/test/${owner}.test.ts`));
    assert.deepEqual(result.commands.find(command => command.name === "extension-build").args, ["run", "build:incremental"]);
    const tests = result.commands.find(command => command.name === "extension-changed");
    assert.ok(tests.args.includes(`dist/test/${owner}.test.js`));
    assert.ok(!tests.args.includes("dist/test/instructionView.test.js"));
    assert.ok(!result.commands.some(command => command.args.some(arg => /^test:(all|current|standalone)$/.test(arg))));
  }
  const changedTest = selection(["--changed-only", "--changed", "extensions/azrael-ex/test/standaloneHostContract.test.ts"]);
  assert.deepEqual(changedTest.extensionFiles, ["extensions/azrael-ex/test/standaloneHostContract.test.ts"]);
  const config = selection(["--changed-only", "--changed", "extensions/azrael-ex/tsconfig.json"]);
  assert.equal(config.commands.length, 0);
  assert.ok(config.separateChecks.some(reason => reason.includes("tsconfig.json")));
});

test("changed-only without explicit paths discovers current Git changes and list creates no runner logs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-changed-selection-"));
  try {
    fs.mkdirSync(path.join(directory, "scripts"));
    fs.writeFileSync(path.join(directory, "scripts/test-new.cjs"), "const test = require('node:test');\n");
    const git = spawnSync("git", ["init", "--quiet"], { cwd: directory, encoding: "utf8" });
    assert.equal(git.status, 0, git.stderr);
    const commit = spawnSync("git", ["-c", "user.name=Selector", "-c", "user.email=selector@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "fixture"], { cwd: directory, encoding: "utf8" });
    assert.equal(commit.status, 0, commit.stderr);
    const result = select(parseArgs(["--changed-only"]), directory);
    assert.deepEqual(result.changed, ["scripts/test-new.cjs"]);
    assert.deepEqual(result.files, ["scripts/test-new.cjs"]);
    const logs = path.join(directory, "unused-logs");
    const listed = spawnSync(process.execPath, [path.join(__dirname, "test-project.cjs"), "--changed-only", "--changed", "docs/README.md", "--list", "--log-directory", logs], { encoding: "utf8" });
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).commands.length, 0);
    assert.equal(fs.existsSync(logs), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
