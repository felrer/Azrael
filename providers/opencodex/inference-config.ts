import { createHash } from 'node:crypto';
import { getProviderRegistryEntry } from './vendor/src/providers/registry.ts';

export const MANAGED_PROVIDERS = ['google-antigravity', 'anthropic', 'meta-muse'];

// Azrael-owned additions to the vendored roster. Use the same metadata for
// discovery and pinned requests so advertised efforts match the wire.
export function managedMetaRegistry() {
  const registry = getProviderRegistryEntry('meta-muse')!;
  const model = 'muse-wonder-1.0';
  const efforts = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  return { ...registry,
    models: [...new Set([...registry.models!, model])],
    modelContextWindows: { ...registry.modelContextWindows, [model]: 1_048_576 },
    modelInputModalities: { ...registry.modelInputModalities, [model]: ['text', 'image'] as ['text', 'image'] },
    modelReasoningEfforts: { ...registry.modelReasoningEfforts, [model]: efforts },
    modelReasoningEffortMap: { ...registry.modelReasoningEffortMap,
      [model]: Object.fromEntries(efforts.map(effort => [effort, effort])) },
  };
}

// Muse credentials are static keys. Bind to a digest, including manual keys
// without an email, so replacing a key invalidates its old conversation lease.
export function managedMetaIdentity(credential: any): [string, string] | null {
  const key = credential?.access;
  return typeof key === 'string' && /^LLM\|\d+\|[A-Za-z0-9_-]{10,}$/.test(key)
    && credential.refresh === key
    ? ['apiKeySha256', createHash('sha256').update(key).digest('hex')] : null;
}

export function managedClaudeIdentity(credential: any): [string, string] | null {
  if (typeof credential?.accountId === 'string' && credential.accountId.trim()) return ['accountId', credential.accountId];
  if (typeof credential?.email === 'string' && credential.email.trim()) return ['email', credential.email];
  return null;
}

export function isManagedOAuthTransport(id: string, provider: any): boolean {
  return (id === 'anthropic' && provider?.disabled !== true && provider?.adapter === 'anthropic'
    && provider.authMode === 'oauth' && provider.baseUrl === 'https://api.anthropic.com')
    || id === 'google-antigravity' && provider?.disabled !== true
    && provider?.adapter === 'google' && provider.authMode === 'oauth'
    && provider.googleMode === 'cloud-code-assist'
    || id === 'meta-muse' && provider?.disabled !== true
    && provider?.adapter === 'openai-responses' && provider.authMode === 'oauth'
    && provider.baseUrl === 'https://api.meta.ai/v1';
}
