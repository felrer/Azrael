'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { parseArgs, finishWork } = require('./complete-work.cjs');

const script = path.join(__dirname, 'complete-work.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-completion-test-'));
let checks = 0;
function check(label, fn) {
  fn();
  checks++;
  console.log(`PASS ${label}`);
}
function fixture() {
  const threadId = randomUUID();
  const workId = randomUUID();
  const dir = path.join(root, threadId);
  fs.mkdirSync(dir);
  const signalPath = path.join(dir, `${workId}.signal.json`);
  const metadataPath = path.join(dir, `${workId}.json`);
  const metadata = { workId, threadId, signalPath, state: 'running', label: 'Test', createdAtMs: Date.now() };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  return { dir, signalPath, metadataPath, metadata, workId };
}
function cli(signalPath, state, extra = []) {
  const result = spawnSync(process.execPath, [script, '--signal-path', signalPath, '--state', state, ...extra], { encoding: 'utf8' });
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split('\n').length, 1);
  return { ...result, receipt: JSON.parse(result.stdout) };
}
function race(signalPath, state) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--signal-path', signalPath, '--state', state], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr, receipt: JSON.parse(stdout) }));
  });
}
// Ordinary per-entry deletion, without following links or recursive force removal.
function cleanup(dir) {
  const absolute = path.resolve(dir);
  assert.ok(absolute === root || absolute.startsWith(root + path.sep));
  for (const entry of fs.readdirSync(absolute)) {
    const file = path.join(absolute, entry);
    const stat = fs.lstatSync(file);
    if (stat.isDirectory() && !stat.isSymbolicLink()) cleanup(file);
    else fs.unlinkSync(file);
  }
  fs.rmdirSync(absolute);
}

(async () => {
  try {
    for (const state of ['succeeded', 'failed', 'cancelled']) {
      check(`new ${state}, matching replay and conflicting replay`, () => {
        const f = fixture();
        const extra = ['--summary', '완료 ✓', '--exit-code', '-4'];
        assert.equal(cli(f.signalPath, state, extra).status, 0);
        const signal = JSON.parse(fs.readFileSync(f.signalPath, 'utf8'));
        assert.deepEqual(signal, { workId: f.workId, state, summary: '완료 ✓', exitCode: -4 });
        const before = fs.readFileSync(f.signalPath);
        assert.equal(cli(f.signalPath, state, extra).receipt.repeated, true);
        assert.equal(cli(f.signalPath, state === 'failed' ? 'succeeded' : 'failed').status, 1);
        assert.equal(cli(f.signalPath, state, ['--summary', 'different', '--exit-code', '-4']).status, 1);
        assert.equal(cli(f.signalPath, state, ['--summary', '완료 ✓', '--exit-code', '0']).status, 1);
        assert.deepEqual(fs.readFileSync(f.signalPath), before);
        assert.deepEqual(fs.readdirSync(f.dir).sort(), [path.basename(f.metadataPath), path.basename(f.signalPath)].sort());
      });
    }
    check('argument validation and integer bounds', () => {
      const base = ['--signal-path', 'some-path', '--state', 'succeeded'];
      for (const args of [[], ['--state'], [...base, '--unknown', 'x'], [...base, '--state', 'failed'], [...base, '--summary'], [...base, '--exit-code', '1.5'], [...base, '--exit-code', '2147483648'], [...base, '--exit-code', '-2147483649'], [...base, '--exit-code', 'NaN'], [...base, '--exit-code', '1e2'], ['--signal-path', 'x', '--state', 'running']]) {
        assert.throws(() => parseArgs(args));
      }
      assert.equal(parseArgs([...base, '--exit-code', '-2147483648']).exitCode, -2147483648);
      assert.equal(parseArgs([...base, '--exit-code', '2147483647']).exitCode, 2147483647);
      assert.equal(spawnSync(process.execPath, [script, '--bad'], { encoding: 'utf8' }).status, 1);
    });
    check('UTF-8 summary byte limit and null defaults', () => {
      const f = fixture();
      const summary = '한'.repeat(170) + 'ab';
      assert.equal(Buffer.byteLength(summary), 512);
      assert.equal(cli(f.signalPath, 'succeeded', ['--summary', summary]).status, 0);
      assert.throws(() => parseArgs(['--signal-path', f.signalPath, '--state', 'succeeded', '--summary', summary + 'x']), /512/);
      const empty = fixture();
      finishWork({ signalPath: empty.signalPath, state: 'cancelled' });
      assert.deepEqual(JSON.parse(fs.readFileSync(empty.signalPath)), { workId: empty.workId, state: 'cancelled', summary: null, exitCode: null });
    });
    check('unregistered, invalid UUID and wrong filename rejected', () => {
      const f = fixture();
      fs.unlinkSync(f.metadataPath);
      assert.equal(cli(f.signalPath, 'succeeded').status, 1);
      assert.equal(fs.existsSync(f.signalPath), false);
      for (const filename of ['bad.signal.json', `${f.workId}.json`, `${f.workId}.signal.json.extra`]) {
        assert.equal(cli(path.join(f.dir, filename), 'succeeded').status, 1);
      }
      assert.equal(cli(path.join(root, 'not-uuid', path.basename(f.signalPath)), 'succeeded').status, 1);
    });
    for (const field of ['workId', 'threadId', 'signalPath']) {
      check(`metadata ${field} mismatch`, () => {
        const f = fixture();
        fs.writeFileSync(f.metadataPath, JSON.stringify({ ...f.metadata, [field]: 'wrong' }));
        assert.equal(cli(f.signalPath, 'failed').status, 1);
        assert.equal(fs.existsSync(f.signalPath), false);
      });
    }
    check('metadata must remain running', () => {
      for (const state of ['succeeded', 'failed', 'cancelled', null, undefined]) {
        const f = fixture();
        fs.writeFileSync(f.metadataPath, JSON.stringify({ ...f.metadata, state }));
        assert.equal(cli(f.signalPath, 'succeeded').status, 1);
        assert.equal(fs.existsSync(f.signalPath), false);
      }
    });
    check('UUIDs must use canonical lowercase', () => {
      const f = fixture();
      const upperWork = f.workId.toUpperCase();
      const upperThread = f.metadata.threadId.toUpperCase();
      assert.notEqual(upperWork, f.workId);
      assert.notEqual(upperThread, f.metadata.threadId);
      assert.equal(cli(path.join(f.dir, `${upperWork}.signal.json`), 'succeeded').status, 1);
      assert.equal(cli(path.join(root, upperThread, path.basename(f.signalPath)), 'succeeded').status, 1);
    });
    check('replay normalizes absent and null optional fields', () => {
      for (const optional of [{}, { summary: null }, { exitCode: null }, { summary: null, exitCode: null }]) {
        const f = fixture();
        const existing = { workId: f.workId, state: 'succeeded', ...optional };
        fs.writeFileSync(f.signalPath, JSON.stringify(existing));
        assert.equal(cli(f.signalPath, 'succeeded').receipt.repeated, true);
        assert.deepEqual(JSON.parse(fs.readFileSync(f.signalPath)), existing);
      }
    });
    check('replay rejects unknown fields and invalid terminal values', () => {
      for (const invalid of [{ extra: true }, { state: 'running' }, { summary: 1 }, { summary: '한'.repeat(171) }, { exitCode: '0' }, { exitCode: 0.5 }, { exitCode: 2147483648 }, { exitCode: -2147483649 }, { workId: randomUUID() }]) {
        const f = fixture();
        const existing = { workId: f.workId, state: 'succeeded', summary: null, exitCode: null, ...invalid };
        fs.writeFileSync(f.signalPath, JSON.stringify(existing));
        assert.equal(cli(f.signalPath, 'succeeded').status, 1);
        assert.deepEqual(JSON.parse(fs.readFileSync(f.signalPath)), existing);
      }
    });
    check('immediate parent must be a real directory', () => {
      const threadId = randomUUID();
      const parent = path.join(root, threadId);
      fs.writeFileSync(parent, 'not a directory');
      assert.equal(cli(path.join(parent, `${randomUUID()}.signal.json`), 'succeeded').status, 1);
      fs.unlinkSync(parent);
      const f = fixture();
      const aliasPath = path.join(parent, path.basename(f.signalPath));
      fs.writeFileSync(f.metadataPath, JSON.stringify({ ...f.metadata, threadId, signalPath: aliasPath }));
      try { fs.symlinkSync(f.dir, parent, process.platform === 'win32' ? 'junction' : 'dir'); }
      catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { console.log(`SKIP parent symlink creation: ${error.code}`); return; }
        throw error;
      }
      assert.equal(cli(aliasPath, 'succeeded').status, 1);
      assert.equal(fs.existsSync(f.signalPath), false);
    });
    for (const target of ['metadataPath', 'signalPath']) {
      check(`${target} malformed, oversized and non-file rejected`, () => {
        const f = fixture();
        for (const contents of ['{', 'null', ' '.repeat(8193)]) {
          fs.writeFileSync(f[target], contents);
          assert.equal(cli(f.signalPath, 'succeeded').status, 1);
          assert.equal(fs.readFileSync(f[target], 'utf8'), contents);
        }
        fs.unlinkSync(f[target]);
        fs.mkdirSync(f[target]);
        assert.equal(cli(f.signalPath, 'succeeded').status, 1);
      });
    }
    check('metadata and existing signal symlinks rejected where permitted', () => {
      for (const target of ['metadataPath', 'signalPath']) {
        const f = fixture();
        const linkTarget = path.join(f.dir, 'link-target.json');
        const content = target === 'metadataPath' ? f.metadata : { workId: f.workId, state: 'succeeded', summary: null, exitCode: null };
        fs.writeFileSync(linkTarget, JSON.stringify(content));
        if (fs.existsSync(f[target])) fs.unlinkSync(f[target]);
        try { fs.symlinkSync(linkTarget, f[target], 'file'); }
        catch (error) {
          if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { console.log(`SKIP ${target} symlink creation: ${error.code}`); continue; }
          throw error;
        }
        assert.equal(cli(f.signalPath, 'succeeded').status, 1);
        assert.equal(fs.lstatSync(f[target]).isSymbolicLink(), true);
        assert.deepEqual(JSON.parse(fs.readFileSync(linkTarget)), content);
      }
    });
    const f = fixture();
    const results = await Promise.all(['succeeded', 'failed', 'cancelled', 'succeeded', 'failed', 'cancelled'].map((state) => race(f.signalPath, state)));
    check('atomic concurrent first writer wins', () => {
      const signal = JSON.parse(fs.readFileSync(f.signalPath));
      assert.ok(['succeeded', 'failed', 'cancelled'].includes(signal.state));
      for (let i = 0; i < results.length; i++) {
        assert.equal(results[i].stderr, '');
        const requested = ['succeeded', 'failed', 'cancelled'][i % 3];
        assert.equal(results[i].code, requested === signal.state ? 0 : 1);
      }
      assert.equal(results.filter((r) => r.code === 0 && !r.receipt.repeated).length, 1);
      assert.equal(fs.readdirSync(f.dir).some((name) => name.endsWith('.tmp')), false);
    });
    console.log(`PASS ${checks} completion producer checks (${process.platform}, ${process.arch})`);
  } finally {
    cleanup(root);
    assert.equal(fs.existsSync(root), false);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
