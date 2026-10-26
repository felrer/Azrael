"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
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
assert(fs.existsSync(run.inputs));
assert(run.record.members.some(member => member.role === "inputs" && member.path === run.inputs));
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
const immutable = path.join(project, "artifacts/inputs/source");
recordLifecycle(project, { id: "immutable-input", kind: "work", owner: "input-owner", state: "pending", membership_complete: false, members: [{ path: immutable, role: "input" }], expected_revision: 0 });
fs.mkdirSync(immutable, { recursive: true });
fs.writeFileSync(path.join(immutable, "snapshot.txt"), "immutable source");
const inputConsumer = start("input-consumer", { references: [
  { id: "immutable-input", reason: "immutable source dependency", kind: "dependency" },
  { id: "controller", reason: "active controller", kind: "execution" }
] });
fs.writeFileSync(path.join(inputConsumer.inputs, "handoff.json"), JSON.stringify({ lifecycleId: "immutable-input", path: immutable }));
finishArtifactRun(inputConsumer, { exitCode: 0, producerStopped: true });
assert.deepEqual(inputConsumer.record.references.map(ref => ref.id), ["immutable-input"]);
assert(!inputConsumer.record.members.some(member => member.path === immutable));
assert.equal(fs.readFileSync(path.join(immutable, "snapshot.txt"), "utf8"), "immutable source");
checks.push("input handoff has a distinct role; immutable dependency survives execution reference release without payload ownership");
const proof = run => {
  const evidence_ref = path.join(run.reports, "tree-stopped.json");
  fs.writeFileSync(evidence_ref, JSON.stringify({ fixture: "controller proof", stopped: true }));
  return { producer_stopped_verified: true, evidence_ref, evidence_sha256: createHash("sha256").update(fs.readFileSync(evidence_ref)).digest("hex"), reason: "Controller verified owned process tree stopped" };
};
for (const [id, exitCode, expected, cancellation] of [
  ["strict-success", 0, "complete", undefined],
  ["strict-failure", 7, "failed", undefined],
  ["strict-cancel", 130, "failed", { requested: true, reason: "User cancelled", signal: "SIGTERM" }],
  ["strict-unknown", null, "pending", { requested: true, reason: "Exit unavailable" }]
]) {
  const strict = start(id, { requireStopEvidence: true });
  const stopEvidence = proof(strict);
  const reason = cancellation?.reason ?? "Controller completed";
  assert.equal(finishArtifactRun(strict, { exitCode, producerStopped: true, stopEvidence, reason, cancellation }).state, expected);
  assert.equal(strict.record.producer.exit_code, exitCode);
  assert.equal(strict.record.producer.outcome, exitCode === null ? "unknown" : exitCode === 0 ? "success" : "failure");
  assert.equal(strict.record.membership_complete, exitCode !== null);
  const report = JSON.parse(fs.readFileSync(path.join(strict.reports, "producer.json"), "utf8"));
  assert.equal(report.reason, reason);
  assert.deepEqual(report.cancellation, cancellation);
  assert.equal(report.stopEvidence.evidence_sha256, stopEvidence.evidence_sha256);
}
const unproven = start("strict-unproven", { requireStopEvidence: true });
unproven.onExit(0);
assert.equal(unproven.record.state, "pending");
assert.equal(unproven.record.membership_complete, false);
assert.equal(unproven.record.producer, undefined);
const stopEvidence = proof(unproven);
assert.throws(() => finishArtifactRun(unproven, { exitCode: 0, producerStopped: true, stopEvidence: { ...stopEvidence, producer_stopped_verified: false } }), /Verified/);
assert.throws(() => finishArtifactRun(unproven, { exitCode: 0, producerStopped: true, stopEvidence: { ...stopEvidence, evidence_sha256: "0".repeat(64) } }), /SHA256/);
assert.throws(() => finishArtifactRun(unproven, { exitCode: 0, producerStopped: true, stopEvidence: { ...stopEvidence, evidence_ref: fixture } }), /outside project/);
const proofLink = path.join(unproven.reports, "linked-proof");
fs.symlinkSync(immutable, proofLink, process.platform === "win32" ? "junction" : "dir");
try {
  assert.throws(() => finishArtifactRun(unproven, { exitCode: 0, producerStopped: true, stopEvidence: { ...stopEvidence, evidence_ref: path.join(proofLink, "snapshot.txt") } }), /Linked/);
} finally { fs.unlinkSync(proofLink); }
const reportProof = path.join(unproven.reports, "producer.json");
assert.throws(() => finishArtifactRun(unproven, { exitCode: 0, producerStopped: true, stopEvidence: { ...stopEvidence, evidence_ref: reportProof, evidence_sha256: createHash("sha256").update(fs.readFileSync(reportProof)).digest("hex") } }), /overwritten/);
assert.equal(unproven.record.producer, undefined);
assert.equal(finishArtifactRun(unproven, { exitCode: 0, producerStopped: true, stopEvidence }).state, "complete");
checks.push("controller proof required on explicit finish and onExit; success, failure, cancellation and unknown actual exits retained; changed, outside and linked proof rejected");
const signalled = start("strict-signalled", { requireStopEvidence: true });
const signalCancellation = { requested: true, reason: "User cancelled" };
assert.equal(finishArtifactRun(signalled, { exitCode: null, signal: "SIGTERM", producerStopped: true, cancellation: signalCancellation }).state, "pending");
assert.equal(signalled.record.producer, undefined);
assert.equal(signalled.record.membership_complete, false);
const pendingSignal = JSON.parse(fs.readFileSync(path.join(signalled.reports, "producer.json"), "utf8"));
assert.equal(pendingSignal.signal, "SIGTERM");
assert.equal(pendingSignal.producerStopped, false);
const signalProof = proof(signalled);
for (const signal of ["TERM", "sigterm", "SIGTERM\n", "SIG-TERM", "", 15, {}, []]) {
  assert.throws(() => finishArtifactRun(signalled, { exitCode: null, signal, producerStopped: true, stopEvidence: signalProof }), /signal/);
}
for (const exitCode of [0, 7, 130]) {
  assert.throws(() => finishArtifactRun(signalled, { exitCode, signal: "SIGTERM", producerStopped: true, stopEvidence: signalProof }), /both/);
}
assert.equal(signalled.record.producer, undefined);
assert.equal(finishArtifactRun(signalled, { exitCode: null, signal: "SIGTERM", producerStopped: true, stopEvidence: signalProof, reason: "Observed SIGTERM after cancellation", cancellation: signalCancellation }).state, "failed");
assert.equal(signalled.record.producer.outcome, "failure");
assert.equal(signalled.record.producer.exit_code, null);
assert.equal(signalled.record.membership_complete, true);
const signalReport = JSON.parse(fs.readFileSync(path.join(signalled.reports, "producer.json"), "utf8"));
assert.equal(signalReport.signal, "SIGTERM");
assert.equal(signalReport.exitCode, null);
assert.equal(signalReport.reason, "Observed SIGTERM after cancellation");
assert.deepEqual(signalReport.cancellation, signalCancellation);
assert.equal(JSON.parse(fs.readFileSync(path.join(project, "artifacts/tasks/writers/runs/strict-unknown/reports/producer.json"), "utf8")).signal, null);
checks.push("observed signal with controller stop proof closes failure with actual null exit; signal without proof stays pending; malformed/conflicting signal input rejected; cancellation alone remains unknown");
for (const id of ["../escape", "a/b", "NUL", "CON.txt", "trailing."]) assert.throws(() => start(id), /Invalid artifact/);
assert.throws(() => start("outside", { paths: { temporary: path.dirname(project) } }), /outside/);
const external = path.join(project, "artifacts/verification/explicit");
const explicit = start("explicit", { paths: { temporary: external } });
assert.equal(explicit.temporary, external);
assert(explicit.record.members.some(member => member.path === external));
assert.throws(() => start("explicit-collision", { paths: { temporary: external } }), /exists|claimed/);
checks.push("safe IDs, containment and explicit path ownership");
const externalInputs = path.join(project, "artifacts/verification/input-handoffs");
const customInputs = start("custom-inputs", { paths: { inputs: externalInputs } });
assert.equal(customInputs.inputs, externalInputs);
assert(customInputs.record.members.some(member => member.path === externalInputs && member.role === "inputs"));
assert.throws(() => start("immutable-claim", { paths: { inputs: immutable } }), /exists|claimed/);
const overlapRoot = path.join(project, "artifacts/tasks/writers/runs/role-overlap");
assert.throws(() => start("role-overlap", { paths: { inputs: path.join(overlapRoot, "temporary/nested") } }), /Overlapping/);
assert.throws(() => start("same-role", { paths: { inputs: externalInputs, logs: externalInputs } }), /Overlapping/);
assert.throws(() => start("ancestor-role", { paths: { inputs: path.join(project, "artifacts/tasks") } }), /Overlapping/);
assert(!fs.existsSync(overlapRoot));
checks.push("custom input destinations retain ownership guards; resolved default/custom role overlap rejected before creation");
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
const claimLock = path.join(project, "artifacts/maintenance/lifecycles/.run-claim.lock");
const waitClaimCode = `
  const fs=require('node:fs'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
  const helper=require(${helper}),lock=${JSON.stringify(claimLock)},ready=lock+'.ready';
  const code='const fs=require(\"node:fs\"),{acquire}=require('+${JSON.stringify(JSON.stringify(require.resolve("./maintenance-lock-owner.cjs")))}+');const lease=acquire('+JSON.stringify(lock)+',{operation:\"test.claim-owner\"});fs.writeFileSync('+JSON.stringify(ready)+',\"ready\");setTimeout(()=>lease.release(),500);';
  const producer=spawn(process.execPath,['-e',code],{stdio:'inherit',windowsHide:true});
  const deadline=performance.now()+5000;
  while(!fs.existsSync(ready)){assert(performance.now()<deadline,'claim owner readiness timed out');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
  const started=performance.now();
  const run=helper.beginArtifactRun(${JSON.stringify(project)},{workId:'writers',owner:'test-artifact-run',runId:'waited-claim'});
  assert(performance.now()-started>=100,'run claim did not wait for normal release');
  helper.finishArtifactRun(run,{exitCode:0,producerStopped:true});fs.unlinkSync(ready);
  producer.on('exit',code=>assert.equal(code,0));
`;
const waitedClaim = spawnSync(process.execPath, ["-e", waitClaimCode], { encoding: "utf8", windowsHide: true, timeout: 15000 });
assert.equal(waitedClaim.status, 0, waitedClaim.stderr);
assert.equal(catalog(project).find(record => record.id.endsWith(":waited-claim")).state, "complete");
assert(!fs.existsSync(claimLock));
checks.push("concurrent run claim waits for normal owner release without removing the marker");
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
const strictChild = start("strict-child", { requireStopEvidence: true });
const child = new (require("node:events").EventEmitter)();
trackArtifactChild(strictChild, child);
const childProof = proof(strictChild);
assert.equal(finishArtifactRun(strictChild, { exitCode: 0, producerStopped: true, stopEvidence: childProof }).state, "pending");
child.emit("close");
assert.equal(finishArtifactRun(strictChild, { exitCode: 0, producerStopped: true }).state, "pending");
assert.equal(finishArtifactRun(strictChild, { exitCode: null, producerStopped: true, stopEvidence: childProof }).state, "pending");
assert.equal(strictChild.record.producer.outcome, "unknown");
assert.equal(strictChild.record.membership_complete, false);
checks.push("child close alone cannot prove a controller tree stopped; proven stop with unknown exit remains protected");
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
