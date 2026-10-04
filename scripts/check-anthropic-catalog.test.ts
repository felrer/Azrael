import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAnthropicCatalog } from '../providers/opencodex/catalog.ts';

test('Anthropic OAuth discovery refreshes explicitly and replaces an account-scoped roster', async () => {
  const root = mkdtempSync(join(tmpdir(), 'azrael-anthropic-catalog-'));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousOpenCodexHome = process.env.OPENCODEX_HOME;
  try {
    process.env.CODEX_HOME = join(root, 'codex');
    process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael', 'providers', 'opencodex');
    mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
    const directory = join(process.env.OPENCODEX_HOME, 'catalog');
    const provider = { adapter: 'anthropic', authMode: 'oauth', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-6'], contextWindow: 200_000 };
    const common = { accountId: 'account-a', identity: ['account-a', 'person-a'], accessToken: 'fixture-token', directory };
    const forbiddenFetch = (async () => { throw new Error('ordinary catalog read made a GET'); }) as typeof fetch;
    const normal = await discoverAnthropicCatalog(provider, { ...common, fetch: forbiddenFetch, now: 1000 });
    expect(normal.models.map(model => model.model_id)).toEqual(['claude-sonnet-4-6']);
    expect(normal.status.state).toBe('stale');
    expect(normal.models[0]?.reasoning?.supported_efforts).toContain('medium');

    const urls: string[] = [];
    const pagedFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = new URL(String(url));
      urls.push(parsed.toString());
      expect(init?.method).toBe('GET');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer fixture-token');
      expect(parsed.pathname).toBe('/v1/models');
      const cursor = parsed.searchParams.get('after_id');
      if (cursor === null) return Response.json({ data: [{ id: 'claude-sonnet-4-6', display_name: 'Sonnet', max_input_tokens: 200000, capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: false }, high: { supported: true }, xhigh: { supported: true }, max: { supported: false } } } }], has_more: true, last_id: 'claude-sonnet-4-6' });
      expect(cursor).toBe('claude-sonnet-4-6');
      return Response.json({ data: [{ id: 'claude-opus-5-5', display_name: 'Opus 5.5', max_input_tokens: 1000000, capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: true }, max: { supported: true } } } }], has_more: false });
    }) as typeof fetch;
    const discovered = await discoverAnthropicCatalog(provider, { ...common, refresh: true, fetch: pagedFetch, now: 2000 });
    expect(urls).toHaveLength(2);
    expect(discovered.status.state).toBe('ready');
    expect(discovered.models.map(model => model.model_id)).toEqual(['claude-sonnet-4-6', 'claude-opus-5-5']);
    expect(discovered.models[1].context_window).toBe(1000000);
    expect(discovered.models[0]?.reasoning?.supported_efforts).toEqual(['low', 'high', 'xhigh']);
    expect(discovered.models[1]?.reasoning?.supported_efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(discovered.models[1]?.reasoning?.default_effort).toBe('medium');
    const cached = await discoverAnthropicCatalog(provider, { ...common, fetch: forbiddenFetch, now: 3000 });
    expect(cached.models).toEqual(discovered.models);
    expect(cached.status.observed_at).toBe(2000);

    const failed = await discoverAnthropicCatalog(provider, { ...common, refresh: true, fetch: (async () => { throw new Error('transient network failure'); }) as typeof fetch, now: 4000 });
    expect(failed.status.state).toBe('stale');
    expect(failed.status.error_code).toBe('network');
    expect(failed.models).toEqual(discovered.models);
    expect((await discoverAnthropicCatalog(provider, { ...common, fetch: forbiddenFetch, now: 5000 })).models).toEqual(discovered.models);

    const anotherAccount = await discoverAnthropicCatalog(provider, { ...common, accountId: 'account-b', identity: ['account-b', 'person-b'], fetch: forbiddenFetch, now: 5000 });
    expect(anotherAccount.models.map(model => model.model_id)).toEqual(['claude-sonnet-4-6']);
    const changedIdentity = await discoverAnthropicCatalog(provider, { ...common, identity: ['account-a', 'different-person'], fetch: forbiddenFetch, now: 5000 });
    expect(changedIdentity.models.map(model => model.model_id)).toEqual(['claude-sonnet-4-6']);

    const removed = await discoverAnthropicCatalog(provider, { ...common, refresh: true, fetch: (async () => Response.json({ data: [{ id: 'claude-opus-5-5', display_name: 'Opus 5.5' }], has_more: false })) as typeof fetch, now: 6000 });
    expect(removed.status.state).toBe('ready');
    expect(removed.models.map(model => model.model_id)).toEqual(['claude-opus-5-5']);
    expect(removed.models[0]?.reasoning?.default_effort).toBe('medium');
    expect((await discoverAnthropicCatalog(provider, { ...common, fetch: forbiddenFetch, now: 7000 })).models).toEqual(removed.models);
    const empty = await discoverAnthropicCatalog(provider, { ...common, refresh: true, fetch: (async () => Response.json({ data: [], has_more: false })) as typeof fetch, now: 8000 });
    expect(empty.status.state).toBe('empty');
    expect(empty.models).toEqual([]);
    expect((await discoverAnthropicCatalog(provider, { ...common, fetch: forbiddenFetch, now: 9000 })).models).toEqual([]);
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousOpenCodexHome === undefined) delete process.env.OPENCODEX_HOME;
    else process.env.OPENCODEX_HOME = previousOpenCodexHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test('Anthropic discovery does not invent reasoning for unknown or explicitly unsupported models', async () => {
  const root = mkdtempSync(join(tmpdir(), 'azrael-anthropic-effort-'));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousOpenCodexHome = process.env.OPENCODEX_HOME;
  try {
    process.env.CODEX_HOME = join(root, 'codex');
    process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael', 'providers', 'opencodex');
    mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
    const provider = { adapter: 'anthropic', authMode: 'oauth', baseUrl: 'https://api.anthropic.com', models: [], contextWindow: 200_000 };
    const rows = [
      { id: 'claude-unknown-future', display_name: 'Future' },
      { id: 'claude-unknown-disabled', display_name: 'Disabled', capabilities: { effort: { supported: false, low: { supported: true }, medium: { supported: true } } } },
      { id: 'claude-unknown-empty', display_name: 'Empty', capabilities: { effort: { supported: true, low: { supported: false }, medium: { supported: false }, high: { supported: false }, xhigh: { supported: false }, max: { supported: false } } } },
    ];
    const result = await discoverAnthropicCatalog(provider, {
      accountId: 'account-a', identity: ['account-a'], accessToken: 'fixture-token', directory: join(process.env.OPENCODEX_HOME, 'catalog'),
      refresh: true, now: 1000, fetch: (async () => Response.json({ data: rows, has_more: false })) as typeof fetch,
    });
    expect(result.status.state).toBe('ready');
    expect(result.models).toHaveLength(3);
    for (const model of result.models) {
      expect(model.reasoning?.supported_efforts ?? []).toEqual([]);
      expect(model.reasoning?.default_effort).toBeUndefined();
    }
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousOpenCodexHome === undefined) delete process.env.OPENCODEX_HOME;
    else process.env.OPENCODEX_HOME = previousOpenCodexHome;
    rmSync(root, { recursive: true, force: true });
  }
});
