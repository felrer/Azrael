import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { handleRequest } from '../helper.ts';
import { accountIdentity, autoSwitchAllowed, autoSwitchAvailable, setAutoSwitch } from '../auto-switch.ts';
import { pinAccount } from '../inference.ts';
import { retirementStatus, retireAccount } from '../retirement.ts';
import * as store from '../vendor/src/oauth/store.ts';
import * as config from '../vendor/src/config.ts';
import * as oauth from '../vendor/src/oauth/index.ts';
import * as quota from '../vendor/src/providers/quota.ts';
import * as registry from '../vendor/src/providers/registry.ts';
import * as devinBase from '../vendor/src/oauth/devin/api-base.ts';

const providerId = 'meta-muse';
const key = (n: number) => `LLM|${n}|synthetic_key_${n}`;
const request = (action: string, extra: any = {}) => ({ protocol: 1 as const, id: 'meta-fixture', action, providerId, ...extra });
const io = { send() {}, async answer() { return null; } };
let fixtureConfig: any;
const m = () => ({ store, config: { ...config, loadConfig: () => fixtureConfig, withConfigMutationLockSync: config.withConfigMutationLockSync }, oauth, quota, registry, devinBase });
const tracked = ['CODEX_HOME', 'OPENCODEX_HOME', 'AZRAEL_PROVIDER_INFERENCE_HELPER', 'AZRAEL_PROVIDER_BUN'];
let root: string;
let previous: Record<string, string | undefined>;
let originalFetch: typeof fetch;
beforeEach(() => {
  previous = Object.fromEntries(tracked.map(name => [name, process.env[name]]));
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as unknown as typeof fetch;
  root = mkdtempSync(join(tmpdir(), 'azrael-meta-accounts-'));
  process.env.CODEX_HOME = root;
  process.env.OPENCODEX_HOME = join(root, 'azrael', 'providers', 'opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
  const runtime = join(root, 'runtime-fixture'); writeFileSync(runtime, 'fixture');
  process.env.AZRAEL_PROVIDER_BUN = runtime; process.env.AZRAEL_PROVIDER_INFERENCE_HELPER = runtime;
  fixtureConfig = { providers: { [providerId]: { adapter: 'openai-responses', authMode: 'oauth', baseUrl: 'https://api.meta.ai/v1' } } };
}, 30_000);
afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true });
  for (const name of tracked) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
}, 30_000);
async function save(n: number) {
  await store.saveCredential(providerId, { access: key(n), refresh: key(n), expires: Number.MAX_SAFE_INTEGER }, { preserveIdentityless: true });
  return store.getAccountSet(providerId)!.accounts.find(a => a.credential.access === key(n))!;
}
const listed = async () => await handleRequest(request('list'), io, m()) as any;

test('Meta listing exposes no key and readiness requires usable selected key, transport and runtime', async () => {
  const account = await save(1);
  const connected = async () => (await listed()).providers.find((p: any) => p.id === providerId)?.inferenceConnected;
  const snapshot = await listed();
  expect(snapshot.availableProviders.some((p: any) => p.id === providerId)).toBeTrue();
  expect(await connected()).toBeTrue();
  expect(JSON.stringify(snapshot)).not.toContain(key(1));
  expect(snapshot.providers.find((p: any) => p.id === providerId).accounts[0].autoSwitchAllowed).toBeFalse();
  await store.markAccountNeedsReauth(providerId, account.id, true); expect(await connected()).toBeFalse();
  await store.markAccountNeedsReauth(providerId, account.id, false);
  delete process.env.AZRAEL_PROVIDER_BUN; expect(await connected()).toBeFalse();
  process.env.AZRAEL_PROVIDER_BUN = join(root, 'runtime-fixture');
  const cfg = fixtureConfig;
  for (const change of [{ disabled: true }, { adapter: 'openai-chat' }, { baseUrl: 'https://api.meta.ai/v1/' }, { authMode: 'key' }]) {
    fixtureConfig = { ...cfg, providers: { ...cfg.providers, [providerId]: { ...cfg.providers[providerId], ...change } } };
    expect(await connected()).not.toBeTrue();
  }
  fixtureConfig = cfg;
  await store.saveAccountCredential(providerId, account.id, { ...account.credential, refresh: 'different' });
  expect(await connected()).toBeFalse();
}, 30_000);

test('Meta consent binds exact static key independent of source or email and replacement invalidates it', async () => {
  const account = await save(1);
  const hash = createHash('sha256').update(key(1)).digest('hex');
  expect(accountIdentity(providerId, account)).toBe(createHash('sha256').update(JSON.stringify([providerId, account.id, 'apiKeySha256', hash])).digest('hex'));
  expect(autoSwitchAvailable(providerId, account, m())).toBeTrue();
  setAutoSwitch(providerId, account.id, true, m()); expect(autoSwitchAllowed(providerId, account)).toBeTrue();
  expect(readFileSync(join(process.env.OPENCODEX_HOME!, 'auto-switch.json'), 'utf8')).not.toContain(key(1));
  const annotated = { ...account, credential: { ...account.credential, source: 'local-cli', email: 'synthetic@example.invalid' } };
  expect(autoSwitchAllowed(providerId, annotated)).toBeTrue();
  const replaced = { ...account, credential: { ...account.credential, access: key(2), refresh: key(2) } };
  expect(autoSwitchAllowed(providerId, replaced)).toBeFalse();
  for (const access of ['not-a-key', 'LLM|1|short']) expect(accountIdentity(providerId, { ...account, credential: { access, refresh: access } })).toBeNull();
}, 30_000);

test('Meta login warning cancels before vendor login, guards unsupported provider and retains manual fallback', async () => {
  let calls = 0;
  const prompts: string[] = [], events: any[] = [];
  const fake = { ...m(), oauth: { ...oauth, runLogin: async (id: string, ctrl: any, options: any, persistence: any) => {
    calls++; expect(id).toBe(providerId); expect(options).toEqual({ forceLogin: true, reauthAccountId: 'aaaaaaaa' });
    ctrl.onAuth({ url: 'https://example.invalid/meta', deviceCode: 'fixture-code', instructions: 'Acknowledge fixture device flow' });
    expect(await ctrl.onManualCodeInput()).toBe(key(1));
    expect(ctrl.signal.aborted).toBeFalse();
    await persistence.saveCredential(id, { access: key(1), refresh: key(1), expires: Number.MAX_SAFE_INTEGER }, {});
  } } } as any;
  await expect(handleRequest(request('login'), { send() {}, async answer(prompt) { prompts.push(prompt); return null; } }, fake)).rejects.toThrow('Provider login failed');
  expect(calls).toBe(0); expect(prompts[0]).toContain('experimental'); expect(prompts[0]).toContain('billing'); expect(prompts[0]).toContain('not been verified');
  await expect(handleRequest(request('login', { providerId: 'xai' }), io, fake)).rejects.toThrow('not supported');
  await handleRequest(request('login', { accountId: 'aaaaaaaa' }), { send(value) { events.push(value); }, async readAnswer() { return 'opened'; }, async answer(prompt, password) { prompts.push(prompt); return password ? key(1) : 'continue'; } }, fake);
  expect(calls).toBe(1); expect(events[0].type).toBe('openUrl'); expect(store.listAccounts(providerId)).toHaveLength(1);
  const cancellation = { ...fake, oauth: { ...fake.oauth, runLogin: async (_id: string, ctrl: any) => {
    ctrl.onAuth({ url: 'https://example.invalid/meta' });
    await expect(ctrl.onManualCodeInput()).rejects.toThrow('cancelled'); expect(ctrl.signal.aborted).toBeTrue();
  } } };
  await expect(handleRequest(request('login'), { send() {}, async answer() { return 'continue'; }, async readAnswer() { return null; } }, cancellation)).rejects.toThrow('Provider login failed');
}, 30_000);

test('Meta select, remove and retirement prefer consent while preserving stopped turn bindings', async () => {
  const accounts = [await save(1), await save(2), await save(3)];
  await handleRequest(request('select', { accountId: accounts[0]!.id }), io, m());
  expect(store.getAccountSet(providerId)!.activeAccountId).toBe(accounts[0]!.id);
  await expect(handleRequest(request('select', { accountId: 'aaaaaaaa' }), io, m())).rejects.toThrow('not found');
  await pinAccount(fixtureConfig, { provider_id: providerId, thread_id: 'meta-thread', turn_id: 'stopped', model: 'muse-fixture' }, m());
  const path = join(root, 'azrael', 'providers', 'sessions', 'meta-thread.json');
  const before = JSON.parse(readFileSync(path, 'utf8'));
  setAutoSwitch(providerId, accounts[2]!.id, true, m());
  await handleRequest(request('remove', { accountId: accounts[0]!.id }), io, m());
  expect(store.getAccountSet(providerId)!.activeAccountId).toBe(accounts[2]!.id);
  expect(retirementStatus({ threads: [{ threadId: 'meta-thread', providerId, turnId: 'stopped' }] }, m()).bindings[0].status).toBe('removed');
  expect(await retireAccount({ providerId, threadId: 'meta-thread', expectedAccountId: accounts[0]!.id, reason: 'removed' }, m())).toEqual({ retiredAccountId: accounts[0]!.id, accountId: accounts[2]!.id });
  const after = JSON.parse(readFileSync(path, 'utf8'));
  expect(after.turns).toEqual(before.turns); expect(after.providers[providerId].account_id).toBe(accounts[2]!.id);
  expect(readFileSync(path, 'utf8')).not.toContain(key(3));
}, 30_000);
