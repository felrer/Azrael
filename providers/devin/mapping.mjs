import { createHash } from 'node:crypto';

export const MAX_BYTES = 8 * 1024 * 1024;
// Request frames may carry base64 images in addition to the bounded text context.
export const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
export const MAX_IMAGES = 100;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export class AdapterError extends Error {}
export function fail(code, diagnostics) {
  const error = new AdapterError(code);
  if (diagnostics) error.diagnostics = diagnostics;
  throw error;
}
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
  return JSON.stringify([namespace || 'functions', name, kind]);
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
export function parseImage(part, budget) {
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
  return { mimeType, base64Data };
}
// Text-only content keeps the established string projection; image content
// becomes the vendored transport's ordered multimodal parts.
function multimodal(content, budget) {
  if (!Array.isArray(content) || !content.some(part => part?.type === 'input_image')) return plainText(content);
  return content.map(part => {
    if (object(part) && part.type === 'input_image') return { type: 'image', ...parseImage(part, budget) };
    return { type: 'text', text: plainText([part]) };
  });
}

// The model-facing alias is request-scoped; the digest keeps history stable as
// lazy tools are added. Only exact declared aliases are accepted on return.
export function compileRequest(request) {
  if (!object(request) || request.protocol_version !== 1 || request.type !== 'request' ||
      !string(request.request_id) || !Array.isArray(request.input) || !Array.isArray(request.tools)) fail('invalid_request');
  if (!string(request.model) || !request.model.trim() || bytes(request.model) > 256 ||
      /[\x00-\x1f\x7f-\x9f]/.test(request.model)) fail('unsupported_native_model');
  const names = new Map();
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
  const messages = [];
  if (request.instructions) messages.push({ role: 'system', content: bounded(request.instructions) });
  const calls = new Set();
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
  for (const item of request.input) {
    if (!object(item)) fail('invalid_history_item');
    switch (item.type) {
      case 'message': {
        if (!['system', 'developer', 'user', 'assistant'].includes(item.role)) fail('unsupported_message_role');
        if (item.role === 'assistant') appendAssistant('content', plainText(item.content));
        else {
          assistant = undefined;
          messages.push({ role: item.role === 'developer' ? 'system' : item.role,
            content: item.role === 'user' ? multimodal(item.content, images) : plainText(item.content) });
        }
        break;
      }
      case 'agent_message':
        assistant = undefined;
        messages.push({ role: 'user', content: `Agent message from ${bounded(item.author)} to ${bounded(item.recipient)}:\n${plainText(item.content)}` });
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
        (message.tool_calls ??= []).push({ id, name: alias(item.namespace ?? '', name, kind), arguments: args });
        break;
      }
      case 'function_call_output':
      case 'custom_tool_call_output':
        if (!calls.has(item.call_id) || results.has(item.call_id)) fail('orphan_or_duplicate_tool_result');
        results.add(item.call_id);
        assistant = undefined;
        messages.push({ role: 'tool', tool_call_id: item.call_id, content: multimodal(item.output, images) });
        break;
      case 'tool_search_output':
        if (item.execution !== 'client' || !calls.has(item.call_id) || results.has(item.call_id) || !Array.isArray(item.tools)) fail('invalid_tool_search_result');
        results.add(item.call_id);
        assistant = undefined;
        messages.push({ role: 'tool', tool_call_id: item.call_id, content: bounded(JSON.stringify({ status: item.status, tools: item.tools })) });
        break;
      case 'additional_tools':
        // Catalog already assembled by native Codex. These are history entries,
        // not permission to execute undeclared tools in the current request.
        if (!Array.isArray(item.tools)) fail('invalid_additional_tools');
        break;
      case 'reasoning':
        if (item.content?.length || item.summary?.length) appendAssistant('thinking', plainText(item.content?.length ? item.content : item.summary));
        if (item.encrypted_content?.startsWith('azrael-devin-v1:')) {
          const prefix = 'azrael-devin-v1:';
          const metadata = JSON.parse(Buffer.from(bounded(item.encrypted_content).slice(prefix.length), 'base64').toString('utf8'));
          // A model/provider switch projects public history without rewriting
          // the rollout or forwarding another model's private replay material.
          if (metadata.model === request.model && metadata.thread === request.thread_id && metadata.account === request.credential_scope) {
            const signature = bounded(metadata.signature);
            if (signature) assistantMessage().signature = signature;
          }
        }
        break;
      default: fail('unsupported_history_item', { history_type: item.type });
    }
  }
  // Base64 is ASCII and JSON-safe, so the image payload is excluded exactly.
  if (bytes(JSON.stringify({ messages, tools })) - images.bytes > MAX_BYTES) fail('context_limit');
  return { messages, tools, names, calls, parallel: request.parallel_tool_calls === true, model: request.model, thread: request.thread_id, account: request.credential_scope };
}

export function restoreToolCall(call, compiled) {
  const owner = compiled.names.get(call.name);
  if (!owner) fail('undeclared_tool');
  if (!string(call.id) || !call.id || compiled.calls.has(call.id)) fail('duplicate_call_id');
  const args = JSON.parse(bounded(call.arguments));
  if (!object(args)) fail('tool_arguments_not_object');
  compiled.calls.add(call.id);
  const common = { call_id: call.id, name: owner.name, ...(owner.namespace ? { namespace: owner.namespace } : {}) };
  if (owner.kind === 'custom') {
    if (Object.keys(args).length !== 1 || !string(args.input)) fail('invalid_custom_wrapper');
    return { type: 'custom_tool_call', ...common, input: bounded(args.input) };
  }
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
  let terminal;
  let usage;
  let eventCount = 0;
  let lastEvent;
  const pending = [];
  const FINISH_REASONS = ['stop', 'tool_calls', 'length', 'content_filter'];
  // Structural diagnostics for an incomplete terminal: counts, allowlisted
  // reason strings and the numeric protobuf StopReason only — never provider
  // text, payloads, or raw event bodies.
  const finishDiagnostics = (event, hadActive) => {
    const diagnostics = {
      event_count: eventCount,
      last_event: lastEvent,
      pending_tool_count: pending.length,
      active_tool_call: hadActive,
    };
    if (FINISH_REASONS.includes(event.reason)) diagnostics.finish_reason = event.reason;
    const v = event.providerStopReason;
    if (Number.isInteger(v) && v >= 0 && v <= 13) diagnostics.provider_stop_reason = v;
    return diagnostics;
  };
  const closeText = () => {
    if (!messageId) return;
    emit({ type: 'item_done', item: { type: 'message', id: messageId, role: 'assistant', content: [{ type: 'output_text', text }] } });
    text = ''; messageId = undefined;
  };
  const closeCall = () => {
    if (!active) return;
    pending.push(restoreToolCall(active, compiled));
    active = undefined;
  };
  for await (const event of events) {
    eventCount++;
    lastEvent = event.kind;
    if (terminal && event.kind !== 'usage') fail('event_after_finish', { event_count: eventCount, last_event: lastEvent });
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
        if (!compiled.parallel && pending.length) fail('parallel_calls_disabled');
        active = { id: event.id, name: event.name, arguments: '' };
        break;
      case 'tool_call_args':
        if (!active || (event.id && event.id !== active.id)) fail('orphan_tool_delta');
        active.arguments = bounded(active.arguments + bounded(event.argsDelta));
        break;
      case 'usage': {
        usage ??= { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
        for (const [wire, native] of [['promptTokens', 'input_tokens'], ['completionTokens', 'output_tokens'], ['cachedInputTokens', 'cached_input_tokens'], ['reasoningTokens', 'reasoning_output_tokens']]) {
          const value = event[wire];
          if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) fail('invalid_usage');
          if (value !== undefined) usage[native] = Math.max(usage[native], value);
        }
        usage.total_tokens = usage.input_tokens + usage.output_tokens;
        break;
      }
      case 'finish': {
        const hadActive = active !== undefined;
        if (!['stop', 'tool_calls'].includes(event.reason)) fail('provider_incomplete', finishDiagnostics(event, hadActive));
        closeCall();
        if (event.reason === 'tool_calls' && !pending.length) fail('provider_incomplete', finishDiagnostics(event, hadActive));
        closeText(); terminal = event.reason;
        break;
      }
      default: fail('unknown_provider_event');
    }
  }
  if (!terminal) fail('provider_eof', { event_count: eventCount, last_event: lastEvent });
  if (reasoning || signature) emit({ type: 'item_done', item: {
    type: 'reasoning', summary: reasoning ? [{ type: 'summary_text', text: reasoning }] : [],
    encrypted_content: signature ? 'azrael-devin-v1:' + Buffer.from(JSON.stringify({ model: compiled.model, thread: compiled.thread, account: compiled.account, signature })).toString('base64') : null,
  } });
  for (const item of pending) emit({ type: 'item_done', item });
  emit({ type: 'completed', usage });
}
