'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createHost } = require('./window-control-host.cjs');
const thread = '12345678-1234-1234-1234-123456789abc';
const otherThread = '12345678-1234-1234-1234-123456789abd';
async function fixture(t, mode) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'window-stage-authority-'));
  const settings = require('./use-control-settings.cjs').createSettingsOwner(home);
  const approvals = require('./window-use-approvals.cjs').createOwner(home);
  const descriptor = { hwnd: 'fixture', pid: 4, processCreated: 'created', executable: 'C:/fixture/editor.exe', title: 'Fixture', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 };
  const modals = [], backendCalls = [], cards = [];
  let answer = '허용';
  const host = createHost({ runtime: { codexHome: home, computerUse: { directory: path.join(home, 'desktop-runtime') }, windowControl: {} }, occupancyDirectory: path.join(home, 'occupancy'), approvals,
    vscode: { window: { async showWarningMessage(...args) { modals.push(args); return typeof answer === 'function' ? answer() : answer; } } },
    backend: { async request(method) { backendCalls.push(method); return method === 'listWindows' ? [descriptor] : descriptor; }, async dispose() {} } });
  t.after(async () => { await host.dispose(); await fs.rm(home, { recursive: true }); });
  const native = { registerProvider() { return { dispose() {} }; } };
  host.attach(native, () => assert.fail('Unexpected engine RPC'));
  host.registerApprovalUI(native, envelope => { cards.push(envelope); return true; });
  async function register(id, computerUseMode = mode) {
    const result = { id: 'fixture-provider:' + id, result: { thread: { id }, computerUseMode } };
    // The request ID is independent of the returned thread ID.
    host.request(native, 'fixture-provider', 'register-' + id, 'thread/start', {});
    result.id = 'fixture-provider:register-' + id;
    const replayed = new Promise(resolve => assert.equal(host.beforeResult(native, result, resolve), true));
    assert.deepEqual(await replayed, result);
    assert.equal(host.threads.get(id).mode, computerUseMode);
  }
  await register(thread);
  let turn = 'turn-one';
  const start = (id = turn) => { turn = id; host.observe(native, { method: 'turn/started', params: { threadId: thread, turn: { id } } }); };
  start();
  const metadata = () => ({ threadId: thread, 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' } }, 'x-codex-turn-metadata': { thread_id: thread, turn_id: turn, sandbox_mode: 'danger-full-access', sandbox: 'none' } });
  const call = (tool, args = {}, meta = metadata()) => host.handlePipe({ nonce: host.nonce, threadId: thread, method: 'call', tool, arguments: args, _meta: meta });
  const desktop = (meta = metadata(), extra = {}) => host.handlePipe({ nonce: host.nonce, threadId: thread, method: 'desktop_authority', _meta: meta, ...extra });
  const requestStage = (stage, targetId) => call('request_stage', { stage, ...(targetId ? { targetId } : {}), reason: 'Perform the explicitly requested fixture task' });
  const select = async () => call('select_window', { candidateId: (await call('list_windows')).candidates[0].candidateId });
  return { host, native, home, settings, approvals, modals, backendCalls, cards, register, start, call, desktop, metadata, requestStage, select, setAnswer: value => answer = value,
    update(patch) { return settings.updateSettings(patch, settings.getSettings().revision); }, complete() { host.observe(native, { method: 'turn/completed', params: { threadId: thread, turn: { status: 'completed' } } }); } };
}
test('ordinary thread stage4 requires explicit consent, active native turn and enabled global stage', async t => {
  const f = await fixture(t);
  await f.select(); assert.equal(f.cards.length, 0, 'stage1 observation does not ask app consent');
  await assert.rejects(f.desktop(), { code: 'permission_denied' });
  f.setAnswer(undefined); await assert.rejects(f.requestStage(4), { code: 'cancelled' }); await assert.rejects(f.desktop(), { code: 'permission_denied' });
  f.setAnswer('허용'); const granted = await f.requestStage(4); assert.equal(granted.authorized, true); assert.equal(granted.stage, 4);
  assert.equal(f.modals.length, 2); assert.equal(f.modals[1][0], 'Window Use 4단계를 허용할까요?'); assert.equal(f.modals[1][1].modal, true); assert.match(f.modals[1][1].detail, /fixture task/);
  const lease = await f.desktop(); assert.equal(lease.threadId, thread); assert.equal(lease.turnId, 'turn-one'); assert.match(lease.token, /^[a-f0-9]{64}$/);
  f.update({ stage4Enabled: false }); await assert.rejects(f.desktop(), { code: 'permission_denied' }); await assert.rejects(f.requestStage(4), { code: 'permission_denied' });
  f.update({ stage4Enabled: true }); await assert.rejects(f.desktop(), { code: 'permission_denied' });
  f.complete(); await assert.rejects(f.requestStage(4), { code: 'permission_denied' }); await assert.rejects(f.desktop(), { code: 'permission_denied' });
  assert.ok(f.backendCalls.every(method => ['listWindows', 'status'].includes(method)), 'no desktop input or fallback backend was invoked: ' + JSON.stringify(f.backendCalls));
});
test('stage4 consent never accepts forged thread, turn or sandbox metadata', async t => {
  const f = await fixture(t); await f.requestStage(4); await f.register(otherThread);
  for (const patch of [{ thread_id: otherThread }, { turn_id: 'forged-turn' }, { sandbox_mode: 'read-only' }, { sandbox: 'workspace-write' }]) {
    const meta = f.metadata(); Object.assign(meta['x-codex-turn-metadata'], patch); await assert.rejects(f.desktop(meta), { code: 'permission_denied' });
  }
  await assert.rejects(f.desktop({}, {}), { code: 'permission_denied' });
  await assert.rejects(f.desktop(f.metadata(), { threadId: otherThread }), { code: 'permission_denied' });
  await assert.rejects(f.desktop(f.metadata(), { tool: 'anything' }), { code: 'permission_denied' });
  assert.equal((await f.desktop()).threadId, thread, 'rejected forgeries cannot replace the real task lease');
});
test('selectedWindow native lifecycle result retains immutable stage4 ceiling', async t => {
  const f = await fixture(t, 'selectedWindow');
  assert.equal((await f.call('context')).stages.find(stage => stage.stage === 4).missingPrerequisite, 'immutable-selected-window-tool-ceiling');
  await assert.rejects(f.requestStage(4), { code: 'permission_denied' }); await assert.rejects(f.desktop(), { code: 'permission_denied' }); assert.equal(f.modals.length, 0);
});
test('turn completion, turn replacement, settings change and stage2 transition revoke desktop leases', async t => {
  const f = await fixture(t);
  for (const boundary of ['complete', 'replace', 'settings', 'stage2']) {
    f.start('turn-' + boundary); const selected = await f.select(); await f.requestStage(4); const lease = await f.desktop();
    if (boundary === 'complete') f.complete();
    if (boundary === 'replace') f.start('replacement-turn');
    if (boundary === 'settings') f.update({ windowUseAllowAll: !f.settings.getSettings().windowUseAllowAll });
    if (boundary === 'stage2') { f.approvals.addAppApproval('C:/fixture/editor.exe', 'Fixture'); assert.equal((await f.requestStage(2, selected.targetId)).stage, 2); }
    await assert.rejects(f.desktop(), { code: 'permission_denied' }, boundary);
    if (boundary !== 'settings') await assert.rejects(fs.stat(lease.recordPath), { code: 'ENOENT' }, boundary + ' removes persisted task lease');
  }
});
test('missing stage3 runtime reports unavailable and never falls back to parent control', async t => {
  const f = await fixture(t); f.update({ stage3Enabled: true });
  const context = await f.call('context'), stage = context.stages.find(item => item.stage === 3);
  assert.equal(stage.available, false); assert.equal(stage.missingPrerequisite, 'child-session-runtime-not-prepared');
  const result = await f.requestStage(3); assert.equal(result.authorized, false); assert.equal(result.missingPrerequisite, 'child-session-runtime-not-prepared');
  assert.equal(f.modals.length, 0); assert.deepEqual(f.backendCalls, []); await assert.rejects(f.desktop(), { code: 'permission_denied' });
});
test('native Stop revokes desktop lease and a late modal response cannot restore it', async t => {
  const f = await fixture(t); await f.requestStage(4); const lease = await f.desktop();
  f.host.request({}, 'fixture-provider', 'forged-stop', 'turn/interrupt', { threadId: thread, turnId: 'turn-one' });
  assert.equal((await f.desktop()).token, lease.token, 'an unrelated native connection cannot stop this task');
  f.host.request(f.native, 'fixture-provider', 'stop', 'turn/interrupt', { threadId: thread, turnId: 'turn-one' });
  await assert.rejects(f.desktop(), { code: 'permission_denied' }); await assert.rejects(fs.stat(lease.recordPath), { code: 'ENOENT' });
  f.start('next-turn'); let release;
  f.setAnswer(() => new Promise(resolve => { release = resolve; }));
  const pending = f.requestStage(4), cancelled = assert.rejects(pending, { code: 'cancelled' });
  for (let attempts = 0; !release && attempts < 100; attempts++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function');
  f.host.request(f.native, 'fixture-provider', 'stop-pending', 'turn/interrupt', { threadId: thread, turnId: 'next-turn' });
  release('허용'); await cancelled; await assert.rejects(f.desktop(), { code: 'permission_denied' });
});
test('persisted desktop task lease replacement invalidates the granted authority', async t => {
  const f = await fixture(t); await f.requestStage(4); const lease = await f.desktop();
  const record = JSON.parse(await fs.readFile(lease.recordPath, 'utf8'));
  await fs.writeFile(lease.recordPath, JSON.stringify({ ...record, turnId: 'replaced-turn' }));
  await assert.rejects(f.desktop(), /replaced/);
});


test('late app-store notification preserves a fresh grant and later revocation removes it', async t => {
  const f = await fixture(t);
  const desktopApps=require('./computer-use-approvals.cjs').createOwner(f.home);
  desktopApps.removeAppApproval('legacy-editor');
  await f.requestStage(4); const fresh=await f.desktop();
  // The revocation preceded this explicit new grant; a delayed file event must not cancel it.
  await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal((await f.desktop()).token,fresh.token);
  desktopApps.removeAppApproval('another-editor');
  await assert.rejects(f.desktop(), /revok|authority|approval/i);
  const deadline=Date.now()+2000;
  for(;;) {try{await fs.stat(fresh.recordPath);}catch(error){if(error.code==='ENOENT')break;throw error;}if(Date.now()>deadline)assert.fail('App revocation did not release the persisted task grant');await new Promise(resolve=>setTimeout(resolve,25));}
  await assert.rejects(f.desktop(),{code:'permission_denied'});
});
