'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const { readCommittedBuildContext } = require('./committed-build-context.cjs');

test('build entry requires a frozen receipt and preserves its selected commit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-context-'));
  const git = (...args) => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  try {
    assert.throws(() => readCommittedBuildContext(root), /Prepare a commit-bound/);
    git('init', '--quiet'); fs.writeFileSync(path.join(root, 'source.txt'), 'selected'); git('add', 'source.txt');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'selected');
    const sourceCommit = git('rev-parse', 'HEAD'), projectSha256 = 'a'.repeat(64);
    fs.mkdirSync(path.join(root, 'control'));
    const receipt = path.join(root, 'control/committed-source.json');
    fs.writeFileSync(receipt, JSON.stringify({schema: 1, sourceCommit, projectSha256}));
    assert.deepEqual(readCommittedBuildContext(root), {sourceCommit, projectSha256});
    fs.writeFileSync(path.join(root, 'source.txt'), 'later'); git('add', 'source.txt');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'later');
    assert.throws(() => readCommittedBuildContext(root), /HEAD differs/);
    fs.writeFileSync(receipt, '{}'); assert.throws(() => readCommittedBuildContext(root), /Invalid committed/);
  } finally { fs.rmSync(root, {recursive: true}); }
});

test('Windows build and deployment reject a live checkout before creating outputs', {skip: process.platform !== 'win32'}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-entry-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    for (const name of ['build-azrael.ps1', 'deploy-azrael.ps1', 'committed-build-context.cjs']) fs.copyFileSync(path.join(__dirname, name), path.join(root, 'scripts', name));
    for (const name of ['build-azrael.ps1', 'deploy-azrael.ps1']) {
      const result = spawnSync(process.env.AZRAEL_TEST_PWSH || 'pwsh', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts', name), '-ReleaseName', 'excluded-live-source'], {encoding: 'utf8', windowsHide: true});
      assert.ifError(result.error); assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /commit-bound/);
      assert.equal(fs.existsSync(path.join(root, 'artifacts')), false);
    }
  } finally { fs.rmSync(root, {recursive: true}); }
});
