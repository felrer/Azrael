"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { beginArtifactRun, finishArtifactRun, trackArtifactChild } = require("./artifact-run.cjs");
const { catalog, recordLifecycle } = require("./artifact-lifecycle.cjs");
// Caller owns and registers this fresh test directory before invocation.
const fixture = process.argv[2];
assert(fixture && path.isAbsolute(fixture), "fresh absolute fixture required");
fs.mkdirSync(fixture);
const project = path.join(fixture, "project"); fs.mkdirSync(project);
const start = (runId, options = {}) => beginArtifactRun(project, { workId: "writers", owner: "test-artifact-run", runId, ...options });
const checks = [];
const run = start("normal");
assert.equal(catalog(project)[0].state, "pending");
assert.equal(catalog(project)[0].membership_complete, false);
assert(fs.existsSync(run.outputs));
fs.writeFileSync(path.join(run.outputs, "payload.txt"), "retained");
assert.equal(finishArtifactRun(run, { exitCode: 0, producerStopped: true }).state, "complete");
assert.throws(() => start("normal"), /already exists|claimed|revision/);
checks.push("precreation ownership, complete result, collision refusal, retained payload");
const failed = start("failed");
assert.equal(finishArtifactRun(failed, { exitCode: 7, producerStopped: true }).state, "failed");
assert.equal(failed.record.membership_complete, true);
assert.equal(failed.record.producer.outcome, "failure");
assert.equal(failed.record.producer.exit_code, 7);
const unknown = start("unknown"); unknown.producerStopped = false;
assert.equal(finishArtifactRun(unknown, { exitCode: null, producerStopped: false }).state, "pending");
assert.equal(unknown.record.membership_complete, false);
checks.push("known failed producer closes while unknown termination remains incomplete");
for (const id of ["../escape", "a/b", "NUL", "CON.txt", "trailing."]) assert.throws(() => start(id), /Invalid artifact/);
assert.throws(() => start("outside", { paths: { temporary: path.dirname(project) } }), /outside/);
const external = path.join(project, "artifacts/verification/explicit");
const explicit = start("explicit", { paths: { temporary: external } });
assert.equal(explicit.temporary, external);
assert(explicit.record.members.some(member => member.path === external));
assert.throws(() => start("explicit-collision", { paths: { temporary: external } }), /exists|claimed/);
checks.push("safe IDs, containment and explicit path ownership");
const claimed = path.join(project, "artifacts/tasks/writers/runs/claimed");
recordLifecycle(project, { id: "prior-claim", kind: "run", owner: "other", state: "pending", membership_complete: false, members: [{ path: claimed, role: "run" }], expected_revision: 0 });
assert.throws(() => start("claimed"), /claimed/); assert(!fs.existsSync(claimed));
const linked = path.join(project, "artifacts/tasks/link");
fs.symlinkSync(fixture, linked, process.platform === "win32" ? "junction" : "dir");
try {
  assert.throws(() => beginArtifactRun(project, { workId: "link", owner: "test" }), /Linked/);
} finally {
  // End this test's deliberate link before the owning run reaches review.
  // Unlink only the exact newly created link; never recurse into its target.
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(linked), fs.realpathSync(fixture));
  fs.unlinkSync(linked);
  assert.equal(fs.existsSync(fixture), true);
}
checks.push("registry-only claim and linked destination rejected before creation");
const helper = JSON.stringify(require.resolve("./artifact-run.cjs"));
const childCode = suffix => `const fs=require('fs'),h=require(${helper});const r=h.beginArtifactRun(${JSON.stringify(project)},{workId:'writers',owner:'test-artifact-run',runId:${JSON.stringify(suffix)}});`;
const failedProcess = spawnSync(process.execPath, ["-e", childCode("uncaught") + "throw Error('intentional writer failure');"], { encoding: "utf8" });
assert.equal(failedProcess.status, 1);
assert.equal(catalog(project).find(record => record.id.endsWith(":uncaught")).state, "failed");
// Inject failure into the first run-root mkdir after its pending claim was recorded.
const partialCode = `const fs=require('fs'),mkdir=fs.mkdirSync;fs.mkdirSync=(p,o)=>{if(String(p).endsWith('partial'))throw Error('intentional mkdir failure');return mkdir(p,o)};require(${helper}).beginArtifactRun(${JSON.stringify(project)},{workId:'writers',owner:'test-artifact-run',runId:'partial'});`;
const partial = spawnSync(process.execPath, ["-e", partialCode], { encoding: "utf8" });
assert.equal(partial.status, 1);
const partialRecord = catalog(project).find(record => record.id.endsWith(":partial"));
assert.equal(partialRecord.state, "failed"); assert.equal(partialRecord.membership_complete, true);
checks.push("uncaught writer and partial preparation failures reconciled");
const fake = new (require("node:events").EventEmitter)(); trackArtifactChild(unknown, fake);
assert.equal(finishArtifactRun(unknown, { exitCode: 0, producerStopped: true }).state, "pending");
fake.emit("close"); unknown.producerStopped = true;
assert.equal(finishArtifactRun(unknown, { exitCode: 0, producerStopped: true }).state, "complete");
checks.push("unclosed owned child prevents success until actual close");
const reportFailure = start("report-failure");
fs.renameSync(reportFailure.reports, reportFailure.reports + "-retained");
fs.writeFileSync(reportFailure.reports, "blocked report directory");
assert.throws(() => finishArtifactRun(reportFailure, { exitCode: 0, producerStopped: true }));
assert.equal(catalog(project).find(record => record.id === reportFailure.lifecycleId).state, "pending");
process.removeListener("exit", reportFailure.onExit);
checks.push("failed producer report cannot leave a completed lifecycle");
fs.writeFileSync(path.join(fixture, "expected-failures.json"), JSON.stringify({ uncaught: failedProcess.stderr, partial: partial.stderr }, null, 2));
async function browserDrainChecks() {
  const vm = require('node:vm');
  const { EventEmitter } = require('node:events');
  const source = fs.readFileSync(require.resolve('./artifact-run.cjs'), 'utf8');
  async function checkBrowser({ platform = 'win32', snapshots = [[]], live = false, signal = null, onInspect } = {}) {
    let clock = 0, inspections = 0, released = false;
    const child = new EventEmitter();
    Object.assign(child, { pid: 123, exitCode: live || signal ? null : 0, signalCode: signal,
      unref() { released = true; }, stderr: { destroy() {} } });
    const sandbox = { module: { exports: {} }, require, process: { platform, env: process.env },
      Date: { now: () => clock }, setTimeout(callback, ms) {
        Promise.resolve().then(() => { clock += ms; callback(); }); return 1;
      }, clearTimeout() {} };
    vm.runInNewContext(source, sandbox, { filename: 'artifact-run.cjs' });
    const spawn = (command, args, options) => {
      assert.equal(platform, 'win32');
      assert(path.isAbsolute(command));
      assert.equal(options.env.AZRAEL_RENDER_BROWSER_PID, '123');
      assert.equal(options.env.AZRAEL_RENDER_BROWSER_PROFILE, 'owned-profile');
      assert(options.timeout > 0 && options.timeout <= 10000 - clock);
      assert(args[2].includes("Name = 'chrome.exe'"));
      assert(args[2].includes('AZRAEL_RENDER_BROWSER_PROFILE'));
      const snapshot = snapshots[Math.min(inspections++, snapshots.length - 1)];
      const query = new EventEmitter(); query.stdout = new EventEmitter(); query.stderr = new EventEmitter();
      Promise.resolve().then(() => {
        clock += snapshot.elapsed ?? 0;
        onInspect?.(child, inspections);
        if (snapshot.error) { query.emit('error', Error(snapshot.error)); return; }
        query.stdout.emit('data', snapshot.raw ?? JSON.stringify(snapshot.ids ?? snapshot));
        query.emit('close', snapshot.code ?? 0);
      });
      return query;
    };
    const result = await sandbox.module.exports.confirmOwnedBrowserExit(child, 'owned-profile', spawn);
    return { result, clock, inspections, released };
  }
  let observed = await checkBrowser({ snapshots: [[456], []] });
  assert.equal(observed.result.confirmed, true); assert.equal(observed.inspections, 2);
  assert.equal(observed.clock, 200); assert.equal(observed.released, true);
  observed = await checkBrowser({ snapshots: [[456]] });
  assert.equal(observed.result.confirmed, false); assert.equal(observed.clock, 10000);
  assert.deepEqual(Array.from(observed.result.processIds), [456]);
  assert.equal(observed.result.exitCode, 0); assert.equal(observed.released, false);
  observed = await checkBrowser({ snapshots: [{ ids: [456], elapsed: 800 }] });
  assert.equal(observed.result.confirmed, false); assert.equal(observed.clock, 10000);
  assert.equal(observed.inspections, 10, 'Inspection time and pauses share one total budget');
  observed = await checkBrowser({ snapshots: [[456], { code: 1, ids: [] }] });
  assert.equal(observed.result.confirmed, false);
  assert.deepEqual(Array.from(observed.result.processIds), [456], 'Failed inspection preserves last successful process evidence');
  observed = await checkBrowser({ live: true });
  assert.equal(observed.result.confirmed, false); assert.equal(observed.clock, 10000);
  assert.equal(observed.result.exitCode, null);
  observed = await checkBrowser({ live: true, onInspect(child, count) { if (count === 2) child.exitCode = 0; } });
  assert.equal(observed.result.confirmed, true); assert.equal(observed.inspections, 2);
  for (const snapshot of [{ code: 1, ids: [] }, { raw: 'invalid JSON' }, { raw: '{}' }, { ids: ['ambiguous'] }, { error: 'inspection unavailable' }]) {
    observed = await checkBrowser({ snapshots: [snapshot] });
    assert.equal(observed.result.confirmed, false); assert(observed.result.inspectionError);
    assert.equal(observed.inspections, 1); assert.equal(observed.released, false);
  }
  observed = await checkBrowser();
  assert.equal(observed.result.confirmed, true); assert.equal(observed.inspections, 1);
  observed = await checkBrowser({ signal: 'SIGTERM' });
  assert.equal(observed.result.confirmed, true); assert.equal(observed.result.signalCode, 'SIGTERM');
  for (const platform of ['linux', 'darwin']) {
    observed = await checkBrowser({ platform });
    assert.equal(observed.result.confirmed, true); assert.equal(observed.inspections, 0);
    observed = await checkBrowser({ platform, live: true });
    assert.equal(observed.result.confirmed, false); assert.equal(observed.clock, 10000);
    assert.equal(observed.inspections, 0);
  }
  checks.push('bounded Windows browser drain, actual root exit required, timeout evidence preserved, inspections fail closed, Unix behavior retained');
}
browserDrainChecks().then(() => {
  console.log(JSON.stringify({ status: "passed", checks, fixture, retained: true }));
}).catch(error => { console.error(error); process.exitCode = 1; });
