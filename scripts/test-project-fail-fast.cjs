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


test("default runs register before execution and separate logs from successful reports", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-managed-run-"));
  const lifecycle = require("./artifact-lifecycle.cjs");
  try {
    const report = await runSelection(selection(["source"]), { root, workId: "BI-01-fixture", runCommand: async (_command, directory) => {
      const records = lifecycle.catalog(root);
      assert.equal(records.length, 1);
      assert.equal(records[0].state, "pending");
      assert.equal(records[0].membership_complete, false);
      assert.equal(directory, path.join(records[0].members[0].path, "logs"));
      fs.writeFileSync(path.join(directory, "fixture.stdout.log"), "fixture");
      return { status: "passed", exitCode: 0 };
    } });
    assert.equal(path.relative(root, report.runRoot).split(path.sep).slice(0, 4).join("/"), "artifacts/tasks/BI-01-fixture/runs");
    assert.match(path.basename(report.runRoot), /^\d{4}-.*-[0-9a-f-]{36}$/);
    assert.equal(report.logDirectory, path.join(report.runRoot, "logs"));
    assert.equal(report.resultPath, path.join(report.runRoot, "reports/results.json"));
    assert.equal(fs.existsSync(path.join(report.logDirectory, "results.json")), false);
    const record = lifecycle.catalog(root)[0];
    assert.equal(record.id, report.lifecycleId);
    assert.equal(record.state, "complete");
    assert.equal(record.membership_complete, true);
    assert.deepEqual(record.members.map(member => member.role), ["run", "logs", "reports"]);
    assert.equal(JSON.parse(fs.readFileSync(report.resultPath)).status, "passed");
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("managed failures and checkpoint errors protect the incomplete producer", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-managed-failure-"));
  const lifecycle = require("./artifact-lifecycle.cjs");
  try {
    const report = await runSelection(selection(["source", "later"]), { root, runCommand: async () => ({ status: "failed", exitCode: 6 }) });
    assert.equal(report.exitCode, 6);
    assert.equal(report.skipped.length, 1);
    await assert.rejects(runSelection(selection(["source"]), { root, onCheckpoint: () => { throw new Error("checkpoint fixture"); }, runCommand: () => assert.fail("must not execute") }), /checkpoint fixture/);
    const records = lifecycle.catalog(root);
    assert.equal(records.length, 2);
    assert.ok(records.every(record => record.state === "failed" && !record.membership_complete));
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("producer registration failure prevents run creation and test execution", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-producer-failure-"));
  try {
    fs.mkdirSync(path.join(root, "artifacts/maintenance"), { recursive: true });
    fs.writeFileSync(path.join(root, "artifacts/maintenance/lifecycles"), "blocked registry");
    await assert.rejects(runSelection(selection(["source"]), { root, runCommand: () => assert.fail("must not execute") }), /EEXIST|ENOTDIR/);
    assert.equal(fs.existsSync(path.join(root, "artifacts/tasks")), false);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("interrupted managed runs retain pending metadata and the active checkpoint", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-managed-interrupted-"));
  try {
    const script = `const {runSelection} = require(${JSON.stringify(path.join(__dirname, "test-project.cjs"))});
      runSelection(${JSON.stringify(selection(["source", "later"]))}, { root: ${JSON.stringify(root)},
        runCommand: async command => { if (command.name === 'later') process.exit(12); return {status:'passed',exitCode:0}; }
      });`;
    const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    assert.equal(child.status, 12, child.stderr);
    const record = require("./artifact-lifecycle.cjs").catalog(root)[0];
    assert.equal(record.state, "pending");
    assert.equal(record.membership_complete, false);
    const saved = JSON.parse(fs.readFileSync(path.join(record.members[0].path, "reports/results.json")));
    assert.equal(saved.status, "running");
    assert.equal(saved.results[0].status, "passed");
    assert.equal(saved.activeCommand.name, "later");
    assert.equal(saved.completedUtc, null);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("explicit log base and exact directory preserve legacy layout without lifecycle records", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-legacy-run-"));
  try {
    for (const override of [{ logDirectory: "custom-logs" }, { directory: path.join(root, "exact") }]) {
      const report = await runSelection(selection([]), { root, workId: "unused", ...override });
      assert.equal(report.lifecycleId, undefined);
      assert.equal(report.runRoot, undefined);
      assert.equal(path.basename(report.resultPath), "results.json");
      if (override.directory) assert.equal(report.resultPath, path.join(override.directory, "results.json"));
      else assert.equal(path.dirname(path.dirname(report.resultPath)), path.join(root, "custom-logs"));
    }
    assert.deepEqual(require("./artifact-lifecycle.cjs").catalog(root), []);
    assert.equal(fs.existsSync(path.join(root, "artifacts")), false);
  } finally { fs.rmSync(root, { recursive: true }); }
});
