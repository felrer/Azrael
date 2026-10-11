import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetAnthropicUsage as resetRemote } from '../anthropic-reset.ts';
const resetAnthropicUsage = (accountId, m, fetcher) => resetRemote(accountId, m, fetcher, m.attempts);

const grant = { id: 'launch-grant', resets_left: 1, ends_at: '2099-10-22T16:00:00Z', paused: false, usable_now: true };
const usage = () => ({ cedar_ember: { eligible: true, next_grant_id: grant.id, grants: [{ ...grant }] } });
function fixture(body = usage(), result = 'reset') {
  const account = { id: 'saved', credential: { accountId: 'principal' } };
  const calls = [];
  let pending;
  const attempts = { read: () => pending, admit: value => pending ??= value, clear: id => { if (pending?.requestId === id) pending = undefined; } };
  const m = { attempts, store: { getAccountSet: () => ({ accounts: [account] }) }, oauth: { async getValidAccessSnapshotForAccount(provider, id, options) {
    assert.deepEqual([provider, id, options], ['anthropic', 'saved', { requireUsableAccount: true }]); return { accessToken: 'private-token' };
  } } };
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    const value = url.includes('/usage?') ? body : url.endsWith('/profile') ? { account: { uuid: 'principal' }, organization: { uuid: 'org' } } : { result };
    return Response.json(value);
  };
  return { m, calls, fetcher, account };
}
test('resets the requested account with organization and stable grant-slot idempotency', async () => {
  const f = fixture();
  assert.equal(await resetAnthropicUsage('saved', f.m, f.fetcher), 'reset');
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].url, 'https://api.anthropic.com/api/organizations/org/reset_rate_limits');
  assert.equal(f.calls[2].init.method, 'POST');
  const request = JSON.parse(f.calls[2].init.body);
  assert.equal(request.program, 'cedar_ember'); assert.equal(request.grant_id, grant.id);
  assert.match(request.request_id, /^azrael-[a-f0-9]{64}$/);
  await resetAnthropicUsage('saved', f.m, f.fetcher);
  assert.equal(JSON.parse(f.calls[5].init.body).request_id, request.request_id);
  assert.equal(f.calls[2].init.redirect, 'error');
});
test('server outcomes distinguish no credit, no usage, cooldown and already redeemed', async () => {
  for (const [result, outcome] of [['not_limited','nothingToReset'],['unavailable','noCredit'],['ineligible','noCredit'],['cooldown','cooldown'],['already_used','alreadyUsed']]) {
    const f = fixture(usage(), result); assert.equal(await resetAnthropicUsage('saved', f.m, f.fetcher), outcome);
  }
  const f = fixture(usage(), 'new_unknown_result');
  await assert.rejects(resetAnthropicUsage('saved', f.m, f.fetcher), /結果|결과/);
});
test('empty, expired, ineligible and cooling grants do not send a POST', async () => {
  for (const body of [
    { cedar_ember: { eligible: false } }, { cedar_ember: { eligible: true, grants: [] } },
    { cedar_ember: { eligible: true, next_grant_id: grant.id, grants: [{ ...grant, resets_left: 0 }] } },
    { cedar_ember: { eligible: true, next_grant_id: grant.id, grants: [{ ...grant, ends_at: '2000-01-01T00:00:00Z' }] } },
  ]) {
    const f = fixture(body); assert.equal(await resetAnthropicUsage('saved', f.m, f.fetcher), 'noCredit'); assert.equal(f.calls.length, 1);
  }
  const body = usage(); body.cedar_ember.grants[0].paused = true;
  const f = fixture(body); assert.equal(await resetAnthropicUsage('saved', f.m, f.fetcher), 'cooldown'); assert.equal(f.calls.length, 1);
});
test('missing schema, account change, mismatched profile and remote errors never masquerade as no credit', async () => {
  const missing = fixture({}); await assert.rejects(resetAnthropicUsage('saved', missing.m, missing.fetcher), /지원 여부/);
  const changed = fixture();
  await assert.rejects(resetAnthropicUsage('saved', changed.m, async (url, init) => { changed.account.credential.accountId = 'other'; return changed.fetcher(url, init); }), /계정이 변경/);
  assert.equal(changed.calls.length, 1);
  const mismatch = fixture();
  await assert.rejects(resetAnthropicUsage('saved', mismatch.m, async (url, init) => url.endsWith('/profile') ? Response.json({ account: { uuid: 'other' }, organization: { uuid: 'org' } }) : mismatch.fetcher(url, init)), /일치하지/);
  assert.equal(mismatch.calls.length, 1);
  for (const status of [401, 403, 429, 500]) {
    const f = fixture(); await assert.rejects(resetAnthropicUsage('saved', f.m, async () => new Response('private-token remote-secret', { status })), error => !error.message.includes('secret') && !error.message.includes('private-token'));
  }
});
test('lost POST response can be retried with the same request id', async () => {
  const f = fixture();
  await assert.rejects(resetAnthropicUsage('saved', f.m, async (url, init) => { const response = await f.fetcher(url, init); if (init.method === 'POST') throw Error('upstream secret'); return response; }), /결과를 확인/);
  const first = JSON.parse(f.calls.at(-1).init.body).request_id;
  await resetAnthropicUsage('saved', f.m, async (url, init) => {
    assert.ok(!url.includes('/usage?'), 'Do not select another grant after a lost response');
    return f.fetcher(url, init);
  });
  assert.equal(JSON.parse(f.calls.at(-1).init.body).request_id, first);
});
test('pending request survives a fresh caller and is cleared only after a known outcome', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'azrael-reset-test-'));
  const previous = process.env.OPENCODEX_HOME;
  process.env.OPENCODEX_HOME = directory;
  try {
    const first = fixture(); let locks = 0;
    first.m.config = { withConfigMutationLockSync: operation => { locks++; return operation(); } };
    await assert.rejects(resetRemote('saved', first.m, async (url, init) => {
      const response = await first.fetcher(url, init); if (init.method === 'POST') throw Error('lost'); return response;
    }), /결과를 확인/);
    assert.equal(readdirSync(join(directory, 'anthropic-reset-attempts')).length, 1);
    const retry = fixture({}, 'already_used'); retry.m.config = first.m.config;
    assert.equal(await resetRemote('saved', retry.m, retry.fetcher), 'alreadyUsed');
    assert.equal(retry.calls.length, 2, 'Retry only checks profile and resends persisted request');
    assert.equal(retry.calls[1].init.body, first.calls[2].init.body);
    assert.equal(readdirSync(join(directory, 'anthropic-reset-attempts')).length, 0);
    assert.equal(locks, 2);
  } finally {
    if (previous === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = previous;
    rmSync(directory, { recursive: true });
  }
});
