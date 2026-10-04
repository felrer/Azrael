import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { withConfigMutationLockSync } from './vendor/src/config.ts';
import { validateIsolatedHomeForTests } from './helper.ts';
import { isManagedOAuthTransport, managedClaudeIdentity } from './inference-config.ts';

const providers = ['devin', 'anthropic', 'google-antigravity'];
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = () => { throw new Error('Invalid provider account request'); };
type Policies = Record<string, Record<string, string>>;
function policyPath() {
  const home = validateIsolatedHomeForTests();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const rel = relative(realpathSync(process.env.CODEX_HOME!), realpathSync(home));
  if (rel.startsWith('..') || isAbsolute(rel)) invalid();
  return join(home, 'auto-switch.json');
}
function readPolicy(path: string): Policies {
  if (!existsSync(path)) return Object.create(null);
  const rel = relative(realpathSync(join(path, '..')), realpathSync(path));
  if (rel.startsWith('..') || isAbsolute(rel) || statSync(path).size > 1024 * 1024) invalid();
  let value: any;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { invalid(); }
  if (!value || value.version !== 1 || !value.providers || typeof value.providers !== 'object' || Array.isArray(value.providers)
      || Object.keys(value).some(key => !['version', 'providers'].includes(key))) invalid();
  const result: Policies = Object.create(null);
  for (const [providerId, accounts] of Object.entries(value.providers)) {
    if (!providers.includes(providerId) || !accounts || typeof accounts !== 'object' || Array.isArray(accounts)) invalid();
    result[providerId] = Object.create(null);
    for (const [id, fingerprint] of Object.entries(accounts!)) {
      if (!/^(?:[a-f0-9]{8}|[a-f0-9]{32})$/.test(id) || typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) invalid();
      result[providerId][id] = fingerprint as string;
    }
  }
  return result;
}
// Persist only a digest of stable identity. Token rotation retains managed consent;
// replacing a durable Devin key resets it, since the key is its credential lease.
export function accountIdentity(providerId: string, account: any): string | null {
  const c = account?.credential;
  if (!providers.includes(providerId) || !account || !c || c.source === 'local-cli' || c.source === 'cli') return null;
  const principal = managedClaudeIdentity(c);
  if (!principal) return null;
  if (providerId === 'anthropic') return digest([providerId, account.id, ...principal]);
  if (providerId === 'google-antigravity') return c.projectId ? digest([providerId, account.id, ...principal, c.projectId]) : null;
  return c.access && c.apiBaseUrl ? digest([providerId, account.id, ...principal, c.apiBaseUrl, c.access]) : null;
}
export function autoSwitchAllowed(providerId: string, account: any): boolean {
  const identity = accountIdentity(providerId, account);
  return !!identity && readPolicy(policyPath())[providerId]?.[account.id] === identity;
}
export function autoSwitchAvailable(providerId: string, account: any, m: any): boolean {
  const provider = m.config.loadConfig().providers[providerId];
  const supported = providers.includes(providerId) && (providerId === 'devin'
    ? provider?.disabled !== true && (!provider || provider.authMode === 'oauth')
    : isManagedOAuthTransport(providerId, provider));
  return supported && !!accountIdentity(providerId, account) && account.needsReauth !== true
    && !!account.credential?.access && !!account.credential?.refresh
    && (providerId !== 'devin' || !!m.devinBase.validateDevinApiBaseUrl(account.credential.apiBaseUrl));
}
export function withAutoSwitchPolicyMutation<T>(m: any, operation: () => T): T {
  const coordinate = m.config.withConfigMutationLockSync ?? withConfigMutationLockSync;
  return coordinate(operation);
}
export function setAutoSwitch(providerId: string, accountId: string, enabled: boolean, m: any) {
  const provider = m.config.loadConfig().providers[providerId];
  if (!providers.includes(providerId) || (providerId === 'devin' ? provider?.disabled || (provider && provider.authMode !== 'oauth') : !isManagedOAuthTransport(providerId, provider))) invalid();
  const account = m.store.getAccountSet(providerId)?.accounts.find((entry: any) => entry.id === accountId);
  const identity = accountIdentity(providerId, account);
  if (!identity || !/^(?:[a-f0-9]{8}|[a-f0-9]{32})$/.test(accountId)) invalid();
  if (enabled && !autoSwitchAvailable(providerId, account, m)) invalid();
  const path = policyPath();
  // SQLite's nonblocking transaction is released by the OS on helper exit.
  return withAutoSwitchPolicyMutation(m, () => {
    const policies = readPolicy(path);
    const current = m.store.getAccountSet(providerId)?.accounts.find((entry: any) => entry.id === accountId);
    if (accountIdentity(providerId, current) !== identity || (enabled && !autoSwitchAvailable(providerId, current, m))) invalid();
    policies[providerId] ??= Object.create(null);
    if (enabled) policies[providerId][accountId] = identity; else delete policies[providerId][accountId];
    const temporary = path + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, providers: policies }), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, path);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    return null;
  });
}
export function eligibleAccounts(providerId: string, m: any, excluded: Set<string>) {
  return (m.store.getAccountSet(providerId)?.accounts ?? []).filter((account: any) => !excluded.has(account.id)
    && autoSwitchAvailable(providerId, account, m) && autoSwitchAllowed(providerId, account)).slice(0, 1024);
}
export async function recoverDevinAccount(request: any, m: any) {
  if (request.providerId !== 'devin' || typeof request.expectedAccountId !== 'string'
      || !/^(?:[a-f0-9]{8}|[a-f0-9]{32})$/.test(request.expectedAccountId)
      || typeof request.threadId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(request.threadId)
      || typeof request.turnId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(request.turnId)
      || typeof request.model !== 'string' || !request.model.trim() || Buffer.byteLength(request.model) > 256 || /[\x00-\x1f\x7f-\x9f]/.test(request.model)
      || !Array.isArray(request.excludedAccountIds) || request.excludedAccountIds.length > 1024
      || request.excludedAccountIds.some((id: any) => typeof id !== 'string')) invalid();
  const config = m.config.loadConfig().providers.devin;
  if (config?.disabled || (config && config.authMode !== 'oauth')) invalid();
  const source = m.store.getAccountSet('devin')?.accounts.find((entry: any) => entry.id === request.expectedAccountId);
  const identity = accountIdentity('devin', source);
  if (!identity || source.needsReauth || !source.credential.refresh || !m.devinBase.validateDevinApiBaseUrl(source.credential.apiBaseUrl)) invalid();
  const validateSource = () => {
    const current = m.store.getAccountSet('devin')?.accounts.find((entry: any) => entry.id === source.id);
    if (accountIdentity('devin', current) !== identity || !autoSwitchAvailable('devin', current, m)) invalid();
  };
  for (const candidate of eligibleAccounts('devin', m, new Set([source.id, ...request.excludedAccountIds]))) {
    validateSource();
    const candidateIdentity = accountIdentity('devin', candidate);
    let snapshot;
    try { snapshot = await m.oauth.getValidAccessSnapshotForAccount('devin', candidate.id, { requireUsableAccount: true }); }
    catch { validateSource(); continue; }
    validateSource();
    const current = m.store.getAccountSet('devin')?.accounts.find((entry: any) => entry.id === candidate.id);
    if (!snapshot.accessToken || snapshot.accessToken !== current?.credential?.access || !autoSwitchAvailable('devin', current, m)
        || accountIdentity('devin', current) !== candidateIdentity || !autoSwitchAllowed('devin', current)) continue;
    return { exhaustedAccountId: source.id, accountId: candidate.id };
  }
  validateSource();
  return null;
}
