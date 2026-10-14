import { createHash } from 'node:crypto';

export const MANAGED_PROVIDERS = ['google-antigravity', 'anthropic', 'meta-muse'];

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
