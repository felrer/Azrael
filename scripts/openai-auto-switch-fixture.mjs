import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Only the disposable check-accounts loopback server calls this fixture.
export class OpenAiAutoSwitchFixture {
  constructor(accounts) {
    this.accounts = accounts;
    this.mode = 'quota';
    this.requests = [];
    this.checks = [];
  }

  async respond(request, response) {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) throw new Error('Fixture request too large');
    }
    const payload = JSON.parse(body);
    const accountId = request.headers['chatgpt-account-id'];
    const bearer = request.headers.authorization?.replace(/^Bearer /, '');
    let tokenOwner;
    try {
      tokenOwner = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString())['https://api.openai.com/auth'];
    } catch { /* The assertion below rejects missing or foreign credentials. */ }
    assert.equal(tokenOwner?.chatgpt_account_id, accountId, 'Inference bearer and workspace owner disagree');
    assert(this.accounts.some(account => account.accountId === accountId), 'Unknown inference owner');
    this.requests.push({ accountId, bearerOwner: tokenOwner.chatgpt_account_id, mode: this.mode,
      inputItemCount: payload.input?.length, userInput: payload.input?.filter(item => item.role === 'user'), model: payload.model });
    if (accountId === this.accounts[0].accountId) {
      response.writeHead(429, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: this.mode === 'generic429'
        ? { type: 'rate_limit_error', message: 'synthetic generic HTTP 429' }
        : { type: 'usage_limit_reached', message: 'synthetic account quota', plan_type: 'team', resets_at: 2000000000 } }));
      return;
    }
    const id = `auto-switch-${this.requests.length}`;
    const events = [
      { type: 'response.created', response: { id } },
      { type: 'response.output_item.done', item: { type: 'message', role: 'assistant', id: `${id}-message`,
        content: [{ type: 'output_text', text: 'OPENAI_SAME_TURN_RECOVERED' }] } },
      { type: 'response.completed', response: { id, usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } } },
    ];
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  }
}

export async function runOpenAiAutoSwitch(context) {
  const { fixture, first, second, accounts, startPair, stopPair, azrael, waitForState,
    stateDirectory, selectedStatePath, fixtureModel, setCurrentPair } = context;
  let pair = await startPair('automatic quota recovery');
  setCurrentPair(pair);
  const profile = async () => (await azrael(pair.stdio, 'list')).state.profiles.find(item => item.id === second.profileId);
  const selectA = async () => {
    await azrael(pair.stdio, 'switch', first.profileId);
    await waitForState(pair.stdio, state => !state.isSwitching && state.activeProfileId === first.profileId, 'select A');
    pair.stdio.discardNotifications('account/updated', 'azrael/account/updated');
    pair.management.discardNotifications('account/updated', 'azrael/account/updated');
  };
  const turn = async (name, status, requireLeaseRelease = true) => {
    const started = await pair.stdio.request('thread/start', { cwd: stateDirectory, ephemeral: false, model: fixtureModel });
    const threadId = started.thread.id;
    const offset = fixture.requests.length;
    const result = await pair.stdio.request('turn/start', { threadId,
      input: [{ type: 'text', text: `OPENAI_AUTO_SWITCH_${name}: Reply with the fixture marker.`, text_elements: [] }] });
    const turnId = result.turn.id;
    const completed = await pair.stdio.notification('turn/completed', params => params.threadId === threadId && params.turn?.id === turnId);
    if (fixture.error) throw fixture.error;
    assert.equal(completed.turn.status, status, `${name} status: ${JSON.stringify(completed.turn.error)}`);
    if (requireLeaseRelease) await waitForState(pair.stdio, state => !state.hasActiveTurns, `${name} task lease release`);
    const recorded = await pair.stdio.request('thread/read', { threadId, includeTurns: true });
    assert.equal(recorded.thread.turns.length, 1, `${name} must retain exactly one user turn`);
    assert.equal(recorded.thread.turns[0].id, turnId);
    return { threadId, turnId, requests: fixture.requests.slice(offset), completed, recorded };
  };
  await selectA();
  await azrael(pair.stdio, 'autoSwitchDisable', second.profileId);
  assert.equal((await profile()).autoSwitchAllowed, false, 'Disabled permission was not persisted');
  const disabled = await turn('DISABLED', 'failed');
  assert(disabled.requests.length > 0 && disabled.requests.every(request => request.accountId === accounts[0].accountId));
  assert.equal((await azrael(pair.stdio, 'list')).state.activeProfileId, first.profileId);
  fixture.checks.push('disabled candidate stays on A after structured quota');

  await azrael(pair.management, 'autoSwitchEnable', second.profileId);
  assert.equal((await profile()).autoSwitchAllowed, true, 'Enabled permission was not persisted');
  fixture.mode = 'generic429';
  const generic = await turn('GENERIC429', 'failed');
  assert(generic.requests.length > 0 && generic.requests.every(request => request.accountId === accounts[0].accountId));
  assert.equal((await azrael(pair.stdio, 'list')).state.activeProfileId, first.profileId);
  fixture.checks.push('generic HTTP429 does not switch despite enabled B');

  fixture.mode = 'quota';
  // A real filesystem failure at the durable selection boundary, without a product test hook.
  assert.equal(process.platform, 'win32', 'Durable selection fault fixture requires Windows read-sharing handle');
  const selectionQuoted = selectedStatePath.replaceAll("'", "''");
  const holder = spawn('powershell.exe', ['-NoProfile', '-Command',
    `$handle = [System.IO.File]::Open('${selectionQuoted}', [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read); [Console]::Out.WriteLine('LOCKED'); [Console]::In.ReadLine() | Out-Null; $handle.Dispose()`],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const released = new Promise((resolve, reject) => { holder.once('error', reject); holder.once('exit', code => code === 0 ? resolve() : reject(new Error(`Selection lock helper exit ${code}`))); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Selection lock helper timed out')), 5000);
    holder.stdout.once('data', data => { clearTimeout(timer); data.toString().includes('LOCKED') ? resolve() : reject(new Error('Selection lock helper failed')); });
    holder.once('error', error => { clearTimeout(timer); reject(error); });
  });
  try {
    const failedSave = await turn('SAVE_FAILURE', 'failed', false);
    assert(failedSave.requests.length > 0 && failedSave.requests.every(request => request.accountId === accounts[0].accountId));
    assert.equal((await azrael(pair.stdio, 'list')).state.activeProfileId, first.profileId, 'Failed durable save changed active owner');
    assert.equal((JSON.parse(await readFile(selectedStatePath, 'utf8'))).selectedProfileId, first.profileId, 'Failed save changed durable selection');
  } finally {
    holder.stdin.end('\n');
    await released;
  }
  fixture.checks.push('durable selection failure retains A binding and selection and makes no B inference');
  // Holding the file also prevents the recovery writer from confirming its
  // rollback. The existing owner fails closed until restart in that case.
  await stopPair(pair);
  pair = await startPair('restart after durable selection refusal');
  setCurrentPair(pair);
  await waitForState(pair.stdio, state => !state.hasActiveTurns && state.activeProfileId === first.profileId, 'durable failure restart A');

  pair.stdio.discardNotifications('account/updated', 'azrael/account/updated');
  pair.management.discardNotifications('account/updated', 'azrael/account/updated');
  const recovered = await turn('RECOVER', 'completed');
  assert.deepEqual(recovered.requests.map(request => request.accountId), [accounts[0].accountId, accounts[1].accountId], 'Recovery must sample A then B in the same turn');
  assert.equal(recovered.requests[1].bearerOwner, accounts[1].accountId);
  const accountEvents = [
    pair.stdio.notification('azrael/account/updated', state => state.activeProfileId === second.profileId),
    pair.stdio.notification('account/updated'),
  ];
  if (pair.management !== pair.stdio) {
    accountEvents.push(pair.management.notification('azrael/account/updated', state => state.activeProfileId === second.profileId), pair.management.notification('account/updated'));
  }
  await Promise.all(accountEvents);
  assert.equal((JSON.parse(await readFile(selectedStatePath, 'utf8'))).selectedProfileId, second.profileId);
  assert(JSON.stringify(recovered.recorded).includes('OPENAI_SAME_TURN_RECOVERED'), 'Recovered assistant response missing');
  fixture.checks.push('native quota recovery emits account and Azrael events, saves B, and samples B bearer in the original turn');
  await stopPair(pair);
  pair = await startPair('automatic selection restart');
  setCurrentPair(pair);
  const restored = await waitForState(pair.stdio, state => !state.isSwitching && state.activeProfileId === second.profileId, 'restart B');
  assert.equal(restored.profiles.find(item => item.id === second.profileId).autoSwitchAllowed, true);
  assert.equal((await profile()).autoSwitchAllowed, true);
  const read = await pair.stdio.request('thread/read', { threadId: recovered.threadId, includeTurns: true });
  assert.equal(read.thread.turns[0].id, recovered.turnId);
  fixture.checks.push('restart preserves B selection, B permission, and recovered turn');
  await stopPair(pair);
}
