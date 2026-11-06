import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinAccount, recoverAccount } from '../inference.ts';
import { handleRequest, safeMessage } from '../helper.ts';

// Admission must not silently substitute an account after future queue/recovery
// refactors. Exercise the real binding owner with a bounded OAuth metadata seam.
const originalHome = process.env.CODEX_HOME, originalProviderHome = process.env.OPENCODEX_HOME;
let root = '';
afterEach(async () => {
  // SQLite closes its owner before returning; Windows can finish releasing that
  // handle asynchronously. Retry ordinary EBUSY deletion without force options.
  if (root) await rm(root, { recursive: true, maxRetries: 3, retryDelay: 100 }); root = '';
  if (originalHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = originalHome;
  if (originalProviderHome === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = originalProviderHome;
});
function fixture() {
  root = mkdtempSync(join(tmpdir(), 'profile-account-scope-'));
  process.env.CODEX_HOME = root;
  process.env.OPENCODEX_HOME = join(root, 'azrael/providers/opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
  const accounts = ['aaaaaaaa', 'bbbbbbbb'].map(id => ({ id, needsReauth: false,
    credential: { accountId: `principal-${id}`, access: `fixture-access-${id}`, refresh: `fixture-refresh-${id}`, expires: Number.MAX_SAFE_INTEGER } }));
  const set = { activeAccountId: accounts[0]!.id, accounts };
  const config = { providers: { anthropic: { adapter: 'anthropic', authMode: 'oauth', baseUrl: 'https://api.anthropic.com' } } };
  const m: any = { config: { loadConfig: () => config }, store: { getAccountSet: () => set },
    oauth: { getValidAccessSnapshotForAccount: async (_provider: string, id: string) => ({ accessToken: accounts.find(a => a.id === id)!.credential.access }) } };
  const scope = { providerId: 'anthropic', accountId: accounts[0]!.id };
  const request = (turn = 'first') => ({ provider_id: 'anthropic', model: 'claude-fixture', thread_id: 'thread', turn_id: turn, providerAccount: { ...scope } });
  const binding = join(root, 'azrael/providers/sessions/thread.json');
  return { accounts, set, config, m, scope, request, binding };
}

test('captured account matches the actual selected pin; absent restriction preserves legacy pinning', async () => {
  const { set, config, m, request, binding } = fixture();
  const result = await pinAccount(config, request(), m);
  expect(result.accountId).toBe('aaaaaaaa');
  expect(JSON.parse(readFileSync(binding, 'utf8')).turns.first.account_id).toBe('aaaaaaaa');
  set.activeAccountId = 'bbbbbbbb';
  const unrestricted = { provider_id: 'anthropic', model: 'claude-fixture', thread_id: 'thread', turn_id: 'legacy' };
  expect((await pinAccount(config, unrestricted, m)).accountId).toBe('aaaaaaaa');
});

test('captured queued account rejects a changed selection or unknown scope before OAuth resolution', async () => {
  const { set, config, m, request, binding } = fixture();
  let refreshed = 0; m.oauth.getValidAccessSnapshotForAccount = async () => { refreshed++; throw Error('unexpected_refresh'); };
  set.activeAccountId = 'bbbbbbbb';
  await expect(pinAccount(config, request(), m)).rejects.toThrow('profile_account_mismatch');
  for (const providerAccount of [null, {}, { providerId: 'meta-muse', accountId: 'aaaaaaaa' }, { providerId: 'anthropic', accountId: 'missing' }]) {
    await expect(pinAccount(config, { ...request(), providerAccount }, m)).rejects.toThrow('profile_account_mismatch');
  }
  expect(refreshed).toBe(0); expect(existsSync(binding)).toBeFalse();
});

test('captured restriction and retained thread pin must agree without overwriting the old binding', async () => {
  const { set, config, m, request, binding } = fixture();
  await pinAccount(config, request(), m);
  const before = readFileSync(binding, 'utf8');
  set.activeAccountId = 'bbbbbbbb';
  await expect(pinAccount(config, { ...request('second'), providerAccount: { providerId: 'anthropic', accountId: 'bbbbbbbb' } }, m)).rejects.toThrow('profile_account_mismatch');
  expect(readFileSync(binding, 'utf8')).toBe(before);
});

test('captured account cannot change during an awaited refresh or through caller object mutation', async () => {
  const { accounts, set, config, m, request, binding } = fixture();
  const captured = request();
  m.oauth.getValidAccessSnapshotForAccount = async () => {
    set.activeAccountId = 'bbbbbbbb'; captured.providerAccount.accountId = 'bbbbbbbb';
    return { accessToken: accounts[0]!.credential.access };
  };
  await expect(pinAccount(config, captured, m)).rejects.toThrow('profile_account_mismatch');
  expect(existsSync(binding)).toBeFalse();
});

test('captured account fails closed on unavailable authoritative metadata and forbids recovery rotation', async () => {
  const { config, m, request, binding, scope } = fixture();
  await pinAccount(config, request(), m);
  const before = readFileSync(binding, 'utf8');
  m.store.readAuthStoreForRetirement = () => { throw Error('fixture metadata unreadable'); };
  await expect(pinAccount(config, request('next'), m)).rejects.toThrow('profile_account_unavailable');
  await expect(recoverAccount({ providerId: 'anthropic', threadId: 'thread', turnId: 'first', model: 'claude-fixture', excludedAccountIds: [], expectedAccountId: 'aaaaaaaa', providerAccount: scope }, m)).rejects.toThrow('profile_account_rotation_forbidden');
  expect(readFileSync(binding, 'utf8')).toBe(before);
});

test('Devin captured credential scope compares selected and resolved identity under its mutation owner', async () => {
  const { accounts, set, config, m } = fixture();
  (config.providers as any).devin = { authMode: 'oauth' };
  m.oauth.OAUTH_PROVIDERS = { devin: {} };
  for (const account of accounts) (account.credential as any).apiBaseUrl = 'https://api.devin.ai';
  m.devinBase = { validateDevinApiBaseUrl: (url: string) => url === 'https://api.devin.ai' ? url : null };
  let lockDepth = 0;
  m.config.withConfigMutationLockSync = (fn: () => any) => { lockDepth++; try { return fn(); } finally { lockDepth--; } };
  m.store.getAccountSet = () => { if (!lockDepth) throw Error('scope read outside mutation owner'); return set; };
  const io = { send() {}, async answer() { return null; } };
  const req = { protocol: 1 as const, id: 'scope', action: 'credential', providerId: 'devin', accountId: 'aaaaaaaa', providerAccount: { providerId: 'devin', accountId: 'aaaaaaaa' } };
  expect(await handleRequest(req, io, m)).toEqual({ api_key: accounts[0]!.credential.access, api_server_url: 'https://api.devin.ai', account_id: 'aaaaaaaa' });
  set.activeAccountId = 'bbbbbbbb';
  for (const request of [req, { ...req, accountId: undefined }, { ...req, providerAccount: { providerId: 'anthropic', accountId: 'aaaaaaaa' } }, { ...req, requireAutoSwitch: true }]) {
    await expect(handleRequest(request, io, m)).rejects.toThrow('captured Agent profile');
  }
  expect(safeMessage(Error('Provider account does not match the captured Agent profile'))).toContain('captured Agent profile');
  m.store.getAccountSet = () => set;
  const { providerAccount: _scope, ...legacy } = req;
  expect((await handleRequest(legacy, io, m) as any).account_id).toBe('aaaaaaaa');
});
