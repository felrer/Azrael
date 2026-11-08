'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { snapshotProject, compareSnapshots } = require('./deployment-input-snapshot.cjs');
const { getProjectSourceState } = require('./project-source-state.cjs');

const project = path.dirname(__dirname);
const stamp = `${Date.now()}-${process.pid}`;
const fixtureParent = process.env.AZRAEL_DEPLOYMENT_SNAPSHOT_TEST_ROOT
  ? path.resolve(process.env.AZRAEL_DEPLOYMENT_SNAPSHOT_TEST_ROOT) : path.join(project, 'artifacts/verification/deployment-optimization');
const fixtures = path.join(fixtureParent, `snapshot-${stamp} spaces 한글`);
const results = [];

function git(root, ...args) {
  const result = spawnSync('git', ['-c', 'core.longpaths=true', '-c', 'core.autocrlf=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', root, ...args], { encoding: 'utf8', windowsHide: true });
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
  assert.ok(Array.isArray(snapshot.inventory));
  return { schema: snapshot.schema, sha256: snapshot.sha256, fileCount: snapshot.fileCount, bytes: snapshot.bytes, inventory: snapshot.inventory };
}

async function countedSnapshot(root, context) {
  const original = fs.open;
  let reads = 0;
  fs.open = async (...args) => { reads++; return original(...args); };
  try { return { value: await getProjectSourceState(root, context), reads }; }
  finally { fs.open = original; }
}

async function main() {
  await test('checkout edits outside selected inputs do not invalidate the selected snapshot', async () => {
    const selected = await repository('selected-frozen');
    const checkout = await repository('separate-checkout');
    const before = await snapshotProject(selected);
    await fs.writeFile(path.join(checkout, 'input.txt'), 'later checkout change');
    assert.equal(compareSnapshots(before, await snapshotProject(selected)).status, 'unchanged');
    await fs.writeFile(path.join(selected, 'input.txt'), 'selected mutation');
    const changed = compareSnapshots(before, await snapshotProject(selected));
    assert.equal(changed.status, 'consumed-inputs-changed');
    assert.equal(changed.action, 'reject-affected-results-and-select-new-inputs');
    assert.deepEqual(changed.changes.map(entry => [entry.path, entry.kind]), [['input.txt', 'modified']]);
    assert.throws(() => compareSnapshots(before, { ...before, sha256: '0'.repeat(64) }), /digest mismatch/);
    const moved = structuredClone(before);
    moved.inventory[0].root = checkout;
    assert.equal(compareSnapshots(before, moved).rootChanged, true);
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
  await test('empty, threshold and streamed inputs hash exact bytes despite partial descriptor reads', async () => {
    const root = await repository('size-boundaries');
    const expected = new Map();
    for (const size of [0, 1, 65535, 65536, 65537, 256 * 1024]) {
      const content = Buffer.alloc(size);
      for (let i = 0; i < size; i++) content[i] = i % 251;
      const name = `bytes-${size}.bin`;
      await fs.writeFile(path.join(root, name), content);
      expected.set(name, createHash('sha256').update(content).digest('hex'));
    }
    const originalOpen = fs.open;
    fs.open = async (...args) => {
      const handle = await originalOpen(...args);
      if (path.basename(args[0]).startsWith('bytes-')) {
        const read = handle.read.bind(handle);
        handle.read = (buffer, offset, length, position) => read(buffer, offset, Math.min(length, 997), position);
      }
      return handle;
    };
    try {
      const first = await snapshotProject(root, { concurrency: 1 });
      const entries = new Map(first.inventory[0].entries.map(entry => [entry.path, entry.sha256]));
      for (const [name, digest] of expected) assert.equal(entries.get(name), digest);
    } finally { fs.open = originalOpen; }
  });
  await test('small and streamed inputs reject mutation between descriptor stats', async () => {
    for (const size of [0, 65536, 65537]) {
      const root = await repository(`mid-read-${size}`);
      const target = path.join(root, 'input.txt');
      await fs.writeFile(target, Buffer.alloc(size, 17));
      const originalOpen = fs.open;
      fs.open = async (...args) => {
        const handle = await originalOpen(...args);
        if (args[0] === target) {
          const stat = handle.stat.bind(handle);
          let first = true;
          handle.stat = async () => {
            const observed = await stat();
            if (first) { first = false; await fs.appendFile(target, 'changed'); }
            return observed;
          };
        }
        return handle;
      };
      try { await assert.rejects(snapshotProject(root), /Project input changed while hashing/); }
      finally { fs.open = originalOpen; }
    }
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
    // Git emits a trailing slash for untracked embedded repositories, unlike
    // tracked gitlinks. Both are recursive inputs of the same snapshot owner.
    const embedded = await repository('embedded-source');
    await fs.cp(embedded, path.join(root, 'embedded'), { recursive: true });
    const before = await snapshotProject(root);
    const inner = path.join(root, 'modules/vendor/nested/input.txt');
    const observation = { statePath: path.join(fixtures, 'nested-state.json'), generation: 'nested-attempt' };
    assert.deepEqual(summary(await getProjectSourceState(root, observation)), summary(before));
    if (process.platform === 'win32') assert.equal((await countedSnapshot(root, observation)).reads, 0);
    await fs.writeFile(inner, 'bravo');
    const dirty = await snapshotProject(root);
    assert.deepEqual(summary(await getProjectSourceState(root, observation)), summary(dirty));
    assert.notEqual(dirty.sha256, before.sha256);
    const difference = compareSnapshots(before, dirty);
    assert.deepEqual(difference.changes.map(entry => entry.path), ['modules/vendor/nested/input.txt']);
    await fs.writeFile(path.join(root, 'modules/vendor/new.txt'), 'new nested input');
    assert.notEqual((await snapshotProject(root)).sha256, dirty.sha256);
    git(root, 'submodule', 'deinit', '--force', '--', 'modules/vendor');
    await assert.rejects(snapshotProject(root), /submodule|gitlink|initializ/i);
  });
  // Retained: later consumer/selector edits can mix attempts, omit fresh Git
  // membership, or accidentally replace reuse with repeated content hashing.
  if (process.platform === 'win32') await test('project observation reuses exact content identity across processes and isolates attempts', async () => {
    const root = await repository('observation');
    await fs.mkdir(path.join(root, 'reports'));
    const context = { statePath: path.join(root, 'reports/state.json'), generation: 'first-attempt' };
    const expected = await snapshotProject(root);
    const first = await countedSnapshot(root, context);
    assert.deepEqual(summary(first.value), summary(expected));
    assert.equal(first.reads, expected.fileCount);
    const reused = await countedSnapshot(root, context);
    assert.deepEqual(summary(reused.value), summary(expected)); assert.equal(reused.reads, 0);
    assert.equal(JSON.parse(await fs.readFile(context.statePath, 'utf8')).disposition, 'reused');
    const child = spawnSync(process.execPath, ['-e',
      "const fs=require('fs/promises');let reads=0;const open=fs.open;fs.open=(...a)=>{reads++;return open(...a)};require(process.argv[1]).getProjectSourceState(process.argv[2],JSON.parse(process.argv[3])).then(value=>console.log(JSON.stringify({value,reads}))).catch(e=>{console.error(e);process.exitCode=1})",
      require.resolve('./project-source-state.cjs'), root, JSON.stringify(context)], { encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 0, child.stderr);
    const observed = JSON.parse(child.stdout);
    assert.equal(observed.reads, 0); assert.deepEqual(summary(observed.value), summary(expected));
    assert.equal((await countedSnapshot(root)).reads, expected.fileCount, 'standalone still hashes every input');
    context.generation = 'fresh-resume-attempt';
    assert.equal((await countedSnapshot(root, context)).reads, expected.fileCount);
    for (const damage of [
      () => fs.writeFile(context.statePath, '{broken'),
      async () => { const saved = JSON.parse(await fs.readFile(context.statePath)); saved.binding = 'different-tools'; await fs.writeFile(context.statePath, JSON.stringify(saved)); },
      async () => { const saved = JSON.parse(await fs.readFile(context.statePath)); saved.snapshot.bytes++; await fs.writeFile(context.statePath, JSON.stringify(saved)); },
    ]) {
      await damage(); assert.equal((await countedSnapshot(root, context)).reads, expected.fileCount);
    }
    const unsupported = { ...context, statePath: 'relative-state.json' };
    assert.equal((await countedSnapshot(root, unsupported)).reads, expected.fileCount);
    await fs.link(path.join(root, 'input.txt'), path.join(root, 'reports/shared.txt'));
    assert.equal((await countedSnapshot(root, context)).reads, expected.fileCount, 'shared input keeps full validation');
    assert.equal((await countedSnapshot(root, context)).reads, expected.fileCount);
  });
  if (process.platform === 'win32') await test('project observation refreshes Git selection and detects content changes with restored mtime', async () => {
    const root = await repository('observation-changes');
    await fs.mkdir(path.join(root, 'reports'));
    const context = { statePath: path.join(root, 'reports/state.json'), generation: 'changes' };
    await getProjectSourceState(root, context);
    const input = path.join(root, 'input.txt'), stamp = await fs.stat(input);
    await fs.writeFile(input, 'bravo'); await fs.utimes(input, stamp.atime, stamp.mtime);
    const changed = await countedSnapshot(root, context);
    assert.ok(changed.reads > 0); assert.deepEqual(summary(changed.value), summary(await snapshotProject(root)));
    for (const mutate of [
      () => fs.writeFile(path.join(root, 'untracked.txt'), 'included'),
      () => fs.rename(path.join(root, 'untracked.txt'), path.join(root, 'renamed.txt')),
      () => fs.appendFile(path.join(root, '.git/info/exclude'), '\nrenamed.txt\n'),
      () => fs.unlink(input),
      () => fs.writeFile(input, 'restored'),
    ]) {
      await mutate(); const current = await countedSnapshot(root, context);
      assert.ok(current.reads > 0); assert.deepEqual(summary(current.value), summary(await snapshotProject(root)));
    }
    await fs.mkdir(path.join(root, 'ignored')); await fs.writeFile(path.join(root, 'ignored/cache'), 'ignored');
    assert.equal((await countedSnapshot(root, context)).reads, 0, 'ignored changes do not alter selected identity');
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
    const comparison = path.join(root, 'reports/comparison.json');
    const compared = spawnSync(process.execPath, [helper, 'compare', report, report, comparison, full.sha256, full.sha256], { encoding: 'utf8' });
    assert.equal(compared.status, 0, compared.stderr);
    assert.equal(JSON.parse(await fs.readFile(comparison, 'utf8')).status, 'unchanged');
    const forged = spawnSync(process.execPath, [helper, 'compare', report, report, comparison, '0'.repeat(64), full.sha256], { encoding: 'utf8' });
    assert.notEqual(forged.status, 0);
  });
  await test('conditional CLI compacts unchanged reports and retains full changed diagnostics with a validated baseline', async () => {
    const root = await repository('cli-conditional');
    const reports = path.join(root, 'reports');
    await fs.mkdir(reports);
    const baselinePath = path.join(reports, 'initial.json');
    const reportPath = path.join(reports, 'pre-install.json');
    const helper = path.join(__dirname, 'deployment-input-snapshot.cjs');
    const initial = spawnSync(process.execPath, [helper, root, baselinePath], { encoding: 'utf8' });
    assert.equal(initial.status, 0, initial.stderr);
    const baselineBytes = await fs.readFile(baselinePath);
    const baseline = JSON.parse(baselineBytes);
    const baselineFileSha256 = createHash('sha256').update(baselineBytes).digest('hex');
    const run = (expectedFileSha256 = baselineFileSha256, selectedBaseline = baselinePath) => spawnSync(process.execPath, [helper, root, reportPath,
      '--baseline', selectedBaseline, '--expected-baseline-sha256', baseline.sha256,
      '--expected-baseline-file-sha256', expectedFileSha256], { encoding: 'utf8' });
    const unchanged = run();
    assert.equal(unchanged.status, 0, unchanged.stderr);
    const compact = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    const stdout = JSON.parse(unchanged.stdout);
    assert.equal(compact.schema, 2);
    assert.equal(compact.status, 'unchanged');
    assert.equal(Object.hasOwn(compact, 'inventory'), false);
    assert.equal(stdout.schema, 1);
    assert.equal(stdout.sha256, baseline.sha256);
    assert.equal(stdout.fileCount, baseline.fileCount);
    assert.equal(stdout.bytes, baseline.bytes);
    assert.deepEqual(compact.baseline, { path: await fs.realpath(baselinePath),
      sha256: baselineFileSha256, inputSha256: baseline.sha256 });
    assert.deepEqual(await fs.readFile(baselinePath), baselineBytes, 'baseline remains intact');

    for (const kind of ['hardlink', 'ancestor-link']) {
      const linked = path.join(reports, kind);
      try {
        if (kind === 'hardlink') await fs.link(baselinePath, linked);
        else await fs.symlink(reports, linked, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS', 'EOPNOTSUPP', 'EXDEV'].includes(error.code)) throw error;
        console.log(`SKIP baseline ${kind}: ${error.code}`);
        continue;
      }
      try {
        const selected = kind === 'hardlink' ? baselinePath : path.join(linked, 'initial.json');
        const rejected = run(baselineFileSha256, selected);
        assert.notEqual(rejected.status, 0, `baseline ${kind} must fail closed`);
        assert.equal(rejected.stdout, '');
      } finally {
        if (kind === 'ancestor-link' && process.platform === 'win32') await fs.rmdir(linked);
        else await fs.unlink(linked);
      }
    }

    await fs.writeFile(path.join(root, 'input.txt'), 'changed consumed bytes');
    const changed = run();
    assert.equal(changed.status, 0, changed.stderr);
    const full = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.deepEqual(summary(full), summary(await snapshotProject(root)));
    assert.equal(JSON.parse(changed.stdout).sha256, full.sha256);
    const comparisonPath = path.join(reports, 'changes.json');
    const compared = spawnSync(process.execPath, [helper, 'compare', baselinePath, reportPath,
      comparisonPath, baseline.sha256, full.sha256], { encoding: 'utf8' });
    assert.equal(compared.status, 0, compared.stderr);
    const comparison = JSON.parse(await fs.readFile(comparisonPath, 'utf8'));
    assert.equal(comparison.status, 'consumed-inputs-changed');
    assert.deepEqual(comparison.changes.map(change => [change.path, change.kind]), [['input.txt', 'modified']]);
    await fs.writeFile(baselinePath, JSON.stringify({ ...baseline, bytes: baseline.bytes + 1 }));
    const tamperedWhileChanged = run();
    assert.notEqual(tamperedWhileChanged.status, 0, 'baseline metadata tamper must fail even with changed inputs');
    assert.equal(tamperedWhileChanged.stdout, '');

    await fs.writeFile(path.join(root, 'input.txt'), 'alpha');
    for (const tampered of [
      { ...baseline, sha256: '0'.repeat(64) },
      { ...baseline, inventory: [{ ...baseline.inventory[0], entries: [] }] },
      { ...baseline, bytes: baseline.bytes + 1 },
      compact,
    ]) {
      const content = JSON.stringify(tampered);
      await fs.writeFile(baselinePath, content);
      const rejected = run(createHash('sha256').update(content).digest('hex'));
      assert.notEqual(rejected.status, 0, 'tampered or compact baseline must fail closed');
      assert.equal(rejected.stdout, '');
    }
    await fs.unlink(baselinePath);
    assert.notEqual(run().status, 0, 'missing baseline must fail closed');
    await fs.mkdir(baselinePath);
    assert.notEqual(run().status, 0, 'non-file baseline must fail closed');
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
