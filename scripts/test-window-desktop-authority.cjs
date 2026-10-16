'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { generateSettingsModule } = require('./inject-sky-control-policy.cjs');
const run = path.resolve(process.env.AZRAEL_DESKTOP_AUTHORITY_TEST_RUN || 'artifacts/tasks/DU-01-window-use-stages/runs/20261017-desktop-authority-r1');

async function fixture(scenario, root) {
  const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
  const { pathToFileURL } = require('node:url'), { AsyncLocalStorage } = require('node:async_hooks');
  const { createDesktopAuthority } = require(path.resolve('scripts/window-desktop-authority.cjs'));
  const { createSettingsOwner } = require(path.resolve('scripts/use-control-settings.cjs'));
  process.env.CODEX_HOME = path.join(root, 'home');
  process.env.NODE_REPL_REQUEST_META = JSON.stringify({ 'x-codex-turn-metadata': { thread_id: 'thread', turn_id: 'turn' } });
  const contexts = new AsyncLocalStorage();
  let meta = Object.freeze({ 'x-codex-turn-metadata': Object.freeze({ thread_id: 'thread', turn_id: 'turn', sandbox_mode: 'danger-full-access', sandbox: 'none' }) });
  const repl = {};
  if (scenario === 'tampered-getter') Object.defineProperty(repl, 'requestMeta', { get: () => meta, configurable: true });
  else Object.defineProperty(repl, 'requestMeta', { get: () => contexts.getStore() || meta, configurable: false });
  if (scenario !== 'missing-runtime') Object.defineProperty(globalThis, 'nodeRepl', { value: repl, writable: scenario === 'mutable-runtime', configurable: false });
  const policy = await import(pathToFileURL(path.join(root, 'sky-control-policy.mjs')));
  const settings = createSettingsOwner(process.env.CODEX_HOME), generation = settings.getSettings().windowUseGeneration;
  const authority = createDesktopAuthority({ directory: path.join(root, 'authority'), codexHome: process.env.CODEX_HOME });
  const identity = { threadId: 'thread', turnId: 'turn', policyGeneration: generation };
  const lease = authority.grant(identity);
  assert.equal(fs.readFileSync(lease.recordPath, 'utf8').includes(lease.token), false);
  assert.equal(authority.authorize(identity), lease);
  for (const wrong of [{ threadId: 'other' }, { turnId: 'other' }, { policyGeneration: generation + 1 }]) assert.throws(() => authority.authorize({ ...identity, ...wrong }));
  if (['missing-runtime', 'mutable-runtime', 'tampered-getter'].includes(scenario)) {
    await assert.rejects(policy.withDesktopAuthority(lease, () => {}), /Trusted/);
    return;
  }
  if (['unfrozen-metadata', 'unfrozen-turn', 'sandboxed'].includes(scenario)) {
    const turn = { thread_id: 'thread', turn_id: 'turn', sandbox_mode: 'danger-full-access', sandbox: scenario === 'sandboxed' ? 'workspace-write' : 'none' };
    meta = scenario === 'unfrozen-metadata' ? { 'x-codex-turn-metadata': Object.freeze(turn) } : Object.freeze({ 'x-codex-turn-metadata': scenario === 'unfrozen-turn' ? turn : Object.freeze(turn) });
    await assert.rejects(policy.withDesktopAuthority(lease, () => {}), /Trusted/); return;
  }
  assert.throws(() => policy.assertComputerUseEnabled(), /not granted/);
  await policy.withDesktopAuthority(lease, async () => assert.equal(policy.assertComputerUseEnabled(generation), generation));
  for (const wrong of [{ threadId: 'other' }, { turnId: 'other' }, { policyGeneration: generation + 1 }]) await assert.rejects(policy.withDesktopAuthority({ ...lease, ...wrong }, () => {}), /not granted/);
  if (scenario === 'settings-off') {
    settings.updateSettings({ stage4Enabled: false }, settings.getSettings().revision);
    await assert.rejects(policy.withDesktopAuthority(lease, () => {}), /disabled/); return;
  }
  if (scenario === 'wrong-turn-after-await') {
    await assert.rejects(policy.withDesktopAuthority(lease, async () => {
      await Promise.resolve();
      meta = Object.freeze({ 'x-codex-turn-metadata': Object.freeze({ ...meta['x-codex-turn-metadata'], turn_id: 'next-turn' }) });
      policy.assertComputerUseEnabled();
    }), /not granted/); return;
  }
  if (scenario === 'generation-change') {
    await assert.rejects(policy.withDesktopAuthority(lease, async () => {
      settings.updateSettings({ stage3Enabled: true }, settings.getSettings().revision);
      policy.assertComputerUseEnabled();
    }), /not granted/); return;
  }
  if (scenario === 'app-revocations') {
    const { appRevocationFingerprint } = require(path.resolve('scripts/window-desktop-authority.cjs'));
    const { createOwner } = require(path.resolve('scripts/computer-use-approvals.cjs'));
    const apps = createOwner(process.env.CODEX_HOME);
    apps.addAppApproval('fixture.exe', 'Fixture');
    assert.equal(authority.authorize(identity), lease, 'adding an approval preserves the host lease');
    await policy.withDesktopAuthority(lease, () => policy.assertComputerUseEnabled());
    apps.removeAppApproval('fixture.exe');
    assert.throws(() => authority.authorize(identity), /app approval revoked/);
    await assert.rejects(policy.withDesktopAuthority(lease, () => {}), /revoked/);
    const file = path.join(process.env.CODEX_HOME, 'azrael/computer-use/app-approvals.json');
    const write = state => fs.writeFileSync(file, JSON.stringify(state));
    write({ schema: 1, revocations: { z: 2, a: 1 }, apps: [] });
    const sorted = authority.grant(identity), fingerprint = sorted.appRevocationFingerprint;
    write({ schema: 1, revocations: { a: 1, z: 2 }, apps: [{ bundleIdentifier: 'new', displayName: 'New' }] });
    assert.equal(appRevocationFingerprint(process.env.CODEX_HOME), fingerprint);
    await policy.withDesktopAuthority(sorted, () => policy.assertComputerUseEnabled());
    for (const invalid of [{ schema: 1, revocations: { a: -1 }, apps: [] }, { schema: 1, revocations: [], apps: [] }, { schema: 2, revocations: {}, apps: [] }]) {
      write(invalid); assert.throws(() => appRevocationFingerprint(process.env.CODEX_HOME));
      await assert.rejects(policy.withDesktopAuthority(sorted, () => {}));
    }
    fs.writeFileSync(file, ' '.repeat(1024 * 1024 + 1));
    assert.throws(() => appRevocationFingerprint(process.env.CODEX_HOME), /limit/);
    await assert.rejects(policy.withDesktopAuthority(sorted, () => {}), /limit/);
    return;
  }
  if (scenario === 'pipe-acquire') {
    const net = require('node:net');
    const pipe = process.platform === 'win32' ? '\\\\.\\pipe\\azrael-window-authority-test-' + process.pid : path.join(fs.mkdtempSync('/tmp/azw-'), 'w.sock');
    const nonce = 'a'.repeat(64);
    const directory = path.join(process.env.CODEX_HOME, 'azrael/computer-use/window-sessions'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'thread.json'), JSON.stringify({ schema: 1, nonce, pipe }));
    const server = net.createServer(socket => socket.once('data', bytes => {
      const request = JSON.parse(bytes.toString());
      assert.equal(request.method, 'desktop_authority'); assert.equal(request.threadId, 'thread');
      assert.deepEqual(request._meta, meta); assert.equal(request.arguments, undefined);
      socket.end(JSON.stringify({ result: authority.authorize(identity) }) + '\n');
    }));
    await new Promise(resolve => server.listen(pipe, resolve));
    try { assert.deepEqual(await policy.acquireDesktopAuthority(), lease); }
    finally { await new Promise(resolve => server.close(resolve)); if (process.platform !== 'win32') fs.rmdirSync(path.dirname(pipe)); }
    return;
  }
  if (scenario === 'concurrent') {
    const otherMeta = Object.freeze({ 'x-codex-turn-metadata': Object.freeze({ thread_id: 'other', turn_id: 'other-turn', sandbox_mode: 'danger-full-access', sandbox: 'none' }) });
    const other = authority.grant({ threadId: 'other', turnId: 'other-turn', policyGeneration: generation });
    let resume; const wait = new Promise(resolve => { resume = resolve; });
    await Promise.all([
      policy.withDesktopAuthority(lease, async () => { await wait; assert.equal(policy.assertComputerUseEnabled(), generation); }),
      contexts.run(otherMeta, () => policy.withDesktopAuthority(other, async () => { await Promise.resolve(); assert.equal(policy.assertComputerUseEnabled(), generation); resume(); }))
    ]);
    assert.throws(() => policy.assertComputerUseEnabled(), /not granted/); return;
  }
  // Revocation during an await blocks the next transport-write guard and result delivery.
  await assert.rejects(policy.withDesktopAuthority(lease, async () => {
    await Promise.resolve(); authority.revoke('thread'); assert.throws(() => policy.assertComputerUseEnabled());
    return 'must not escape';
  }));
  assert.throws(() => authority.authorize(identity));
  const fresh = authority.grant(identity);
  await assert.rejects(policy.withDesktopAuthority(fresh, async () => { authority.grant(identity); policy.assertComputerUseEnabled(); }), /revoked or replaced/);
}

test('desktop authority requires trusted runtime, exact host grant, live settings and isolated async lease', () => {
  fs.mkdirSync(path.join(run, 'temporary'), { recursive: true });
  const settings = generateSettingsModule(fs.readFileSync(path.join(__dirname, 'use-control-settings.cjs'))).content;
  for (const scenario of ['missing-runtime', 'mutable-runtime', 'tampered-getter', 'unfrozen-metadata', 'unfrozen-turn', 'sandboxed', 'settings-off', 'generation-change', 'wrong-turn-after-await', 'revocation', 'concurrent', 'pipe-acquire', 'app-revocations']) {
    const root = fs.mkdtempSync(path.join(run, 'temporary', scenario + '-'));
    fs.copyFileSync(path.join(__dirname, 'sky-control-policy.mjs'), path.join(root, 'sky-control-policy.mjs'));
    fs.writeFileSync(path.join(root, 'use-control-settings.mjs'), settings);
    const result = spawnSync(process.execPath, ['-e', `(${fixture.toString()})(${JSON.stringify(scenario)}, ${JSON.stringify(root)}).catch(error => { console.error(error); process.exitCode = 1; });`], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, scenario + ': ' + (result.error?.message || result.stderr || result.stdout));
    if (path.dirname(root) !== path.join(run, 'temporary')) throw new Error('Unsafe fixture cleanup path');
    fs.rmSync(root, { recursive: true });
  }
});
