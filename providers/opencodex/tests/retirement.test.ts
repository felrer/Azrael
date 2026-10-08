import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as store from '../vendor/src/oauth/store.ts';
import { pinAccount } from '../inference.ts';
import { retirementStatus, retireAccount } from '../retirement.ts';
import { setAutoSwitch } from '../auto-switch.ts';
import { handleRequest } from '../helper.ts';

let root = '';
const previous = { codex: process.env.CODEX_HOME, provider: process.env.OPENCODEX_HOME };
afterEach(() => {
  if (root) rmSync(root, { recursive: true }); root = '';
  if (previous.codex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous.codex;
  if (previous.provider === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = previous.provider;
});
async function setup(providerId = 'anthropic') {
  root = mkdtempSync(join(tmpdir(), 'azrael-retirement-'));
  process.env.CODEX_HOME = root;
  process.env.OPENCODEX_HOME = join(root, 'azrael', 'providers', 'opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
  for (const principal of ['a', 'b', 'c']) await store.saveCredential(providerId, {
    accountId: principal, access: 'fixture-' + principal, refresh: 'fixture-refresh-' + principal,
    expires: Number.MAX_SAFE_INTEGER, apiBaseUrl: 'https://server.codeium.com', projectId: 'fixture-project', source: 'oauth',
  }, { preserveIdentityless: true });
  const accounts = store.getAccountSet(providerId)!.accounts;
  await store.setActiveAccount(providerId, accounts[0]!.id);
  const config = { providers: { [providerId]: providerId === 'anthropic'
    ? { authMode: 'oauth', adapter: 'anthropic', baseUrl: 'https://api.anthropic.com' } : { authMode: 'oauth' } } };
  const m: any = { store, config: { loadConfig: () => config }, oauth: { OAUTH_PROVIDERS: { [providerId]: {} },
    getValidAccessSnapshotForAccount: async (provider: string, id: string) => ({ accessToken: store.getAccountSet(provider)?.accounts.find(a => a.id === id)?.credential.access }) },
    devinBase: { validateDevinApiBaseUrl: (url: string) => url }, };
  if (providerId === 'anthropic') {
    await pinAccount(config, turn('old'), m); await pinAccount(config, turn('stopped'), m);
  }
  return { accounts, config, m };
}
const turn = (turn_id: string) => ({ provider_id: 'anthropic', thread_id: 'thread', turn_id, model: 'claude-fixture' });
const status = (m: any) => retirementStatus({ threads: [{ threadId: 'thread', providerId: 'anthropic' }] }, m).bindings[0];
const request = (id: string, reason = 'removed', providerId = 'anthropic') => ({ threadId: 'thread', providerId, expectedAccountId: id, reason });
const binding = () => JSON.parse(readFileSync(join(root, 'azrael', 'providers', 'sessions', 'thread.json'), 'utf8'));

test('cross-process removal selects preferred future pin while retaining all old turn pins', async () => {
  const { accounts, m, config } = await setup();
  const before = binding(); setAutoSwitch('anthropic', accounts[2]!.id, true, m);
  const child = Bun.spawn([process.execPath, '-e', `import {removeAccount} from ${JSON.stringify(join(import.meta.dir, '../vendor/src/oauth/store.ts'))}; await removeAccount('anthropic', ${JSON.stringify(accounts[0]!.id)}, {deferSelection:true});`], { env: process.env, stdout: 'ignore', stderr: 'pipe' });
  expect(await child.exited).toBe(0); expect(status(m).status).toBe('removed');
  expect(await retireAccount(request(accounts[0]!.id), m)).toEqual({ retiredAccountId: accounts[0]!.id, accountId: accounts[2]!.id });
  expect(binding().turns).toEqual(before.turns);
  expect(binding().providers.anthropic.account_id).toBe(accounts[2]!.id);
  expect(store.getAccountSet('anthropic')!.activeAccountId).toBe(accounts[2]!.id);
  await expect(pinAccount(config, turn('stopped'), m)).rejects.toThrow('provider_account_removed');
  await pinAccount(config, turn('new'), m); expect(binding().turns.new.account_id).toBe(accounts[2]!.id);
});
test('fallback health and revoked source never resume stopped turns', async () => {
  const { accounts, m } = await setup(); const before = binding();
  await store.markAccountNeedsReauth('anthropic', accounts[0]!.id, true);
  await store.markAccountNeedsReauth('anthropic', accounts[1]!.id, true);
  expect(status(m).status).toBe('reauth');
  expect((await retireAccount(request(accounts[0]!.id, 'revoked'), m))!.accountId).toBe(accounts[2]!.id);
  expect(binding().turns).toEqual(before.turns);
});
test('no candidate preserves failed pin and empty active selection across store normalization', async () => {
  const { accounts, m, config } = await setup();
  await store.markAccountNeedsReauth('anthropic', accounts[1]!.id, true); await store.markAccountNeedsReauth('anthropic', accounts[2]!.id, true);
  await handleRequest({ protocol: 1, id: 'remove', action: 'remove', providerId: 'anthropic', accountId: accounts[0]!.id }, { send() {}, async answer() { return null; } }, m);
  expect(store.getAccountSet('anthropic')!.activeAccountId).toBe(''); expect(store.getCredential('anthropic')).toBeNull();
  expect((await retireAccount(request(accounts[0]!.id), m))!.accountId).toBeNull();
  await expect(pinAccount(config, turn('new'), m)).rejects.toThrow('provider_account_removed');
});
test('malformed and partial store cannot falsely retire a source; transient resolver errors do not mark source', async () => {
  const { accounts, m } = await setup();
  m.oauth.getValidAccessSnapshotForAccount = async () => { throw new TypeError('network temporary'); };
  await expect(retireAccount(request(accounts[0]!.id), m)).rejects.toThrow(); expect(status(m).status).toBe('available');
  const auth = store.getAuthStorePath(); renameSync(auth, auth + '.temporarily-unavailable');
  expect(() => status(m)).toThrow('storage is unavailable'); renameSync(auth + '.temporarily-unavailable', auth);
  writeFileSync(store.getAuthStorePath(), '{broken'); expect(() => status(m)).toThrow('storage is unavailable');
  writeFileSync(store.getAuthStorePath(), JSON.stringify({ anthropic: { activeAccountId: accounts[0]!.id, accounts: [accounts[0], { id: accounts[1]!.id, credential: {} }] } }));
  expect(() => status(m)).toThrow('storage is unavailable');
});
test('refresh and reauth persistence cannot recreate a removed slot', async () => {
  const { accounts } = await setup(); const source = accounts[0]!;
  await Promise.all([store.removeAccount('anthropic', source.id),
    store.saveAccountCredential('anthropic', source.id, { ...source.credential, access: 'fixture-reauth' })]);
  await expect(store.mergeAccountCredential('anthropic', source.id, { ...source.credential, access: 'fixture-refresh' }, { expectedGeneration: store.credentialGeneration(source.credential) })).rejects.toThrow('disappeared');
  expect(store.getAccountSet('anthropic')!.accounts.some(a => a.id === source.id)).toBeFalse();
});
test('Devin status accepts native account pin and retirement prefers opted-in replacement', async () => {
  const { accounts, m } = await setup('devin'); setAutoSwitch('devin', accounts[2]!.id, true, m);
  await store.removeAccount('devin', accounts[0]!.id, { deferSelection: true });
  const result = retirementStatus({ threads: [{ threadId: 'thread', providerId: 'devin', accountId: accounts[0]!.id }] }, m);
  expect(result.bindings[0].status).toBe('removed');
  expect((await retireAccount(request(accounts[0]!.id, 'removed', 'devin'), m))!.accountId).toBe(accounts[2]!.id);
});
test('local active removal persists first and selects preferred validated account', async () => {
  const { accounts, m } = await setup(); setAutoSwitch('anthropic', accounts[2]!.id, true, m);
  const resolve = m.oauth.getValidAccessSnapshotForAccount;
  m.oauth.getValidAccessSnapshotForAccount = async (provider: string, id: string) => {
    expect(store.getAccountSet(provider)!.accounts.some(a => a.id === accounts[0]!.id)).toBeFalse();
    expect(store.getAccountSet(provider)!.activeAccountId).toBe('');
    return resolve(provider, id);
  };
  await handleRequest({ protocol: 1, id: 'remove', action: 'remove', providerId: 'anthropic', accountId: accounts[0]!.id }, { send() {}, async answer() { return null; } }, m);
  expect(store.getAccountSet('anthropic')!.activeAccountId).toBe(accounts[2]!.id);
});
test('candidate removed during validation is skipped', async () => {
  const { accounts, m } = await setup(); const resolve = m.oauth.getValidAccessSnapshotForAccount;
  await store.removeAccount('anthropic', accounts[0]!.id, { deferSelection: true });
  m.oauth.getValidAccessSnapshotForAccount = async (provider: string, id: string) => {
    if (id === accounts[1]!.id) await store.removeAccount(provider, id);
    return resolve(provider, id);
  };
  expect((await retireAccount(request(accounts[0]!.id), m))!.accountId).toBe(accounts[2]!.id);
});
test('two watchers observe the immutable active source and preserve an already chosen future replacement', async () => {
  for (const reason of ['removed', 'revoked']) {
    const { accounts, m } = await setup(); const before = binding();
    if (reason === 'removed') await store.removeAccount('anthropic', accounts[0]!.id, { deferSelection: true });
    else await store.markAccountNeedsReauth('anthropic', accounts[0]!.id, true);
    expect((await retireAccount(request(accounts[0]!.id, reason), m))!.accountId).toBe(accounts[1]!.id);
    setAutoSwitch('anthropic', accounts[2]!.id, true, m); await store.setActiveAccount('anthropic', accounts[2]!.id);
    const selection = store.captureOAuthAccountSelection('anthropic');
    expect(status(m).accountId).toBe(accounts[1]!.id);
    const active = retirementStatus({ threads: [{ threadId: 'thread', providerId: 'anthropic', turnId: 'stopped' }] }, m).bindings[0];
    expect(active.accountId).toBe(accounts[0]!.id); expect(active.status).toBe(reason === 'removed' ? 'removed' : 'reauth');
    expect((await retireAccount({ ...request(accounts[0]!.id, reason), turnId: 'stopped' }, m))!.accountId).toBe(accounts[1]!.id);
    expect(binding().turns).toEqual(before.turns); expect(binding().providers.anthropic.account_id).toBe(accounts[1]!.id);
    expect(store.captureOAuthAccountSelection('anthropic')).toEqual(selection);
    rmSync(root, { recursive: true }); root = '';
  }
}, 40_000);
test('turn descriptors reject unknown, mismatched and invalid turns without changing bindings', async () => {
  const { accounts, m } = await setup(); const before = binding();
  for (const row of [
    { threadId: 'thread', providerId: 'google-antigravity', turnId: 'stopped' },
    { threadId: 'thread', providerId: 'anthropic', turnId: '../stopped' },
    { threadId: 'thread', providerId: 'devin', turnId: 'stopped', accountId: accounts[0]!.id },
  ]) expect(() => retirementStatus({ threads: [row] }, m)).toThrow('Invalid provider account request');
  await store.removeAccount('anthropic', accounts[0]!.id, { deferSelection: true });
  const batch = retirementStatus({ threads: [
    { threadId: 'thread', providerId: 'anthropic', turnId: 'unknown' },
    { threadId: 'thread', providerId: 'anthropic', turnId: 'stopped' },
  ] }, m).bindings;
  expect(batch[0].accountId).toBeNull(); expect(batch[0].status).toBe('unbound');
  expect(batch[1].accountId).toBe(accounts[0]!.id); expect(batch[1].status).toBe('removed');
  await expect(retireAccount({ ...request(accounts[0]!.id), turnId: 'unknown' }, m)).rejects.toThrow();
  await expect(retireAccount({ ...request(accounts[0]!.id), turnId: '../stopped' }, m)).rejects.toThrow();
  expect(binding()).toEqual(before);
});
test('already rebound retirement rejects a healthy source and a reauthenticated source generation race', async () => {
  const { accounts, m } = await setup();
  await store.markAccountNeedsReauth('anthropic', accounts[0]!.id, true);
  await retireAccount(request(accounts[0]!.id, 'revoked'), m);
  const before = binding(); const resolve = m.oauth.getValidAccessSnapshotForAccount;
  m.oauth.getValidAccessSnapshotForAccount = async (provider: string, id: string) => {
    await store.saveAccountCredential(provider, accounts[0]!.id, { ...accounts[0]!.credential, access: 'fixture-reauthenticated' });
    return resolve(provider, id);
  };
  await expect(retireAccount({ ...request(accounts[0]!.id, 'revoked'), turnId: 'stopped' }, m)).rejects.toThrow();
  await expect(retireAccount({ ...request(accounts[0]!.id, 'revoked'), turnId: 'stopped' }, m)).rejects.toThrow();
  await store.markAccountNeedsReauth('anthropic', accounts[0]!.id, true);
  m.oauth.getValidAccessSnapshotForAccount = async (provider: string, id: string) => {
    await store.saveAccountCredential(provider, accounts[0]!.id, { ...accounts[0]!.credential, access: 'fixture-new-generation' });
    await store.markAccountNeedsReauth(provider, accounts[0]!.id, true);
    return resolve(provider, id);
  };
  await expect(retireAccount({ ...request(accounts[0]!.id, 'revoked'), turnId: 'stopped' }, m)).rejects.toThrow();
  expect(binding()).toEqual(before);
});
test('chained retirement replaces an unavailable future pin or preserves it when no candidate remains', async () => {
  for (const revoked of [false, true]) for (const availableReplacement of [true, false]) {
    const { accounts, m, config } = await setup(); const before = binding();
    await store.removeAccount('anthropic', accounts[0]!.id, { deferSelection: true });
    await retireAccount(request(accounts[0]!.id), m);
    expect(binding().providers.anthropic.account_id).toBe(accounts[1]!.id);
    if (revoked) await store.markAccountNeedsReauth('anthropic', accounts[1]!.id, true);
    else await store.removeAccount('anthropic', accounts[1]!.id, { deferSelection: true });
    if (!availableReplacement) await store.markAccountNeedsReauth('anthropic', accounts[2]!.id, true);
    const active = retirementStatus({ threads: [{ threadId: 'thread', providerId: 'anthropic', turnId: 'stopped' }] }, m).bindings[0];
    expect(active.accountId).toBe(accounts[0]!.id); expect(active.status).toBe('removed');
    expect((await retireAccount({ ...request(accounts[0]!.id), turnId: 'stopped' }, m))!.accountId)
      .toBe(availableReplacement ? accounts[2]!.id : null);
    expect(binding().turns).toEqual(before.turns);
    expect(binding().providers.anthropic.account_id).toBe(accounts[availableReplacement ? 2 : 1]!.id);
    await expect(pinAccount(config, turn('stopped'), m)).rejects.toThrow('provider_account_removed');
    if (!availableReplacement) await expect(pinAccount(config, turn('new'), m)).rejects.toThrow(revoked ? 'provider_account_revoked' : 'provider_account_removed');
    rmSync(root, { recursive: true }); root = '';
  }
}, 60_000);
