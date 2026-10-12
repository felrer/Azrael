import { createHash } from 'node:crypto';
import { anthropicPromptSection } from './anthropic-prompt-format.mjs';
import { projectSearchHistory } from '../devin/tool-search-history.mjs';

// Native protocol/tool projection adapted from providers/devin/mapping.mjs.
// Managed transport and provider-private replay remain owned by inference.ts.

export const MAX_BYTES = 8 * 1024 * 1024;
// Request frames may carry base64 images in addition to the bounded text context.
export const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
export const MAX_IMAGES = 100;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export class AdapterError extends Error {}
export function fail(code) { throw new AdapterError(code); }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string';
const bytes = value => Buffer.byteLength(value, 'utf8');
function bounded(value) {
  if (!string(value) || bytes(value) > MAX_BYTES) fail('invalid_or_oversized_text');
  return value;
}
function identity(namespace, name, kind) {
  if (!string(name) || !name || /[\x00-\x1f\x7f]/.test(name) ||
      !string(namespace) || /[\x00-\x1f\x7f]/.test(namespace)) fail('invalid_tool_identity');
  return JSON.stringify([namespace, name, kind]);
}
function alias(namespace, name, kind) {
  return 'az_' + createHash('sha256').update(identity(namespace, name, kind)).digest('hex').slice(0, 40);
}
function plainText(content) {
  if (string(content)) return bounded(content);
  if (!Array.isArray(content)) fail('unsupported_content');
  return bounded(content.map(part => {
    if (!object(part) || !['input_text', 'output_text', 'text', 'reasoning_text', 'summary_text'].includes(part.type)) {
      fail('unsupported_nontext_content');
    }
    return bounded(part.text);
  }).join('\n'));
}
// Native core prepares prompt images as data URLs. Remote URLs and other media
// are rejected rather than fetched or silently dropped.
function imageUrl(part, budget) {
  const url = part.image_url;
  if (!string(url)) fail('invalid_image_input');
  const comma = url.indexOf(',');
  const header = comma > 0 && comma <= 64 ? url.slice(0, comma).toLowerCase() : '';
  if (!header.startsWith('data:')) fail('remote_image_unsupported');
  const mimeType = header.slice(5, header.endsWith(';base64') ? -7 : undefined);
  if (!header.endsWith(';base64') || !IMAGE_MIME_TYPES.has(mimeType)) fail('unsupported_image_format');
  const base64Data = url.slice(comma + 1);
  if (!base64Data || base64Data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Data)) fail('invalid_image_input');
  budget.count += 1;
  budget.bytes += base64Data.length;
  if (budget.count > MAX_IMAGES || budget.bytes > MAX_IMAGE_BYTES) fail('image_input_too_large');
  return `data:${mimeType};base64,${base64Data}`;
}
// Text-only content keeps the established string projection; image content
// becomes the vendored adapters' ordered text/image parts.
function multimodal(content, budget) {
  if (!Array.isArray(content) || !content.some(part => part?.type === 'input_image')) return plainText(content);
  return content.map(part => {
    if (object(part) && part.type === 'input_image') return { type: 'image', imageUrl: imageUrl(part, budget) };
    return { type: 'text', text: plainText([part]) };
  });
}

// The model-facing alias is request-scoped; the digest keeps history stable as
// lazy tools are added. Return names resolve only within the current catalog.
export function compileRequest(request, { promptFormat, compactToolSearchResults = false } = {}) {
  if (!object(request) || request.protocol_version !== 1 || request.type !== 'request' ||
      !string(request.request_id) || !Array.isArray(request.input) || !Array.isArray(request.tools)) fail('invalid_request');
  if (!string(request.model) || !request.model.trim() || bytes(request.model) > 256 ||
      /[\x00-\x1f\x7f-\x9f]/.test(request.model)) fail('unsupported_native_model');
  const names = new Map();
  const acceptedNames = new Map();
  const tools = [];
  function declare(tool, namespace = '') {
    if (!object(tool)) fail('invalid_tool');
    if (tool.type === 'namespace') {
      if (namespace || !Array.isArray(tool.tools) || !string(tool.name)) fail('invalid_namespace');
      for (const child of tool.tools) declare(child, tool.name);
      return;
    }
    const kind = tool.type;
    if (!['function', 'custom', 'tool_search'].includes(kind)) fail('unsupported_tool_kind');
    if (kind === 'tool_search' && tool.execution !== 'client') fail('unsupported_hosted_search');
    const name = kind === 'tool_search' ? 'tool_search' : tool.name;
    const wireName = alias(namespace, name, kind);
    const owner = { namespace, name, kind };
    const prior = names.get(wireName);
    if (prior) fail('duplicate_tool_identity');
    names.set(wireName, owner);
    for (const accepted of new Set([wireName, name, namespace ? namespace + '.' + name : name])) {
      const candidates = acceptedNames.get(accepted) ?? new Set();
      candidates.add(wireName);
      acceptedNames.set(accepted, candidates);
    }
    const custom = kind === 'custom';
    const parameters = custom ? {
      type: 'object', properties: { input: { type: 'string', description: 'Exact freeform tool input; preserve code and newlines.' } },
      required: ['input'], additionalProperties: false,
    } : tool.parameters;
    if (!object(parameters)) fail('invalid_tool_schema');
    let description = `${namespace ? namespace + '.' : ''}${name}\n${tool.description ?? ''}`;
    if (custom && tool.format) description += `\nInput format: ${JSON.stringify(tool.format)}`;
    tools.push({ name: wireName, description: bounded(description), parameters });
  }
  for (const tool of request.tools) declare(tool);
  const searchHistory = compactToolSearchResults ? undefined : projectSearchHistory(request.input, names, alias);
  const format = promptFormat === 'anthropic-xml' ? anthropicPromptSection : (_tag, content) => content;
  const currentTaskIndex = request.input.findLastIndex(item => item?.type === 'message' && item.role === 'user');
  const messages = [];
  if (request.instructions) messages.push({ role: 'system', content: format('common_instructions', bounded(request.instructions)) });
  const calls = new Set();
  const historyAliases = new Set();
  const results = new Set();
  const images = { count: 0, bytes: 0 };
  let assistant;
  function assistantMessage() {
    if (!assistant) {
      assistant = { role: 'assistant', content: '' };
      messages.push(assistant);
    }
    return assistant;
  }
  function appendAssistant(field, text) {
    const message = assistantMessage();
    // Match upstream assistantText/assistantThinking: nonempty blocks joined
    // with newlines, independently for visible text and reasoning.
    if (text) message[field] = message[field] ? message[field] + '\n' + text : text;
  }
  for (const [index, item] of request.input.entries()) {
    if (!object(item)) fail('invalid_history_item');
    switch (item.type) {
      case 'message': {
        if (!['system', 'developer', 'user', 'assistant'].includes(item.role)) fail('unsupported_message_role');
        if (item.role === 'assistant') appendAssistant('content', plainText(item.content));
        else {
          assistant = undefined;
          messages.push({ role: item.role === 'developer' ? 'system' : item.role,
            content: item.role === 'user'
              ? format(index === currentTaskIndex ? 'current_task' : 'user_input', multimodal(item.content, images))
              : format('runtime_instructions', plainText(item.content)) });
        }
        break;
      }
      case 'agent_message':
        assistant = undefined;
        messages.push({ role: 'user', content: format('agent_message', `Agent message from ${bounded(item.author)} to ${bounded(item.recipient)}:\n${plainText(item.content)}`) });
        break;
      case 'function_call':
      case 'custom_tool_call':
      case 'tool_search_call': {
        if (item.encrypted_function_args?.length) fail('encrypted_tool_arguments_unsupported');
        const kind = item.type === 'function_call' ? 'function' : item.type === 'custom_tool_call' ? 'custom' : 'tool_search';
        const name = kind === 'tool_search' ? 'tool_search' : item.name;
        const id = bounded(item.call_id);
        if (!id || calls.has(id)) fail('duplicate_history_call_id');
        calls.add(id);
        const args = kind === 'custom' ? JSON.stringify({ input: bounded(item.input) }) :
          kind === 'tool_search' ? JSON.stringify(item.arguments) : bounded(item.arguments);
        JSON.parse(args);
        const message = assistantMessage();
        const historyAlias = alias(item.namespace ?? '', name, kind);
        historyAliases.add(historyAlias);
        (message.tool_calls ??= []).push({ id, name: historyAlias, arguments: args });
        break;
      }
      case 'function_call_output':
      case 'custom_tool_call_output':
        if (!calls.has(item.call_id) || results.has(item.call_id)) fail('orphan_or_duplicate_tool_result');
        results.add(item.call_id);
        assistant = undefined;
        messages.push({ role: 'tool', tool_call_id: item.call_id, content: format('tool_result', multimodal(item.output, images)) });
        break;
      case 'tool_search_output':
        if (item.execution !== 'client' || !calls.has(item.call_id) || results.has(item.call_id) || !Array.isArray(item.tools)) fail('invalid_tool_search_result');
        results.add(item.call_id);
        assistant = undefined;
        // API discovery uses only current aliases. Other providers retain the
        // latest uncovered definition, including nested Code Mode helpers.
        messages.push({ role: 'tool', tool_call_id: item.call_id, content: format('tool_result', bounded(JSON.stringify(
          compactToolSearchResults
            ? { status: item.status, tools: compactSearchTools(item.tools, names), guidance: 'Call only names in the current tools catalog. Search again for other tools.' }
            : searchHistory(item, index)
        ))) });
        break;
      case 'additional_tools':
        // Catalog already assembled by native Codex. These are history entries,
        // not permission to execute undeclared tools in the current request.
        if (!Array.isArray(item.tools)) fail('invalid_additional_tools');
        break;
      case 'reasoning':
        if (item.encrypted_content) {
          const prefix = 'azrael-managed-v1:';
          if (!item.encrypted_content.startsWith(prefix)) fail('opaque_reasoning_unsupported');
          const metadata = JSON.parse(Buffer.from(bounded(item.encrypted_content).slice(prefix.length), 'base64').toString('utf8'));
          if (metadata.model !== request.model || metadata.thread !== request.thread_id || metadata.account !== request.credential_scope || metadata.provider !== request.provider_id || metadata.turn !== request.turn_id) fail('reasoning_scope_mismatch_origin');
          appendAssistant('thinking', plainText(item.content?.length ? item.content : item.summary));
          const signature = bounded(metadata.signature ?? '');
          if (signature) assistantMessage().signature = signature;
        } else if (item.content?.length || item.summary?.length) appendAssistant('thinking', plainText(item.content?.length ? item.content : item.summary));
        break;
      default: fail('unsupported_history_item');
    }
  }
  // Base64 is ASCII and JSON-safe; the rebuilt data URL prefix stays within text slack.
  if (bytes(JSON.stringify({ messages, tools })) - images.bytes > MAX_BYTES) fail('context_limit');
  return { messages, tools, names, acceptedNames, calls, historyAliases, parallel: request.parallel_tool_calls === true, model: request.model, thread: request.thread_id, account: request.credential_scope };
}

function compactSearchTools(specs, names) {
  const selected = [];
  const seen = new Set();
  function visit(spec, namespace = '') {
    if (!object(spec)) return;
    if (spec.type === 'namespace' && Array.isArray(spec.tools)) {
      for (const child of spec.tools) visit(child, spec.name);
    } else if (string(spec.name) && ['function', 'custom'].includes(spec.type)) {
      const wireName = alias(namespace, spec.name, spec.type);
      if (names.has(wireName) && !seen.has(wireName)) {
        seen.add(wireName);
        selected.push({ name: wireName });
      }
    }
  }
  for (const spec of specs) visit(spec);
  return selected;
}

const diagnose = (compiled, method, ...args) => { try { compiled.toolDiagnostics?.[method]?.(...args); } catch {} };
function parseToolArguments(value, compiled) {
  const text = bounded(value);
  try { return JSON.parse(text); }
  catch {
    diagnose(compiled, 'json', 'invalid_json');
    diagnose(compiled, 'rejected', 'invalid_arguments');
    fail('tool_arguments_invalid_json');
  }
}
export function resolveToolName(name, compiled) {
  const candidates = compiled.acceptedNames.get(name);
  if (!candidates?.size) fail('undeclared_tool');
  if (candidates.size !== 1) fail('ambiguous_tool_name');
  return candidates.values().next().value;
}
export function restoreToolCall(call, compiled) {
  let wireName;
  try { wireName = resolveToolName(call.name, compiled); }
  catch (error) {
    diagnose(compiled, 'lookup', call.name, false);
    throw error;
  }
  const owner = compiled.names.get(wireName);
  diagnose(compiled, 'lookup', wireName, true);
  if (!string(call.id) || !call.id || compiled.calls.has(call.id)) { diagnose(compiled, 'rejected', 'duplicate_id'); fail('duplicate_call_id'); }
  const args = parseToolArguments(call.arguments, compiled);
  diagnose(compiled, 'json', object(args) ? 'valid_object' : 'not_object');
  if (!object(args)) { diagnose(compiled, 'rejected', 'invalid_arguments'); fail('tool_arguments_not_object'); }
  compiled.calls.add(call.id);
  const common = { call_id: call.id, name: owner.name, ...(owner.namespace ? { namespace: owner.namespace } : {}) };
  if (owner.kind === 'custom') {
    if (Object.keys(args).length !== 1 || !string(args.input)) { diagnose(compiled, 'rejected', 'invalid_custom_wrapper'); fail('invalid_custom_wrapper'); }
    diagnose(compiled, 'validated');
    return { type: 'custom_tool_call', ...common, input: bounded(args.input) };
  }
  const schema = compiled.tools.find(tool => tool.name === wireName)?.parameters;
  if (!Object.keys(args).length && Array.isArray(schema?.required) && schema.required.length) {
    diagnose(compiled, 'rejected', 'invalid_arguments'); fail('tool_arguments_missing_required');
  }
  diagnose(compiled, 'validated');
  if (owner.kind === 'tool_search') return { type: 'tool_search_call', call_id: call.id, execution: 'client', arguments: args, status: 'completed' };
  return { type: 'function_call', ...common, arguments: call.arguments };
}

// Buffer executable items until a clean provider terminal. A truncated/error
// stream must never accidentally turn partial model output into a command.
export async function mapStream(events, compiled, emit, requestId) {
  emit({ type: 'created' });
  let active;
  let text = '';
  let messageId;
  let messageIndex = 0;
  let reasoning = '';
  let signature = '';
  const opaqueCalls = [];
  let terminal;
  let usage;
  const pending = [];
  const closeText = () => {
    if (!messageId) return;
    emit({ type: 'item_done', item: { type: 'message', id: messageId, role: 'assistant', content: [{ type: 'output_text', text }] } });
    text = ''; messageId = undefined;
  };
  const closeCall = () => {
    if (!active) return;
    const restored = restoreToolCall(active, compiled);
    const metadata = opaqueCalls.find(call => call.id === active.id);
    if (metadata) {
      metadata.name = resolveToolName(active.name, compiled);
      const parsed = parseToolArguments(active.arguments, compiled);
      metadata.arguments_digest = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
    }
    pending.push(restored);
    active = undefined;
  };
  for await (const event of events) {
    if (terminal && event.kind !== 'usage') fail('event_after_finish');
    switch (event.kind) {
      case 'text':
        closeCall();
        if (!messageId) {
          messageId = `msg_${requestId}_${messageIndex++}`;
          emit({ type: 'item_added', item: { type: 'message', id: messageId, role: 'assistant', content: [{ type: 'output_text', text: '' }] } });
        }
        text = bounded(text + bounded(event.text));
        emit({ type: 'text_delta', delta: event.text });
        break;
      case 'reasoning': reasoning = bounded(reasoning + bounded(event.text)); break;
      case 'reasoning_signature': signature = bounded(signature + bounded(event.signature)); break;
      case 'tool_call_start':
        closeText(); closeCall();
        if (!compiled.parallel && pending.length) { diagnose(compiled, 'rejected', 'parallel_disabled'); fail('parallel_calls_disabled'); }
        active = { id: event.id, name: event.name, arguments: '' };
        diagnose(compiled, 'start', active);
        opaqueCalls.push({ id: event.id, name: event.name, ...(event.providerMetadata ? { providerMetadata: event.providerMetadata } : {}) });
        break;
      case 'tool_call_args':
        if (!active || (event.id && event.id !== active.id)) fail('orphan_tool_delta');
        active.arguments = bounded(active.arguments + bounded(event.argsDelta));
        diagnose(compiled, 'args', event.argsDelta);
        break;
      case 'usage': {
        usage ??= { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0, estimated: false };
        for (const [wire, native] of [['promptTokens', 'input_tokens'], ['completionTokens', 'output_tokens'], ['cachedInputTokens', 'cached_input_tokens'], ['reasoningTokens', 'reasoning_output_tokens']]) {
          const value = event[wire];
          if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) fail('invalid_usage');
          if (value !== undefined) usage[native] = Math.max(usage[native] ?? 0, value);
        }
        for (const [wire, native] of [['cacheCreationInputTokens', 'cache_write_input_tokens'], ['cacheWrite1hInputTokens', 'cache_write_1h_input_tokens']]) {
          const value = event[wire];
          if (value === undefined) continue;
          if (!Number.isSafeInteger(value) || value < 0) {
            usage.estimated = true;
            if (native === 'cache_write_input_tokens') usage[native] = 0;
            else delete usage[native];
          } else usage[native] = Math.max(usage[native] ?? 0, value);
        }
        if (event.usageEstimated !== undefined && typeof event.usageEstimated !== 'boolean') usage.estimated = true;
        usage.estimated ||= event.usageEstimated === true;
        usage.total_tokens = usage.input_tokens + usage.output_tokens;
        break;
      }
      case 'finish':
        if (!['stop', 'tool_calls'].includes(event.reason)) fail('provider_incomplete');
        closeCall(); closeText(); terminal = event.reason;
        break;
      default: fail('unknown_provider_event');
    }
  }
  if (!terminal) fail('provider_eof');
  if (usage && !Number.isSafeInteger(usage.total_tokens)) fail('invalid_usage');
  if (usage) {
    if (!Number.isSafeInteger(usage.cached_input_tokens + usage.cache_write_input_tokens) ||
        usage.cached_input_tokens + usage.cache_write_input_tokens > usage.input_tokens ||
        usage.reasoning_output_tokens > usage.output_tokens) usage.estimated = true;
    if (usage.cache_write_1h_input_tokens !== undefined && usage.cache_write_1h_input_tokens > usage.cache_write_input_tokens) {
      delete usage.cache_write_1h_input_tokens;
      usage.estimated = true;
    }
  }
  if (reasoning || signature || opaqueCalls.length || compiled.opaque?.details?.length) emit({ type: 'item_done', item: {
    type: 'reasoning', summary: reasoning ? [{ type: 'summary_text', text: reasoning }] : [],
    encrypted_content: signature || opaqueCalls.length || compiled.opaque?.details?.length ? 'azrael-managed-v1:' + Buffer.from(JSON.stringify({ provider: compiled.provider, model: compiled.model, thread: compiled.thread, turn: compiled.turn, account: compiled.account, signature, calls: opaqueCalls, reasoning_details: compiled.opaque?.details })).toString('base64') : null,
  } });
  for (const item of pending) emit({ type: 'item_done', item });
  emit({ type: 'completed', usage });
}
