"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, runSelection } = require("./test-project.cjs");

function selection(names) {
  return { files: ["fixture.cjs"], reasons: [], separateChecks: [], coverageStatus: "selected-source-scope",
    commands: names.map(name => ({ name, executable: process.execPath, args: ["fixture.cjs"], cwd: process.cwd(), files: [] })) };
}

async function fixture(names, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-source-runner-"));
  const calls = [];
  try {
    const report = await runSelection(selection(names), { directory, runCommand: async command => {
      calls.push(command.name);
      return { status: "passed", exitCode: 0 };
    }, ...options });
    const saved = JSON.parse(fs.readFileSync(report.resultPath, "utf8"));
    return { report, saved, calls };
  } finally { fs.rmSync(directory, { recursive: true }); }
}

test("failure collection requires an explicit CLI flag", () => {
  assert.equal(parseArgs([]).collectFailures, false);
  assert.equal(parseArgs(["--collect-failures"]).collectFailures, true);
});

test("source failure stops every later command group and retains planned scope", async () => {
  const calls = [];
  const { report, saved } = await fixture(["source", "native-fixture", "extension-build", "extension-changed"], {
    runCommand: async command => { calls.push(command.name); return { status: "failed", exitCode: 7 }; },
  });
  assert.deepEqual(calls, ["source"]);
  assert.equal(report.exitCode, 7);
  assert.equal(report.status, "failed");
  assert.equal(saved.commands.length, 4);
  assert.deepEqual(saved.plannedCommands, saved.commands);
  assert.equal(saved.results.length, 1);
  assert.equal(saved.skipped.length, 3);
  assert.ok(saved.skipped.every(command => /Stopped after.*source/.test(command.reason)));
});

test("diagnostic collection continues independent groups and preserves first failure exit", async () => {
  const calls = [];
  const { report } = await fixture(["source", "native-fixture", "extension-build", "extension-changed"], {
    collectFailures: true,
    runCommand: async command => {
      calls.push(command.name);
      return command.name === "source" ? { status: "failed", exitCode: 3 } : { status: "passed", exitCode: 0 };
    },
  });
  assert.deepEqual(calls, ["source", "native-fixture", "extension-build", "extension-changed"]);
  assert.equal(report.exitCode, 3);
  assert.equal(report.skipped.length, 0);
});

test("failed extension compilation blocks dependent tests even in collection mode", async () => {
  const calls = [];
  const { report } = await fixture(["source", "extension-build", "extension-changed", "independent-fixture"], {
    collectFailures: true,
    runCommand: async command => {
      calls.push(command.name);
      return command.name === "extension-build" ? { status: "failed", exitCode: 2 } : { status: "passed", exitCode: 0 };
    },
  });
  assert.deepEqual(calls, ["source", "extension-build", "independent-fixture"]);
  assert.equal(report.skipped[0].name, "extension-changed");
  assert.match(report.skipped[0].reason, /Dependency extension-build/);
  assert.equal(report.exitCode, 2);
});

for (const outcome of [{ status: "passed", exitCode: null }, { status: "passed", exitCode: 4 },
  { status: "running", exitCode: 0 }, { status: "spawn-error", exitCode: null }, undefined]) {
  test(`failed or incomplete outcome cannot pass: ${JSON.stringify(outcome)}`, async () => {
    const { report } = await fixture(["source", "later"], { runCommand: async () => outcome });
    assert.equal(report.status, "failed");
    assert.notEqual(report.exitCode, 0);
    assert.equal(report.results.length, 1);
    assert.equal(report.skipped.length, 1);
  });
}

test("runner exceptions retain failure checkpoints", async () => {
  const { report, saved } = await fixture(["source", "later"], { runCommand: async () => { throw new Error("fixture launch failure"); } });
  assert.equal(report.exitCode, 1);
  assert.equal(saved.results[0].status, "runner-error");
  assert.equal(saved.results[0].error, "fixture launch failure");
});

test("checkpoints retain partial running state and UTC/wall metrics for completed groups", async () => {
  const snapshots = [];
  const { report, saved } = await fixture(["source", "later"], {
    onCheckpoint: (_report, resultPath) => snapshots.push(JSON.parse(fs.readFileSync(resultPath, "utf8"))),
    runCommand: async command => {
      const running = snapshots.at(-1);
      assert.equal(running.activeCommand.name, command.name);
      assert.equal(running.completedUtc, null);
      assert.equal(running.exitCode, null);
      assert.equal(running.activeCommand.completedUtc, null);
      assert.equal(running.activeCommand.exitCode, null);
      return { status: "passed", exitCode: 0 };
    },
  });
  assert.equal(snapshots.filter(snapshot => snapshot.activeCommand).length, 2);
  assert.ok(snapshots.some(snapshot => snapshot.results.length === 1 && snapshot.activeCommand === null));
  assert.equal(report.exitCode, 0);
  assert.equal(saved.status, "passed");
  for (const record of [saved, ...saved.results]) {
    assert.match(record.startedUtc, /Z$/);
    assert.match(record.completedUtc, /Z$/);
    assert.ok(Date.parse(record.completedUtc) >= Date.parse(record.startedUtc));
    assert.ok(record.wallTimeMs >= 0);
  }
});

test("real lightweight Node commands record failure logs without scheduling successors", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-source-process-"));
  try {
    const selected = selection(["source", "later"]);
    selected.commands[0].args = ["-e", "console.error('fixture failure'); process.exitCode = 9"];
    selected.commands[1].args = ["-e", "throw new Error('must never start')"];
    const report = await runSelection(selected, { directory });
    assert.equal(report.exitCode, 9);
    assert.equal(report.results.length, 1);
    assert.match(fs.readFileSync(report.results[0].stderr, "utf8"), /fixture failure/);
    assert.equal(fs.existsSync(path.join(directory, "02-later.stdout.log")), false);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test("interrupted runner leaves completed groups and active incomplete group readable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-source-interrupted-"));
  try {
    const script = `const {runSelection} = require(${JSON.stringify(path.join(__dirname, "test-project.cjs"))});
      runSelection(${JSON.stringify(selection(["source", "later"]))}, {
        directory: ${JSON.stringify(directory)}, runCommand: async command => {
          if (command.name === 'later') process.exit(11);
          return {status:'passed',exitCode:0};
        }
      });`;
    const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    assert.equal(child.status, 11, child.stderr);
    const saved = JSON.parse(fs.readFileSync(path.join(directory, "results.json"), "utf8"));
    assert.equal(saved.status, "running");
    assert.equal(saved.completedUtc, null);
    assert.equal(saved.exitCode, null);
    assert.equal(saved.results[0].status, "passed");
    assert.equal(saved.activeCommand.name, "later");
    assert.equal(saved.activeCommand.completedUtc, null);
  } finally { fs.rmSync(directory, { recursive: true }); }
});
