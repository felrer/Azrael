"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cache = require("./cargo-shared-cache.cjs");
const lifecycle = require("./artifact-lifecycle.cjs");
const defaultRun = process.env.AZRAEL_SHARED_CARGO_TEST_ROOT ? null : require("./artifact-run.cjs").beginArtifactRun(path.resolve(__dirname, ".."), { workId: "cargo-cache-tests", owner: "cargo-cache-tests" });
const base = process.env.AZRAEL_SHARED_CARGO_TEST_ROOT || defaultRun.temporary;
if (!path.isAbsolute(base)) throw Error("Absolute shared Cargo test fixture root required");
fs.mkdirSync(base, { recursive: true });
const owned = [];
function fixture() {
  const projectRoot = fs.mkdtempSync(path.join(base, "case-")); owned.push(projectRoot);
  const sourceRoot = path.join(projectRoot, "source");
  fs.mkdirSync(path.join(sourceRoot, "codex-rs"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "codex-rs/Cargo.toml"), "[workspace]\n");
  return { projectRoot, sourceRoot, target: "x86_64-pc-windows-msvc", env: { AZRAEL_CARGO_CACHE_SCOPE: "cache-verification", CARGO_HOME: path.join(projectRoot, "cargo-home") }, tools: { rustc: "rustc fixture\nhost: x86_64-pc-windows-msvc", cargo: "cargo fixture" } };
}
after(() => { for (const directory of owned) fs.rmSync(directory, { recursive: true }); });
test("same compiler/configuration shares storage across source copies, without creating outputs during selection", () => {
  const options = fixture(), first = cache.selectCache(options);
  const other = path.join(options.projectRoot, "other");
  fs.mkdirSync(path.join(other, "codex-rs"), { recursive: true }); fs.writeFileSync(path.join(other, "codex-rs/Cargo.toml"), "[workspace]\n");
  assert.equal(first.targetDirectory, cache.selectCache({ ...options, sourceRoot: other }).targetDirectory);
  assert.equal(fs.existsSync(first.directory), false);
  assert.equal(first.key, cache.selectCache({ ...options, env: { ...options.env, CARGO_TARGET_DIR: first.targetDirectory } }).key);
  for (const changed of [{ target: "aarch64-apple-darwin" }, { tools: { ...options.tools, rustc: "different" } }, { tools: { ...options.tools, cargo: "different" } },
    ...["RUSTFLAGS", "CARGO_INCREMENTAL", "CARGO_PROFILE_TEST_DEBUG", "RUSTDOCFLAGS"].map(name => ({ env: { ...options.env, [name]: "changed" } }))]) {
    assert.notEqual(first.key, cache.selectCache({ ...options, ...changed }).key);
  }
  // Retained: a future caller addition must not silently return to the broad
  // unscoped cache, or permit saved legacy selections to create generations.
  assert.throws(() => cache.selectCache({ ...options, env: {} }), /SCOPE|scope/);
  const legacyIdentity = { ...first.identity }; delete legacyIdentity.scope;
  assert.throws(() => cache.beginExecution({ ...first, identity: legacyIdentity }, "legacy"), /scoped/);
  assert.equal(fs.existsSync(first.directory), false);
  fs.mkdirSync(options.env.CARGO_HOME);
  fs.writeFileSync(path.join(options.env.CARGO_HOME, "config.toml"), "[build]\nrustflags=['-Cdebuginfo=0']\n");
  assert.notEqual(first.key, cache.selectCache(options).key, "User Cargo configuration must affect the cache identity");
  fs.unlinkSync(path.join(options.env.CARGO_HOME, "config.toml"));
  fs.mkdirSync(path.join(options.sourceRoot, "codex-rs/.cargo")); fs.writeFileSync(path.join(options.sourceRoot, "codex-rs/.cargo/config.toml"), "[build]\njobs=1\n");
  assert.notEqual(first.key, cache.selectCache(options).key);
});
test("cache lifecycle precedes payload, permits known-close reuse and blocks unresolved producers", context => {
  const options = fixture(), selection = cache.selectCache(options);
  // Retained: a later preparation refactor can omit the bounded catalog wait
  // or replay a claim instead of waiting only for native acquisition.
  const { Worker } = require("node:worker_threads");
  const signal = new Int32Array(new SharedArrayBuffer(8));
  const lock = path.join(options.projectRoot, "artifacts/maintenance/lifecycles/catalog.lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const holder = new Worker(`
    const { workerData } = require('node:worker_threads');
    const signal = new Int32Array(workerData.signal);
    try {
      const lease = require(workerData.helper).acquire(workerData.lock, { operation: 'test.cache-begin' });
      Atomics.store(signal, 0, 1); Atomics.notify(signal, 0);
      Atomics.wait(signal, 1, 0, 300);
      Atomics.store(signal, 0, 2); Atomics.notify(signal, 0);
      lease.release();
      Atomics.store(signal, 1, 1); Atomics.notify(signal, 1);
    } catch {
      Atomics.store(signal, 0, -1); Atomics.notify(signal, 0);
      Atomics.store(signal, 1, -1); Atomics.notify(signal, 1);
    }
  `, { eval: true, workerData: { helper: require.resolve("./maintenance-lock-owner.cjs"), lock, signal: signal.buffer } });
  const recordLifecycle = lifecycle.recordLifecycle;
  const claim = context.mock.method(lifecycle, "recordLifecycle", (...args) => recordLifecycle(...args));
  const catalog = lifecycle.catalog;
  const observation = context.mock.method(lifecycle, "catalog", (...args) => {
    assert.equal(Atomics.load(signal, 0), 2, "catalog observation must wait for the active writer to finish under its lease");
    return catalog(...args);
  });
  let first;
  try {
    Atomics.wait(signal, 0, 0, 15000);
    assert.equal(Atomics.load(signal, 0), 1, "native holder must acquire before cache preparation");
    first = cache.beginExecution(selection, "first");
    assert.equal(claim.mock.callCount(), 1, "contention must not replay the pending claim");
  } finally {
    Atomics.wait(signal, 1, 0, 15000);
    assert.equal(Atomics.load(signal, 1), 1, "native holder must release before fixture cleanup");
    claim.mock.restore();
    observation.mock.restore();
  }
  assert.equal(lifecycle.catalog(options.projectRoot)[0].state, "pending");
  assert.throws(() => cache.beginExecution(selection, "competing"), /unresolved/);
  cache.finishExecution(first, { status: null, signal: "SIGTERM" }, {});
  assert.equal(lifecycle.catalog(options.projectRoot)[0].state, "pending");
  // Independent test fixture's actual-close simulation; not recovery evidence.
  cache.finishExecution(first, { status: 1 }, { exitCode: 1 });
  const failed = lifecycle.catalog(options.projectRoot)[0];
  assert.equal(failed.producer.outcome, "failure"); assert.equal(failed.membership_complete, true);
  const priorEvidence = fs.readFileSync(failed.producer.evidence_ref);
  const second = cache.beginExecution(selection, "second");
  cache.finishExecution(second, { status: 0 }, { exitCode: 0 });
  assert.equal(lifecycle.catalog(options.projectRoot)[0].producer.outcome, "success");
  assert.notEqual(lifecycle.catalog(options.projectRoot)[0].producer.evidence_ref, failed.producer.evidence_ref);
  assert.deepEqual(fs.readFileSync(failed.producer.evidence_ref), priorEvidence);
  const nested = lifecycle.withCatalogLock(options.projectRoot, () => cache.beginExecution(selection, "nested"));
  cache.finishExecution(nested, { status: 0 }, { exitCode: 0 });
  fs.writeFileSync(path.join(selection.directory, "identity.json"), "changed");
  assert.throws(() => cache.beginExecution(selection, "third"), /identity/);
});
test("scoped verification cache reopens the same target without copying or hashing its payload", context => {
  // Retained: adding a scope or changing private verification preparation must
  // not revert to cloning every previous target or drop unresolved protection.
  const options = fixture();
  options.env = { AZRAEL_CARGO_CACHE_SCOPE: "agent-image-attachments", CARGO_PROFILE_TEST_DEBUG: "0" };
  const selection = cache.selectCache(options);
  assert.throws(() => cache.selectCache({ ...options, env: {} }), /SCOPE|scope/);
  assert.notEqual(selection.key, cache.selectCache({ ...options, env: { ...options.env, AZRAEL_CARGO_CACHE_SCOPE: "another-check" } }).key);
  assert.notEqual(selection.key, cache.selectCache({ ...options, env: { ...options.env, CARGO_PROFILE_TEST_DEBUG: "1" } }).key);
  assert.equal(selection.identity.scope, "agent-image-attachments");
  assert.equal(path.basename(selection.directory).length, 32);
  for (const scope of ["", "../escape", "UPPER", "a".repeat(65)]) {
    assert.throws(() => cache.selectCache({ ...options, env: { AZRAEL_CARGO_CACHE_SCOPE: scope } }), /scope/);
  }
  const first = cache.beginExecution(selection, "scoped-first");
  fs.mkdirSync(selection.targetDirectory);
  const payload = path.join(selection.targetDirectory, "compiled-object");
  fs.writeFileSync(payload, "previous compilation");
  const before = fs.statSync(payload);
  cache.finishExecution(first, { status: 0 }, { exitCode: 0 });
  const read = fs.readFileSync;
  context.mock.method(fs, "copyFileSync", () => { throw Error("Cache reuse must not copy payload"); });
  context.mock.method(fs, "readFileSync", (file, ...args) => {
    assert.notEqual(file, payload, "Cache selection must not hash compiled objects");
    return read(file, ...args);
  });
  const secondSelection = cache.selectCache(options);
  assert.equal(secondSelection.targetDirectory, selection.targetDirectory);
  const differentScope = cache.selectCache({ ...options, env: { ...options.env, AZRAEL_CARGO_CACHE_SCOPE: "another-check" } });
  assert.throws(() => cache.beginExecution({ ...differentScope, directory: selection.directory }, "collision"), /identity/,
    "A shortened-path collision must reject the different full identity");
  const second = cache.beginExecution(secondSelection, "scoped-second");
  assert.throws(() => cache.beginExecution(secondSelection, "competing"), /unresolved/);
  assert.equal(fs.statSync(payload).mtimeMs, before.mtimeMs);
  assert.equal(fs.statSync(payload).ino, before.ino);
  cache.finishExecution(second, { status: 0 }, { exitCode: 0 });
});
test("cache identity markers reject hardlinks and symbolic links before claiming a generation", context => {
  const options = fixture(), selection = cache.selectCache(options);
  fs.mkdirSync(selection.directory, { recursive: true });
  const marker = path.join(selection.directory, "identity.json");
  const external = path.join(options.projectRoot, "external-identity.json");
  fs.writeFileSync(external, JSON.stringify(selection.identity));
  fs.linkSync(external, marker);
  assert.throws(() => cache.beginExecution(selection, "hardlink"), /unlinked regular file/);
  fs.unlinkSync(marker);
  // No elevated Windows symlink privilege is required to exercise this guard.
  const lstat = fs.lstatSync;
  context.mock.method(fs, "lstatSync", (file, ...args) => file === marker
    ? { isSymbolicLink: () => true } : lstat(file, ...args));
  assert.throws(() => cache.beginExecution(selection, "symlink"), /Linked/);
  assert.equal(fs.existsSync(lifecycle.registryPath(options.projectRoot, selection.lifecycleId)), false);
});
test("claimed cache preparation failures close only their generation without inventing an exit", context => {
  const mkdir = fs.mkdirSync, write = fs.writeFileSync;
  const mkdirMock = context.mock.method(fs, "mkdirSync", (...args) => mkdir(...args));
  const writeMock = context.mock.method(fs, "writeFileSync", (...args) => write(...args));
  for (const boundary of ["directory", "identity"]) {
    const options = fixture(), selection = cache.selectCache(options);
    const failure = new Error(`injected ${boundary} failure`);
    mkdirMock.mock.mockImplementation((filename, ...args) => {
      if (boundary === "directory" && filename === selection.directory) throw failure;
      return mkdir(filename, ...args);
    });
    writeMock.mock.mockImplementation((filename, ...args) => {
      if (boundary === "identity" && filename === path.join(selection.directory, "identity.json")) throw failure;
      return write(filename, ...args);
    });
    assert.throws(() => cache.beginExecution(selection, `failed-${boundary}`), error => error === failure);
    const [record] = lifecycle.catalog(options.projectRoot);
    assert.equal(record.generation, `failed-${boundary}`);
    assert.equal(record.membership_complete, true);
    assert.equal(record.producer.status, "stopped");
    assert.equal(record.producer.outcome, "failure");
    assert.equal(record.producer.exit_code, null);
    assert.ok(fs.existsSync(record.producer.evidence_ref));
  }
});
test("confirmed non-start closes cache failure while an unclassified spawn error remains protected", () => {
  const options = fixture(), selection = cache.selectCache(options);
  const first = cache.beginExecution(selection, "not-started");
  const failure = new Error("preparation failed");
  cache.finishExecution(first, { status: null, error: failure }, { status: "not-started", exitCode: null });
  const [closed] = lifecycle.catalog(options.projectRoot);
  assert.equal(closed.producer.outcome, "failure");
  assert.equal(closed.producer.exit_code, null);
  const second = cache.beginExecution(selection, "unknown");
  cache.finishExecution(second, { status: null, error: failure }, { status: "unknown", exitCode: null });
  const [pending] = lifecycle.catalog(options.projectRoot);
  assert.equal(pending.generation, "unknown");
  assert.equal(pending.state, "pending");
  assert.equal(pending.membership_complete, false);
});
test("cache preparation preserves its original fault when lifecycle close also fails", context => {
  let options, selection, closeFailure;
  const failure = new Error("identity write failed");
  const write = fs.writeFileSync;
  context.mock.method(fs, "writeFileSync", (filename, ...args) => {
    if (selection && filename === path.join(selection.directory, "identity.json")) throw failure;
    return write(filename, ...args);
  });
  context.mock.method(lifecycle, "closeLifecycle", () => { throw closeFailure; });
  // Diagnostic decoration must preserve both mutable Error identity and
  // immutable/primitive causes when later fault paths throw either shape.
  for (closeFailure of [new Error("close failed"), Object.freeze(new Error("frozen close failed")), "primitive close failed"]) {
    options = fixture(); selection = cache.selectCache(options);
    assert.throws(() => cache.beginExecution(selection, "close-failed"), error => {
      assert.equal(error, failure);
      const [diagnostic] = error.ownershipErrors;
      if (Object.isExtensible(closeFailure)) assert.equal(diagnostic, closeFailure);
      else assert.equal(diagnostic.cause, closeFailure);
      assert.equal(diagnostic.stage, "cargo-shared-cache.lifecycle-close");
      return true;
    });
    const [record] = lifecycle.catalog(options.projectRoot);
    assert.equal(record.generation, "close-failed");
    assert.equal(record.state, "pending");
  }
});
test("unowned preexisting directory and invalid paths cannot become shared cache", () => {
  const options = fixture(), selection = cache.selectCache(options);
  fs.mkdirSync(selection.directory, { recursive: true });
  assert.throws(() => cache.beginExecution(selection, "first"), /identity/);
  assert.throws(() => cache.selectCache({ ...options, projectRoot: "relative" }), /Absolute/);
  const linked = path.join(options.projectRoot, "linked");
  if (process.platform === "win32") fs.symlinkSync(options.sourceRoot, linked, "junction");
  else fs.symlinkSync(options.sourceRoot, linked, "dir");
  assert.throws(() => cache.selectCache({ ...options, sourceRoot: linked }), /Linked/);
  fs.unlinkSync(linked);
});
test("interrupted cache reuse requires exact stop and target retirement evidence and preserves unknown history", context => {
  // Retained: later simplification of generation rollover must not turn restart
  // authority into successful execution, cleanup permission, or inferred stop.
  const options = fixture(), selection = cache.selectCache(options);
  const first = cache.beginExecution(selection, "interrupted");
  const targetOwner = require("./cargo-target-owner.cjs");
  const { spawnSync } = require("node:child_process");
  const child = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(require.resolve("./cargo-target-owner.cjs"))}).acquireTargetOwner(JSON.parse(process.argv[1]))`, JSON.stringify({
    command: process.execPath, args: [], cwd: path.join(options.sourceRoot, "codex-rs"), env: { CARGO_TARGET_DIR: selection.targetDirectory }
  })], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.signal, null);
  const lease = targetOwner.inspectTargetOwner(selection);
  const payload = path.join(selection.targetDirectory, "compiled-object"); fs.writeFileSync(payload, "retained compilation");
  const before = fs.statSync(payload);
  const crypto = require("node:crypto"), digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const evidence = path.join(options.projectRoot, "stop.json");
  fs.writeFileSync(evidence, JSON.stringify({ producer: lease.owner, child_exit: child.status, child_signal: child.signal,
    basis: "Dedicated synchronous fixture child acquired only this lease, spawned no children, and exited" }));
  const receipt = path.join(options.projectRoot, "retirement.json");
  const recovery = { expectedGeneration: first.record.generation, expectedRevision: first.record.revision,
    expectedToken: lease.token, expectedOwnerSha256: lease.ownerSha256, producer_stopped_verified: true,
    reason: "Independent fixture child completion observed with no descendants", evidence_ref: evidence, evidence_sha256: digest(evidence), receipt_ref: receipt };
  assert.throws(() => cache.beginExecution(selection, "unapproved"), /unresolved/);
  assert.throws(() => cache.recoverExecution(selection, recovery), /lease is still active/);
  targetOwner.recoverTargetOwner({ ...selection, ...recovery });
  recovery.receipt_sha256 = digest(receipt);
  const wrongReceipt = path.join(options.projectRoot, "wrong-retirement.json"), wrong = JSON.parse(fs.readFileSync(receipt));
  wrong.lease.targetDirectory = options.sourceRoot;
  fs.writeFileSync(wrongReceipt, JSON.stringify(wrong));
  assert.throws(() => cache.recoverExecution(selection, { ...recovery, receipt_ref: wrongReceipt, receipt_sha256: digest(wrongReceipt) }), /binding/);
  for (const changed of [{ expectedGeneration: "wrong" }, { expectedRevision: 999 }, { expectedToken: "wrong" },
    { expectedOwnerSha256: "0".repeat(64) }, { producer_stopped_verified: false }, { receipt_sha256: "0".repeat(64) }]) {
    assert.throws(() => cache.recoverExecution(selection, { ...recovery, ...changed }));
  }
  // A genuine stopped unknown lifecycle is still protected before authorization.
  const closed = lifecycle.closeLifecycle(options.projectRoot, selection.lifecycleId, { owner: "cargo-shared-cache", expected_revision: first.record.revision,
    producer_stopped_verified: true, outcome: "unknown", exit_code: null, reason: recovery.reason,
    evidence_ref: receipt, evidence_sha256: recovery.receipt_sha256 });
  assert.equal(closed.producer.outcome, "unknown");
  assert.throws(() => cache.beginExecution(selection, "still-unapproved"), /unresolved/);
  const forged = cache.saveTerminalEvidence(options.projectRoot, `${selection.key}-cache`, closed.generation, {
    schema: 1, action: "authorize-restart", source: { ...lifecycle.restartSource(closed), generation: "wrong" },
    producer_stopped_verified: true, stop_basis: recovery.reason, producer_evidence: [{ path: evidence, sha256: recovery.evidence_sha256 }] });
  const authorize = { owner: closed.owner, expected_revision: closed.revision, expected_generation: closed.generation,
    producer_stopped_verified: true, reason: recovery.reason, ...forged };
  assert.throws(() => lifecycle.authorizeRestart(options.projectRoot, closed.id, authorize), /evidence/);
  assert.throws(() => lifecycle.authorizeRestart(options.projectRoot, closed.id, { ...authorize, expected_generation: "wrong" }), /generation/);
  assert.throws(() => lifecycle.authorizeRestart(options.projectRoot, closed.id, { ...authorize, expected_revision: 999 }), /revision/);
  const publish = context.mock.method(lifecycle, "authorizeRestart", () => { throw Error("injected authorization publication interruption"); });
  assert.throws(() => cache.recoverExecution(selection, recovery), /publication interruption/);
  publish.mock.restore();
  const updated = lifecycle.recordLifecycle(options.projectRoot, { ...closed, expected_revision: closed.revision,
    references: [{ id: "fixture:recovery-evidence", reason: "Preserve independent stop evidence", kind: "evidence" }] });
  assert.throws(() => cache.recoverExecution(selection, recovery), /revision/);
  recovery.expectedRevision = updated.revision;
  const authorized = cache.recoverExecution(selection, recovery);
  assert.equal(authorized.producer.outcome, "unknown"); assert.equal(authorized.producer.exit_code, null);
  assert.equal(authorized.membership_complete, false); assert.equal(authorized.cleanup_recovery, undefined);
  assert.equal(authorized.references[0].id, "fixture:recovery-evidence");
  assert.equal(cache.recoverExecution(selection, recovery).revision, authorized.revision);
  assert.throws(() => cache.recoverExecution(selection, { ...recovery, reason: "changed" }), /Conflicting/);
  const original = fs.readFileSync(evidence);
  fs.writeFileSync(evidence, "tampered");
  assert.throws(() => lifecycle.catalog(options.projectRoot), /SHA256/);
  assert.throws(() => cache.beginExecution(selection, "tampered"), /SHA256/);
  fs.writeFileSync(evidence, original);
  const authPath = authorized.restart_recovery.evidence_ref, authBytes = fs.readFileSync(authPath);
  fs.writeFileSync(authPath, "tampered authorization");
  assert.throws(() => lifecycle.catalog(options.projectRoot), /SHA256/);
  fs.writeFileSync(authPath, authBytes);
  fs.mkdirSync(path.join(selection.targetDirectory, ".azrael-cargo-owner"));
  assert.throws(() => cache.beginExecution(selection, "active"), /lease is still active/);
  fs.rmdirSync(path.join(selection.targetDirectory, ".azrael-cargo-owner"));
  context.mock.method(fs, "copyFileSync", () => { throw Error("No cache payload copy allowed"); });
  const second = cache.beginExecution(selection, "resumed");
  assert.equal(second.record.previous_generation.producer.outcome, "unknown");
  assert.equal(second.record.previous_generation.producer.exit_code, null);
  assert.equal(second.record.previous_generation.generation, "interrupted");
  assert.equal(second.record.references[0].id, "fixture:recovery-evidence");
  assert.equal(fs.statSync(payload).ino, before.ino); assert.equal(fs.statSync(payload).mtimeMs, before.mtimeMs);
  cache.finishExecution(second, { status: 0 }, { exitCode: 0 });
  assert.equal(lifecycle.catalog(options.projectRoot)[0].previous_generation.producer.exit_code, null);
});
