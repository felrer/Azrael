import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync, realpathSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { createOAuthFileLock, type OAuthFileLockGuard } from './vendor/src/oauth/store.ts';
import { validateIsolatedHomeForTests } from './helper.ts';
import { AdapterError, compileRequest, mapStream, MAX_BYTES, MAX_REQUEST_BYTES, fail } from './inference-mapping.mjs';
import { MANAGED_PROVIDERS, isManagedOAuthTransport, managedClaudeIdentity } from './inference-config.ts';
import { declaredInputModalities, discoverAnthropicCatalog, type ProviderCatalogStatus } from './catalog.ts';
import { configuredModelReasoning } from './reasoning.ts';
import { createProgressMonitor } from '../devin/progress.mjs';
import { observeRawReads, observeParser } from '../devin/stall-diagnostics.mjs';
import { accountIdentity, autoSwitchAvailable, autoSwitchAllowed, eligibleAccounts, withAutoSwitchPolicyMutation } from './auto-switch.ts';
import { classifyManagedError, providerHttpError } from './inference-errors.ts';

const supported = MANAGED_PROVIDERS;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const safeId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
type Pin = { account_id: string; fingerprint: string };
type Binding = { version: 1; thread_id: string; providers: Record<string, Pin>; turns: Record<string, Pin & { provider_id: string; model: string }> };
const MAX_BINDING_BYTES = 1024 * 1024;
const object = (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validPin = (value: any) => object(value) && typeof value.account_id === 'string' && /^(?:[a-f0-9]{8}|[a-f0-9]{32})$/.test(value.account_id) && typeof value.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.fingerprint);
const validModel = (value: any) => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= 256 && !/[\x00-\x1f\x7f-\x9f]/.test(value);

function readBinding(path: string, thread: string, directory: string): Binding {
  const rel = relative(realpathSync(directory), realpathSync(path));
  if (rel.startsWith('..') || isAbsolute(rel)) fail('invalid_binding');
  const fd = openSync(path, 'r');
  let raw: string;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BINDING_BYTES) fail('binding_limit');
    const bytes = Buffer.alloc(MAX_BINDING_BYTES + 1); let size = 0, count;
    while (size < bytes.length && (count = readSync(fd, bytes, size, bytes.length - size, null)) > 0) size += count;
    if (size > MAX_BINDING_BYTES) fail('binding_limit');
    raw = bytes.subarray(0, size).toString('utf8');
  } finally { closeSync(fd); }
  let binding: any;
  try { binding = JSON.parse(raw!); } catch { fail('invalid_binding'); }
  if (!object(binding) || binding.version !== 1 || binding.thread_id !== thread || !safeId(thread) || !object(binding.providers) || !object(binding.turns)) fail('invalid_binding');
  const providers: Record<string, Pin> = Object.create(null), turns: Binding['turns'] = Object.create(null);
  for (const [id, pin] of Object.entries(binding.providers)) {
    if (!supported.includes(id) || !validPin(pin) || Object.keys(pin as any).some(key => !['account_id', 'fingerprint'].includes(key))) fail('invalid_binding');
    providers[id] = pin as Pin;
  }
  for (const [id, turn] of Object.entries(binding.turns) as [string, any][]) {
    if (!safeId(id) || !validPin(turn) || !supported.includes(turn.provider_id) || !validModel(turn.model) || Object.keys(turn).some(key => !['provider_id', 'model', 'account_id', 'fingerprint'].includes(key))) fail('invalid_binding');
    const pin = providers[turn.provider_id];
    if (!pin) fail('invalid_binding');
    turns[id] = turn;
  }
  if (Object.keys(binding).some(key => !['version', 'thread_id', 'providers', 'turns'].includes(key))) fail('invalid_binding');
  return { version: 1, thread_id: thread, providers, turns };
}

async function modules() {
  validateIsolatedHomeForTests();
  const [config, router, google, budget, antigravity, oauth, store, anthropic] = await Promise.all([
    import('./vendor/src/config.ts'),
    import('./vendor/src/router.ts'), import('./vendor/src/adapters/google.ts'),
    import('./vendor/src/lib/translator-budget.ts'),
    import('./antigravity.ts'), import('./vendor/src/oauth/index.ts'),
    import('./vendor/src/oauth/store.ts'), import('./vendor/src/adapters/anthropic.ts'),
  ]);
  return { config, router, google, budget, antigravity, oauth, store, anthropic };
}

async function resolvePin(config: any, providerId: string, retained: Pin | undefined, m: any) {
  const provider = config.providers[providerId];
  let accountId: string, routed: any, fingerprint: string;
  if (providerId === 'anthropic') {
    if (!isManagedOAuthTransport('anthropic', provider)) fail('provider_unavailable');
    const set = m.store.getAccountSet('anthropic');
    accountId = retained?.account_id ?? set?.activeAccountId;
    const account = set?.accounts.find((entry: any) => entry.id === accountId);
    if (!account) fail('pinned_account_missing');
    if (account.needsReauth || !account.credential?.refresh) fail('pinned_account_unavailable');
    const before = managedClaudeIdentity(account.credential);
    if (!before) fail('pinned_account_unavailable');
    const access = (await m.oauth.getValidAccessSnapshotForAccount('anthropic', accountId, { requireUsableAccount: true })).accessToken;
    if (!access) fail('pinned_account_unavailable');
    const current = m.store.getAccountSet('anthropic')?.accounts.find((entry: any) => entry.id === accountId);
    const after = managedClaudeIdentity(current?.credential);
    if (!after || JSON.stringify(after) !== JSON.stringify(before) || current?.needsReauth || current.credential.access !== access) fail('pinned_account_changed');
    routed = { ...provider, adapter: 'anthropic', authMode: 'oauth', baseUrl: 'https://api.anthropic.com', headers: undefined, apiKey: access };
    fingerprint = digest(JSON.stringify(['anthropic', accountId, ...after]));
  } else if (providerId === 'google-antigravity') {
    const beforeAccount = m.store.getAccountSet(providerId)?.accounts.find((entry: any) => entry.id === (retained?.account_id ?? m.store.getAccountSet(providerId)?.activeAccountId));
    const beforeIdentity = accountIdentity(providerId, beforeAccount);
    const resolved = await m.antigravity.resolveAntigravityAccount(provider, retained?.account_id);
    const afterAccount = m.store.getAccountSet(providerId)?.accounts.find((entry: any) => entry.id === resolved.accountId);
    if (!beforeIdentity || accountIdentity(providerId, afterAccount) !== beforeIdentity || afterAccount?.needsReauth || afterAccount?.credential?.access !== resolved.provider.apiKey) fail('pinned_account_changed');
    accountId = resolved.accountId; routed = resolved.provider; fingerprint = resolved.fingerprint;
  } else fail('provider_unavailable');
  return { accountId, routed, fingerprint };
}

// Auxiliary state owns identity only. Conversation content remains native.
export async function pinAccount(config: any, request: any, m: any) {
  if (!supported.includes(request.provider_id) || !safeId(request.thread_id) || !safeId(request.turn_id) || !validModel(request.model)) fail('invalid_selection');
  const directory = join(process.env.CODEX_HOME!, 'azrael', 'providers', 'sessions');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const physicalRelative = relative(realpathSync(process.env.CODEX_HOME!), realpathSync(directory));
  if (physicalRelative.startsWith('..') || isAbsolute(physicalRelative)) fail('binding_storage_not_isolated');
  const path = join(directory, request.thread_id + '.json');
  const lock = path + '.lock';
  let guard: OAuthFileLockGuard;
  // Admission never waits on another turn. Allow the upstream 120s credential
  // lease to expire before reclaiming a lock abandoned by a killed helper.
  try { guard = await (m.store.createOAuthFileLock ?? createOAuthFileLock)({ path: lock, waitTimeoutMs: 0, staleAfterMs: 120_000 }).acquire(); }
  catch { fail('binding_busy'); }
  try {
    let binding: Binding = existsSync(path) ? readBinding(path, request.thread_id, directory) : { version: 1, thread_id: request.thread_id, providers: Object.create(null), turns: Object.create(null) };
    if (!existsSync(path) && request.forked_from_thread_id) {
      if (!safeId(request.forked_from_thread_id) || !Array.isArray(request.fork_provider_ids) || request.fork_provider_ids.length > supported.length || request.fork_provider_ids.some((id: any) => !supported.includes(id))) fail('fork_binding_unavailable');
      if (request.fork_provider_ids.length) {
        const ancestorPath = join(directory, request.forked_from_thread_id + '.json');
        if (!existsSync(ancestorPath)) fail('fork_binding_unavailable');
        const ancestor = readBinding(ancestorPath, request.forked_from_thread_id, directory);
        for (const id of request.fork_provider_ids) {
          if (!ancestor.providers[id]) fail('fork_binding_unavailable');
          binding.providers[id] = ancestor.providers[id];
        }
      }
    }
    const previous = binding.turns[request.turn_id];
    if (previous && (previous.provider_id !== request.provider_id || previous.model !== request.model)) fail('turn_selection_mismatch');
    const retained = previous ?? binding.providers[request.provider_id];
    const { accountId, routed, fingerprint } = await resolvePin(config, request.provider_id, retained, m);
    if (retained && retained.fingerprint !== fingerprint) fail('pinned_account_changed');
    const pin = { account_id: accountId, fingerprint };
    if (!validPin(pin)) fail('pinned_account_unavailable');
    if (!previous || !binding.providers[request.provider_id]) binding.providers[request.provider_id] = pin;
    binding.turns[request.turn_id] = { ...pin, provider_id: request.provider_id, model: request.model };
    const temporary = path + '.' + randomUUID() + '.tmp';
    const serialized = JSON.stringify(binding);
    if (Buffer.byteLength(serialized) > MAX_BINDING_BYTES) fail('binding_limit');
    writeFileSync(temporary, serialized, { mode: 0o600 });
    renameSync(temporary, path);
    return { provider: routed, fingerprint };
  } finally { guard!.release(); }
}

export function projectRequest(request: any, fingerprint: string) {
  const opaqueCalls = new Map<string, any>();
  const replayDetails: { details: any[]; callIds: string[] }[] = [];
  const projected = { ...request, credential_scope: fingerprint, input: request.input.map((item: any) => {
    if (item.type !== 'reasoning' || !item.encrypted_content) return item;
    const prefix = 'azrael-managed-v1:';
    let metadata;
    if (typeof item.encrypted_content === 'string' && item.encrypted_content.startsWith(prefix)) {
      try { metadata = JSON.parse(Buffer.from(item.encrypted_content.slice(prefix.length), 'base64').toString('utf8')); } catch { fail('invalid_reasoning_envelope'); }
    }
    const valid = metadata && metadata.provider === request.provider_id && metadata.model === request.model && metadata.thread === request.thread_id && metadata.account === fingerprint && metadata.turn === request.turn_id;
    if (valid) for (const call of metadata.calls ?? []) opaqueCalls.set(call.id, call);
    if (valid && metadata.reasoning_details) replayDetails.push({ details: metadata.reasoning_details, callIds: (metadata.calls ?? []).map((call: any) => call.id) });
    // Public reasoning survives switching; private replay has an exact origin and turn.
    return { ...item, encrypted_content: valid ? item.encrypted_content : null };
  }) };
  const compiled = compileRequest(projected);
  for (const replay of replayDetails) for (const id of replay.callIds) {
    const original = opaqueCalls.get(id);
    const call = compiled.messages.flatMap((message: any) => message.tool_calls ?? []).find((call: any) => call.id === id);
    if (!call || original?.name !== call.name || original.arguments_digest !== digest(JSON.stringify(JSON.parse(call.arguments)))) fail('reasoning_scope_mismatch');
  }
  const systemPrompt: string[] = [];
  const messages: any[] = [];
  const callNames = new Map<string, string>();
  for (const message of compiled.messages) {
    if (message.role === 'system') { systemPrompt.push(message.content); continue; }
    if (message.role === 'assistant') {
      const content: any[] = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      if (message.thinking) content.push({ type: 'thinking', thinking: message.thinking, ...(message.signature ? { signature: message.signature } : {}) });
      for (const call of message.tool_calls ?? []) {
        callNames.set(call.id, call.name);
        const opaque = opaqueCalls.get(call.id);
        const validOpaque = opaque?.name === call.name && opaque.arguments_digest === digest(JSON.stringify(JSON.parse(call.arguments)));
        content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: JSON.parse(call.arguments), ...(validOpaque && opaque.providerMetadata ? { providerMetadata: opaque.providerMetadata } : {}) });
      }
      messages.push({ role: 'assistant', content, timestamp: 0 });
    } else if (message.role === 'tool') messages.push({ role: 'toolResult', toolCallId: message.tool_call_id, toolName: callNames.get(message.tool_call_id), content: message.content, isError: false, timestamp: 0 });
    else messages.push({ role: message.role, content: message.content, timestamp: 0 });
  }
  return { compiled, replayDetails, parsed: { modelId: request.model, context: { systemPrompt, messages, tools: compiled.tools }, stream: true, options: { parallelToolCalls: request.parallel_tool_calls, reasoning: request.reasoning_effort }, _clientThreadId: request.thread_id } };
}

// Observe structured replay fields without replacing the vendored stream parser.
// The adapter sees exactly the same bytes; retained private records are bounded.
export function observeDetails(response: Response, opaque: { details: any[]; terminal: boolean; upstreamSseError?: boolean }, retainDetails: boolean, wrappedGoogle = false, onBytes?: (bytes: number) => void, provider = '') {
  if (!response.body) fail('provider_eof');
  const decoder = new TextDecoder();
  let pending = '', data: string[] = [], dataBytes = 0;
  const records: any[] = [];
  const frame = () => {
    const payload = data.join('\n'); data = []; dataBytes = 0;
    if (!payload || payload === '[DONE]') return;
    let parsed; try { parsed = JSON.parse(payload); } catch { return; }
    const error = parsed.error ?? parsed.response?.error ?? parsed.choices?.find((choice: any) => choice.finish_reason === 'error')?.error;
    if (error !== undefined) {
      opaque.upstreamSseError = true;
      const code = classifyManagedError(provider, undefined, { error });
      if (code) fail(code);
    }
    if (wrappedGoogle) parsed = parsed.response ?? parsed;
    const parts = parsed.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts) && parts.some((part: any) => part.inlineData || part.inline_data || part.fileData || part.file_data || part.executableCode || part.codeExecutionResult)) fail('unsupported_provider_output');
    const delta = parsed.choices?.[0]?.delta;
    if (delta && ((delta.content != null && typeof delta.content !== 'string') || delta.images?.length || delta.audio)) fail('unsupported_provider_output');
    if (typeof parsed.choices?.[0]?.finish_reason === 'string' && parsed.choices[0].finish_reason) opaque.terminal = true;
    if (typeof parsed.candidates?.[0]?.finishReason === 'string' && parsed.candidates[0].finishReason) opaque.terminal = true;
    if (!retainDetails) return;
    const details = parsed.choices?.[0]?.delta?.reasoning_details;
    if (details === undefined) return;
    if (!Array.isArray(details)) fail('invalid_reasoning_details');
    for (const detail of details) {
      if (!detail || typeof detail !== 'object' || Array.isArray(detail) || typeof detail.type !== 'string') fail('invalid_reasoning_details');
      // OpenRouter streaming fields are increments, never cumulative snapshots.
      // Follow its SDK's consecutive text/summary reconstruction; encrypted
      // records are discrete opaque blobs and remain unchanged in stream order.
      // https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
      const field = detail.type === 'reasoning.text' ? 'text' : detail.type === 'reasoning.summary' ? 'summary' : undefined;
      if (field && detail[field] !== undefined && typeof detail[field] !== 'string') fail('invalid_reasoning_details');
      const prior = records.at(-1);
      const compatible = field && prior?.type === detail.type && Object.entries(detail).every(([name, value]) => name === field || prior[name] == null || value == null || JSON.stringify(prior[name]) === JSON.stringify(value));
      if (!compatible) records.push(structuredClone(detail));
      else {
        prior[field] = (prior[field] ?? '') + (detail[field] ?? '');
        for (const [name, value] of Object.entries(detail)) if (name !== field && (prior[name] === undefined || prior[name] === null)) prior[name] = value;
      }
    }
    opaque.details = records;
    if (Buffer.byteLength(JSON.stringify(opaque.details)) > MAX_BYTES) fail('output_limit');
  };
  const consume = (text: string) => {
    pending += text;
    if (Buffer.byteLength(pending) > MAX_BYTES) fail('output_limit');
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1);
      if (!line) frame(); else if (line.startsWith('data:')) {
        const value = line.slice(5).trimStart(); dataBytes += Buffer.byteLength(value);
        if (dataBytes > MAX_BYTES) fail('output_limit');
        data.push(value);
      }
    }
  };
  const body = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) { onBytes?.(chunk.byteLength); consume(decoder.decode(chunk, { stream: true })); controller.enqueue(chunk); },
    flush() { consume(decoder.decode() + '\n'); frame(); },
  }));
  return new Response(body, { status: response.status, headers: response.headers });
}

async function* translate(events: AsyncIterable<any>, opaque: { terminal: boolean }, onEvent?: (event: string) => void, tracker?: any) {
  let tools = false;
  try { for await (const event of events) {
    const progressEvent = ({ text_delta: 'text', thinking_delta: 'reasoning', reasoning_raw_delta: 'reasoning', thinking_signature: 'reasoning_signature', tool_call_start: 'tool_call_start', tool_call_delta: 'tool_call_args', done: 'finish' } as Record<string, string>)[event.type];
    const deltaField = ({ text_delta: 'text', thinking_delta: 'thinking', reasoning_raw_delta: 'text', thinking_signature: 'signature', tool_call_delta: 'arguments' } as Record<string, string>)[event.type];
    // A declared empty block remains parser evidence, not generated content.
    if (progressEvent && (!deltaField || (typeof event[deltaField] === 'string' && event[deltaField].length > 0))) onEvent?.(progressEvent);
    switch (event.type) {
      case 'heartbeat': case 'tool_call_end': break;
      case 'text_delta': yield { kind: 'text', text: event.text }; break;
      case 'thinking_delta': yield { kind: 'reasoning', text: event.thinking }; break;
      case 'reasoning_raw_delta': yield { kind: 'reasoning', text: event.text }; break;
      case 'thinking_signature': yield { kind: 'reasoning_signature', signature: event.signature }; break;
      case 'tool_call_start': tools = true; yield { kind: 'tool_call_start', id: event.id, name: event.name, providerMetadata: event.providerMetadata }; break;
      case 'tool_call_delta': yield { kind: 'tool_call_args', argsDelta: event.arguments }; break;
      case 'done':
        if (!opaque.terminal) fail('provider_eof');
        if (event.stopReason && !['stop', 'tool_calls', 'end_turn', 'tool_use'].includes(event.stopReason)) fail('provider_incomplete');
        if (event.usage) yield { kind: 'usage', promptTokens: event.usage.inputTokens, completionTokens: event.usage.outputTokens, cachedInputTokens: event.usage.cachedInputTokens, reasoningTokens: event.usage.reasoningOutputTokens };
        yield { kind: 'finish', reason: tools ? 'tool_calls' : 'stop' }; break;
      case 'error': if (Number.isInteger(event.status)) fail('provider_http_' + event.status); fail('provider_failure');
      case 'incomplete': fail('provider_incomplete');
      default: fail('unsupported_provider_event');
    }
  } } catch (error) { tracker?.error('translate', error); throw error; }
}

// Anthropic's parser tolerates a terminal message_delta without message_stop.
// The managed native stream requires the actual terminal frame before tool calls execute.
export function observeAnthropic(response: Response, opaque: { terminal: boolean; upstreamSseError?: boolean }, onBytes?: (bytes: number) => void, tracker?: any) {
  if (!response.body) fail('provider_eof');
  const decoder = new TextDecoder();
  let pending = '', data: string[] = [], dataBytes = 0, frameBytes = 0;
  const frame = () => {
    if (!data.length) return;
    let value: any;
    try { value = JSON.parse(data.join('\n')); } catch { fail('invalid_provider_stream'); }
    data = []; dataBytes = 0;
    if (value.type === 'error') opaque.upstreamSseError = true;
    tracker?.sse(value);
    if (value.type === 'error') {
      const code = classifyManagedError('anthropic', undefined, value);
      if (code) fail(code);
    }
    if (value.type === 'message_stop') opaque.terminal = true;
    if (value.type === 'content_block_start' && !['text', 'thinking', 'redacted_thinking', 'tool_use'].includes(value.content_block?.type)) fail('unsupported_provider_output');
    if (value.type === 'content_block_delta' && !['text_delta', 'thinking_delta', 'reasoning_delta', 'signature_delta', 'input_json_delta'].includes(value.delta?.type)) fail('unsupported_provider_output');
  };
  const consume = (chunk: string) => {
    pending += chunk;
    if (Buffer.byteLength(pending) > MAX_BYTES) fail('output_limit');
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      frameBytes += Buffer.byteLength(pending.slice(0, end)) + 1;
      const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1);
      if (!line) { frame(); frameBytes = 0; }
      else if (line.startsWith('data:')) {
        const value = line.slice(5).trimStart();
        dataBytes += Buffer.byteLength(value);
        if (dataBytes > MAX_BYTES) fail('output_limit');
        data.push(value);
      }
    }
  };
  const body = observeRawReads(response, tracker).body!.pipeThrough(new TransformStream({
    transform(chunk, controller) { onBytes?.(chunk.byteLength); try { consume(decoder.decode(chunk, { stream: true })); } catch (error) { tracker?.error('sse_decode', error); throw error; } tracker?.pending(Buffer.byteLength(pending) + frameBytes); controller.enqueue(chunk); },
    flush() { try { consume(decoder.decode() + '\n'); frame(); tracker?.pending(0); } catch (error) { tracker?.error('sse_decode', error); throw error; } },
  }));
  return new Response(body, { status: response.status, headers: response.headers });
}

export function managedDeadlineFailure(error: any, signal: AbortSignal, upstreamSseError = false) {
  // An observed upstream error remains authoritative when the timer races it.
  // This source flag is independent of temporary diagnostics and contains no payload.
  // Confirmed HTTP and our own validation failures keep their classifications.
  return signal.aborted && !upstreamSseError && (!(error instanceof AdapterError) || error.message === 'provider_failure');
}

export async function infer(request: any, emit: (frame: any) => void, fetcher = globalThis.fetch, progress?: ReturnType<typeof createProgressMonitor>, options: { deadlineSignal?: AbortSignal } = {}) {
  const m = await modules();
  if (!request || request.type !== 'request' || request.protocol_version !== 1 || typeof request.request_id !== 'string' || !Array.isArray(request.input) || !Array.isArray(request.tools)) fail('invalid_request');
  const pinned = await pinAccount(m.config.loadConfig(), request, m);
  const { compiled, parsed } = projectRequest(request, pinned.fingerprint);
  const adapter = pinned.provider.adapter === 'anthropic' ? m.anthropic.createAnthropicAdapter(pinned.provider)
    : m.google.createGoogleAdapter(pinned.provider);
  const budget = m.budget.createTranslatorBudget();
  const signal = options.deadlineSignal ?? AbortSignal.timeout(900_000);
  const tracker = progress?.transport;
  const opaque = { details: [], terminal: false, upstreamSseError: false };
  let stage = 'build';
  try {
    progress?.observe({ kind: 'phase', phase: 'headers' });
    const built = await adapter.buildRequest(parsed, { headers: new Headers(), translatorBudget: budget, abortSignal: signal, providerFetch: fetcher });
    const wireBody = JSON.parse(built.body);
    if ((wireBody.request ?? wireBody).generationConfig?.responseModalities?.some((modality: string) => modality !== 'TEXT')) fail('unsupported_output_modality');
    if (request.provider_id === 'anthropic' && (typeof request.instructions !== 'string'
      || wireBody.messages?.some((message: any) => typeof message.content !== 'string' && (!Array.isArray(message.content) || message.content.some((part: any) => !['text', 'image', 'tool_use', 'tool_result', 'thinking', 'redacted_thinking'].includes(part.type))))
      || !wireBody.system?.some((part: any) => typeof part.text === 'string' && part.text.includes(request.instructions)))) fail('unsupported_provider_output');
    stage = 'headers';
    const response = adapter.fetchResponse ? await adapter.fetchResponse(built, { abortSignal: signal, executor: fetcher, returnRawErrors: true, stream: true }) : await fetcher(built.url, { method: built.method, headers: built.headers, body: built.body, signal, redirect: 'error' });
    tracker?.headers(response);
    if (!response.ok) fail(await providerHttpError(response, request.provider_id));
    progress?.observe({ kind: 'phase', phase: 'stream' });
    const onBytes = (bytes: number) => progress?.observe({ kind: 'bytes', bytes });
    const observed = request.provider_id === 'anthropic' ? observeAnthropic(response, opaque, onBytes, tracker) : observeDetails(response, opaque, false, true, onBytes, request.provider_id);
    stage = 'map';
    await mapStream(translate(observeParser(adapter.parseStream(observed, budget, built.tierLog), tracker), opaque, event => progress?.observe({ kind: 'event', event }), tracker), { ...compiled, provider: request.provider_id, turn: request.turn_id, opaque }, emit, request.request_id);
  } catch (error) {
    tracker?.error(stage, error, signal);
    if (managedDeadlineFailure(error, signal, opaque.upstreamSseError)) fail('provider_request_deadline');
    throw error;
  } finally { budget.dispose(); }
}

export async function catalog(options: { refresh?: boolean; fetch?: typeof fetch; now?: number } = {}) {
  const m = await modules();
  const config = m.config.loadConfig();
  const models: any[] = [];
  const provider_statuses: ProviderCatalogStatus[] = [];
  for (const provider_id of supported) {
    const configured = config.providers[provider_id];
    let provider: any;
    if (provider_id === 'anthropic') {
      if (!isManagedOAuthTransport(provider_id, configured)) continue;
      const set = m.store.getAccountSet(provider_id);
      const account = set?.accounts.find((entry: any) => entry.id === set.activeAccountId);
      const identity = account && !account.needsReauth && account.credential?.refresh
        ? managedClaudeIdentity(account.credential) : null;
      if (!account || !identity) continue;
      let accessToken: string | undefined;
      if (options.refresh) {
        try {
          accessToken = (await m.oauth.getValidAccessSnapshotForAccount('anthropic', account.id, { requireUsableAccount: true })).accessToken;
          const current = m.store.getAccountSet('anthropic');
          const same = current?.activeAccountId === account.id && current?.accounts.find((entry: any) => entry.id === account.id);
          if (!same || same.needsReauth || JSON.stringify(managedClaudeIdentity(same.credential)) !== JSON.stringify(identity)) accessToken = undefined;
        } catch { /* Discovery failure must not invalidate the prior catalog or an active turn. */ }
      }
      const discovered = await discoverAnthropicCatalog({
        ...configured, models: m.router.knownModelIdsForProvider('anthropic', configured, config),
      }, {
        accountId: account.id, identity, accessToken, refresh: options.refresh, fetch: options.fetch, now: options.now,
      });
      const current = m.store.getAccountSet('anthropic');
      const same = current?.activeAccountId === account.id && current.accounts.find((entry: any) => entry.id === account.id);
      if (!same || same.needsReauth || JSON.stringify(managedClaudeIdentity(same.credential)) !== JSON.stringify(identity)) continue;
      models.push(...discovered.models);
      provider_statuses.push(discovered.status);
      continue;
    } else if (provider_id === 'google-antigravity') {
      if (!configured) continue;
      try { provider = (await m.antigravity.resolveAntigravityAccount(configured, undefined, false)).provider; }
      catch { provider_statuses.push({ provider_id, state: 'error', model_count: 0, observed_at: options.now ?? Date.now(), error_code: 'unavailable' }); continue; }
    } else continue;
    const start = models.length;
    // CCA's model-keyed hints also contain wire tiers and compatibility aliases;
    // only its configured picker roster represents distinct selectable models.
    const modelIds = provider_id === 'google-antigravity' ? [...new Set<string>(provider.models)] : m.router.knownModelIdsForProvider(provider_id, provider, config);
    for (const model_id of modelIds) {
      if (!validModel(model_id)) continue;
      if (provider.modelInputModalities?.[model_id] && !provider.modelInputModalities[model_id].includes('text')) continue;
      if (provider.adapter === 'google') {
        // Ask the existing wire builder about forced image output; its model
        // allowlist remains the single owner and this probe performs no fetch.
        const budget = m.budget.createTranslatorBudget();
        try {
          const built = await m.google.createGoogleAdapter(provider).buildRequest({ modelId: model_id, context: { messages: [] }, stream: true, options: {} }, { headers: new Headers(), translatorBudget: budget });
          const body = JSON.parse(built.body);
          if ((body.request ?? body).generationConfig?.responseModalities?.some((modality: string) => modality !== 'TEXT')) continue;
        } finally { budget.dispose(); }
      }
      models.push({ provider_id, model_id, display_name: provider.modelDisplayNames?.[model_id] ?? model_id,
        context_window: provider.modelContextWindows?.[model_id] ?? provider.contextWindow ?? 32768,
        reasoning: configuredModelReasoning(provider, model_id),
        input_modalities: declaredInputModalities(provider.modelInputModalities?.[model_id]) });
    }
    const count = models.length - start;
    provider_statuses.push({ provider_id, state: count ? 'ready' : 'empty', model_count: count, observed_at: options.now ?? Date.now() });
  }
  if (Buffer.byteLength(JSON.stringify({ models, provider_statuses })) > 1024 * 1024) fail('catalog_limit');
  return { models, provider_statuses };
}

export async function runCli() {
  let requestId = '', seq = 0, total = 0;
  let progress: ReturnType<typeof createProgressMonitor> | undefined;
  const emit = (frame: any) => {
    // Structural progress is useful even while headers have not arrived.
    if (frame.type === 'completed' || frame.type === 'error') {
      if (progress) frame = { ...frame, progress: progress.snapshot() };
      progress?.stop();
    }
    const line = JSON.stringify({ protocol_version: 1, request_id: requestId, seq, ...frame }) + '\n';
    const size = Buffer.byteLength(line);
    // Reserve a bounded safe terminal even when ordinary output fills its budget.
    const limit = 16 * 1024 * 1024 - (frame.type === 'error' ? 0 : 1024);
    if (size > MAX_BYTES || total + size > limit) fail('output_limit');
    total += size; seq++;
    const flushed = process.stdout.write(line);
    progress?.noteOutput({ bytes: size, backpressured: !flushed });
  };
  // Vendored readers can warn with unsafe config diagnostics. Boundary diagnostics are codes only.
  console.warn = console.error = console.log = console.info = console.debug = () => {};
  try {
    if (process.argv.includes('--catalog')) process.stdout.write(JSON.stringify(await catalog({ refresh: process.argv.includes('--refresh') })) + '\n');
    else {
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) { size += chunk.length; if (size > MAX_REQUEST_BYTES) fail('request_limit'); chunks.push(Buffer.from(chunk)); }
      const lines = Buffer.concat(chunks).toString('utf8').trimEnd().split('\n');
      if (lines.length !== 2) fail('invalid_frame_count');
      const [init, request] = lines.map(line => JSON.parse(line));
      requestId = typeof request.request_id === 'string' && request.request_id.length <= 128 && !/[\x00-\x1f]/.test(request.request_id) ? request.request_id : '';
      if (init.type !== 'init' || init.protocol_version !== 1 || init.request_id !== requestId || !requestId) fail('invalid_init');
      progress = createProgressMonitor(emit, { bufferedBytes: () => process.stdout.writableLength, transportEnabled: true });
      await infer(request, emit, globalThis.fetch, progress);
    }
  } catch (error: any) {
    const code = error instanceof AdapterError && /^[a-z_]{3,64}(?:\d{3})?$/.test(error.message) ? error.message : 'provider_failure';
    emit({ type: 'error', code }); process.exitCode = 1;
  } finally {
    progress?.stop();
  }
}

if (import.meta.main) await runCli();

// Called only by the native quota-recovery owner, never by inference retries.
export async function recoverAccount(request: any, injected?: any) {
  validateIsolatedHomeForTests();
  const m = injected ?? await modules();
  const config = m.config.loadConfig();
  const providerId = request.providerId;
  if (!supported.includes(providerId) || !safeId(request.threadId) || !safeId(request.turnId) || !validModel(request.model)
      || !Array.isArray(request.excludedAccountIds) || request.excludedAccountIds.length > 1024
      || request.excludedAccountIds.some((id: any) => typeof id !== 'string')
      || (request.expectedAccountId !== undefined && typeof request.expectedAccountId !== 'string')) fail('invalid_selection');
  const directory = join(process.env.CODEX_HOME!, 'azrael', 'providers', 'sessions');
  const path = join(directory, request.threadId + '.json');
  if (!existsSync(path)) fail('invalid_binding');
  const physicalRelative = relative(realpathSync(process.env.CODEX_HOME!), realpathSync(directory));
  if (physicalRelative.startsWith('..') || isAbsolute(physicalRelative)) fail('binding_storage_not_isolated');
  const lock = path + '.lock';
  let guard: OAuthFileLockGuard;
  // Admission never waits on another turn. Allow the upstream 120s credential
  // lease to expire before reclaiming a lock abandoned by a killed helper.
  try { guard = await (m.store.createOAuthFileLock ?? createOAuthFileLock)({ path: lock, waitTimeoutMs: 0, staleAfterMs: 120_000 }).acquire(); }
  catch { fail('binding_busy'); }
  try {
    const binding = readBinding(path, request.threadId, directory);
    const source = binding.turns[request.turnId], current = binding.providers[providerId];
    if (!source || source.provider_id !== providerId || source.model !== request.model || !current
        || source.account_id !== current.account_id || source.fingerprint !== current.fingerprint
        || (request.expectedAccountId !== undefined && request.expectedAccountId !== source.account_id)) fail('turn_selection_mismatch');
    const sourceIdentity = accountIdentity(providerId, m.store.getAccountSet(providerId)?.accounts.find((entry: any) => entry.id === source.account_id));
    const validateSource = async () => {
      const resolved = await resolvePin(config, providerId, source, m);
      if (resolved.accountId !== source.account_id || resolved.fingerprint !== source.fingerprint) fail('pinned_account_changed');
    };
    await validateSource();
    const excluded = new Set([source.account_id, ...request.excludedAccountIds]);
    for (const candidate of eligibleAccounts(providerId, m, excluded)) {
      await validateSource();
      let resolved;
      try { resolved = await resolvePin(config, providerId, { account_id: candidate.id } as Pin, m); }
      catch { await validateSource(); continue; }
      const fresh = m.store.getAccountSet(providerId)?.accounts.find((entry: any) => entry.id === candidate.id);
      if (resolved.accountId !== candidate.id || !autoSwitchAvailable(providerId, fresh, m) || !autoSwitchAllowed(providerId, fresh)) continue;
      const destinationIdentity = accountIdentity(providerId, fresh);
      let destinationAgain;
      try { destinationAgain = await resolvePin(config, providerId, { account_id: candidate.id } as Pin, m); }
      catch { await validateSource(); continue; }
      await validateSource();
      if (destinationAgain.fingerprint !== resolved.fingerprint) continue;
      // Serialize the final consent read and binding rename with opt-out. No
      // credential refresh or other asynchronous work runs in this transaction.
      const committed = withAutoSwitchPolicyMutation(m, () => {
        const sourceNow = m.store.getAccountSet(providerId)?.accounts.find((entry: any) => entry.id === source.account_id);
        if (!sourceIdentity || accountIdentity(providerId, sourceNow) !== sourceIdentity || !autoSwitchAvailable(providerId, sourceNow, m)) fail('pinned_account_changed');
        const destination = m.store.getAccountSet(providerId)?.accounts.find((entry: any) => entry.id === candidate.id);
        if (accountIdentity(providerId, destination) !== destinationIdentity || !autoSwitchAvailable(providerId, destination, m)
            || !autoSwitchAllowed(providerId, destination)) return null;
        const pin = { account_id: candidate.id, fingerprint: resolved.fingerprint };
        if (!validPin(pin)) fail('pinned_account_unavailable');
        binding.providers[providerId] = pin;
        binding.turns[request.turnId] = { ...pin, provider_id: providerId, model: request.model };
        const serialized = JSON.stringify(binding);
        if (Buffer.byteLength(serialized) > MAX_BINDING_BYTES) fail('binding_limit');
        const temporary = path + '.' + randomUUID() + '.tmp';
        try { writeFileSync(temporary, serialized, { mode: 0o600, flag: 'wx' }); renameSync(temporary, path); }
        finally { if (existsSync(temporary)) unlinkSync(temporary); }
        return { exhaustedAccountId: source.account_id, accountId: candidate.id };
      });
      if (committed) return committed;
    }
    await validateSource();
    return null;
  } finally { guard!.release(); }
}
