'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { spawn } = require('node:child_process');
const { createResourceManager } = require('./window-use-resources.cjs');
const root = path.resolve(process.env.WINDOW_USE_RESOURCE_TEST_ROOT || 'artifacts/tasks/DU-01-window-use-stages/runs/20261017-resources-r1/temporary');
let sequence = 0;
async function removeOrdinary(file) {
  let stat; try { stat = await fs.lstat(file); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (stat.isDirectory() && !stat.isSymbolicLink()) { for (const name of await fs.readdir(file)) await removeOrdinary(path.join(file, name)); await fs.rmdir(file); }
  else await fs.unlink(file);
}
async function fixture(t, options = {}) {
  await fs.mkdir(root, { recursive: true });
  const directory = path.join(root, `case-${process.pid}-${++sequence}`);
  const manager = createResourceManager({ directory, idleMs: 0, ...options });
  t.after(async () => { await manager.stopScheduler(); await removeOrdinary(directory); });
  await manager.inspect();
  return { manager, directory };
}
async function generated(manager, id = 'capture', extra = {}) {
  const registered = await manager.registerGenerated({ id, workId: 'work', runId: 'run', producer: 'fixture', ...extra });
  await fs.mkdir(registered.path); await fs.writeFile(path.join(registered.path, 'capture'), '12345');
  return registered;
}
const identity = { sessionId: 71, processId: 135, processCreated: 'exact-created', desktop: 'owned' };
function observation(state = 'running', extra = {}) {
  return { identity, ownershipVerified: true, state, pendingWork: false, directUser: false, unsavedWork: false, unknownState: false, unrelatedApps: false, pendingUserDecision: false, heldInput: false, ...(state === 'closed' ? { logoffConfirmed: true, processesStopped: true } : {}), ...extra };
}
async function session(manager, id = 'session') {
  const registered = await manager.registerSession({ id, workId: 'work', runId: 'run', identity, ownershipVerified: true });
  await manager.releaseLease(id, registered.lease); return registered;
}

test('legacy unknown session admission requires fresh exact release proof; generated unknown stays protected', async t => {
  const { manager } = await fixture(t);
  const registered = await manager.registerSession({ id: 'legacy', workId: 'work', runId: 'run', identity, ownershipVerified: true });
  await manager.releaseLease('legacy', registered.lease, { state: 'unknown' });
  const proof = { ok: true, identity, ownershipVerified: true, inputReleased: true, available: true, admissionReady: true };
  await assert.rejects(manager.acquireSessionLease('legacy', 'task', async () => ({ ...proof, inputReleased: false })), /unverified/);
  await assert.rejects(manager.acquireSessionLease('legacy', 'task', async () => ({ ...proof, identity: { ...identity, processId: 999 } })), /unverified/);
  assert.equal((await manager.inspect()).resources[0].state, 'unknown');
  const admitted = await manager.acquireSessionLease('legacy', 'task', async () => proof);
  assert.equal((await manager.inspect()).resources[0].state, 'ready');
  await assert.rejects(manager.acquireSessionLease('legacy', 'other', async () => proof), /current state/);
  await manager.releaseLease('legacy', admitted.lease);
  const file = await generated(manager); await manager.releaseLease(file.id, file.lease, { state: 'unknown' });
  await assert.rejects(manager.acquireSessionLease(file.id, 'task', async () => proof), /current state/);
});

test('only explicit owned registration is disposable; exact bytes and metadata survive cleanup', async t => {
  const { manager, directory } = await fixture(t);
  const r = await generated(manager);
  assert.equal((await manager.inspect()).resources[0].blocked, 'active leases');
  assert.equal((await manager.cleanup()).results[0].state, 'deferred');
  await manager.releaseLease(r.id, r.lease);
  const status = await manager.inspect(); assert.equal(status.bytes, 5);
  const result = await manager.cleanup(); assert.equal(result.results[0].state, 'deleted'); assert.equal(result.freedBytes, 5);
  assert.equal(result.bytes, 0); assert.equal(result.resources.length, 0);
  await assert.rejects(fs.stat(r.path), { code: 'ENOENT' });
  assert.ok((await fs.stat(path.join(directory, 'management/resources.json'))).isFile());
});

test('registration rejects path escape, adoption, user-profile roots and capacity overcommit', async t => {
  const { manager, directory } = await fixture(t, { maxBytes: 10 });
  await assert.rejects(manager.registerGenerated({ id: '../escape', workId: 'w', runId: 'r', producer: 'p' }), /resource id/);
  await generated(manager, 'reserved', { reserveBytes: 8 });
  await assert.rejects(manager.registerGenerated({ id: 'too-large', workId: 'w', runId: 'r', producer: 'p', reserveBytes: 3 }), /capacity/);
  await fs.mkdir(path.join(directory, 'payload/preexisting'));
  await assert.rejects(manager.registerGenerated({ id: 'preexisting', workId: 'w', runId: 'r', producer: 'p' }), /capacity.*unknown|already exists/);
  const unknownUsage = await manager.inspect(); assert.equal(unknownUsage.capacityUnknown, true); assert.equal(unknownUsage.availableBytes, 0);
  assert.deepEqual(unknownUsage.unregisteredPaths, [path.join(directory, 'payload/preexisting')]);
  assert.throws(() => createResourceManager({ directory: require('node:os').homedir() }), /user profile/);
  const arbitrary = path.join(directory, 'arbitrary'); await fs.mkdir(arbitrary); await fs.writeFile(path.join(arbitrary, 'user'), 'preserve');
  await assert.rejects(createResourceManager({ directory: arbitrary }).inspect(), /empty dedicated/);
});

test('leases, consumers, protected state, unknown producer outcomes and restart block reclamation', async t => {
  const { manager, directory } = await fixture(t);
  const r = await generated(manager);
  const restarted = createResourceManager({ directory, idleMs: 0 });
  assert.equal((await restarted.cleanup()).results[0].reason, 'active leases');
  await manager.releaseLease(r.id, r.lease, { state: 'unknown' });
  assert.match((await manager.cleanup()).results[0].reason, /unknown/);
  const repair = await manager.registerGenerated({ id: 'ready', workId: 'w', runId: 'r', producer: 'p' });
  await manager.releaseLease(repair.id, repair.lease);
  await manager.setProtection(repair.id, { protected: false, consumers: ['release-evidence'] });
  assert.equal((await manager.cleanup({ ids: [repair.id] })).results[0].reason, 'active consumers');
  await manager.setProtection(repair.id, { protected: true, consumers: [] });
  assert.equal((await manager.cleanup({ ids: [repair.id] })).results[0].reason, 'protected');
});

test('symlink/junction payload and parent links preserve the link target', async t => {
  const { manager, directory } = await fixture(t);
  const r = await generated(manager); await manager.releaseLease(r.id, r.lease);
  const outside = path.join(directory, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'user'), 'preserve');
  await fs.symlink(outside, path.join(r.path, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await manager.cleanup()).results[0].state, 'deferred');
  assert.equal(await fs.readFile(path.join(outside, 'user'), 'utf8'), 'preserve');
  const alias = path.join(directory, 'alias'); await fs.symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createResourceManager({ directory: path.join(alias, 'managed') }).inspect(), /Unsafe directory/);
});

test('hardlinks and unexpected post-release files defer the complete owned group', async t => {
  const { manager, directory } = await fixture(t);
  const r = await generated(manager); await manager.releaseLease(r.id, r.lease);
  await fs.writeFile(path.join(r.path, 'unknown'), 'do not delete');
  assert.match((await manager.cleanup()).results[0].reason, /membership changed/);
  await fs.unlink(path.join(r.path, 'unknown'));
  await fs.link(path.join(r.path, 'capture'), path.join(directory, 'hardlink'));
  assert.match((await manager.cleanup()).results[0].reason, /Unsafe payload/);
});

test('pending/direct-user/unsaved/unknown/wrong-owner observations prevent normal close and disk removal', async t => {
  let observed = observation(), closes = 0;
  const { manager } = await fixture(t, { inspectSession: async () => observed, closeSession: async () => { closes++; } });
  await session(manager);
  const r = await generated(manager, 'capture', { sessionIds: ['session'] }); await manager.releaseLease(r.id, r.lease);
  for (const extra of [{ pendingWork: true }, { directUser: true }, { unsavedWork: true }, { unknownState: true }, { identity: { ...identity, processCreated: 'reused-pid' } }, { heldInput: undefined }]) {
    observed = observation('running', extra); assert.equal((await manager.cleanup()).results[0].state, 'deferred');
  }
  assert.equal(closes, 0); assert.equal(await fs.readFile(path.join(r.path, 'capture'), 'utf8'), '12345');
});

test('normal closure requires exact logoff/process confirmation; uncertain close reconciles explicitly', async t => {
  let observed = observation(), closes = 0;
  const { manager } = await fixture(t, { inspectSession: async () => observed, closeSession: async () => { closes++; observed = observation('closed', { processesStopped: false }); } });
  await session(manager); const r = await generated(manager, 'capture', { sessionIds: ['session'] }); await manager.releaseLease(r.id, r.lease);
  const failed = await manager.cleanup(); assert.equal(failed.results[0].state, 'failed'); assert.equal(failed.freedBytes, 0);
  await assert.rejects(manager.acquireLease('session', 'new-task'), /current state/);
  await assert.rejects(manager.reconcileSession('session'), /unconfirmed/);
  observed = observation('closed'); await manager.reconcileSession('session');
  const success = await manager.cleanup(); assert.equal(success.freedBytes, 5); assert.equal(closes, 1);
});

test('same-process and cross-process admissions serialize with session cleanup', async t => {
  let observed = observation(), releaseClose, closeStarted;
  const started = new Promise(resolve => { closeStarted = resolve; });
  const gate = new Promise(resolve => { releaseClose = resolve; });
  const { manager, directory } = await fixture(t, { inspectSession: async () => observed, closeSession: async () => { closeStarted(); await gate; observed = observation('closed'); } });
  await session(manager);
  const cleanup = manager.cleanup(); await started;
  const childResult = await new Promise((resolve, reject) => {
    const program = `const {createResourceManager}=require(process.argv[1]);createResourceManager({directory:process.argv[2],lockTimeoutMs:30}).acquireLease('session','child').then(()=>process.exit(2),e=>{console.log(e.message);process.exit(/admission lock/.test(e.message)?0:3)});`;
    const child = spawn(process.execPath, ['-e', program, require.resolve('./window-use-resources.cjs'), directory]);
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    child.on('error', reject); child.on('exit', code => resolve({ code, output }));
  });
  assert.equal(childResult.code, 0, childResult.output);
  const admission = manager.acquireLease('session', 'later');
  releaseClose(); assert.equal((await cleanup).results[0].state, 'deleted');
  await assert.rejects(admission, /Unknown resource/);
});

test('partial ordinary deletion reports freed bytes and remaining paths, then retries safely', async t => {
  let fail = true;
  const { manager } = await fixture(t, { unlink: async file => { if (fail && path.basename(file) === 'capture') { const e = new Error('fixture ordinary unlink denied'); e.code = 'EACCES'; throw e; } return fs.unlink(file); } });
  const r = await generated(manager); await fs.writeFile(path.join(r.path, 'z-long-first'), 'abc'); await manager.releaseLease(r.id, r.lease);
  const first = await manager.cleanup(); assert.equal(first.results[0].state, 'failed'); assert.equal(first.freedBytes, 3); assert.deepEqual(first.results[0].remainingPaths, [r.path]);
  fail = false; const second = await manager.cleanup(); assert.equal(second.results[0].state, 'deleted'); assert.equal(second.freedBytes, 5);
});

test('external logoff after host restart retires session leases and files immediately while keeping evidence', async t => {
  const { manager, directory } = await fixture(t, { idleMs: 1000000 });
  await manager.registerSession({ id: 'session', workId: 'work', runId: 'run', identity, ownershipVerified: true });
  const payload = await generated(manager, 'capture', { sessionIds: ['session'] });
  await manager.releaseLease(payload.id, payload.lease);
  const evidence = path.join(directory, 'verification.json'); await fs.writeFile(evidence, '{"passed":true}');
  let closes = 0;
  const restarted = createResourceManager({ directory, idleMs: 1000000, inspectSession: async actual => {
    assert.deepEqual(actual, identity); return observation('closed');
  }, closeSession: async () => { closes++; throw new Error('Already logged off'); } });
  const result = await restarted.cleanup();
  assert.equal(closes, 0); assert.equal(result.resources.length, 0);
  assert.equal(result.results[0].logoffConfirmed, true); assert.equal(result.results[0].filesCleanupState, 'complete');
  assert.deepEqual(result.results[0].remainingPaths, []);
  assert.equal(await fs.readFile(evidence, 'utf8'), '{"passed":true}');
  assert.equal((await restarted.cleanup()).results.length, 0);
});

test('confirmed logoff preserves independent payload producers and retries from durable closure receipt', async t => {
  const { manager, directory } = await fixture(t, { inspectSession: async () => observation('closed') });
  await session(manager); const payload = await generated(manager, 'capture', { sessionIds: ['session'] });
  const deferred = (await manager.cleanup()).results[0];
  assert.equal(deferred.state, 'deferred'); assert.equal(deferred.logoffConfirmed, true);
  assert.equal(deferred.filesCleanupState, 'deferred'); assert.equal(deferred.reason, 'active leases');
  await manager.releaseLease(payload.id, payload.lease);
  const restarted = createResourceManager({ directory, idleMs: 0, inspectSession: async () => { throw new Error('New host has no live transport'); } });
  const result = (await restarted.cleanup()).results[0];
  assert.equal(result.state, 'deleted'); assert.equal(result.logoffConfirmed, true);
});

test('unknown or reused session identities cannot clear a stale input lease or delete payload', async t => {
  let observed = observation('closed', { identity: { ...identity, processCreated: 'new-instance' } });
  const { manager, directory } = await fixture(t, { inspectSession: async () => observed });
  await manager.registerSession({ id: 'session', workId: 'work', runId: 'run', identity, ownershipVerified: true });
  const payload = await generated(manager, 'capture', { sessionIds: ['session'] }); await manager.releaseLease(payload.id, payload.lease);
  for (const value of [observed, observation('unknown', { ownershipVerified: false }), observation('closed', { processesStopped: false })]) {
    observed = value; const result = await manager.cleanup();
    assert.equal(result.results[0].state, 'deferred'); assert.equal(result.results[0].logoffConfirmed, false);
    assert.equal(result.resources.find(r => r.id === 'session').leases.length, 1);
    assert.equal(await fs.readFile(path.join(payload.path, 'capture'), 'utf8'), '12345');
  }
  assert.ok((await fs.stat(path.join(directory, 'management/resources.json'))).isFile());
});

test('file deletion failure reports confirmed logoff separately and preserves exact retry evidence', async t => {
  let fail = true;
  const { manager } = await fixture(t, { inspectSession: async () => observation('closed'), unlink: async file => {
    if (fail) throw Object.assign(new Error('File locked'), { code: 'EACCES' }); return fs.unlink(file);
  } });
  await session(manager); const payload = await generated(manager, 'capture', { sessionIds: ['session'] }); await manager.releaseLease(payload.id, payload.lease);
  const failed = (await manager.cleanup()).results[0];
  assert.equal(failed.logoffConfirmed, true); assert.equal(failed.filesCleanupState, 'partial');
  assert.deepEqual(failed.diagnostic, { phase: 'delete_files', code: 'EACCES' });
  assert.deepEqual(failed.remainingPaths, [payload.path]);
  fail = false; assert.equal((await manager.cleanup()).results[0].filesCleanupState, 'complete');
});

test('external logoff does not discard explicit session protection', async t => {
  const { manager } = await fixture(t, { inspectSession: async () => observation('closed') });
  const registered = await manager.registerSession({ id: 'session', workId: 'work', runId: 'run', identity, ownershipVerified: true });
  await manager.releaseLease(registered.id, registered.lease, { state: 'protected' });
  const result = await manager.cleanup();
  assert.equal(result.results[0].logoffConfirmed, true); assert.equal(result.results[0].reason, 'protected');
  assert.equal(result.resources[0].protected, true);
  await manager.setProtection(registered.id, { protected: false, consumers: [] });
  assert.equal((await manager.cleanup()).results[0].state, 'deleted');
});

test('stale lock needs exact owner-stop verification and does not expire on time or PID absence', async t => {
  const { manager, directory } = await fixture(t, { lockTimeoutMs: 5 });
  const lock = path.join(directory, 'management/admission.lock'), owner = { pid: 999999, started: 'created', nonce: 'owned' };
  await fs.mkdir(lock); await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify(owner));
  await assert.rejects(manager.inspect(), /admission lock/);
  await assert.rejects(manager.recoverLock(async () => ({ state: 'stopped', identity: owner, exactIdentityVerified: false })), /unverified/);
  await manager.recoverLock(async actual => ({ identity: actual, state: 'stopped', exactIdentityVerified: true }));
  assert.equal((await manager.inspect()).bytes, 0);
});

test('actual worker exit inside session observation leaves a protected admission lock', async t => {
  const { manager, directory } = await fixture(t, { lockTimeoutMs: 5 });
  await session(manager);
  const result = await new Promise((resolve, reject) => {
    const program = `const {createResourceManager}=require(process.argv[1]);createResourceManager({directory:process.argv[2],idleMs:0,inspectSession:async()=>process.exit(17)}).cleanup().catch(()=>process.exit(3));`;
    const child = spawn(process.execPath, ['-e', program, require.resolve('./window-use-resources.cjs'), directory]);
    child.on('error', reject); child.on('exit', code => resolve(code));
  });
  assert.equal(result, 17);
  const owner = JSON.parse(await fs.readFile(path.join(directory, 'management/admission.lock/owner.json'), 'utf8'));
  assert.ok(owner.pid && owner.started && owner.nonce);
  await assert.rejects(manager.cleanup(), /admission lock/);
  // No recovery is inferred from this exit code or from PID absence.
});

test('interrupted metadata writes remain visible and reject fresh allocations', async t => {
  const { manager, directory } = await fixture(t);
  const r = await generated(manager); await manager.releaseLease(r.id, r.lease);
  await fs.writeFile(path.join(directory, 'management/resources.next'), '{partial');
  const status = await manager.inspect(); assert.equal(status.pendingMetadataWrite, true); assert.equal(status.capacityUnknown, true);
  await assert.rejects(manager.registerGenerated({ id: 'fresh', workId: 'w', runId: 'r', producer: 'p' }), /capacity.*unknown/);
  const cleanup = await manager.cleanup(); assert.equal(cleanup.results[0].state, 'failed'); assert.equal(cleanup.freedBytes, 0); assert.match(cleanup.results[0].metadataError, /Interrupted metadata write/);
  assert.equal(await fs.readFile(path.join(r.path, 'capture'), 'utf8'), '12345');
  assert.equal(await fs.readFile(path.join(directory, 'management/resources.next'), 'utf8'), '{partial');
});

test('age is nomination only, scheduler uses same policy and bounded history compacts', async t => {
  let now = 0;
  const { manager, directory } = await fixture(t, { now: () => now, idleMs: 100, historyLimit: 2 });
  const r = await generated(manager); await manager.releaseLease(r.id, r.lease);
  assert.equal((await manager.cleanup()).results.length, 0); now = 101;
  await manager.setProtection(r.id, { protected: true, consumers: [] });
  const scheduled = new Promise(resolve => manager.startScheduler({ intervalMs: 1000, onResult: resolve }));
  assert.equal((await scheduled).results[0].state, 'deferred'); await manager.stopScheduler();
  await manager.setProtection(r.id, { protected: false, consumers: [] }); await manager.cleanup();
  for (let i = 0; i < 3; i++) { const item = await generated(manager, `item${i}`); await manager.releaseLease(item.id, item.lease); await manager.cleanup({ ids: [item.id] }); }
  const metadata = JSON.parse(await fs.readFile(path.join(directory, 'management/resources.json'), 'utf8'));
  assert.equal(metadata.history.length, 2); assert.equal(metadata.records.length, 0);
});
