import { existsSync, statSync, realpathSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { accountIdentity, autoSwitchAvailable, autoSwitchAllowed } from './auto-switch.ts';
import { readBinding, resolvePin } from './inference.ts';
import { validateIsolatedHomeForTests } from './helper.ts';

const providers = ['anthropic', 'google-antigravity', 'devin'];
const safeId = (id: any) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
const accountId = (id: any) => typeof id === 'string' && /^(?:[a-f0-9]{8}|[a-f0-9]{32})$/.test(id);
const invalid = () => { throw new Error('Invalid provider account request'); };
function existsOrAbsent(path: string) {
  try { statSync(path); return true; }
  catch (error: any) { if (error?.code === 'ENOENT') return false; throw new Error('Provider binding storage is unavailable'); }
}
function pathFor(threadId: string) {
  validateIsolatedHomeForTests();
  const directory = join(process.env.CODEX_HOME!, 'azrael', 'providers', 'sessions');
  if (existsOrAbsent(directory)) {
    const rel = relative(realpathSync(process.env.CODEX_HOME!), realpathSync(directory));
    if (rel.startsWith('..') || isAbsolute(rel)) invalid();
  }
  return { directory, path: join(directory, threadId + '.json') };
}
export function sourceStatus(store: any, providerId: string, id: string) {
  const source = store[providerId]?.accounts.find((entry: any) => entry.id === id);
  return !source ? 'removed' : source.needsReauth === true ? 'reauth' : 'available';
}
export function retirementStatus(request: any, m: any) {
  if (!Array.isArray(request.threads) || request.threads.length > 256) invalid();
  let store: any;
  return { bindings: request.threads.map((row: any) => {
    if (!safeId(row?.threadId) || !providers.includes(row?.providerId)
      || (row.accountId !== undefined && (row.providerId !== 'devin' || !accountId(row.accountId)))
      || (row.turnId !== undefined && (row.providerId === 'devin' || !safeId(row.turnId)))) invalid();
    let id: string | null;
    if (row.providerId === 'devin') id = row.accountId ?? null;
    else {
      const { path, directory } = pathFor(row.threadId);
      const binding = existsOrAbsent(path) ? readBinding(path, row.threadId, directory) : null;
      if (row.turnId !== undefined) {
        const turn = binding?.turns[row.turnId];
        if (turn && turn.provider_id !== row.providerId) invalid();
        id = turn?.account_id ?? null;
      } else id = binding?.providers[row.providerId]?.account_id ?? null;
    }
    return { threadId: row.threadId, providerId: row.providerId, accountId: id,
      status: id === null ? 'unbound' : sourceStatus(store ??= m.store.readAuthStoreForRetirement(), row.providerId, id) };
  }) };
}
export function retirementCandidates(providerId: string, excluded: string, m: any) {
  const accounts = m.store.readAuthStoreForRetirement()[providerId]?.accounts ?? [];
  return accounts.filter((entry: any) => entry.id !== excluded && autoSwitchAvailable(providerId, entry, m))
    .map((entry: any, index: number) => ({ entry, index, preferred: autoSwitchAllowed(providerId, entry) }))
    .sort((a: any, b: any) => Number(b.preferred) - Number(a.preferred) || a.index - b.index).slice(0, 1024).map((row: any) => row.entry);
}
async function resolveCandidate(providerId: string, candidate: any, m: any) {
  const identity = accountIdentity(providerId, candidate);
  let fingerprint: string;
  if (providerId === 'devin') {
    const snapshot = await m.oauth.getValidAccessSnapshotForAccount(providerId, candidate.id, { requireUsableAccount: true });
    const current = m.store.readAuthStoreForRetirement()[providerId]?.accounts.find((a: any) => a.id === candidate.id);
    if (!snapshot.accessToken || snapshot.accessToken !== current?.credential.access) invalid();
    fingerprint = identity!;
  } else fingerprint = (await resolvePin(m.config.loadConfig(), providerId, { account_id: candidate.id } as any, m)).fingerprint;
  const fresh = m.store.readAuthStoreForRetirement()[providerId]?.accounts.find((a: any) => a.id === candidate.id);
  if (!identity || accountIdentity(providerId, fresh) !== identity || !autoSwitchAvailable(providerId, fresh, m)) invalid();
  return { accountId: candidate.id, generation: m.store.credentialGeneration(fresh.credential), fingerprint };
}
export async function retireAccount(request: any, m: any) {
  const { providerId, expectedAccountId, reason, threadId, turnId } = request;
  if (!providers.includes(providerId) || !accountId(expectedAccountId) || !safeId(threadId) || !['removed', 'revoked'].includes(reason)
    || (turnId !== undefined && (providerId === 'devin' || !safeId(turnId)))) invalid();
  const { directory, path } = pathFor(threadId);
  const guard = providerId === 'devin' ? null : await m.store.createOAuthFileLock({ path: path + '.lock', waitTimeoutMs: 0, staleAfterMs: 120_000 }).acquire();
  try {
    const binding = providerId === 'devin' ? null : readBinding(path, threadId, directory);
    const sourcePin = binding && (turnId === undefined ? binding.providers[providerId] : binding.turns[turnId]);
    if (binding && (!sourcePin || sourcePin.account_id !== expectedAccountId
      || (turnId !== undefined && binding.turns[turnId]?.provider_id !== providerId))) invalid();
    const status = () => sourceStatus(m.store.readAuthStoreForRetirement(), providerId, expectedAccountId);
    const required = reason === 'removed' ? 'removed' : 'reauth';
    if (status() !== required) invalid();
    const source = m.store.readAuthStoreForRetirement()[providerId]?.accounts.find((entry: any) => entry.id === expectedAccountId);
    const sourceGeneration = source ? m.store.credentialGeneration(source.credential) : undefined;
    const futurePin = binding?.providers[providerId];
    let failedFutureAccountId: string | undefined;
    if (futurePin && futurePin.account_id !== expectedAccountId) {
      // Another watcher already retired this source. Validate its chosen future
      // binding, while leaving immutable turn attribution and manual selection intact.
      const destination = m.store.readAuthStoreForRetirement()[providerId]?.accounts.find((entry: any) => entry.id === futurePin.account_id);
      let resolved: Awaited<ReturnType<typeof resolveCandidate>> | null = null;
      if (destination) {
        try { resolved = await resolveCandidate(providerId, destination, m); }
        catch { /* A second retirement can invalidate the peer's future choice. */ }
      }
      if (status() !== required) invalid();
      if (resolved?.fingerprint === futurePin.fingerprint
        && await m.store.commitAccountRetirement(providerId, expectedAccountId, reason, resolved, () => {}, sourceGeneration, undefined, true)) {
        return { retiredAccountId: expectedAccountId, accountId: resolved.accountId };
      }
      failedFutureAccountId = futurePin.account_id;
    }
    const candidates = retirementCandidates(providerId, expectedAccountId, m).filter((entry: any) => entry.id !== failedFutureAccountId);
    for (const candidate of [...candidates, null]) {
      let resolved: Awaited<ReturnType<typeof resolveCandidate>> | null = null;
      if (candidate) {
        try { resolved = await resolveCandidate(providerId, candidate, m); }
        catch { if (status() !== required) invalid(); continue; }
      }
      if (status() !== required) invalid();
      const committed = await m.store.commitAccountRetirement(providerId, expectedAccountId, reason, resolved, () => {
        if (!binding || !resolved) return;
        binding.providers[providerId] = { account_id: resolved.accountId, fingerprint: resolved.fingerprint };
        const temporary = path + '.' + randomUUID() + '.tmp';
        try { writeFileSync(temporary, JSON.stringify(binding), { mode: 0o600, flag: 'wx' }); renameSync(temporary, path); }
        finally { if (existsSync(temporary)) unlinkSync(temporary); }
      }, sourceGeneration);
      if (committed) return { retiredAccountId: expectedAccountId, accountId: resolved?.accountId ?? null };
    }
    invalid();
  } finally { guard?.release(); }
}
/** Removal is durable before any replacement refresh or discovery starts. */
export async function selectAfterRemoval(providerId: string, removedId: string, m: any) {
  for (const candidate of retirementCandidates(providerId, removedId, m)) {
    let resolved;
    try { resolved = await resolveCandidate(providerId, candidate, m); } catch { continue; }
    if (await m.store.commitAccountRetirement(providerId, removedId, 'removed', resolved, () => {}, undefined, '')) return;
  }
}
