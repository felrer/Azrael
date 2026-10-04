import { Database } from 'bun:sqlite';
import { prepareConfigMutationDatabasePathForWrite, withConfigMutationLockSync } from '../vendor/src/config.ts';
import { createOAuthFileLock } from '../vendor/src/oauth/store.ts';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRequest } from '../helper.ts';
import { autoSwitchAvailable, autoSwitchAllowed, setAutoSwitch, eligibleAccounts, recoverDevinAccount } from '../auto-switch.ts';
import { pinAccount, recoverAccount } from '../inference.ts';

const oldHome = process.env.CODEX_HOME, oldProvider = process.env.OPENCODEX_HOME;
let root = '';
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true }); root = '';
  if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome;
  if (oldProvider === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = oldProvider;
});
function setup(providerId = 'anthropic') {
  root = mkdtempSync(join(tmpdir(), 'azrael-auto-switch-'));
  process.env.CODEX_HOME = root;
  process.env.OPENCODEX_HOME = join(root, 'azrael', 'providers', 'opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
  const accounts = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd'].map(id => ({ id, needsReauth: false,
    credential: { accountId: 'principal-' + id, access: 'fixture-access-' + id, refresh: 'fixture-refresh-' + id, projectId: 'fixture-project', apiBaseUrl: 'https://api.devin.ai', expires: Number.MAX_SAFE_INTEGER } }));
  const set = { activeAccountId: accounts[0]!.id, accounts };
  const config = { providers: { [providerId]: providerId === 'anthropic'
    ? { adapter: 'anthropic', authMode: 'oauth', baseUrl: 'https://api.anthropic.com' }
    : providerId === 'google-antigravity' ? { adapter: 'google', authMode: 'oauth', googleMode: 'cloud-code-assist', baseUrl: 'https://daily-cloudcode-pa.googleapis.com' }
    : { authMode: 'oauth' } } };
  const m: any = { config: { loadConfig: () => config }, store: { getAccountSet: (id: string) => id === providerId ? set : undefined },
    oauth: { OAUTH_PROVIDERS: { [providerId]: {} }, getValidAccessSnapshotForAccount: async (_id: string, accountId: string) => {
      const account = accounts.find(a => a.id === accountId)!; return { accessToken: account.credential.access, projectId: account.credential.projectId };
    } }, devinBase: { validateDevinApiBaseUrl: (url: string) => url === 'https://api.devin.ai' ? url : null },
    quota: { providerOAuthAccountQuotaMode: () => 'unsupported' }, registry: { PROVIDER_REGISTRY: [] } };
  return { accounts, set, config, m };
}
const req = (turn_id = 'current') => ({ provider_id: 'anthropic', thread_id: 'thread', turn_id, model: 'claude-fixture' });
const recovery = (extras: any = {}) => ({ providerId: 'anthropic', threadId: 'thread', turnId: 'current', model: 'claude-fixture', excludedAccountIds: [], expectedAccountId: 'aaaaaaaa', ...extras });
const io = { send: () => {}, answer: async () => null };
const bindingPath = () => join(root, 'azrael', 'providers', 'sessions', 'thread.json');

test('snapshot consent defaults false and persists by stable identity without credential contents', async () => {
  const { m, accounts } = setup();
  const list: any = await handleRequest({ protocol: 1, id: 'list', action: 'list' }, io, m);
  expect(list.providers[0].accounts.every((a: any) => a.autoSwitchAllowed === false)).toBeTrue();
  await handleRequest({ protocol: 1, id: 'enable', action: 'setAutoSwitch', providerId: 'anthropic', accountId: accounts[1]!.id, enabled: true }, io, m);
  expect(autoSwitchAllowed('anthropic', accounts[1])).toBeTrue();
  accounts[1]!.credential.access = 'rotated-access'; accounts[1]!.credential.refresh = 'rotated-refresh';
  expect(autoSwitchAllowed('anthropic', accounts[1])).toBeTrue();
  const text = readFileSync(join(process.env.OPENCODEX_HOME!, 'auto-switch.json'), 'utf8');
  expect(text).not.toContain('principal'); expect(text).not.toContain('access'); expect(text).not.toContain('refresh');
  accounts[1]!.credential.accountId = 'replaced-principal';
  expect(autoSwitchAllowed('anthropic', accounts[1])).toBeFalse();
  await expect(handleRequest({ protocol: 1, id: 'bad', action: 'setAutoSwitch', providerId: 'anthropic', accountId: accounts[0]!.id, enabled: 'true' }, io, m)).rejects.toThrow();
});

test('candidates preserve store order and exclude disabled, reauth, missing and exhausted identities', () => {
  const { m, accounts } = setup();
  for (const account of accounts) setAutoSwitch('anthropic', account.id, true, m);
  setAutoSwitch('anthropic', accounts[1]!.id, false, m);
  accounts[2]!.needsReauth = true;
  expect(eligibleAccounts('anthropic', m, new Set([accounts[0]!.id, 'missing'])) .map((a: any) => a.id)).toEqual(['dddddddd']);
  accounts[2]!.needsReauth = false;
  expect(eligibleAccounts('anthropic', m, new Set([accounts[0]!.id])) .map((a: any) => a.id)).toEqual(['cccccccc', 'dddddddd']);
  accounts[2]!.credential.refresh = '';
  expect(eligibleAccounts('anthropic', m, new Set([accounts[0]!.id, accounts[3]!.id]))).toEqual([]);
});

test('recovery changes only current turn and provider atomically, preserves historical pins and global selection', async () => {
  const { m, config, accounts, set } = setup();
  await pinAccount(config, req('history'), m); await pinAccount(config, req(), m);
  const original = JSON.parse(readFileSync(bindingPath(), 'utf8'));
  set.activeAccountId = accounts[3]!.id;
  setAutoSwitch('anthropic', accounts[1]!.id, true, m); setAutoSwitch('anthropic', accounts[2]!.id, true, m);
  expect(await recoverAccount(recovery(), m)).toEqual({ exhaustedAccountId: 'aaaaaaaa', accountId: 'bbbbbbbb' });
  const next = JSON.parse(readFileSync(bindingPath(), 'utf8'));
  expect(next.turns.history).toEqual(original.turns.history);
  expect(next.turns.current.account_id).toBe('bbbbbbbb'); expect(next.providers.anthropic.account_id).toBe('bbbbbbbb');
  expect(set.activeAccountId).toBe('dddddddd');
  await pinAccount(config, req('history'), m);
  expect(JSON.parse(readFileSync(bindingPath(), 'utf8')).providers.anthropic.account_id).toBe('bbbbbbbb');
  expect(await recoverAccount(recovery({ expectedAccountId: 'bbbbbbbb', excludedAccountIds: ['aaaaaaaa'] }), m)).toEqual({ exhaustedAccountId: 'bbbbbbbb', accountId: 'cccccccc' });
  expect(await recoverAccount(recovery({ expectedAccountId: 'cccccccc', excludedAccountIds: ['aaaaaaaa', 'bbbbbbbb'] }), m)).toBeNull();
});

test('stale account, turn and model or source fingerprint refuse recovery without writes', async () => {
  const { m, config, accounts } = setup(); await pinAccount(config, req(), m);
  setAutoSwitch('anthropic', accounts[1]!.id, true, m);
  const original = readFileSync(bindingPath(), 'utf8');
  for (const extras of [{ expectedAccountId: 'bbbbbbbb' }, { turnId: 'missing' }, { model: 'other' }]) {
    await expect(recoverAccount(recovery(extras), m)).rejects.toThrow('turn_selection_mismatch');
    expect(readFileSync(bindingPath(), 'utf8')).toBe(original);
  }
  accounts[0]!.credential.accountId = 'replacement';
  await expect(recoverAccount(recovery(), m)).rejects.toThrow('pinned_account_changed');
  expect(readFileSync(bindingPath(), 'utf8')).toBe(original);
});

test('binding lock and failed destination credential resolution leave complete original binding', async () => {
  const { m, config, accounts } = setup(); await pinAccount(config, req(), m);
  setAutoSwitch('anthropic', accounts[1]!.id, true, m);
  const original = readFileSync(bindingPath(), 'utf8');
  writeFileSync(bindingPath() + '.lock', '');
  await expect(recoverAccount(recovery(), m)).rejects.toThrow('binding_busy');
  rmSync(bindingPath() + '.lock');
  m.oauth.getValidAccessSnapshotForAccount = async (_id: string, id: string) => {
    if (id === accounts[1]!.id) throw new Error('fixture-auth-failure');
    return { accessToken: accounts[0]!.credential.access };
  };
  expect(await recoverAccount(recovery(), m)).toBeNull();
  expect(readFileSync(bindingPath(), 'utf8')).toBe(original);
});

test('Devin consent excludes CLI, resets with durable key replacement and returns identity without selecting', async () => {
  const { m, accounts, set } = setup('devin');
  setAutoSwitch('devin', accounts[1]!.id, true, m);
  expect(await recoverDevinAccount(recovery({ providerId: 'devin' }), m)).toEqual({ exhaustedAccountId: 'aaaaaaaa', accountId: 'bbbbbbbb' });
  expect(set.activeAccountId).toBe('aaaaaaaa');
  accounts[1]!.credential.access = 'replacement';
  expect(autoSwitchAllowed('devin', accounts[1])).toBeFalse();
  (accounts[2]!.credential as any).source = 'local-cli';
  expect(() => setAutoSwitch('devin', accounts[2]!.id, true, m)).toThrow();
  await expect(recoverDevinAccount(recovery({ providerId: 'devin', expectedAccountId: undefined }), m)).rejects.toThrow();
  expect(await recoverDevinAccount(recovery({ providerId: 'devin' }), m)).toBeNull();
});

test('policy writer lock prevents concurrent updates and malformed policy fails closed', () => {
  const { m, accounts } = setup();
  const path = join(process.env.OPENCODEX_HOME!, 'auto-switch.json');
  const database = new Database(prepareConfigMutationDatabasePathForWrite(), { create: true });
  database.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
  try { expect(() => setAutoSwitch('anthropic', accounts[1]!.id, true, m)).toThrow(); }
  finally { database.exec('ROLLBACK'); database.close(); }
  setAutoSwitch('anthropic', accounts[1]!.id, true, m);
  setAutoSwitch('anthropic', accounts[2]!.id, true, m);
  expect(autoSwitchAllowed('anthropic', accounts[1])).toBeTrue(); expect(autoSwitchAllowed('anthropic', accounts[2])).toBeTrue();
  writeFileSync(path, '{broken');
  expect(() => autoSwitchAllowed('anthropic', accounts[1])).toThrow();
});


test('Google recovery preserves project continuity and source/destination identity during credential resolution', async () => {
  const { m, accounts, config, set } = setup('google-antigravity');
  m.antigravity = { resolveAntigravityAccount: async (_provider: any, id: string) => {
    id ??= set.activeAccountId;
    const account = accounts.find(a => a.id === id)!;
    return { accountId: id, provider: { ...config.providers['google-antigravity'], apiKey: account.credential.access },
      fingerprint: createHash('sha256').update(JSON.stringify([id, account.credential.accountId, account.credential.projectId])).digest('hex') };
  } };
  const googleRequest = { ...req(), provider_id: 'google-antigravity' };
  await pinAccount(config, googleRequest, m);
  setAutoSwitch('google-antigravity', accounts[1]!.id, true, m);
  const recover = recovery({ providerId: 'google-antigravity' });
  const original = readFileSync(bindingPath(), 'utf8');
  const resolve = m.antigravity.resolveAntigravityAccount;
  m.antigravity.resolveAntigravityAccount = async (provider: any, id: string) => {
    const result = await resolve(provider, id);
    if (id === accounts[1]!.id) accounts[0]!.credential.projectId = 'changed-source-project';
    return result;
  };
  await expect(recoverAccount(recover, m)).rejects.toThrow('pinned_account_changed');
  expect(readFileSync(bindingPath(), 'utf8')).toBe(original);
  accounts[0]!.credential.projectId = 'fixture-project'; m.antigravity.resolveAntigravityAccount = resolve;
  expect(await recoverAccount(recover, m)).toEqual({ exhaustedAccountId: 'aaaaaaaa', accountId: 'bbbbbbbb' });
  accounts[1]!.credential.projectId = 'replaced-project';
  expect(autoSwitchAllowed('google-antigravity', accounts[1])).toBeFalse();
});


test('snapshot hides unavailable CLI and unusable accounts while retaining independent consent', async () => {
  const { m, accounts, config } = setup();
  setAutoSwitch('anthropic', accounts[1]!.id, true, m);
  (accounts[0]!.credential as any).source = 'local-cli';
  accounts[1]!.needsReauth = true;
  accounts[2]!.credential.refresh = '';
  const listed: any = await handleRequest({ protocol: 1, id: 'availability', action: 'list' }, io, m);
  expect(listed.providers[0].accounts.map((a: any) => a.autoSwitchAvailable)).toEqual([false, false, false, true]);
  expect(listed.providers[0].accounts[1].autoSwitchAllowed).toBeTrue();
  expect(() => setAutoSwitch('anthropic', accounts[1]!.id, true, m)).toThrow();
  (config.providers.anthropic as any).disabled = true;
  expect(autoSwitchAvailable('anthropic', accounts[3], m)).toBeFalse();
});

for (const providerId of ['anthropic', 'devin']) {
  test(providerId + ' skips failed B credential resolution and commits permitted C in store order', async () => {
    const { m, accounts, config, set } = setup(providerId);
    if (providerId === 'anthropic') await pinAccount(config, req(), m);
    setAutoSwitch(providerId, accounts[1]!.id, true, m); setAutoSwitch(providerId, accounts[2]!.id, true, m);
    const resolver = m.oauth.getValidAccessSnapshotForAccount;
    const attempts: string[] = [];
    m.oauth.getValidAccessSnapshotForAccount = async (id: string, accountId: string) => {
      if (accountId !== accounts[0]!.id) attempts.push(accountId);
      if (accountId === accounts[1]!.id) throw new Error('fixture-destination-reauth');
      return resolver(id, accountId);
    };
    const request = recovery({ providerId, model: providerId === 'devin' ? 'devin/fixture-model' : 'claude-fixture' });
    const recover = providerId === 'devin' ? recoverDevinAccount : recoverAccount;
    expect(await recover(request, m)).toEqual({ exhaustedAccountId: 'aaaaaaaa', accountId: 'cccccccc' });
    expect(attempts[0]).toBe('bbbbbbbb'); expect(attempts[1]).toBe('cccccccc');
    expect(attempts.filter(id => id === 'bbbbbbbb')).toHaveLength(1);
    expect(set.activeAccountId).toBe('aaaaaaaa');
    if (providerId === 'anthropic') expect(JSON.parse(readFileSync(bindingPath(), 'utf8')).providers.anthropic.account_id).toBe('cccccccc');
  });
  test(providerId + ' skips invalid B credential result but stops if source identity changes', async () => {
    const { m, accounts, config } = setup(providerId);
    if (providerId === 'anthropic') await pinAccount(config, req(), m);
    setAutoSwitch(providerId, accounts[1]!.id, true, m); setAutoSwitch(providerId, accounts[2]!.id, true, m);
    const originalBinding = providerId === 'anthropic' ? readFileSync(bindingPath(), 'utf8') : '';
    const resolver = m.oauth.getValidAccessSnapshotForAccount;
    m.oauth.getValidAccessSnapshotForAccount = async (id: string, accountId: string) => accountId === accounts[1]!.id ? { accessToken: '' } : resolver(id, accountId);
    const recover = providerId === 'devin' ? recoverDevinAccount : recoverAccount;
    expect(await recover(recovery({ providerId }), m)).toEqual({ exhaustedAccountId: 'aaaaaaaa', accountId: 'cccccccc' });
    if (providerId === 'anthropic') writeFileSync(bindingPath(), originalBinding);
    m.oauth.getValidAccessSnapshotForAccount = async (id: string, accountId: string) => {
      if (accountId === accounts[1]!.id) { accounts[0]!.credential.accountId = 'replaced-source'; throw new Error('fixture-destination-failure'); }
      return resolver(id, accountId);
    };
    await expect(recover(recovery({ providerId }), m)).rejects.toThrow();
  });
}


test('pin and recovery reclaim abandoned locks after the credential lease but never steal a live competing lock', async () => {
  const { m, accounts, config } = setup();
  const directory = join(root, 'azrael', 'providers', 'sessions'); mkdirSync(directory, { recursive: true });
  const lock = bindingPath() + '.lock';
  const abandon = () => {
    const createdAt = Date.now() - 180_000;
    writeFileSync(lock, JSON.stringify({ version: 1, ownerId: 'abandoned-helper', pid: 99999999, createdAt }));
    const age = new Date(createdAt); utimesSync(lock, age, age);
  };
  abandon(); await pinAccount(config, req(), m); expect(existsSync(lock)).toBeFalse();
  setAutoSwitch('anthropic', accounts[1]!.id, true, m);
  const original = readFileSync(bindingPath(), 'utf8');
  const live = await createOAuthFileLock({ path: lock, waitTimeoutMs: 0, staleAfterMs: 120_000 }).acquire();
  const liveMetadata = readFileSync(lock, 'utf8');
  try {
    await expect(pinAccount(config, req('another'), m)).rejects.toThrow('binding_busy');
    await expect(recoverAccount(recovery(), m)).rejects.toThrow('binding_busy');
    expect(readFileSync(lock, 'utf8')).toBe(liveMetadata);
    expect(readFileSync(bindingPath(), 'utf8')).toBe(original);
  } finally { live.release(); }
  abandon();
  expect(await recoverAccount(recovery(), m)).toEqual({ exhaustedAccountId: 'aaaaaaaa', accountId: 'bbbbbbbb' });
  expect(existsSync(lock)).toBeFalse();
});


test('opt-out immediately before coordinated final commit leaves the managed binding unchanged', async () => {
  const { m, accounts, config } = setup(); await pinAccount(config, req(), m);
  setAutoSwitch('anthropic', accounts[1]!.id, true, m);
  const original = readFileSync(bindingPath(), 'utf8');
  let admission = 0;
  // Injected config coordination is the existing seam; opt-out wins admission.
  m.config.withConfigMutationLockSync = (operation: () => unknown) => {
    admission++;
    delete m.config.withConfigMutationLockSync;
    setAutoSwitch('anthropic', accounts[1]!.id, false, m);
    return withConfigMutationLockSync(operation);
  };
  expect(await recoverAccount(recovery(), m)).toBeNull();
  expect(admission).toBe(1);
  expect(autoSwitchAllowed('anthropic', accounts[1])).toBeFalse();
  expect(readFileSync(bindingPath(), 'utf8')).toBe(original);
});


test('Devin recovery credential admission rejects revoked or replaced advisory identity without fallback', async () => {
  const { m, accounts, set } = setup('devin');
  const candidate = accounts[1]!;
  setAutoSwitch('devin', candidate.id, true, m);
  expect(await recoverDevinAccount(recovery({ providerId: 'devin' }), m)).toEqual({ exhaustedAccountId: 'aaaaaaaa', accountId: candidate.id });
  const credential = { protocol: 1 as const, id: 'credential', action: 'credential', providerId: 'devin', accountId: candidate.id, requireAutoSwitch: true };
  setAutoSwitch('devin', candidate.id, false, m);
  await expect(handleRequest(credential, io, m)).rejects.toThrow();
  expect(set.activeAccountId).toBe(accounts[0]!.id);
  setAutoSwitch('devin', candidate.id, true, m);
  candidate.credential.access = 'replaced-durable-key';
  await expect(handleRequest(credential, io, m)).rejects.toThrow();
  await expect(handleRequest({ ...credential, accountId: undefined }, io, m)).rejects.toThrow();
  expect(set.activeAccountId).toBe(accounts[0]!.id);
});

test('Devin admitted credentials use one permitted snapshot and ordinary credential reads retain default selection', async () => {
  const { m, accounts } = setup('devin');
  const candidate = accounts[1]!;
  const ordinary = { protocol: 1 as const, id: 'ordinary', action: 'credential', providerId: 'devin' };
  expect(await handleRequest(ordinary, io, m)).toEqual({ api_key: accounts[0]!.credential.access, api_server_url: 'https://api.devin.ai', account_id: accounts[0]!.id });
  setAutoSwitch('devin', candidate.id, true, m);
  const credential = { ...ordinary, accountId: candidate.id, requireAutoSwitch: true };
  expect(await handleRequest(credential, io, m)).toEqual({ api_key: candidate.credential.access, api_server_url: candidate.credential.apiBaseUrl, account_id: candidate.id });
  setAutoSwitch('devin', candidate.id, false, m);
  expect(await handleRequest({ ...credential, requireAutoSwitch: false }, io, m)).toEqual({ api_key: candidate.credential.access, api_server_url: candidate.credential.apiBaseUrl, account_id: candidate.id });
});
