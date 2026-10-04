"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, select, runCommand } = require("./test-project.cjs");
const selection = args => select(parseArgs(args));

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
