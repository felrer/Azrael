import { normalizeOpenRouterReasoning, validateCatalogReasoning, type CatalogReasoning } from './reasoning.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, unlinkSync, realpathSync, openSync, fstatSync, readSync, closeSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute, resolve, dirname } from 'node:path';
import { buildModelsRequest } from './vendor/src/oauth/index.ts';
import { CLAUDE_CODE_HEADERS, claudeCodeSessionId } from './vendor/src/adapters/client-fingerprint.ts';
import { providerOutboundGet, providerRedirectError } from './vendor/src/lib/provider-outbound.ts';
import { resolveProviderModelDiscovery, readBoundedDiscoveryJson, extractProviderModelItems, isRegistryModelDiscoveryUrl } from './vendor/src/providers/model-discovery.ts';
import { catalogHintsFromModelsApiItem } from './vendor/src/codex/catalog/provider-fetch.ts';
import { getProviderRegistryEntry } from './vendor/src/providers/registry.ts';
import { usesAdaptiveThinking } from './vendor/src/adapters/anthropic.ts';

export type InputModalities = ['text'] | ['text', 'image'];
export type CatalogEntry = { provider_id: string; model_id: string; display_name: string; context_window: number; reasoning?: CatalogReasoning; input_modalities?: InputModalities };
// Omitted modalities mean text-only; the native catalog advertises images only when declared.
export const validInputModalities = (value: unknown): value is InputModalities | undefined => value === undefined
  || (Array.isArray(value) && value[0] === 'text' && (value.length === 1 || (value.length === 2 && value[1] === 'image')));
export function declaredInputModalities(declared: unknown): InputModalities {
  return Array.isArray(declared) && declared.includes('text') && declared.includes('image') ? ['text', 'image'] : ['text'];
}
export type CatalogErrorCode = 'network' | 'timeout' | 'http' | 'invalid_response' | 'catalog_limit' | 'storage' | 'unavailable';
export type ProviderCatalogStatus = { provider_id: string; state: 'ready' | 'stale' | 'empty' | 'error'; model_count: number; observed_at: number; error_code?: CatalogErrorCode };
export const CATALOG_FRESH_MS = 5 * 60 * 1000;
export const CATALOG_STALE_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 1024 * 1024;
const MAX_MODELS = 2000;
const validId = (id: unknown): id is string => typeof id === 'string' && id.trim() === id && id.length > 0 && Buffer.byteLength(id) <= 256 && !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(id);
const validEntry = (m: any): m is CatalogEntry => m?.provider_id === 'openrouter' && validId(m.model_id) && typeof m.display_name === 'string' && m.display_name.length > 0 && Buffer.byteLength(m.display_name) <= 4096 && !/[\x00-\x1f\x7f-\x9f]/.test(m.display_name) && Number.isSafeInteger(m.context_window) && m.context_window > 0 && validateCatalogReasoning(m.reasoning);
type Snapshot = { version: 2; fingerprint: string; observed_at: number; models: CatalogEntry[] };
export type OpenRouterCatalogOptions = { refresh?: boolean; now?: number; fetch?: typeof fetch; directory?: string };
export type AnthropicCatalogOptions = OpenRouterCatalogOptions & { accountId: string; identity: readonly string[]; accessToken?: string };

function contains(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
function safeCacheDirectory(directory: string): string {
  const home = process.env.OPENCODEX_HOME;
  const codex = process.env.CODEX_HOME;
  if (!home || !codex || !isAbsolute(home) || !isAbsolute(codex) || resolve(home).toLowerCase() !== resolve(codex, 'azrael/providers/opencodex').toLowerCase() || !contains(realpathSync(codex), realpathSync(home)) || !contains(resolve(home), resolve(directory))) throw new Error('storage');
  let ancestor = resolve(directory);
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (!contains(realpathSync(home), realpathSync(ancestor))) throw new Error('storage');
  return resolve(directory);
}
function cachePath(directory: string): string {
  const safeDirectory = safeCacheDirectory(directory);
  mkdirSync(safeDirectory, { recursive: true, mode: 0o700 });
  safeCacheDirectory(safeDirectory);
  return join(safeDirectory, 'openrouter.json');
}
function anthropicCachePath(directory: string): string {
  const safeDirectory = safeCacheDirectory(directory);
  mkdirSync(safeDirectory, { recursive: true, mode: 0o700 });
  safeCacheDirectory(safeDirectory);
  return join(safeDirectory, 'anthropic.json');
}
function removeSnapshot(path: string) {
  safeCacheDirectory(dirname(path));
  try { unlinkSync(path); }
  catch (cause: any) { if (cause?.code !== 'ENOENT') throw new Error('storage'); }
}
function readSnapshot(path: string, fingerprint: string, now: number): Snapshot | undefined {
  try {
    const directory = realpathSync(join(path, '..'));
    const rel = relative(directory, realpathSync(path));
    if (rel.startsWith('..') || isAbsolute(rel)) return;
    const fd = openSync(path, 'r');
    let raw: string;
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_CACHE_BYTES) return;
      const bytes = Buffer.alloc(MAX_CACHE_BYTES + 1); let size = 0, count;
      while (size < bytes.length && (count = readSync(fd, bytes, size, bytes.length - size, null)) > 0) size += count;
      if (size > MAX_CACHE_BYTES) return;
      raw = bytes.subarray(0, size).toString('utf8');
    } finally { closeSync(fd); }
    const value = JSON.parse(raw!);
    if (value.version !== 2 || value.fingerprint !== fingerprint || !Number.isSafeInteger(value.observed_at) || value.observed_at > now || now - value.observed_at > CATALOG_STALE_MS || !Array.isArray(value.models) || value.models.length > MAX_MODELS || !value.models.every(validEntry) || new Set(value.models.map((m: CatalogEntry) => m.model_id)).size !== value.models.length) return;
    return value;
  } catch { return; }
}
function writeSnapshot(path: string, snapshot: Snapshot) {
  const bytes = JSON.stringify(snapshot);
  if (Buffer.byteLength(bytes) > MAX_CACHE_BYTES) throw new Error('catalog_limit');
  const temp = path + '.' + randomUUID() + '.tmp';
  try { writeFileSync(temp, bytes, { mode: 0o600, flag: 'wx' }); renameSync(temp, path); }
  finally { try { safeCacheDirectory(dirname(temp)); unlinkSync(temp); } catch {} }
}

type AnthropicSnapshot = { version: 1; fingerprint: string; observed_at: number; models: CatalogEntry[] };
const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
function knownAnthropicReasoning(modelId: string): CatalogReasoning {
  const registry = getProviderRegistryEntry('anthropic');
  const known = registry?.modelReasoningEfforts?.[modelId];
  const supported_efforts = ANTHROPIC_EFFORTS.filter(effort => known?.includes(effort));
  const declaredDefault = registry?.modelDefaultReasoningEfforts?.[modelId];
  return { supported_efforts, mandatory: supported_efforts.length > 0,
    ...(declaredDefault && supported_efforts.includes(declaredDefault as typeof ANTHROPIC_EFFORTS[number])
      ? { default_effort: declaredDefault } : {}) };
}
function anthropicReasoning(modelId: string, row?: any): CatalogReasoning {
  const capability = row?.capabilities?.effort;
  const known = knownAnthropicReasoning(modelId);
  if (capability && typeof capability === 'object' && typeof capability.supported === 'boolean') {
    if (capability.supported) {
      // The picker may expose a rung only when the adapter has an established
      // adaptive wire or an exact-known budget translation for this model.
      if (!usesAdaptiveThinking(modelId) && !known.supported_efforts.length)
        return { supported_efforts: [], mandatory: false };
      const supported_efforts = ANTHROPIC_EFFORTS.filter(effort => capability[effort]?.supported === true);
      const declaredDefault = getProviderRegistryEntry('anthropic')?.modelDefaultReasoningEfforts?.[modelId];
      return { supported_efforts, mandatory: supported_efforts.length > 0,
        ...(declaredDefault && supported_efforts.includes(declaredDefault as typeof ANTHROPIC_EFFORTS[number])
          ? { default_effort: declaredDefault } : {}) };
    }
    // Older exact-known models translate Codex stages to thinking.budget_tokens.
    // Adaptive models must not receive a stage that the API explicitly rejects.
    if (usesAdaptiveThinking(modelId)) return { supported_efforts: [], mandatory: false };
  }
  return known;
}
function anthropicSeed(provider: any): CatalogEntry[] {
  return [...new Set<string>(provider.models ?? [])].filter((id): id is string => validId(id) && id.startsWith('claude-')).map(model_id => ({
    provider_id: 'anthropic', model_id,
    display_name: provider.modelDisplayNames?.[model_id] ?? model_id,
    context_window: provider.modelContextWindows?.[model_id] ?? provider.contextWindow ?? 200_000,
    reasoning: anthropicReasoning(model_id),
  })).filter(validAnthropicEntry);
}
function validAnthropicEntry(model: any): model is CatalogEntry {
  return model?.provider_id === 'anthropic' && validId(model.model_id) && model.model_id.startsWith('claude-')
    && typeof model.display_name === 'string' && model.display_name.length > 0 && Buffer.byteLength(model.display_name) <= 4096
    && !/[\x00-\x1f\x7f-\x9f]/.test(model.display_name)
    && Number.isSafeInteger(model.context_window) && model.context_window > 0
    && (model.reasoning === undefined || validateCatalogReasoning(model.reasoning))
    && validInputModalities(model.input_modalities);
}
function readAnthropicSnapshot(path: string, fingerprint: string, now: number): AnthropicSnapshot | undefined {
  try {
    const directory = realpathSync(join(path, '..'));
    const rel = relative(directory, realpathSync(path));
    if (rel.startsWith('..') || isAbsolute(rel)) return;
    const fd = openSync(path, 'r');
    let raw: string;
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_CACHE_BYTES) return;
      const bytes = Buffer.alloc(MAX_CACHE_BYTES + 1); let size = 0, count;
      while (size < bytes.length && (count = readSync(fd, bytes, size, bytes.length - size, null)) > 0) size += count;
      if (size > MAX_CACHE_BYTES) return;
      raw = bytes.subarray(0, size).toString('utf8');
    } finally { closeSync(fd); }
    const value = JSON.parse(raw!);
    if (value.version !== 1 || value.fingerprint !== fingerprint || !Number.isSafeInteger(value.observed_at)
      || value.observed_at > now || !Array.isArray(value.models)
      || value.models.length > MAX_MODELS || !value.models.every(validAnthropicEntry)
      || new Set(value.models.map((model: CatalogEntry) => model.model_id)).size !== value.models.length) return;
    return value;
  } catch { return; }
}
function writeAnthropicSnapshot(path: string, snapshot: AnthropicSnapshot) {
  const bytes = JSON.stringify(snapshot);
  if (Buffer.byteLength(bytes) > MAX_CACHE_BYTES) throw new Error('catalog_limit');
  const temp = path + '.' + randomUUID() + '.tmp';
  try { writeFileSync(temp, bytes, { mode: 0o600, flag: 'wx' }); renameSync(temp, path); }
  finally { try { safeCacheDirectory(dirname(temp)); unlinkSync(temp); } catch {} }
}

// The Claude subscription transport discovers only on an explicit picker refresh (normally
// after thread/start). A catalog process may be short-lived, so its last good observation is
// account-scoped on disk; ordinary model/list and turn continuations never make a models GET.
export async function discoverAnthropicCatalog(provider: any, options: AnthropicCatalogOptions): Promise<{ models: CatalogEntry[]; status: ProviderCatalogStatus }> {
  const now = options.now ?? Date.now();
  const seed = anthropicSeed(provider);
  const status = (state: ProviderCatalogStatus['state'], models: CatalogEntry[], observed_at = now, error_code?: CatalogErrorCode) => ({
    models, status: { provider_id: 'anthropic', state, model_count: models.length, observed_at, ...(error_code ? { error_code } : {}) },
  });
  const fingerprint = createHash('sha256').update(JSON.stringify(['anthropic', options.accountId, options.identity, provider.baseUrl])).digest('hex');
  let path: string;
  try { path = anthropicCachePath(options.directory ?? join(process.env.OPENCODEX_HOME!, 'catalog')); }
  catch { return status('stale', seed, now, 'storage'); }
  const cached = readAnthropicSnapshot(path, fingerprint, now);
  // Version-1 snapshots from before reasoning discovery remain usable; add only
  // exact-known adapter metadata until the next explicit live refresh replaces them.
  if (cached) cached.models = cached.models.map(model => model.reasoning === undefined
    ? { ...model, reasoning: anthropicReasoning(model.model_id) } : model);
  if (!options.refresh) return cached
    ? status(now - cached.observed_at > CATALOG_FRESH_MS ? 'stale' : cached.models.length ? 'ready' : 'empty', cached.models, cached.observed_at)
    : status('stale', seed, now, 'unavailable');
  if (!options.accessToken) return status('stale', cached?.models ?? seed, cached?.observed_at ?? now, 'unavailable');
  let error: CatalogErrorCode = 'network';
  try {
    const request = buildModelsRequest(provider, options.accessToken, 'anthropic');
    const headers = {
      ...request.headers, Accept: 'application/json', 'User-Agent': '@anthropic-ai/sdk/0.74.0',
      ...CLAUDE_CODE_HEADERS, 'X-Claude-Code-Session-Id': claudeCodeSessionId(options.accessToken),
      'x-client-request-id': randomUUID(),
    };
    const models: CatalogEntry[] = [], seen = new Set<string>();
    const signal = AbortSignal.timeout(8000);
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const url = new URL(request.url);
      if (cursor) url.searchParams.set('after_id', cursor);
      const response = await providerOutboundGet('anthropic', { ...provider, ...(options.fetch ? { fetch: options.fetch } : {}) }, url.toString(), {
        headers, signal,
      }, { isCanonicalUrl: isRegistryModelDiscoveryUrl });
      if (await providerRedirectError(response, url.toString()) || !response.ok) { error = response.status === 401 || response.status === 403 ? 'unavailable' : 'http'; throw new Error(); }
      const json = await readBoundedDiscoveryJson(response, MAX_CACHE_BYTES);
      if (!json.ok) { error = json.reason === 'response_too_large' ? 'catalog_limit' : 'invalid_response'; throw new Error(); }
      const body: any = json.value;
      if (!Array.isArray(body?.data) || typeof body.has_more !== 'boolean') { error = 'invalid_response'; throw new Error(); }
      const before = models.length;
      for (const row of body.data) {
        if (!validId(row?.id) || !row.id.startsWith('claude-') || seen.has(row.id)) continue;
        const model: CatalogEntry = {
          provider_id: 'anthropic', model_id: row.id,
          display_name: typeof row.display_name === 'string' && row.display_name.trim() ? row.display_name : row.id,
          context_window: Number.isSafeInteger(row.max_input_tokens) && row.max_input_tokens > 0
            ? row.max_input_tokens : provider.modelContextWindows?.[row.id] ?? provider.contextWindow ?? 1_000_000,
          reasoning: anthropicReasoning(row.id, row),
          input_modalities: row.capabilities?.image_input?.supported === true ? ['text', 'image'] : ['text'],
        };
        if (!validAnthropicEntry(model)) continue;
        seen.add(row.id); models.push(model);
        if (models.length > MAX_MODELS) { error = 'catalog_limit'; throw new Error(); }
      }
      if (body.data.length > 0 && models.length === before) { error = 'invalid_response'; throw new Error(); }
      if (!body.has_more) {
        try { writeAnthropicSnapshot(path, { version: 1, fingerprint, observed_at: now, models }); }
        catch (cause: any) { error = cause?.message === 'catalog_limit' ? 'catalog_limit' : 'storage'; throw cause; }
        return status(models.length ? 'ready' : 'empty', models);
      }
      if (!validId(body.last_id) || body.last_id === cursor || !body.data.length) { error = 'invalid_response'; throw new Error(); }
      cursor = body.last_id;
    }
    error = 'catalog_limit'; throw new Error();
  } catch (cause: any) {
    if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') error = 'timeout';
    if (cause?.message === 'catalog_limit') error = 'catalog_limit';
    return status('stale', cached?.models ?? seed, cached?.observed_at ?? now, error);
  }
}
// Inference consumes already-discovered identity-scoped metadata without a GET.
export function readOpenRouterModelReasoning(provider: any, modelId: string, now = Date.now()): CatalogReasoning | undefined {
  try {
    if (!provider.apiKey) return undefined;
    const request = buildModelsRequest(provider, provider.apiKey, 'openrouter');
    const fingerprint = createHash('sha256').update(JSON.stringify([request.url, provider.apiKey, request.headers])).digest('hex');
    const directory = safeCacheDirectory(join(process.env.OPENCODEX_HOME!, 'catalog'));
    return readSnapshot(join(directory, 'openrouter.json'), fingerprint, now)?.models.find(model => model.model_id === modelId)?.reasoning;
  } catch { return undefined; }
}

export function clearOpenRouterCatalog() {
  try {
    if (!process.env.OPENCODEX_HOME) throw new Error('storage');
    removeSnapshot(join(process.env.OPENCODEX_HOME, 'catalog', 'openrouter.json'));
  } catch { throw new Error('storage'); }
}

// Discovery metadata is authoritative: configured seeds cannot manufacture a callable roster.
export async function discoverOpenRouterCatalog(provider: any, options: OpenRouterCatalogOptions = {}): Promise<{ models: CatalogEntry[]; status: ProviderCatalogStatus }> {
  const now = options.now ?? Date.now();
  const status = (state: ProviderCatalogStatus['state'], models: CatalogEntry[], observed_at = now, error_code?: CatalogErrorCode) => ({ models, status: { provider_id: 'openrouter', state, model_count: models.length, observed_at, ...(error_code ? { error_code } : {}) } });
  if (!provider.apiKey) {
    try { clearOpenRouterCatalog(); } catch { return status('error', [], now, 'storage'); }
    return status('error', [], now, 'unavailable');
  }
  let request: ReturnType<typeof buildModelsRequest>;
  try { request = buildModelsRequest(provider, provider.apiKey, 'openrouter'); }
  catch {
    try { clearOpenRouterCatalog(); } catch { return status('error', [], now, 'storage'); }
    return status('error', [], now, 'unavailable');
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([request.url, provider.apiKey, request.headers])).digest('hex');
  let path: string;
  try { path = cachePath(options.directory ?? join(process.env.OPENCODEX_HOME!, 'catalog')); }
  catch { return status('error', [], now, 'storage'); }
  const cached = readSnapshot(path, fingerprint, now);
  // Remove the previous identity immediately, even if the new discovery fails.
  if (!cached) { try { removeSnapshot(path); } catch { return status('error', [], now, 'storage'); } }
  if (!options.refresh && cached && now - cached.observed_at < CATALOG_FRESH_MS) return status(cached.models.length ? 'ready' : 'empty', cached.models, cached.observed_at);
  let error: CatalogErrorCode = 'network';
  try {
    const response = await providerOutboundGet('openrouter', { ...provider, ...(options.fetch ? { fetch: options.fetch } : {}) }, request.url, { headers: request.headers, signal: AbortSignal.timeout(8000) }, { isCanonicalUrl: isRegistryModelDiscoveryUrl });
    if (!response.ok && response.status !== 408 && response.status !== 429 && response.status < 500) {
      try { removeSnapshot(path); } catch { return status('error', [], now, 'storage'); }
      return status('error', [], now, 'unavailable');
    }
    if (await providerRedirectError(response, request.url) || !response.ok) { error = 'http'; throw new Error(); }
    const discovery = resolveProviderModelDiscovery('openrouter', provider);
    const json = await readBoundedDiscoveryJson(response, discovery.maxResponseBytes);
    if (!json.ok) { error = json.reason === 'response_too_large' ? 'catalog_limit' : 'invalid_response'; throw new Error(); }
    const parsed = extractProviderModelItems(json.value, discovery);
    if (!parsed.ok) { error = parsed.reason === 'too_many_models' ? 'catalog_limit' : 'invalid_response'; throw new Error(); }
    const models: CatalogEntry[] = [];
    const seen = new Set<string>();
    for (const item of parsed.items) {
      const architecture = item.architecture as any;
      const hints = catalogHintsFromModelsApiItem('openrouter', item);
      if (!validId(item.id) || seen.has(item.id) || !hints.inputModalities?.includes('text') || !Array.isArray(architecture?.output_modalities) || !architecture.output_modalities.includes('text') || !Array.isArray(item.supported_parameters) || !item.supported_parameters.includes('tools')) continue;
      const model = { provider_id: 'openrouter', model_id: item.id, display_name: typeof item.name === 'string' ? item.name : item.id, context_window: hints.contextWindow!, reasoning: normalizeOpenRouterReasoning(item) };
      if (!validEntry(model)) continue;
      seen.add(item.id); models.push(model);
    }
    models.sort((a, b) => a.model_id.localeCompare(b.model_id));
    // Retire prior callable IDs before persisting this authoritative observation.
    // Storage failure must not turn a known empty roster into a stale selectable one.
    try { removeSnapshot(path); writeSnapshot(path, { version: 2, fingerprint, observed_at: now, models }); }
    catch (cause: any) { return status('error', [], now, cause?.message === 'catalog_limit' ? 'catalog_limit' : 'storage'); }
    return status(models.length ? 'ready' : 'empty', models);
  } catch (cause: any) {
    if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') error = 'timeout';
    return cached ? status('stale', cached.models, cached.observed_at, error) : status('error', [], now, error);
  }
}
