"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { test, after } = require("node:test");
const owner = require("./cargo-target-owner.cjs");
const { createHash } = require("node:crypto");
const { buildCargoTestCommand } = require("./cargo-verification.cjs");
const root = path.resolve(process.env.AZRAEL_CARGO_OWNER_TEST_ROOT || "artifacts/verification/cargo-owner-tests");
fs.mkdirSync(root, { recursive: true });
const helper = path.join(__dirname, "cargo-target-owner.cjs");
const ownedFixtures = [];
// Teardown only links below fresh fixtures allocated by this test process.
// Never follow them into their targets or leave junctions for generic cleanup.
after(() => {
  const removeLinks = directory => {
    for (const name of fs.readdirSync(directory)) {
      const filename = path.join(directory, name), stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) {
        if (process.platform === "win32") fs.rmdirSync(filename);
        else fs.unlinkSync(filename);
      } else if (stat.isDirectory()) removeLinks(filename);
    }
  };
  for (const directory of ownedFixtures) removeLinks(directory);
});
function fixture(name) {
  const cwd = fs.mkdtempSync(path.join(root, name + "-"));
  ownedFixtures.push(cwd);
  const env = { ...process.env, CARGO_TARGET_DIR: path.join(cwd, "target"), INSTA_PENDING_DIR: path.join(cwd, "pending") };
  delete env.AZRAEL_CARGO_CACHE_PROJECT_ROOT;
  return { command: process.execPath, args: ["-e", "process.stdout.write('fake Cargo\\n')"], cwd,
    env,
    stdio: "pipe", encoding: "utf8" };
}
const leasePath = spec => path.join(spec.env.CARGO_TARGET_DIR, ".azrael-cargo-owner");

function recoveryFixture(name) {
  const spec = fixture(name), lease = owner.acquireTargetOwner(spec);
  // Synthetic dead PID observations avoid touching real process lifetimes.
  const metadata = { ...lease.owner, coordinatorPid: 2147483646, producerPid: null, status: "unknown", exitCode: null };
  fs.writeFileSync(lease.ownerPath, JSON.stringify(metadata));
  const evidence = path.join(root, `${path.basename(spec.cwd)}-evidence.json`);
  fs.writeFileSync(evidence, JSON.stringify({ synthetic: true, exactProducerTreeStopped: true }));
  const inspected = owner.inspectTargetOwner({ targetDirectory: spec.env.CARGO_TARGET_DIR });
  return { spec, lease, options: { targetDirectory: spec.env.CARGO_TARGET_DIR, expectedToken: inspected.token,
    expectedOwnerSha256: inspected.ownerSha256, producer_stopped_verified: true, reason: "Synthetic exact tree verification",
    evidence_ref: evidence, evidence_sha256: createHash("sha256").update(fs.readFileSync(evidence)).digest("hex"),
    receipt_ref: path.join(root, `${path.basename(spec.cwd)}-receipt.json`) } };
}
function mockDeadPid(context) {
  context.mock.method(process, "kill", (pid, signal) => {
    assert.equal(signal, 0);
    if (pid === 2147483646) throw Object.assign(new Error("synthetic absent PID"), { code: "ESRCH" });
    if (pid === process.pid) return true;
    throw new Error(`Unexpected PID observation ${pid}`);
  });
}

test("recovery requires exact identity, independent assertion and pinned evidence", context => {
  mockDeadPid(context);
  const { lease, options } = recoveryFixture("recover-refusal");
  for (const altered of [ { expectedToken: "wrong" }, { expectedOwnerSha256: "0".repeat(64) },
    { producer_stopped_verified: false }, { reason: " " }, { evidence_sha256: "0".repeat(64) },
    { evidence_ref: path.join(root, "absent-proof.json") }, { targetDirectory: "relative" },
    { receipt_ref: path.join(options.targetDirectory, "receipt.json") }, { receipt_ref: path.join(lease.owner.cwd, "receipt.json") } ]) {
    assert.throws(() => owner.recoverTargetOwner({ ...options, ...altered }));
    assert.ok(fs.existsSync(lease.ownerPath));
    assert.ok(!fs.existsSync(options.receipt_ref));
  }
  fs.writeFileSync(options.evidence_ref, "changed");
  assert.throws(() => owner.recoverTargetOwner(options), /evidence changed/);
});

test("recovery vetoes live coordinator and producer without trusting PID absence", context => {
  mockDeadPid(context);
  for (const field of ["coordinatorPid", "producerPid"]) {
    const { lease, options } = recoveryFixture(`recover-live-${field}`);
    const metadata = JSON.parse(fs.readFileSync(lease.ownerPath)); metadata[field] = process.pid;
    fs.writeFileSync(lease.ownerPath, JSON.stringify(metadata));
    options.expectedOwnerSha256 = owner.inspectTargetOwner(options).ownerSha256;
    assert.throws(() => owner.recoverTargetOwner(options), /PID is live/);
    assert.ok(fs.existsSync(lease.ownerPath));
    assert.ok(!fs.existsSync(options.receipt_ref));
  }
});

test("explicit recovery preserves unknown/interrupted results and all target payload", context => {
  mockDeadPid(context);
  for (const status of ["running", "unknown", "interrupted"]) {
    const { lease, options } = recoveryFixture(`recover-${status}`);
    const metadata = JSON.parse(fs.readFileSync(lease.ownerPath)); metadata.status = status;
    fs.writeFileSync(lease.ownerPath, JSON.stringify(metadata));
    const original = fs.readFileSync(lease.ownerPath);
    options.expectedOwnerSha256 = owner.inspectTargetOwner(options).ownerSha256;
    const payload = path.join(options.targetDirectory, "warm-cache.bin"); fs.writeFileSync(payload, "warm compiled payload");
    const result = owner.recoverTargetOwner(options);
    assert.equal(result.recovered, true);
    assert.deepEqual(result.result, { status: status === "interrupted" ? status : "unknown", exitCode: null });
    assert.ok(!fs.existsSync(lease.leasePath));
    assert.equal(fs.readFileSync(payload, "utf8"), "warm compiled payload");
    const receipt = JSON.parse(fs.readFileSync(options.receipt_ref));
    assert.equal(receipt.lease.ownerBytesBase64, original.toString("base64"));
    assert.deepEqual(receipt.result, result.result);
    assert.equal(owner.inspectTargetOwner(options).exists, false);
  }
});

test("receipt publication failure and post-publication owner/evidence races retain lease", context => {
  mockDeadPid(context);
  for (const mutation of ["write-failure", "owner", "evidence", "owner-identity", "lease-identity"]) {
    const { lease, options } = recoveryFixture(`recover-race-${mutation}`);
    const originalWrite = fs.writeFileSync;
    const mock = context.mock.method(fs, "writeFileSync", (filename, ...args) => {
      if (filename !== options.receipt_ref) return originalWrite(filename, ...args);
      if (mutation === "write-failure") throw Object.assign(new Error("receipt publication denied"), { code: "EACCES" });
      originalWrite(filename, ...args);
      if (mutation === "owner") originalWrite(lease.ownerPath, JSON.stringify({ ...lease.owner, token: "replacement" }));
      if (mutation === "evidence") originalWrite(options.evidence_ref, "changed after publication");
      if (mutation === "owner-identity") { fs.renameSync(lease.ownerPath, path.join(lease.owner.cwd, "old-owner.json")); originalWrite(lease.ownerPath, Buffer.from(JSON.parse(fs.readFileSync(filename)).lease.ownerBytesBase64, "base64")); }
      if (mutation === "lease-identity") { fs.renameSync(lease.leasePath, path.join(lease.owner.cwd, "old-lease")); fs.mkdirSync(lease.leasePath); originalWrite(lease.ownerPath, Buffer.from(JSON.parse(fs.readFileSync(filename)).lease.ownerBytesBase64, "base64")); }
    });
    assert.throws(() => owner.recoverTargetOwner(options), /changed|denied/);
    mock.mock.restore();
    assert.ok(fs.existsSync(lease.ownerPath));
    assert.equal(fs.existsSync(options.receipt_ref), mutation !== "write-failure");
  }
});

test("ordinary metadata removal failure retains independently readable unknown receipt", context => {
  mockDeadPid(context);
  const { lease, options } = recoveryFixture("recover-unlink-failure");
  const originalUnlink = fs.unlinkSync;
  context.mock.method(fs, "unlinkSync", filename => {
    if (filename === lease.ownerPath) throw Object.assign(new Error("ordinary unlink denied"), { code: "EACCES" });
    return originalUnlink(filename);
  });
  assert.throws(() => owner.recoverTargetOwner(options), /ordinary unlink denied/);
  assert.ok(fs.existsSync(lease.ownerPath));
  assert.deepEqual(JSON.parse(fs.readFileSync(options.receipt_ref)).result, { status: "unknown", exitCode: null });
});

test("tiny process returns exact output/exit and releases normal success and failure", () => {
  const spec = fixture("terminal");
  for (const exit of [0, 7]) {
    spec.args = ["-e", `process.stdout.write('fake Cargo\\n'); process.stderr.write('diagnostic\\n'); process.exitCode=${exit}`];
    const result = owner.runManagedCargoSync(spec);
    assert.equal(result.status, exit);
    assert.equal(result.stdout, "fake Cargo\n");
    assert.equal(result.stderr, "diagnostic\n");
    assert.ok(!fs.existsSync(leasePath(spec)));
  }
});

test("success observer receives exact child result while target ownership is held", context => {
  const spec = fixture("observer-success");
  const child = { status: 0, signal: null, pid: 12345, stdout: "artifact JSON\n", stderr: "diagnostic\n" };
  context.mock.method(require("node:child_process"), "spawnSync", () => child);
  let observedOwner;
  const result = owner.runManagedCargoSync(spec, { onSuccess(result, metadata) {
    assert.equal(result, child);
    observedOwner = metadata;
    assert.equal(metadata.status, "running");
    assert.ok(Number.isFinite(Date.parse(metadata.resultObservedUtc)));
    assert.equal(JSON.parse(fs.readFileSync(path.join(leasePath(spec), "owner.json"))).token, metadata.token);
    assert.throws(() => owner.acquireTargetOwner(spec), /owner conflict/);
    fs.writeFileSync(path.join(spec.cwd, "prepared-artifact"), result.stdout);
  } });
  assert.equal(result, child);
  assert.equal(result.observationError, undefined);
  assert.equal(observedOwner.status, "success");
  assert.equal(observedOwner.exitCode, 0);
  assert.equal(fs.readFileSync(path.join(spec.cwd, "prepared-artifact"), "utf8"), child.stdout);
  assert.ok(!fs.existsSync(leasePath(spec)));
});

test("observer errors preserve successful child evidence and release ownership", context => {
  const spawnMock = context.mock.method(require("node:child_process"), "spawnSync");
  for (const thrown of [new Error("copy failed"), "copy failed"]) {
    const spec = fixture("observer-error");
    const child = { status: 0, signal: null, pid: 12345, stdout: "unchanged\n", stderr: "diagnostic\n" };
    spawnMock.mock.mockImplementation(() => child);
    let observedOwner;
    const result = owner.runManagedCargoSync(spec, { onSuccess(_result, metadata) {
      observedOwner = metadata;
      throw thrown;
    } });
    assert.equal(result, child);
    assert.equal(result.observationError, thrown);
    assert.equal(result.status, 0);
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "unchanged\n");
    assert.equal(result.stderr, "diagnostic\n");
    assert.equal(observedOwner.status, "success");
    assert.equal(observedOwner.exitCode, 0);
    assert.ok(!fs.existsSync(leasePath(spec)));
  }
});

test("failed and unknown child outcomes skip success observation and preserve protection", context => {
  const spawnMock = context.mock.method(require("node:child_process"), "spawnSync");
  const outcomes = [
    { status: 7, signal: null, pid: 12345 },
    { status: null, signal: "SIGTERM", pid: 12345 },
    { status: 0, signal: "SIGTERM", pid: 12345 },
    { status: 0, error: new Error("uncertain child"), pid: 12345 },
  ];
  for (const child of outcomes) {
    const spec = fixture("observer-skipped");
    spawnMock.mock.mockImplementation(() => child);
    const result = owner.runManagedCargoSync(spec, { onSuccess() { assert.fail("unexpected success observation"); } });
    assert.equal(result, child);
    assert.equal(result.observationError, undefined);
    const unknown = Boolean(child.error || child.signal);
    assert.equal(fs.existsSync(leasePath(spec)), unknown);
    if (unknown) {
      const metadata = JSON.parse(fs.readFileSync(path.join(leasePath(spec), "owner.json")));
      assert.equal(metadata.status, "unknown");
      assert.equal(metadata.exitCode, child.status);
      assert.ok(Number.isFinite(Date.parse(metadata.resultObservedUtc)));
      assert.ok(Number.isFinite(metadata.durationMs) && metadata.durationMs >= 0);
      assert.equal(metadata.endedUtc, undefined);
    }
  }
});

test("owner duration uses monotonic invocation time through lease release", context => {
  const spec = fixture("owner-timing");
  context.mock.method(require("node:child_process"), "spawnSync", () => ({ status: 0 }));
  let clockReads = 0;
  context.mock.method(process.hrtime, "bigint", () => {
    if (++clockReads === 1) {
      assert.ok(!fs.existsSync(spec.env.CARGO_TARGET_DIR));
      return 1000000000n;
    }
    assert.ok(!fs.existsSync(leasePath(spec)));
    return 1250000000n;
  });
  let observedOwner;
  owner.runManagedCargoSync(spec, { onSuccess(_result, metadata) { observedOwner = metadata; } });
  assert.equal(clockReads, 2);
  assert.equal(observedOwner.durationMs, 250);
  assert.equal(observedOwner.endedUtc, undefined);
});

test("a second real process cannot enter a target via a junction/symlink or Windows case alias", async () => {
  const spec = fixture("contention");
  const target = spec.env.CARGO_TARGET_DIR;
  fs.mkdirSync(target);
  const alias = path.join(spec.cwd, "alias");
  fs.symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
  spec.args = ["-e", "process.stdout.write('ready\\n'); setTimeout(() => {}, 800)"];
  const code = `const o=require(${JSON.stringify(helper)}); const r=o.runManagedCargoSync(${JSON.stringify({ ...spec, stdio: "inherit" })}); process.exitCode=r.status??1;`;
  const first = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  let diagnostic = "";
  first.stderr.on("data", data => { diagnostic += data; });
  const ended = once(first, "exit");
  await new Promise((resolve, reject) => {
    first.once("error", reject);
    first.stdout.once("data", data => String(data).includes("ready") ? resolve() : reject(new Error("unexpected fake Cargo output")));
    first.once("exit", exit => { if (exit !== 0) reject(new Error(`owner exited: ${diagnostic}`)); });
  });
  const running = JSON.parse(fs.readFileSync(path.join(leasePath(spec), "owner.json"), "utf8"));
  assert.equal(running.coordinatorPid, first.pid);
  assert.equal(running.status, "running");
  for (const spelling of [alias, ...(process.platform === "win32" ? [target.toUpperCase()] : [])]) {
    const second = spawnSync(process.execPath, ["-e", `const o=require(${JSON.stringify(helper)});o.runManagedCargoSync(${JSON.stringify({ ...spec, env: { ...spec.env, CARGO_TARGET_DIR: spelling } })})`], { encoding: "utf8" });
    assert.notEqual(second.status, 0);
    assert.equal(second.stdout, "");
    assert.match(second.stderr, /owner conflict[\s\S]*No Cargo process was launched/);
  }
  assert.deepEqual(await ended, [0, null]);
  assert.ok(!fs.existsSync(leasePath(spec)));
  assert.equal(owner.runManagedCargoSync({ ...spec, args: ["-e", "process.exitCode=0"] }).status, 0);
});

test("unknown and foreign owners retain protection without automatic recovery", () => {
  const spec = fixture("unknown");
  const lease = owner.acquireTargetOwner(spec);
  const result = owner.finishTargetOwner(lease, { status: null, signal: "SIGTERM", pid: 12345 });
  assert.equal(result.status, "unknown");
  assert.equal(result.producerPid, 12345);
  assert.throws(() => owner.runManagedCargoSync(spec), /owner conflict/);
  const altered = { ...result, token: "foreign" };
  fs.writeFileSync(lease.ownerPath, JSON.stringify(altered));
  assert.throws(() => owner.finishTargetOwner(lease, { status: 0 }), /owner changed/);
  assert.equal(JSON.parse(fs.readFileSync(lease.ownerPath)).token, "foreign");
});

test("missing executable releases a lease only when no producer started", () => {
  const spec = fixture("missing");
  const result = owner.runManagedCargoSync({ ...spec, command: path.join(spec.cwd, "missing-cargo") });
  assert.equal(result.error.code, "ENOENT");
  assert.ok(!fs.existsSync(leasePath(spec)));

});

test("explicit target arguments cannot bypass the lease and aliases are pinned before spawn", context => {
  const spec = fixture("explicit-target");
  fs.mkdirSync(spec.env.CARGO_TARGET_DIR);
  const alias = path.join(spec.cwd, "cache-alias");
  fs.symlinkSync(spec.env.CARGO_TARGET_DIR, alias, process.platform === "win32" ? "junction" : "dir");
  const physical = owner.physicalPath(spec.env.CARGO_TARGET_DIR);
  const spawnMock = context.mock.method(require("node:child_process"), "spawnSync", (_command, args, options) => {
    assert.equal(options.env.CARGO_TARGET_DIR, physical);
    assert.ok(args.includes(physical) || args.includes(`--target-dir=${physical}`));
    return { status: 0 };
  });
  for (const args of [["build", "--target-dir", alias], ["build", `--target-dir=${alias}`]]) {
    assert.equal(owner.runManagedCargoSync({ ...spec, args, env: { ...spec.env, CARGO_TARGET_DIR: alias } }).status, 0);
  }
  assert.equal(spawnMock.mock.callCount(), 2);
  assert.throws(() => owner.runManagedCargoSync({ ...spec, args: ["build", "--target-dir", path.join(spec.cwd, "other")] }), /conflicts with leased/);
  assert.equal(spawnMock.mock.callCount(), 2);
});

test("command-line Cargo config overrides fail before acquiring a lease or launching a producer", context => {
  const spec = fixture("config-override");
  const spawnMock = context.mock.method(require("node:child_process"), "spawnSync", () => { throw new Error("unexpected producer"); });
  for (const args of [["build", "--config", 'build.target-dir="elsewhere"'], ["test", '--config=build.target-dir="elsewhere"']]) {
    assert.throws(() => owner.runManagedCargoSync({ ...spec, args }), /does not support command-line --config/);
    assert.ok(!fs.existsSync(leasePath(spec)));
  }
  assert.equal(spawnMock.mock.callCount(), 0);
});

test("pending output is physically pinned and a retargeted source junction fails before Cargo", context => {
  const spec = fixture("pending-retarget");
  const source = path.join(spec.cwd, "engine");
  const output = path.join(spec.cwd, "safe-output");
  const alias = path.join(spec.cwd, "pending-alias");
  fs.mkdirSync(source); fs.mkdirSync(output);
  fs.symlinkSync(output, alias, process.platform === "win32" ? "junction" : "dir");
  const command = buildCargoTestCommand(source, ["test", "--lib", "filter"], {
    env: { CARGO_TARGET_DIR: spec.env.CARGO_TARGET_DIR, INSTA_PENDING_DIR: alias },
  });
  const spawnMock = context.mock.method(require("node:child_process"), "spawnSync", (_command, _args, options) => {
    assert.equal(options.env.INSTA_PENDING_DIR, owner.physicalPath(output));
    assert.equal(options.selectedSourceRoot, undefined);
    return { status: 0 };
  });
  assert.equal(owner.runManagedCargoSync(command).status, 0);
  if (process.platform === "win32") fs.rmdirSync(alias); else fs.unlinkSync(alias);
  fs.symlinkSync(source, alias, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => owner.runManagedCargoSync(command), /outside selected engine source at Cargo launch/);
  assert.ok(!fs.existsSync(leasePath(spec)));
  assert.equal(spawnMock.mock.callCount(), 1);
});

test("copied-project default pending lifecycle precedes the producer and reconciles physical alias ownership", () => {
  const spec = fixture("default-lifecycle");
  const scripts = path.join(spec.cwd, "scripts");
  fs.mkdirSync(scripts);
  for (const file of ["cargo-target-owner.cjs", "cargo-verification.cjs", "cargo-test-preparation.cjs", "artifact-lifecycle.cjs", "maintenance-lock-owner.cjs", "maintenance-lock-worker.cjs", "maintenance-owner-config.cjs"]) {
    fs.copyFileSync(path.join(__dirname, file), path.join(scripts, file));
  }
  const source = path.join(spec.cwd, "engine");
  const physicalOutput = path.join(spec.cwd, "artifacts", "pending-store");
  const outputAlias = path.join(spec.cwd, "artifacts", "verification", "cargo-pending");
  fs.mkdirSync(path.join(source, "codex-rs"), { recursive: true });
  fs.mkdirSync(physicalOutput, { recursive: true });
  fs.mkdirSync(path.dirname(outputAlias), { recursive: true });
  fs.symlinkSync(physicalOutput, outputAlias, process.platform === "win32" ? "junction" : "dir");
  const copiedVerification = require(path.join(scripts, "cargo-verification.cjs"));
  const copiedLifecycle = require(path.join(scripts, "artifact-lifecycle.cjs"));
  const env = { ...process.env, CARGO_TARGET_DIR: spec.env.CARGO_TARGET_DIR };
  delete env.AZRAEL_CARGO_CACHE_PROJECT_ROOT;
  delete env.INSTA_PENDING_DIR;
  const command = copiedVerification.buildCargoTestCommand(source, ["test", "--lib", "filter"], { env });
  // The runner canonicalizes the junction; Windows case aliases must still
  // identify this default output and receive the same lifecycle registration.
  if (process.platform === "win32") command.env.INSTA_PENDING_DIR = command.env.INSTA_PENDING_DIR.toUpperCase();
  const code = `const assert=require('node:assert/strict');const fs=require('node:fs');const lifecycle=require(${JSON.stringify(path.join(scripts, "artifact-lifecycle.cjs"))});const records=lifecycle.catalog(${JSON.stringify(spec.cwd)});assert.equal(records.length,1);assert.equal(records[0].state,'pending');assert.equal(records[0].membership_complete,false);assert.equal(records[0].owner,'cargo-target-owner');assert.ok(fs.existsSync(process.env.INSTA_PENDING_DIR));const identity=value=>process.platform==='win32'?value.toLowerCase():value;assert.equal(identity(records[0].members[0].path),identity(process.env.INSTA_PENDING_DIR));process.stdout.write('lifecycle before producer verified');`;
  const result = copiedVerification.runManagedCargoSync({ ...command, command: process.execPath, args: ["-e", code], stdio: "pipe", encoding: "utf8" });
  assert.equal(result.status, 0, result.error?.message || result.stderr || "fake Cargo did not complete");
  assert.equal(result.stdout, "lifecycle before producer verified");
  const records = copiedLifecycle.catalog(spec.cwd);
  assert.equal(records.length, 1);
  assert.equal(records[0].state, "complete");
  assert.equal(records[0].membership_complete, true);
  assert.ok(records[0].id.startsWith("shared:cargo-pending:"));
  assert.equal(path.dirname(records[0].members[0].path), owner.physicalPath(physicalOutput));
  assert.ok(!fs.existsSync(leasePath(spec)));
  const firstGeneration = records[0].generation;
  const failed = copiedVerification.runManagedCargoSync({ ...command, command: process.execPath, args: ["-e", "process.exitCode=7"], stdio: "pipe", encoding: "utf8" });
  assert.equal(failed.status, 7);
  const [failedRecord] = copiedLifecycle.catalog(spec.cwd);
  assert.equal(copiedLifecycle.catalog(spec.cwd).length, 1);
  assert.equal(failedRecord.id, records[0].id);
  assert.notEqual(failedRecord.generation, firstGeneration);
  assert.equal(failedRecord.state, "failed"); assert.equal(failedRecord.membership_complete, true);
  assert.equal(failedRecord.producer.exit_code, 7);
  assert.equal(failedRecord.producer.outcome, "failure");
  assert.ok(!failedRecord.producer.evidence_ref.startsWith(failedRecord.members[0].path + path.sep));
});

test("compilation signatures retain package/features/target/profile/env while omitting runtime filters/arguments", () => {
  const spec = fixture("signature");
  spec.args = ["test", "-p", "crate", "--features", "one", "--target", "triple", "--profile", "test", "filter", "--", "--test-threads=1"];
  const initial = owner.compilationSignature(spec);
  assert.equal(initial, owner.compilationSignature({ ...spec, args: [...spec.args.slice(0, -3), "other-filter", "--", "--nocapture"] }));
  for (const [from, to] of [["crate", "other"], ["one", "two"], ["triple", "other-triple"], ["test", "dev"]]) {
    const args = [...spec.args]; args[args.lastIndexOf(from)] = to;
    assert.notEqual(initial, owner.compilationSignature({ ...spec, args }));
  }
  assert.notEqual(initial, owner.compilationSignature({ ...spec, env: { ...spec.env, RUSTFLAGS: "changed" } }));
});

test("snapshot pending output is stable, outside source and rejects physical in-source aliases", () => {
  const spec = fixture("pending");
  const source = path.join(spec.cwd, "engine");
  fs.mkdirSync(source);
  const command = buildCargoTestCommand(source, ["test", "--lib", "filter"], { env: {} });
  assert.equal(command.env.INSTA_UPDATE, "no");
  assert.ok(command.env.INSTA_PENDING_DIR.startsWith(path.resolve(__dirname, "../artifacts/verification/cargo-pending")));
  assert.equal(command.env.INSTA_PENDING_DIR, buildCargoTestCommand(source, ["test", "--lib", "another"], { env: {} }).env.INSTA_PENDING_DIR);
  for (const pending of ["relative", source, path.join(source, "snapshots")]) {
    assert.throws(() => buildCargoTestCommand(source, ["test"], { env: { INSTA_PENDING_DIR: pending } }), /INSTA_PENDING_DIR/);
  }
  const alias = path.join(spec.cwd, "source-alias");
  fs.symlinkSync(source, alias, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => buildCargoTestCommand(source, ["test"], { env: { INSTA_PENDING_DIR: path.join(alias, "new-output") } }), /outside selected/);
});
