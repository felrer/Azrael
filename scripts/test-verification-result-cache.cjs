'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { begin, pruneObsoleteVersions, pruneRemovedChecks, CACHE_SCHEMA } = require('./verification-result-cache.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const storage = path.resolve(__dirname, '../artifacts/logs/verification-result-cache/storage');
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
async function main() {
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
  await test('concurrent begin calls allow a single publisher', async () => {
    const { options, record } = await setup('concurrent-begins');
    const handles = await Promise.all([begin(options), begin(options), begin(options)]);
    const results = await Promise.all(handles.map(handle => handle.publish(record)));
    assert.equal(results.filter(result => result.published).length, 1);
    assert.equal(handles.filter(handle => /busy/.test(handle.reason || '')).length, 2);
    await Promise.all(handles.map(handle => handle.close()));
    const hit = await begin(options); assert.equal(hit.hit.reused, true); await hit.close();
  });
  await test('four concurrent different checks all publish and reuse', async () => {
    const { options, record } = await setup('concurrent-different');
    const inputs = ['first', 'second', 'third', 'fourth'].map(checkId => ({ ...options, checkId }));
    const handles = await Promise.all(inputs.map(begin));
    assert.equal(handles.filter(handle => /busy/.test(handle.reason || '')).length, 0);
    const results = await Promise.all(handles.map(handle => handle.publish(record)));
    assert.equal(results.filter(result => result.published).length, 4);
    const old = path.join(options.cacheRoot, 'v0'); await fs.mkdir(old);
    await handles[0].close(); assert.equal(await exists(old), true);
    await Promise.all(handles.slice(1).map(handle => handle.close())); assert.equal(await exists(old), false);
    const hits = await Promise.all(inputs.map(input => begin({ ...input, runDirectory: path.join(options.projectRoot, `reuse-${input.checkId}`) })));
    assert.equal(hits.filter(handle => handle.hit && handle.hit.reused).length, 4);
    await Promise.all(hits.map(handle => handle.close()));
  });
  await test('abandoned lifecycle lease bypasses within a bounded retry', async () => {
    const { options } = await setup('abandoned-lifecycle');
    const lock = path.join(options.cacheRoot, '.lifecycle'); await fs.mkdir(lock, { recursive: true });
    const started = performance.now(), handle = await begin(options);
    assert.match(handle.reason, /busy: lifecycle/); assert.equal(await exists(lock), true);
    assert.ok(performance.now() - started < 5000, 'lifecycle retry must remain bounded'); await handle.close();
    const result = await pruneObsoleteVersions(options); assert.match(result.deferred.join(), /lifecycle lease busy/);
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
