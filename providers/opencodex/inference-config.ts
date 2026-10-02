export const MANAGED_PROVIDERS = ['google-antigravity', 'anthropic'];

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
    && provider.googleMode === 'cloud-code-assist';
}
