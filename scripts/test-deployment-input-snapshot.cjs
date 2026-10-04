'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { snapshotProject } = require('./deployment-input-snapshot.cjs');

const project = path.dirname(__dirname);
const stamp = `${Date.now()}-${process.pid}`;
const fixtures = path.join(project, 'artifacts/verification/deployment-optimization', `snapshot-${stamp} spaces 한글`);
const results = [];

function git(root, ...args) {
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.error || result.stderr}`);
  return result.stdout.trim();
}

async function repository(name) {
  const root = path.join(fixtures, name);
  await fs.mkdir(root, { recursive: true });
  git(root, 'init', '--quiet');
  await fs.writeFile(path.join(root, '.gitignore'), 'ignored/\nreports/\n');
  await fs.writeFile(path.join(root, 'input.txt'), 'alpha');
  git(root, 'add', '--', '.');
  git(root, 'commit', '--quiet', '-m', 'fixture');
  return root;
}

async function test(name, action) {
  await action();
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}

function summary(snapshot) {
  assert.equal(snapshot.schema, 1);
  assert.match(snapshot.sha256, /^[a-f0-9]{64}$/i);
  assert.ok(Number.isInteger(snapshot.fileCount) && snapshot.fileCount > 0);
  assert.ok(Number.isInteger(snapshot.bytes) && snapshot.bytes >= 0);
  assert.ok(Number.isFinite(snapshot.elapsedMs) && snapshot.elapsedMs >= 0);
  assert.ok(Array.isArray(snapshot.inventory));
  return { schema: snapshot.schema, sha256: snapshot.sha256, fileCount: snapshot.fileCount, bytes: snapshot.bytes, inventory: snapshot.inventory };
}

async function main() {
  await test('deterministic across concurrency and repeated runs', async () => {
    const root = await repository('deterministic');
    for (let i = 0; i < 25; i++) await fs.writeFile(path.join(root, `input ${i} 한글.txt`), `content ${i}\n`);
    const snapshots = await Promise.all([1, 2, 8, 16].map(concurrency => snapshotProject(root, { concurrency })));
    for (const snapshot of snapshots) assert.deepEqual(summary(snapshot), summary(snapshots[0]));
    assert.deepEqual(summary(await snapshotProject(root)), summary(snapshots[0]));
  });
  await test('same-size content mutation with restored timestamp changes digest', async () => {
    const root = await repository('restored-time');
    const file = path.join(root, 'input.txt');
    const original = await fs.stat(file);
    const before = await snapshotProject(root);
    await fs.writeFile(file, 'bravo');
    await fs.utimes(file, original.atime, original.mtime);
    assert.equal((await fs.stat(file)).size, original.size);
    assert.ok(Math.abs((await fs.stat(file)).mtimeMs - original.mtimeMs) < 1);
    const after = await snapshotProject(root);
    assert.equal(after.bytes, before.bytes);
    assert.notEqual(after.sha256, before.sha256);
  });
  await test('untracked and deleted inputs included; ignored contents excluded', async () => {
    const root = await repository('membership');
    const before = await snapshotProject(root);
    await fs.mkdir(path.join(root, 'ignored'));
    await fs.writeFile(path.join(root, 'ignored/cache'), 'ignored first');
    assert.deepEqual(summary(await snapshotProject(root)), summary(before));
    await fs.writeFile(path.join(root, 'untracked 한글.txt'), 'new content');
    const untracked = await snapshotProject(root);
    assert.notEqual(untracked.sha256, before.sha256);
    assert.equal(untracked.fileCount, before.fileCount + 1);
    await fs.unlink(path.join(root, 'input.txt'));
    const deleted = await snapshotProject(root);
    assert.notEqual(deleted.sha256, untracked.sha256);
    const deletedInventory = JSON.stringify(deleted.inventory);
    assert.match(deletedInventory, /input\.txt/);
    assert.match(deletedInventory, /deleted|missing/i);
    await fs.writeFile(path.join(root, 'ignored/cache'), 'ignored changed');
    assert.deepEqual(summary(await snapshotProject(root)), summary(deleted));
  });
  await test('docs and other tracked inputs remain conservative', async () => {
    const root = await repository('docs');
    await fs.mkdir(path.join(root, 'docs'));
    await fs.writeFile(path.join(root, 'docs/design.md'), 'design A');
    git(root, 'add', '--', '.');
    const before = await snapshotProject(root);
    await fs.writeFile(path.join(root, 'docs/design.md'), 'design B');
    assert.notEqual((await snapshotProject(root)).sha256, before.sha256);
  });
  await test('recursive initialized gitlinks detect dirty contents and untracked inputs', async () => {
    const root = await repository('submodules');
    const vendor = await repository('vendor-source');
    const nested = await repository('nested-source');
    git(vendor, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', nested, 'nested');
    git(vendor, 'commit', '--quiet', '-am', 'nested fixture');
    git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', vendor, 'modules/vendor');
    git(root, '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '--recursive', '--quiet');
    const before = await snapshotProject(root);
    const inner = path.join(root, 'modules/vendor/nested/input.txt');
    await fs.writeFile(inner, 'bravo');
    const dirty = await snapshotProject(root);
    assert.notEqual(dirty.sha256, before.sha256);
    await fs.writeFile(path.join(root, 'modules/vendor/new.txt'), 'new nested input');
    assert.notEqual((await snapshotProject(root)).sha256, dirty.sha256);
    git(root, 'submodule', 'deinit', '--force', '--', 'modules/vendor');
    await assert.rejects(snapshotProject(root), /submodule|gitlink|initializ/i);
  });
  await test('CLI returns only summary JSON and writes complete inventory report', async () => {
    const root = await repository('cli');
    const report = path.join(root, 'reports/snapshot.json');
    await fs.mkdir(path.dirname(report));
    const helper = path.join(__dirname, 'deployment-input-snapshot.cjs');
    const cli = spawnSync(process.execPath, [helper, root, report], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const output = JSON.parse(cli.stdout);
    const full = JSON.parse(await fs.readFile(report, 'utf8'));
    assert.equal(output.schema, 1);
    assert.equal(output.sha256, full.sha256);
    assert.equal(Object.hasOwn(output, 'inventory'), false);
    assert.deepEqual(summary(full), summary(await snapshotProject(root)));
    const withoutReport = spawnSync(process.execPath, [helper, root], { encoding: 'utf8' });
    assert.equal(withoutReport.status, 0, withoutReport.stderr);
    assert.equal(JSON.parse(withoutReport.stdout).sha256, output.sha256);
  });
  await test('API and CLI abort for invalid repository and unreadable tracked input', async () => {
    const invalid = path.join(fixtures, 'not-a-repository');
    await fs.mkdir(invalid);
    // Block Git's ancestor discovery: fixtures themselves live below the project checkout.
    await fs.writeFile(path.join(invalid, '.git'), 'invalid repository fixture\n');
    await assert.rejects(snapshotProject(invalid));
    const helper = path.join(__dirname, 'deployment-input-snapshot.cjs');
    const cli = spawnSync(process.execPath, [helper, invalid], { encoding: 'utf8' });
    assert.notEqual(cli.status, 0);
    assert.ok(cli.stderr.trim().length > 0);
    assert.equal(cli.stdout.trim(), '');
    const root = await repository('read-error');
    await fs.unlink(path.join(root, 'input.txt'));
    await fs.mkdir(path.join(root, 'input.txt'));
    await assert.rejects(snapshotProject(root));
    const readError = spawnSync(process.execPath, [helper, root], { encoding: 'utf8' });
    assert.notEqual(readError.status, 0);
    assert.equal(readError.stdout.trim(), '');
  });
  console.log(JSON.stringify({ passed: results.length, failed: 0, fixtures }));
}

main().catch(error => {
  console.error(error.stack || error);
  console.error(JSON.stringify({ passed: results.length, failed: 1, fixtures }));
  process.exitCode = 1;
});
