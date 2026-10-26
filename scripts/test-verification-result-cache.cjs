'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { begin, prune, pruneObsoleteVersions, pruneRemovedChecks, inspectLease, recoverLease, CACHE_SCHEMA } = require('./verification-result-cache.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const storage = process.env.AZRAEL_CACHE_TEST_OUTPUT ? path.resolve(process.env.AZRAEL_CACHE_TEST_OUTPUT) : path.resolve(__dirname, '../artifacts/logs/verification-result-cache/storage');
const fixtures = path.join(storage, `fixtures-${crypto.randomUUID()}`);
let passed = 0;
const retained = [];
async function exists(filename) { try { await fs.lstat(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function setup(name) {
  const projectRoot = path.join(fixtures, name), cacheRoot = path.join(projectRoot, 'artifacts/cache/verification-results');
  const runDirectory = path.join(projectRoot, 'run');
  await fs.mkdir(runDirectory, { recursive: true });
  const logPath = path.join(runDirectory, 'check.log'), errorPath = path.join(runDirectory, 'check.stderr.log');
  await fs.writeFile(logPath, 'success\n'); await fs.writeFile(errorPath, '');
  return { options: { projectRoot, cacheRoot, runDirectory, checkId: 'check', key: sha('one') }, record: { exitCode: 0, signal: null, logPath, errorPath }, slot: path.join(cacheRoot, `v${CACHE_SCHEMA}`, sha('check')) };
}
async function test(name, action) { await action(); passed++; console.log(`PASS ${name}`); }
async function retirement(options, lease) {
  const identity = await inspectLease({ ...options, lease });
  const evidence_ref = path.join(options.projectRoot, `termination-${crypto.randomUUID()}.json`);
  const proof = JSON.stringify({ independentlyVerifiedProducerTreeStopped: true, identity });
  await fs.writeFile(evidence_ref, proof);
  return { ...options, lease, expectedToken: identity.token, expectedOwnerSha256: identity.ownerSha256, producer_stopped_verified: true, evidence_ref, evidence_sha256: sha(proof), reason: 'Focused fixture producer tree independently observed terminated', receipt_ref: path.join(options.projectRoot, `decision-${crypto.randomUUID()}.json`) };
}
async function orphan(options, record) {
  const { fork } = require('node:child_process');
  const child = fork('-e', [`const {begin}=require(${JSON.stringify(require.resolve('./verification-result-cache.cjs'))}); (async()=>{const h=await begin(${JSON.stringify(options)}); await h.publish(${JSON.stringify(record)});process.send({ready:true,lease:h.lease});process.on('message',()=>process.exit(0));})().catch(e=>{console.error(e);process.exit(1)});`], { execArgv: [], silent: true });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; }); child.stdout.resume();
  const exited = new Promise((resolve, reject) => { child.on('exit', (code, signal) => code === 0 && signal === null ? resolve() : reject(Error(`Fixture child failed ${code}/${signal}: ${stderr}`))); child.on('error', reject); });
  const ready = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', code => reject(Error(`Child exited before ready: ${code} ${stderr}`))); });
  return { child, exited, ready };
}
function recoveryChild(request, interruptAfterClaim = false) {
  const { fork } = require('node:child_process');
  const source = `
    const fs = require('node:fs').promises;
    const writeFile = fs.writeFile;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    process.on('message', () => release());
    fs.writeFile = async function(filename, ...args) {
      if (/retirement-claim-[a-f0-9]{64}\\.json$/.test(String(filename))) {
        if (args[1]?.flag !== 'wx') throw Error('Recovery claim must use exclusive creation');
        process.send({ ready: true });
        await gate;
        const result = await writeFile.call(this, filename, ...args);
        if (${interruptAfterClaim}) process.exit(0);
        return result;
      }
      return writeFile.call(this, filename, ...args);
    };
    const { recoverLease } = require(${JSON.stringify(require.resolve('./verification-result-cache.cjs'))});
    recoverLease(${JSON.stringify(request)}).then(
      value => process.send({ outcome: { status: 'fulfilled', value } }, () => process.exit(0)),
      error => process.send({ outcome: { status: 'rejected', message: error.message } }, () => process.exit(0))
    );`;
  const child = fork('-e', [source], { execArgv: [], silent: true });
  let stderr = '', outcome, readyResolve, readyReject;
  child.stderr.on('data', bytes => { stderr += bytes; }); child.stdout.resume();
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Attach immediately so a fixture startup failure never becomes unhandled.
  ready.catch(() => {});
  child.on('message', message => { if (message.ready) readyResolve(); if (message.outcome) outcome = message.outcome; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', error => { readyReject(error); reject(error); });
    child.once('exit', (code, signal) => {
      readyReject(Error(`Recovery child exited before claim gate: ${code}/${signal}: ${stderr}`));
      if (code !== 0 || signal !== null) reject(Error(`Recovery child failed ${code}/${signal}: ${stderr}`));
      else resolve(outcome);
    });
  });
  exited.catch(() => {});
  return { child, ready, exited, release() { if (child.connected) child.send('continue'); } };
}
async function abandonedGuard(name) {
  const fixture = await setup(name), { options, record } = fixture;
  const producer = await orphan(options, record); producer.child.send('exit'); await producer.exited;
  await recoverLease(await retirement(options, sha(options.checkId)));
  const guard = path.join(options.cacheRoot, '.lease-access'); await fs.mkdir(guard);
  await fs.writeFile(path.join(guard, 'owner.json'), JSON.stringify({ token: 'dead-guard', pid: producer.child.pid }));
  const owner = await inspectLease({ ...options, lease: '.lease-access' });
  const bytes = JSON.stringify({ token: 'dead-claim', pid: producer.child.pid, ownerSha256: owner.ownerSha256 });
  await fs.writeFile(path.join(guard, 'retirement.json'), bytes);
  const request = await retirement(options, '.lease-access');
  const claimed = await inspectLease(request);
  return { ...fixture, guard, bytes, deadPid: producer.child.pid, request: { ...request, expectedRetirementName: claimed.retirement.name, expectedRetirementSha256: claimed.retirement.sha256 } };
}
async function main() {
  await test('blocked close coalesces, retains ownership and retries after exact fixture guard removal', async () => {
    const { options } = await setup('retry-close'); const handle = await begin(options);
    const old = path.join(options.cacheRoot, 'v0'); await fs.mkdir(old);
    const guard = path.join(options.cacheRoot, '.lease-access'), ownerFile = path.join(guard, 'owner.json');
    const ownerBytes = JSON.stringify({ token: crypto.randomUUID(), pid: process.pid, fixture: 'retry-close' });
    await fs.mkdir(guard); await fs.writeFile(ownerFile, ownerBytes, { flag: 'wx' });
    const lease = path.join(options.cacheRoot, '.leases', sha(options.checkId));
    await Promise.all([handle.close(), handle.close(), handle.close()]);
    assert.equal(handle.deferred.filter(value => value.startsWith('lease release:')).length, 1);
    assert.equal(await exists(lease), true); assert.equal(await exists(old), true);
    assert.equal(await fs.readFile(ownerFile, 'utf8'), ownerBytes, 'foreign access ownership must be retained');
    // Remove only the exact guard created by this test, never another owner.
    assert.deepEqual(await fs.readdir(guard), ['owner.json']);
    await fs.unlink(ownerFile); await fs.rmdir(guard);
    await Promise.all([handle.close(), handle.close()]);
    assert.deepEqual(await fs.readdir(path.join(options.cacheRoot, '.leases')), []);
    assert.equal(await exists(path.join(options.cacheRoot, '.lifecycle')), false);
    assert.equal(await exists(guard), false); assert.equal(await exists(old), false);
    assert.equal(handle.deferred.filter(value => value.startsWith('lease release:')).length, 1, 'retain the original release diagnostic');
  });
  await test('begin retains a failed lifecycle release for close to retry', async () => {
    const { options } = await setup('retry-lifecycle');
    const lifecycle = path.join(options.cacheRoot, '.lifecycle'), readdir = fs.readdir;
    let failed = false, handle;
    fs.readdir = async function (filename, ...args) {
      if (filename === lifecycle && !failed) { failed = true; throw Object.assign(Error('fixture lifecycle release blocked'), { code: 'EBUSY' }); }
      return readdir.call(this, filename, ...args);
    };
    try { handle = await begin(options); } finally { fs.readdir = readdir; }
    assert.equal(failed, true); assert.match(handle.deferred.join(), /lifecycle release: EBUSY/);
    assert.equal(await exists(lifecycle), true);
    const contender = await begin({ ...options, checkId: 'contender' });
    assert.match(contender.reason, /busy: lifecycle/, 'failed release retires the local turn while disk ownership stays protected');
    await contender.close();
    const old = path.join(options.cacheRoot, 'v0'); await fs.mkdir(old);
    await Promise.all([handle.close(), handle.close()]);
    assert.equal(await exists(lifecycle), false);
    assert.deepEqual(await fs.readdir(path.join(options.cacheRoot, '.leases')), []);
    assert.equal(await exists(old), false);
  });
  await test('lifecycle acquisition and setup failures retire local turns before cleanup reentry', async () => {
    for (const stage of ['acquisition', 'setup']) {
      const { options, record, slot } = await setup(`lifecycle-failure-${stage}`);
      const target = stage === 'acquisition' ? path.join(options.cacheRoot, '.lifecycle') : slot;
      const mkdir = fs.mkdir;
      let failed = false, handle;
      fs.mkdir = async function (filename, ...args) {
        if (filename === target && !failed) { failed = true; throw Object.assign(Error(`fixture ${stage} blocked`), { code: 'EIO' }); }
        return mkdir.call(this, filename, ...args);
      };
      try { handle = await begin(options); } finally { fs.mkdir = mkdir; }
      assert.equal(failed, true); assert.match(handle.reason, /EIO/);
      await handle.close();
      const next = await begin(options);
      try { assert.equal((await next.publish(record)).published, true, next.reason); }
      finally { await next.close(); }
      assert.equal(await exists(path.join(options.cacheRoot, '.lifecycle')), false);
      assert.deepEqual(await fs.readdir(path.join(options.cacheRoot, '.leases')), []);
    }
  });
  await test('exact live lease refuses recovery; confirmed child exit permits recovery and cached hit', async () => {
    const { options, record } = await setup('recovery-child');
    const producer = await orphan(options, record), lease = sha(options.checkId);
    assert.equal(producer.ready.lease.runDirectory, options.runDirectory);
    assert.equal(producer.ready.lease.checkId, options.checkId);
    assert.ok(producer.ready.lease.acquisitionTime);
    const denied = await begin(options); assert.match(denied.reason, /busy: check/); await denied.close();
    const request = await retirement(options, lease);
    await assert.rejects(recoverLease({ ...request, producer_stopped_verified: false }), /verified retirement/);
    await assert.rejects(recoverLease(request), /PID is live/);
    producer.child.send('exit'); await producer.exited;
    await assert.rejects(recoverLease({ ...request, expectedToken: 'replacement' }), /identity changed/);
    await fs.appendFile(request.evidence_ref, 'mutated');
    await assert.rejects(recoverLease(request), /evidence changed/);
    const exact = await retirement(options, lease);
    assert.equal((await recoverLease(exact)).recovered, true);
    assert.equal((await inspectLease({ ...options, lease })).exists, false);
    assert.equal(JSON.parse(await fs.readFile(exact.receipt_ref)).evidence_sha256, exact.evidence_sha256);
    const hit = await begin(options); assert.equal(hit.hit.reused, true); await hit.close(); await hit.close();
  });
  await test('malformed exact bytes and guard retirement stay explicit, serialized and fail closed', async () => {
    const { options } = await setup('recovery-guard'); await fs.mkdir(options.cacheRoot, { recursive: true });
    const guard = path.join(options.cacheRoot, '.lease-access'); await fs.mkdir(guard); await fs.writeFile(path.join(guard, 'owner.json'), '{legacy malformed');
    const request = await retirement(options, '.lease-access'); assert.equal(request.expectedToken, null);
    const outcomes = await Promise.allSettled([recoverLease(request), recoverLease({ ...request, receipt_ref: path.join(options.projectRoot, 'other-decision.json') })]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await exists(guard), false);
    await fs.mkdir(guard); await fs.writeFile(path.join(guard, 'owner.json'), '{}');
    const missingProof = await retirement(options, '.lease-access');
    await assert.rejects(recoverLease({ ...missingProof, evidence_ref: path.join(options.cacheRoot, 'proof') }), /outside cache/);
    const linked = path.join(options.projectRoot, 'linked-proof');
    await fs.symlink(options.projectRoot, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(recoverLease({ ...missingProof, evidence_ref: path.join(linked, path.basename(missingProof.evidence_ref)) }), /Unsafe|Redirected/); await fs.unlink(linked);
    await fs.writeFile(path.join(guard, 'unknown'), 'keep');
    await assert.rejects(inspectLease({ ...options, lease: '.lease-access' }), /Unidentified/);
    assert.equal(await exists(path.join(guard, 'unknown')), true);
  });
  await test('stale token refuses publication and close cannot delete replacement', async () => {
    const { options, record } = await setup('replacement-token'); const handle = await begin(options);
    const lease = path.join(options.cacheRoot, '.leases', sha(options.checkId), 'owner.json');
    const owner = JSON.parse(await fs.readFile(lease)); owner.token = crypto.randomUUID(); await fs.writeFile(lease, JSON.stringify(owner));
    assert.match((await handle.publish(record)).reason, /ownership changed/);
    await handle.close(); await handle.close(); assert.equal(await exists(lease), true);
    assert.match(handle.deferred.join(), /ownership changed/);
  });
  await test('interrupted guard claim resumes once and lifecycle recovery preserves passing evidence', async () => {
    const { options, record } = await setup('resumed-retirement');
    const producer = await orphan(options, record); producer.child.send('exit'); await producer.exited;
    await recoverLease(await retirement(options, sha(options.checkId)));
    const guard = path.join(options.cacheRoot, '.lease-access'); await fs.mkdir(guard);
    await fs.writeFile(path.join(guard, 'owner.json'), JSON.stringify({ token: 'dead-guard', pid: producer.child.pid }));
    const identity = await inspectLease({ ...options, lease: '.lease-access' });
    await fs.writeFile(path.join(guard, 'retirement.json'), JSON.stringify({ token: 'dead-claim', pid: producer.child.pid, ownerSha256: identity.ownerSha256 }));
    const request = await retirement(options, '.lease-access');
    const claimed = await inspectLease(request);
    await assert.rejects(recoverLease(request), /Exact retirement claim identity/);
    const exact = { ...request, expectedRetirementName: claimed.retirement.name, expectedRetirementSha256: claimed.retirement.sha256 };
    const writeFile = fs.writeFile;
    let entered, release, claimAttempts = 0;
    const atClaim = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    fs.writeFile = async function (filename, ...args) {
      if (path.dirname(filename) === guard && /^retirement-claim-/.test(path.basename(filename))) {
        claimAttempts++; assert.equal(args[1].flag, 'wx'); entered(); await gate;
      }
      return writeFile.call(this, filename, ...args);
    };
    let first, second, outcomes;
    try {
      first = recoverLease(exact); await atClaim;
      second = recoverLease({ ...exact, receipt_ref: path.join(options.projectRoot, 'resume-other.json') });
      release(); outcomes = await Promise.allSettled([first, second]);
    } finally { release(); await Promise.allSettled([first, second].filter(Boolean)); fs.writeFile = writeFile; }
    assert.equal(claimAttempts, 1, 'the local access turn excludes the second stale claimant');
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1); assert.equal(await exists(guard), false);
    const lifecycle = path.join(options.cacheRoot, '.lifecycle'); await fs.mkdir(lifecycle);
    await fs.writeFile(path.join(lifecycle, 'owner.json'), JSON.stringify({ token: 'dead-lifecycle', pid: producer.child.pid }));
    const original = await retirement(options, '.lifecycle');
    await fs.writeFile(path.join(lifecycle, 'owner.json'), JSON.stringify({ token: 'replacement-lifecycle', pid: producer.child.pid }));
    await assert.rejects(recoverLease(original), /identity changed/);
    await recoverLease(await retirement(options, '.lifecycle'));
    const hit = await begin(options); assert.equal(hit.hit.reused, true); await hit.close();
  });
  await test('distinct recovery processes race at exclusive successor creation and preserve passing evidence', async () => {
    const { options, guard, request } = await abandonedGuard('recovery-process-race');
    const children = [recoveryChild(request), recoveryChild({ ...request, receipt_ref: path.join(options.projectRoot, 'other-process-decision.json') })];
    let outcomes;
    try {
      await Promise.all(children.map(child => child.ready));
      // Both processes inspected the same predecessor before either exclusive write.
      children.forEach(child => child.release());
      outcomes = await Promise.all(children.map(child => child.exited));
    } finally {
      children.forEach(child => child.release());
      await Promise.allSettled(children.map(child => child.exited));
    }
    assert.equal(outcomes.filter(result => result?.status === 'fulfilled' && result.value.recovered === true).length, 1);
    assert.equal(outcomes.filter(result => result?.status === 'rejected').length, 1);
    assert.equal(await exists(guard), false);
    const hit = await begin(options); try { assert.equal(hit.hit.reused, true); } finally { await hit.close(); }
  });
  await test('terminated successor claimant resumes from the current complete predecessor chain', async () => {
    const { options, guard, request } = await abandonedGuard('interrupted-successor');
    const child = recoveryChild(request, true);
    try { await child.ready; child.release(); await child.exited; }
    finally { child.release(); await child.exited; }
    const interrupted = await inspectLease(request);
    assert.equal(interrupted.retirement.name, `retirement-claim-${request.expectedRetirementSha256}.json`);
    assert.equal(interrupted.retirement.claim.pid, child.child.pid);
    assert.deepEqual(interrupted.retirement.claim.predecessor, { name: request.expectedRetirementName, sha256: request.expectedRetirementSha256 });
    assert.equal(interrupted.retirement.claim.evidence_sha256, request.evidence_sha256);
    assert.equal((await fs.readdir(guard)).length, 3, 'retain predecessor until ordinary guard removal');
    await assert.rejects(recoverLease(request), /Exact retirement claim identity/);
    const current = await retirement(options, '.lease-access');
    assert.equal((await recoverLease({ ...current, expectedRetirementName: interrupted.retirement.name, expectedRetirementSha256: interrupted.retirement.sha256 })).recovered, true);
    assert.equal(await exists(guard), false);
    const hit = await begin(options); try { assert.equal(hit.hit.reused, true); } finally { await hit.close(); }
  });
  await test('legacy renamed dead claim remains recoverable with exact bytes and passing evidence', async () => {
    const { options, guard, bytes, deadPid, request } = await abandonedGuard('legacy-renamed-claim');
    const name = `retirement-${deadPid}-${crypto.randomUUID()}.json`;
    await fs.rename(path.join(guard, request.expectedRetirementName), path.join(guard, name));
    assert.equal(await fs.readFile(path.join(guard, name), 'utf8'), bytes);
    const current = await retirement(options, '.lease-access');
    const identity = await inspectLease(current);
    assert.equal(identity.retirement.name, name);
    assert.equal(identity.retirement.sha256, request.expectedRetirementSha256);
    assert.equal(identity.retirement.claimantPid, deadPid);
    assert.equal((await recoverLease({ ...current, expectedRetirementName: name, expectedRetirementSha256: identity.retirement.sha256 })).recovered, true);
    assert.equal(await exists(guard), false);
    const hit = await begin(options); try { assert.equal(hit.hit.reused, true); } finally { await hit.close(); }
  });
  await test('successor token changed after decision write prevents deletion and a live claimant prevents retry', async () => {
    const { options, guard, request } = await abandonedGuard('successor-changed-after-decision');
    const writeFile = fs.writeFile;
    const claimPath = path.join(guard, `retirement-claim-${request.expectedRetirementSha256}.json`);
    let changed = false, originalClaim;
    fs.writeFile = async function (filename, ...args) {
      const result = await writeFile.call(this, filename, ...args);
      if (filename === request.receipt_ref) {
        originalClaim = JSON.parse(await fs.readFile(claimPath, 'utf8'));
        await writeFile.call(this, claimPath, JSON.stringify({ ...originalClaim, token: crypto.randomUUID() }));
        changed = true;
      }
      return result;
    };
    try { await assert.rejects(recoverLease(request), /Lease identity changed/); }
    finally { fs.writeFile = writeFile; }
    assert.equal(changed, true, 'mutation follows the completed immutable decision write');
    assert.equal(await exists(guard), true);
    const decisionBytes = await fs.readFile(request.receipt_ref, 'utf8');
    const decision = JSON.parse(decisionBytes);
    assert.equal(decision.retirementClaim.claim.token, originalClaim.token);
    const identity = await inspectLease(request);
    assert.notEqual(identity.retirement.claim.token, originalClaim.token);
    assert.notEqual(identity.retirement.sha256, decision.retirementClaim.sha256);
    assert.deepEqual(identity.retirement.claim.predecessor, originalClaim.predecessor);
    assert.equal(identity.retirement.claim.pid, process.pid);
    const current = await retirement(options, '.lease-access');
    await assert.rejects(recoverLease({ ...current, expectedRetirementName: identity.retirement.name, expectedRetirementSha256: identity.retirement.sha256 }), /PID is live/);
    assert.equal(await exists(guard), true);
    assert.equal(await fs.readFile(request.receipt_ref, 'utf8'), decisionBytes);
    assert.equal(await exists(current.receipt_ref), false, 'refused retry must not publish a decision');
  });
  await test('malformed, missing, changed and forked predecessor chains refuse without deleting evidence', async () => {
    for (const variant of ['malformed', 'missing', 'changed', 'forked', 'unknown']) {
      const { options, guard, request, deadPid } = await abandonedGuard(`chain-${variant}`);
      const name = `retirement-claim-${request.expectedRetirementSha256}.json`;
      const claim = { token: 'interrupted-successor', pid: deadPid, ownerSha256: request.expectedOwnerSha256, evidence_sha256: request.evidence_sha256, predecessor: { name: request.expectedRetirementName, sha256: request.expectedRetirementSha256 } };
      await fs.writeFile(path.join(guard, name), variant === 'malformed' ? '{invalid' : JSON.stringify(claim));
      if (variant === 'missing') await fs.unlink(path.join(guard, request.expectedRetirementName));
      if (variant === 'changed') await fs.appendFile(path.join(guard, request.expectedRetirementName), ' ');
      if (variant === 'forked') await fs.writeFile(path.join(guard, `retirement-${deadPid}-${crypto.randomUUID()}.json`), JSON.stringify({ token: 'other-root', pid: deadPid, ownerSha256: request.expectedOwnerSha256 }));
      if (variant === 'unknown') await fs.writeFile(path.join(guard, 'retirement-claim-unknown.json'), 'keep');
      const before = (await fs.readdir(guard)).sort();
      await assert.rejects(inspectLease({ ...options, lease: '.lease-access' }));
      await assert.rejects(recoverLease(request));
      assert.deepEqual((await fs.readdir(guard)).sort(), before, `${variant} evidence must remain intact`);
      assert.equal(await exists(path.join(guard, 'owner.json')), true);
    }
  });
  await test('cold publish, exact hit and independent copied logs after replacement', async () => {
    const { options, record, slot } = await setup('hit');
    const cold = await begin(options); assert.equal(cold.hit, null);
    assert.equal((await cold.publish(record)).published, true); await cold.close();
    const hitOptions = { ...options, runDirectory: path.join(options.projectRoot, 'second') };
    const hit = await begin(hitOptions); assert.equal(hit.hit.reused, true); assert.equal(hit.hit.stdout, 'success\n');
    assert.equal(hit.hit.logSha256, sha('success\n')); assert.equal(hit.hit.logPath, path.join(hitOptions.runDirectory, 'check.log')); await hit.close();
    const replacement = await begin({ ...options, key: sha('two') });
    assert.equal((await replacement.publish(record)).published, true); await replacement.close();
    assert.deepEqual(await fs.readdir(slot), [sha('two')]); assert.equal(await fs.readFile(hit.hit.logPath, 'utf8'), 'success\n');
    const old = await begin(options); assert.equal(old.hit, null); await old.close();
  });
  await test('failed, signaled, unknown and error checks cannot publish', async () => {
    const { options, record, slot } = await setup('failure'); const handle = await begin(options);
    for (const bad of [{ exitCode: 1 }, { exitCode: null }, { signal: 'SIGTERM' }, { error: 'spawn failed' }]) assert.equal((await handle.publish({ ...record, ...bad })).published, false);
    assert.deepEqual(await fs.readdir(slot), []); await handle.close();
    assert.equal((await handle.publish(record)).reason, 'closed');
  });
  await test('key change immediately prunes stale success even when replacement fails', async () => {
    const { options, record, slot } = await setup('failed-replacement');
    const first = await begin(options); await first.publish(record); await first.close();
    const next = await begin({ ...options, key: sha('changed') });
    assert.deepEqual(await fs.readdir(slot), []);
    assert.equal((await next.publish({ ...record, exitCode: 1 })).published, false); await next.close();
    assert.deepEqual(await fs.readdir(slot), []);
  });
  await test('removed check slots prune idle and protect active checks', async () => {
    const { options, record, slot } = await setup('removed-checks');
    const first = await begin(options); await first.publish(record);
    const other = await begin({ ...options, checkId: 'other' }); await other.publish(record); await other.close();
    const protectedResult = await pruneRemovedChecks({ ...options, checkIds: [] });
    assert.match(protectedResult.deferred.join(), /active or abandoned/); assert.equal(await exists(slot), true);
    assert.equal(await exists(path.join(options.cacheRoot, `v${CACHE_SCHEMA}`, sha('other'))), false);
    await first.close();
    const removed = await pruneRemovedChecks({ ...options, checkIds: [] }); assert.deepEqual(removed.removed, [sha('check')]); assert.equal(await exists(slot), false);
    await assert.rejects(pruneRemovedChecks({ ...options, checkIds: ['../escape'] }), /Invalid active/);
  });
  await test('combined pruning keeps one lifecycle owner across obsolete and removed checks', async () => {
    const { options, record, slot } = await setup('combined-prune');
    for (const checkId of ['check', 'keep']) {
      const handle = await begin({ ...options, checkId }); await handle.publish(record); await handle.close();
    }
    const old = path.join(options.cacheRoot, 'v0'); await fs.mkdir(old);
    const lifecycle = path.join(options.cacheRoot, '.lifecycle'), version = path.join(options.cacheRoot, `v${CACHE_SCHEMA}`);
    const mkdir = fs.mkdir, readdir = fs.readdir, tokens = []; let acquisitions = 0;
    fs.mkdir = async function (filename, ...args) {
      const result = await mkdir.call(this, filename, ...args);
      if (filename === lifecycle) acquisitions++;
      return result;
    };
    fs.readdir = async function (filename, ...args) {
      if (filename === options.cacheRoot || filename === version) {
        const owner = JSON.parse(await fs.readFile(path.join(lifecycle, 'owner.json'), 'utf8'));
        assert.equal(owner.operation, 'prune'); tokens.push(owner.token);
      }
      return readdir.call(this, filename, ...args);
    };
    let result;
    try { result = await prune({ ...options, checkIds: ['keep'] }); }
    finally { fs.mkdir = mkdir; fs.readdir = readdir; }
    assert.deepEqual(result.deferred, []); assert.deepEqual(result.removed, [sha('check')]);
    assert.equal(acquisitions, 1); assert.ok(tokens.length >= 2); assert.equal(new Set(tokens).size, 1);
    assert.equal(await exists(old), false); assert.equal(await exists(slot), false); assert.equal(await exists(lifecycle), false);
    const keep = await begin({ ...options, checkId: 'keep' });
    try { assert.equal(keep.hit?.reused, true); assert.equal(keep.hit.stdout, 'success\n'); }
    finally { await keep.close(); }
  });
  await test('combined pruning protects active evidence and retains final-release obsolete cleanup', async () => {
    const { options, record, slot } = await setup('combined-active');
    const active = await begin(options); await active.publish(record);
    const idle = await begin({ ...options, checkId: 'idle' }); await idle.publish(record); await idle.close();
    const old = path.join(options.cacheRoot, 'v0'); await fs.mkdir(old);
    const ownerFile = path.join(options.cacheRoot, '.leases', sha('check'), 'owner.json');
    const owner = await fs.readFile(ownerFile);
    try {
      const result = await prune({ ...options, checkIds: [] });
      assert.deepEqual(result.removed, [sha('idle')]); assert.match(result.deferred.join(), /obsolete versions: active or abandoned/);
      assert.match(result.deferred.join(), /removed check .*active or abandoned/);
      assert.equal(await exists(old), true); assert.equal(await exists(slot), true);
      assert.deepEqual(await fs.readFile(ownerFile), owner);
      assert.equal(await fs.readFile(path.join(slot, options.key, 'stdout.log'), 'utf8'), 'success\n');
    } finally { await active.close(); }
    assert.equal(await exists(old), false); assert.equal(await exists(ownerFile), false);
    assert.deepEqual((await prune({ ...options, checkIds: [] })).removed, [sha('check')]);
  });
  await test('combined pruning isolates scan failures and releases ownership before retry', async () => {
    for (const phase of ['obsolete', 'removed']) {
      const { options, record, slot } = await setup(`combined-failure-${phase}`);
      const handle = await begin(options); await handle.publish(record); await handle.close();
      const old = path.join(options.cacheRoot, 'v0'), version = path.join(options.cacheRoot, `v${CACHE_SCHEMA}`);
      await fs.mkdir(old);
      const readdir = fs.readdir, lstat = fs.lstat; let injected = false;
      fs.readdir = async function (filename, ...args) {
        if (phase === 'obsolete' && filename === options.cacheRoot && !injected) {
          injected = true; throw Object.assign(new Error('injected obsolete scan failure'), { code: 'EIO' });
        }
        return readdir.call(this, filename, ...args);
      };
      fs.lstat = async function (filename, ...args) {
        if (phase === 'removed' && filename === version && !injected) {
          injected = true; throw Object.assign(new Error('injected removed scan failure'), { code: 'EIO' });
        }
        return lstat.call(this, filename, ...args);
      };
      let result;
      try { result = await prune({ ...options, checkIds: [] }); }
      finally { fs.readdir = readdir; fs.lstat = lstat; }
      assert.equal(injected, true); assert.match(result.deferred.join(), new RegExp(`injected ${phase} scan failure`));
      assert.equal(await exists(path.join(options.cacheRoot, '.lifecycle')), false);
      assert.equal(await exists(path.join(options.cacheRoot, '.lease-access')), false);
      assert.equal(await exists(old), phase === 'obsolete'); assert.equal(await exists(slot), phase === 'removed');
      const retried = await prune({ ...options, checkIds: [] });
      assert.deepEqual(retried.deferred, []); assert.equal(await exists(old), false); assert.equal(await exists(slot), false);
    }
  });
  await test('combined pruning rejects invalid IDs and preserves unknown lifecycle ownership', async () => {
    const { options, record, slot } = await setup('combined-unknown');
    await assert.rejects(prune({ ...options, checkIds: ['../escape'] }), /Invalid active/);
    assert.equal(await exists(options.cacheRoot), false);
    const handle = await begin(options); await handle.publish(record); await handle.close();
    const old = path.join(options.cacheRoot, 'v0'), lifecycle = path.join(options.cacheRoot, '.lifecycle');
    await fs.mkdir(old); await fs.mkdir(lifecycle);
    const ownerFile = path.join(lifecycle, 'owner.json'), owner = '{"token":"owned-test-unknown","pid":null}';
    await fs.writeFile(ownerFile, owner, { flag: 'wx' });
    try {
      const result = await prune({ ...options, checkIds: [] });
      assert.deepEqual(result.removed, []);
      assert.deepEqual(result.deferred, ['obsolete versions: lifecycle lease busy', 'removed checks: lifecycle lease busy']);
      assert.equal(await fs.readFile(ownerFile, 'utf8'), owner);
      assert.equal(await exists(old), true); assert.equal(await exists(slot), true);
    } finally {
      // This exact fixture guard has no producer; retire only the bytes created above.
      assert.equal(await fs.readFile(ownerFile, 'utf8'), owner); await fs.unlink(ownerFile); await fs.rmdir(lifecycle);
    }
    assert.deepEqual((await prune({ ...options, checkIds: [] })).deferred, []);
    assert.equal(await exists(old), false); assert.equal(await exists(slot), false);
  });
  await test('corrupt receipt, extra fields and altered evidence miss then replace', async () => {
    const { options, record, slot } = await setup('corrupt');
    let handle = await begin(options); await handle.publish(record); await handle.close();
    const receiptPath = path.join(slot, options.key, 'receipt.json');
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    await fs.writeFile(receiptPath, JSON.stringify({ ...receipt, extra: 'unsafe' }));
    handle = await begin(options); assert.equal(handle.hit, null); assert.match(handle.reason, /Invalid cache receipt/);
    assert.equal((await handle.publish(record)).published, true); await handle.close();
    await fs.writeFile(path.join(slot, options.key, 'stdout.log'), 'tampered');
    handle = await begin(options); assert.equal(handle.hit, null); assert.match(handle.reason, /hash mismatch/); await handle.close();
    await fs.unlink(path.join(slot, options.key, 'stderr.log'));
    handle = await begin(options); assert.equal(handle.hit, null); await handle.close();
  });
  await test('active same-check lease bypass and unrelated check preservation', async () => {
    const { options, record, slot } = await setup('leases');
    const first = await begin(options), second = await begin({ ...options, key: sha('two') });
    assert.equal(second.hit, null); assert.match(second.reason, /busy: check lease/); assert.equal((await second.publish(record)).published, false); await second.close();
    assert.deepEqual(second.blockingLease, await inspectLease({ ...options, lease: sha(options.checkId) }));
    assert.equal(second.blockingLease.token, first.lease.token);
    assert.equal(second.blockingLease.owner.pid, process.pid);
    assert.equal(first.blockingLease, null);
    const other = await begin({ ...options, checkId: 'other' }); assert.equal((await other.publish(record)).published, true);
    assert.equal((await first.publish(record)).published, true); await first.close();
    assert.equal(await exists(path.join(options.cacheRoot, '.leases', sha('other'))), true);
    assert.equal(await exists(path.join(options.cacheRoot, `v${CACHE_SCHEMA}`, sha('other'), options.key)), true);
    const newer = await begin({ ...options, key: sha('three') }); await newer.publish(record); await newer.close();
    assert.deepEqual(await fs.readdir(slot), [sha('three')]); await other.close();
  });
  await test('obsolete versions cleaned idle and deferred during active or abandoned leases', async () => {
    const { options } = await setup('versions');
    const old = path.join(options.cacheRoot, 'v0', 'old'); await fs.mkdir(old, { recursive: true }); await fs.writeFile(path.join(old, 'evidence'), 'old');
    const idle = await pruneObsoleteVersions(options); assert.deepEqual(idle.deferred, []); assert.equal(await exists(path.dirname(old)), false);
    const active = await begin(options); await fs.mkdir(old, { recursive: true });
    assert.match((await pruneObsoleteVersions(options)).deferred.join(), /active or abandoned/); assert.equal(await exists(old), true);
    await active.close(); assert.equal(await exists(old), false); assert.deepEqual((await pruneObsoleteVersions(options)).deferred, []);
    const lease = path.join(options.cacheRoot, '.leases', sha('abandoned')); await fs.mkdir(lease); await fs.mkdir(old, { recursive: true });
    assert.match((await pruneObsoleteVersions(options)).deferred.join(), /abandoned/); assert.equal(await exists(lease), true);
  });
  await test('IDs, keys and escaped cache roots are rejected', async () => {
    const { options } = await setup('invalid');
    for (const patch of [{ checkId: '../escape' }, { key: 'A'.repeat(64) }, { logName: '../escape' }, { cacheRoot: path.join(options.projectRoot, 'outside') }]) await assert.rejects(begin({ ...options, ...patch }), /Invalid verification|must be inside/);
  });
  await test('linked parents, entries and obsolete trees are retained safely', async () => {
    const { options, record, slot } = await setup('links'); const target = path.join(options.projectRoot, 'outside'); await fs.mkdir(target); await fs.writeFile(path.join(target, 'keep'), 'keep');
    await fs.mkdir(path.dirname(options.cacheRoot), { recursive: true });
    await fs.symlink(target, options.cacheRoot, process.platform === 'win32' ? 'junction' : 'dir');
    let handle = await begin(options); assert.equal(handle.hit, null); assert.match(handle.reason, /Unsafe|Redirected/); await handle.close(); await fs.unlink(options.cacheRoot);
    handle = await begin(options); await fs.symlink(target, path.join(slot, options.key), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await handle.publish(record); assert.equal(result.published, false); assert.match(result.reason, /linked|Unsafe/); await handle.close();
    assert.equal(await fs.readFile(path.join(target, 'keep'), 'utf8'), 'keep'); await fs.unlink(path.join(slot, options.key));
    const obsolete = path.join(options.cacheRoot, 'v0'); await fs.mkdir(obsolete); await fs.symlink(target, path.join(obsolete, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const prune = await pruneObsoleteVersions(options); assert.match(prune.deferred.join(), /linked|Unsafe/); assert.equal(await exists(obsolete), true); await fs.unlink(path.join(obsolete, 'linked'));
  });
  await test('concurrent publications serialize without losing valid evidence', async () => {
    const { options, record, slot } = await setup('concurrent'); const handle = await begin(options);
    const results = await Promise.all([handle.publish(record), handle.publish(record)]);
    assert.equal(results.filter(result => result.published).length, 1); assert.equal(results.filter(result => result.reason === 'publication already active').length, 1);
    await handle.close(); assert.deepEqual(await fs.readdir(slot), [options.key]);
    const hit = await begin(options); assert.equal(hit.hit.reused, true); await hit.close();
  });
  await test('same-root access queues through guard release while another root progresses', async () => {
    const first = await setup('access-queue'), other = await setup('independent-access');
    const handles = [await begin(first.options), await begin({ ...first.options, checkId: 'second' }), await begin(other.options)];
    const guard = path.join(first.options.cacheRoot, '.lease-access');
    const mkdir = fs.mkdir, writeFile = fs.writeFile;
    let entered, resume, attempts = 0;
    const acquired = new Promise(resolve => { entered = resolve; });
    const barrier = new Promise(resolve => { resume = resolve; });
    fs.mkdir = async function (filename, ...args) {
      if (filename === guard) attempts++;
      return mkdir.call(this, filename, ...args);
    };
    fs.writeFile = async function (filename, ...args) {
      if (filename === path.join(guard, 'owner.json') && attempts === 1) { entered(); await barrier; }
      return writeFile.call(this, filename, ...args);
    };
    let pending = [];
    try {
      pending.push(handles[0].publish(first.record)); await acquired;
      pending.push(handles[1].publish(first.record));
      assert.equal((await handles[2].publish(other.record)).published, true, 'another root progresses while the first guard is held');
      assert.equal(attempts, 1, 'same-root contenders wait locally instead of polling the owned disk guard');
      resume();
      assert.equal((await Promise.all(pending)).filter(result => result.published).length, 2);
    } finally {
      resume(); await Promise.allSettled(pending); fs.mkdir = mkdir; fs.writeFile = writeFile;
      await Promise.all(handles.map(handle => handle.close()));
    }
    for (const { options } of [first, other]) {
      assert.deepEqual(await fs.readdir(path.join(options.cacheRoot, '.leases')), []);
      assert.equal(await exists(path.join(options.cacheRoot, '.lease-access')), false);
    }
  });
  await test('concurrent begin calls allow a single publisher', async () => {
    const { options, record } = await setup('concurrent-begins');
    const handles = await Promise.all([begin(options), begin(options), begin(options)]);
    const results = await Promise.all(handles.map(handle => handle.publish(record)));
    assert.equal(results.filter(result => result.published).length, 1);
    assert.equal(handles.filter(handle => /busy/.test(handle.reason || '')).length, 2);
    await Promise.all(handles.map(handle => handle.close()));
    const hit = await begin(options); assert.equal(hit.hit.reused, true); await hit.close();
  });
  await test('local lifecycle ownership outlives external deadline without blocking another root', async () => {
    const first = await setup('lifecycle-queue'), other = await setup('independent-lifecycle');
    const inputs = ['first', 'second', 'third', 'fourth'].map(checkId => ({ ...first.options, checkId }));
    const leases = path.join(first.options.cacheRoot, '.leases'), lifecycle = path.join(first.options.cacheRoot, '.lifecycle');
    const readdir = fs.readdir, mkdir = fs.mkdir;
    let entered, resume, held = false, attempts = 0;
    const acquired = new Promise(resolve => { entered = resolve; });
    const barrier = new Promise(resolve => { resume = resolve; });
    fs.mkdir = async function (filename, ...args) {
      if (filename === lifecycle) attempts++;
      return mkdir.call(this, filename, ...args);
    };
    fs.readdir = async function (filename, ...args) {
      // Pause obsolete scanning after lifecycle acquisition and access release.
      if (filename === leases && !held) { held = true; entered(); await barrier; }
      return readdir.call(this, filename, ...args);
    };
    const pending = [], handles = [];
    let pruning = [];
    try {
      pending.push(begin(inputs[0])); await acquired;
      pending.push(...inputs.slice(1).map(begin));
      pruning = [pruneObsoleteVersions(first.options), pruneRemovedChecks({ ...first.options, checkIds: inputs.map(input => input.checkId) })];
      const independent = await begin(other.options);
      handles.push(independent);
      assert.equal((await independent.publish(other.record)).published, true, independent.reason);
      // The local owner remains held longer than the 2000ms external deadline.
      await new Promise(resolve => setTimeout(resolve, 2200));
      resume();
      const local = await Promise.all(pending); handles.push(...local);
      assert.equal(local.filter(handle => /busy/.test(handle.reason || '')).length, 0, JSON.stringify(local.map(handle => handle.reason)));
      const pruned = await Promise.all(pruning);
      assert.equal(attempts, 6, 'each begin and prune acquires once after its local predecessor releases');
      assert.equal(pruned.flatMap(result => result.deferred).some(value => /lifecycle lease busy/.test(value)), false);
      assert.equal((await Promise.all(local.map(handle => handle.publish(first.record)))).filter(result => result.published).length, 4);
    } finally {
      resume();
      const settled = await Promise.allSettled(pending);
      await Promise.allSettled(pruning);
      fs.readdir = readdir; fs.mkdir = mkdir;
      await Promise.all([...new Set([...handles, ...settled.filter(result => result.status === 'fulfilled').map(result => result.value)])].map(handle => handle.close()));
    }
    const hits = await Promise.all(inputs.map(begin));
    try { assert.equal(hits.filter(handle => handle.hit && handle.hit.reused).length, 4, JSON.stringify(hits.map(handle => handle.reason))); }
    finally { await Promise.all(hits.map(handle => handle.close())); }
    assert.equal(await exists(lifecycle), false);
    assert.equal(await exists(path.join(first.options.cacheRoot, '.lease-access')), false);
    assert.deepEqual(await fs.readdir(leases), []);
  });
  await test('four concurrent different checks all publish and reuse', async () => {
    const { options, record } = await setup('concurrent-different');
    const inputs = ['first', 'second', 'third', 'fourth'].map(checkId => ({ ...options, checkId }));
    const handles = await Promise.all(inputs.map(begin));
    assert.equal(handles.filter(handle => /busy/.test(handle.reason || '')).length, 0, JSON.stringify(handles.map(handle => handle.reason)));
    const results = await Promise.all(handles.map(handle => handle.publish(record)));
    assert.equal(results.filter(result => result.published).length, 4);
    const old = path.join(options.cacheRoot, 'v0'); await fs.mkdir(old);
    await handles[0].close(); assert.equal(await exists(old), true);
    await Promise.all(handles.slice(1).flatMap(handle => [handle.close(), handle.close()])); assert.equal(await exists(old), false);
    assert.deepEqual(await fs.readdir(path.join(options.cacheRoot, '.leases')), []);
    assert.equal(await exists(path.join(options.cacheRoot, '.lifecycle')), false);
    assert.equal(await exists(path.join(options.cacheRoot, '.lease-access')), false);
    assert.equal(handles.flatMap(handle => handle.deferred).filter(value => /lease release:|lifecycle release:|guard busy|lifecycle lease busy/.test(value)).length, 0);
    const hits = await Promise.all(inputs.map(input => begin({ ...input, runDirectory: path.join(options.projectRoot, `reuse-${input.checkId}`) })));
    assert.equal(hits.filter(handle => handle.hit && handle.hit.reused).length, 4);
    await Promise.all(hits.map(handle => handle.close()));
  });
  await test('abandoned lifecycle lease bypasses within a bounded retry', async () => {
    const { options } = await setup('abandoned-lifecycle');
    const lock = path.join(options.cacheRoot, '.lifecycle'); await fs.mkdir(lock, { recursive: true });
    const started = performance.now(), handle = await begin(options);
    assert.match(handle.reason, /busy: lifecycle/); assert.equal(await exists(lock), true);
    assert.equal(handle.blockingLease, null);
    assert.match(handle.deferred.join(), /blocking lease inspection:.*Unidentified lease contents/);
    assert.ok(performance.now() - started < 5000, 'lifecycle retry must remain bounded'); await handle.close();
    const result = await pruneObsoleteVersions(options); assert.match(result.deferred.join(), /lifecycle lease busy/);
  });
  await test('busy lifecycle reports exact owner without treating a dead PID as recovery authority', async () => {
    const { options, record } = await setup('busy-lifecycle-diagnostics');
    const producer = await orphan(options, record); producer.child.send('exit'); await producer.exited;
    const lock = path.join(options.cacheRoot, '.lifecycle'); await fs.mkdir(lock);
    const bytes = JSON.stringify({ token: 'stopped-fixture', pid: producer.child.pid, runDirectory: options.runDirectory });
    await fs.writeFile(path.join(lock, 'owner.json'), bytes);
    const handle = await begin(options);
    assert.match(handle.reason, /busy: lifecycle/);
    assert.equal(handle.blockingLease.ownerSha256, sha(bytes));
    assert.equal(handle.blockingLease.token, 'stopped-fixture');
    await handle.close();
    assert.equal(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'), bytes);
    assert.equal(await exists(path.join(options.cacheRoot, '.leases', sha(options.checkId))), true);
    await recoverLease(await retirement(options, '.lifecycle'));
    await recoverLease(await retirement(options, sha(options.checkId)));
  });
  await test('oversized evidence bypasses and failed temporary entries prune', async () => {
    const { options, record, slot } = await setup('bounded'); const handle = await begin(options);
    await fs.truncate(record.logPath, 32 * 1024 * 1024 + 1);
    assert.match((await handle.publish(record)).reason, /exceeds/); assert.deepEqual(await fs.readdir(slot), []);
    await fs.writeFile(record.logPath, 'success\n'); const failedTemp = path.join(slot, `.tmp-${crypto.randomUUID()}`); await fs.mkdir(failedTemp); await fs.writeFile(path.join(failedTemp, 'partial'), 'partial');
    assert.equal((await handle.publish(record)).published, true); assert.deepEqual(await fs.readdir(slot), [options.key]); await handle.close();
  });
  console.log(`${passed} storage tests passed`);
}
// Validate every fixture path and link before removal. Never recursively follow links.
async function clean(filename) {
  const relative = path.relative(fixtures, filename);
  assert.ok(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)));
  const stat = await fs.lstat(filename);
  if (stat.isSymbolicLink()) { retained.push(filename); return false; }
  if (stat.isDirectory()) {
    let safe = true;
    for (const name of await fs.readdir(filename)) if (!await clean(path.join(filename, name))) safe = false;
    if (safe) await fs.rmdir(filename);
    return safe;
  }
  await fs.unlink(filename); return true;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (await exists(fixtures)) await clean(fixtures);
  if (retained.length) { console.error(`Fixtures retained due to links: ${retained.join(', ')}`); process.exitCode = 1; }
  console.log(`Fixture cleanup: ${await exists(fixtures) ? 'retained' : 'removed'}`);
});
