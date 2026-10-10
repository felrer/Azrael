import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { AdapterError, fail, mapStream, MAX_BYTES } from './inference-mapping.mjs';
import { projectRequest, readBinding, translate, observeDetails } from './inference.ts';
import { acquireApiLock, apiDirectory, apiIdentity, apiProviderIdentity, apiToken, atomicJson, boundedJson, isApiProvider, normalizeConnection, readConnections, type ApiConnection, type ApiModel } from './custom-api-config.ts';
import { createOpenAIChatAdapter } from './vendor/src/adapters/openai-chat.ts';
import { createResponsesPassthroughAdapter } from './vendor/src/adapters/openai-responses.ts';
import { createTranslatorBudget } from './vendor/src/lib/translator-budget.ts';
import { decodeServerSentEvents } from './vendor/src/lib/sse-decoder.ts';

const safeId = (v: any) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) && !['__proto__', 'prototype', 'constructor'].includes(v);
async function pinApi(request: any, c: ApiConnection, fingerprint: string, providerFingerprint: string, signal: AbortSignal) {
  if (!safeId(request.thread_id) || !safeId(request.turn_id)) fail('invalid_selection');
  const directory = join(process.env.CODEX_HOME!, 'azrael', 'providers', 'sessions');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const rel = relative(realpathSync(process.env.CODEX_HOME!), realpathSync(directory));
  if (rel.startsWith('..') || isAbsolute(rel)) fail('binding_storage_not_isolated');
  const path = join(directory, request.thread_id + '.json');
  const release = await acquireApiLock(path + '.lock', signal);
  try {
    const binding = existsSync(path) ? readBinding(path, request.thread_id, directory) : { version: 1 as const, thread_id: request.thread_id, providers: Object.create(null), turns: Object.create(null) };
    if (!existsSync(path) && request.forked_from_thread_id && request.fork_provider_ids?.length) {
      if (!safeId(request.forked_from_thread_id) || !Array.isArray(request.fork_provider_ids) || request.fork_provider_ids.length > 130) fail('fork_binding_unavailable');
      const parent = join(directory, request.forked_from_thread_id + '.json');
      if (!existsSync(parent)) fail('fork_binding_unavailable');
      const ancestor = readBinding(parent, request.forked_from_thread_id, directory);
      for (const id of request.fork_provider_ids) {
        if (!ancestor.providers[id]) fail('fork_binding_unavailable');
        binding.providers[id] = ancestor.providers[id];
      }
    }
    const previous = binding.turns[request.turn_id];
    if (previous && (previous.provider_id !== request.provider_id || previous.model !== request.model)) fail('turn_selection_mismatch');
    if (previous && previous.fingerprint !== fingerprint) fail('api_connection_changed');
    const retained = binding.providers[request.provider_id];
    if (retained && retained.fingerprint !== providerFingerprint) fail('api_connection_changed');
    const pin = { account_id: c.id, fingerprint };
    binding.providers[request.provider_id] = { account_id: c.id, fingerprint: providerFingerprint };
    binding.turns[request.turn_id] = { ...pin, provider_id: request.provider_id, model: request.model };
    atomicJson(path, binding);
  } finally { release!(); }
}
async function acquireSlot(c: ApiConnection, signal: AbortSignal) {
  const directory = apiDirectory();
  for (;;) {
    for (let n = 0; n < c.maxConcurrent; n++) {
      const release = await acquireApiLock(join(directory, c.id + '.slot-' + n + '.lock'), signal, false);
      if (release) return release;
    }
    await new Promise<void>(r => { const timer = setTimeout(done, 40); function done() { clearTimeout(timer); signal.removeEventListener('abort', done); r(); } signal.addEventListener('abort', done, { once: true }); });
  }
}
function responsesBody(compiled: any, c: ApiConnection, m: ApiModel) {
  const input: any[] = [];
  for (const message of compiled.messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') { input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }); continue; }
    if (message.content) input.push({ type: 'message', role: message.role, content: message.role === 'assistant' ? [{ type: 'output_text', text: message.content }] : typeof message.content === 'string' ? [{ type: 'input_text', text: message.content }] : message.content });
    for (const call of message.tool_calls ?? []) input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments });
  }
  return { model: m.id, instructions: compiled.messages.filter((v: any) => v.role === 'system').map((v: any) => v.content).join('\n'), input, tools: compiled.tools.map((t: any) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })), stream: c.stream, store: false, max_output_tokens: m.maxOutputTokens, parallel_tool_calls: m.parallelToolCalls, ...(m.sendThinkingParameter ? { reasoning: { effort: m.enableThinking ? 'medium' : 'none' } } : {}) };
}
// Responses passthrough's parseResponse is compaction-only. Normalize its completed
// public response to Chat's mature full-response parser, including all tool calls.
function normalizedResponse(value: any) {
  if (!value || value.status !== 'completed' || value.error || !Array.isArray(value.output)) fail(value?.status === 'incomplete' ? 'provider_incomplete' : 'invalid_api_response');
  let content = '', reasoning = ''; const tool_calls: any[] = [];
  for (const item of value.output) {
    if (item.type === 'message') {
      if (!Array.isArray(item.content)) fail('invalid_api_response');
      for (const part of item.content) { if (part.type !== 'output_text' || typeof part.text !== 'string') fail('unsupported_provider_output'); content += part.text; }
    } else if (item.type === 'function_call') tool_calls.push({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } });
    else if (item.type === 'reasoning') {
      for (const part of item.summary ?? []) { if (part.type !== 'summary_text' || typeof part.text !== 'string') fail('unsupported_provider_output'); reasoning += part.text; }
    } else fail('unsupported_provider_output');
  }
  const usage = value.usage;
  return { choices: [{ message: { role: 'assistant', content, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(tool_calls.length ? { tool_calls } : {}) }, finish_reason: tool_calls.length ? 'tool_calls' : 'stop' }], ...(usage ? { usage: { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, prompt_tokens_details: usage.input_tokens_details, completion_tokens_details: usage.output_tokens_details } } : {}) };
}
async function* responseEvents(response: Response, budget: any, signal: AbortSignal, chat: any, progress?: any) {
  if (!response.body) fail('provider_eof');
  let completed: any;
  for await (const frame of decodeServerSentEvents(response.body, { translatorBudget: budget, signal })) {
    if (signal.aborted) fail('provider_request_deadline');
    if (Buffer.byteLength(frame.data) > MAX_BYTES) fail('output_limit');
    let value: any; try { value = JSON.parse(frame.data); } catch { if (frame.data === '[DONE]') continue; fail('invalid_provider_stream'); }
    progress?.observe({ kind: 'bytes', bytes: Buffer.byteLength(frame.data) });
    if (['error', 'response.failed'].includes(value.type)) fail('provider_failure');
    if (value.type === 'response.incomplete') fail('provider_incomplete');
    if (value.type === 'response.completed') { completed = value.response; break; }
  }
  if (!completed) fail('provider_eof');
  for (const event of await chat.parseResponse(Response.json(normalizedResponse(completed)), budget)) yield event;
}
export async function inferApi(request: any, emit: (frame: any) => void, fetcher = globalThis.fetch, progress?: any, options: { deadlineSignal?: AbortSignal } = {}) {
  if (!isApiProvider(request.provider_id)) fail('invalid_selection');
  const c = readConnections().find(v => 'api-' + v.id === request.provider_id);
  if (!c || !c.enabled) fail('api_connection_missing');
  const m = c.models.find(v => v.id === request.model); if (!m) fail('api_model_missing');
  if (!m.supportsTools && request.tools.length) fail('api_tools_unsupported');
  if (request.api_options) {
    const frozen = normalizeConnection(request.api_options);
    if (frozen.models.length !== 1 || frozen.models[0].id !== request.model || apiIdentity(frozen, frozen.models[0]) !== apiIdentity(c, m)) fail('api_connection_changed');
  }
  const signal = AbortSignal.any([AbortSignal.timeout(c.timeoutMs), ...(options.deadlineSignal ? [options.deadlineSignal] : [])]);
  // Snapshot config and protected credential under the mutation lock: an update
  // must never pair its new secret with the previous endpoint.
  const configLock = join(apiDirectory(), 'config.lock');
  const releaseConfig = await acquireApiLock(configLock, signal);
  let token: string | undefined;
  try {
    const live = readConnections().find(v => v.id === c.id), selected = live?.models.find(v => v.id === m.id);
    if (!live?.enabled || !selected) fail('api_connection_missing');
    if (apiIdentity(live, selected) !== apiIdentity(c, m)) fail('api_connection_changed');
    token = apiToken(live);
  } finally { releaseConfig!(); }
  const fingerprint = apiIdentity(c, m, token);
  await pinApi(request, c, fingerprint, apiProviderIdentity(c, token), signal);
  const retirement = new AbortController(); let changedCode: string | undefined;
  const check = () => { if (existsSync(configLock)) return; try { const live = readConnections().find(v => v.id === c.id); const selected = live?.models.find(v => v.id === m.id); if (!live?.enabled || !selected) changedCode = 'api_connection_missing'; else if (apiIdentity(live, selected, apiToken(live)) !== fingerprint) changedCode = 'api_connection_changed'; } catch { changedCode = 'api_connection_unavailable'; } if (changedCode) retirement.abort(); };
  const activeSignal = AbortSignal.any([signal, retirement.signal]);
  const timer = setInterval(check, 250);
  let release: (() => void) | undefined; const budget = createTranslatorBudget();
  try {
    release = await acquireSlot(c, activeSignal); check(); if (changedCode) fail(changedCode);
    const { compiled, parsed } = projectRequest({ ...request, parallel_tool_calls: m.parallelToolCalls, reasoning_effort: m.sendThinkingParameter && m.enableThinking ? 'medium' : undefined }, fingerprint);
    parsed.stream = c.stream; parsed.options = { ...parsed.options, maxOutputTokens: m.maxOutputTokens, parallelToolCalls: m.parallelToolCalls };
    const provider: any = { adapter: c.protocol === 'chat' ? 'openai-chat' : 'openai-responses', baseUrl: c.baseUrl, authMode: token ? 'key' : 'local', apiKey: token, models: [m.id], statelessResponses: true };
    const chat = createOpenAIChatAdapter(provider);
    const adapter = c.protocol === 'chat' ? chat : createResponsesPassthroughAdapter({ ...provider, responsesPath: c.baseUrl.endsWith('/responses') ? '' : '/responses' });
    if (c.protocol === 'responses') (parsed as any)._rawBody = responsesBody(compiled, c, m);
    const built = await adapter.buildRequest(parsed as any, { headers: new Headers(), translatorBudget: budget, abortSignal: activeSignal });
    const body = JSON.parse(built.body);
    body.model = m.id; body.stream = c.stream; body.parallel_tool_calls = m.parallelToolCalls;
    if (c.protocol === 'chat') { body.max_tokens = m.maxOutputTokens; if (m.sendThinkingParameter) body.chat_template_kwargs = { enable_thinking: m.enableThinking }; }
    else body.max_output_tokens = m.maxOutputTokens;
    progress?.observe({ kind: 'phase', phase: 'headers' });
    const response = await fetcher(built.url, { method: built.method, headers: built.headers, body: JSON.stringify(body), signal: activeSignal, redirect: 'error' });
    if (!response.ok) { void response.body?.cancel().catch(() => {}); fail('provider_http_' + response.status); }
    progress?.observe({ kind: 'phase', phase: 'stream' });
    const opaque = { details: [], terminal: !c.stream || c.protocol === 'responses' };
    let events: AsyncIterable<any>;
    if (c.stream && c.protocol === 'chat') events = chat.parseStream(observeDetails(response, opaque, false, false, (bytes: number) => progress?.observe({ kind: 'bytes', bytes })), budget);
    else if (c.stream) events = responseEvents(response, budget, activeSignal, chat, progress);
    else {
      const raw = await boundedJson(response, activeSignal);
      if (c.protocol === 'chat') {
        const message = raw?.choices?.[0]?.message;
        if (!raw?.choices?.[0]?.finish_reason) fail('provider_eof');
        if (message && ((message.content != null && typeof message.content !== 'string') || message.images?.length || message.audio)) fail('unsupported_provider_output');
      }
      const list = await chat.parseResponse(Response.json(c.protocol === 'chat' ? raw : normalizedResponse(raw)), budget);
      events = (async function* () { yield* list; })();
    }
    const guardedEmit = (frame: any) => {
      if (frame.type === 'completed' || frame.type === 'item_done') { check(); if (changedCode) fail(changedCode); if (signal.aborted) fail('provider_request_deadline'); }
      emit(frame);
    };
    await mapStream(translate(events, opaque, event => progress?.observe({ kind: 'event', event })), { ...compiled, provider: request.provider_id, turn: request.turn_id, opaque }, guardedEmit, request.request_id);
  } catch (e) {
    if (changedCode) fail(changedCode);
    if (signal.aborted) fail('provider_request_deadline');
    if (e instanceof AdapterError) throw e;
    fail('api_connection_failed');
  } finally { clearInterval(timer); release?.(); budget.dispose(); }
}
