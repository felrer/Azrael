import { createHash } from 'node:crypto';
import { getAccountSet } from './vendor/src/oauth/store.ts';
import { getValidAccessSnapshotForAccount } from './vendor/src/oauth/index.ts';
import { routedProviderConfig } from './vendor/src/router.ts';
import { ANTIGRAVITY_MODELS } from './vendor/src/providers/antigravity-models.ts';
import { isManagedOAuthTransport } from './inference-config.ts';
import { fail } from './inference-mapping.mjs';

const ID = 'google-antigravity';

// Resolve bearer and CCA project from the same account snapshot. Catalog building
// only inspects configured models and must not refresh tokens or change selection.
export async function resolveAntigravityAccount(configured: any, pinnedId?: string, refresh = true) {
  if (!isManagedOAuthTransport(ID, configured)) fail('provider_unavailable');
  const set = getAccountSet(ID);
  const accountId = pinnedId ?? set?.activeAccountId;
  const account = set?.accounts.find(row => row.id === accountId);
  if (!account) fail('pinned_account_missing');
  if (account.needsReauth || !account.credential.refresh || !account.credential.projectId) fail('pinned_account_unavailable');
  let snapshot;
  try {
    snapshot = refresh
      ? await getValidAccessSnapshotForAccount(ID, account.id, { requireUsableAccount: true })
      : { accessToken: account.credential.access, projectId: account.credential.projectId };
  } catch { fail('pinned_account_unavailable'); }
  if (!snapshot.accessToken || !snapshot.projectId) fail('pinned_account_unavailable');
  const provider = routedProviderConfig(ID, { ...configured, models: configured.models ?? ANTIGRAVITY_MODELS, apiKey: snapshot.accessToken, apiKeyPool: undefined, _apiKeyAttempt: undefined, project: snapshot.projectId });
  if (!isManagedOAuthTransport(ID, provider)) fail('unsupported_provider_transport');
  // Token generations rotate; account slot, principal, project and transport do not.
  const fingerprint = createHash('sha256').update(JSON.stringify([
    ID, account.id, account.credential.accountId ?? account.credential.email,
    snapshot.projectId, configured.baseUrl, provider.baseUrl, provider.headers,
  ])).digest('hex');
  return { accountId: account.id, provider, fingerprint };
}
