import { fail, MAX_BYTES } from './inference-mapping.mjs';
import { decodeServerSentEvents } from './vendor/src/lib/sse-decoder.ts';
import type { AdapterEvent, OcxUsage } from './vendor/src/types.ts';

const object = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: any) => typeof v === 'string';
const nonempty = (v: any) => text(v) && v.length > 0;
const bounded = (v: any) => { if (Buffer.byteLength(JSON.stringify(v)) > MAX_BYTES) fail('output_limit'); return v; };
function contentParts(value: any, assistant = false) {
  if (text(value)) return [{ type: assistant ? 'output_text' : 'input_text', text: value }];
  if (!Array.isArray(value)) fail('invalid_meta_content');
  return value.map((p: any) => {
    if (object(p) && ['text', 'input_text', 'output_text'].includes(p.type) && text(p.text)) return { type: assistant ? 'output_text' : 'input_text', text: p.text };
    if (!assistant && object(p) && p.type === 'image' && nonempty(p.imageUrl)) return { type: 'input_image', image_url: p.imageUrl };
    if (!assistant && object(p) && p.type === 'input_image' && nonempty(p.image_url)) return { type: 'input_image', image_url: p.image_url, ...(p.detail !== undefined ? { detail: p.detail } : {}) };
    fail('invalid_meta_content');
  });
}

// Only native Responses reasoning items cross this boundary. Provider envelopes,
// signatures and unknown fields must never turn into replayable request content.
function reasoningItem(v: any) {
  if (!object(v) || v.type !== 'reasoning' || Object.keys(v).some(k => !['type', 'id', 'summary', 'encrypted_content', 'status'].includes(k))
    || (v.id !== undefined && !nonempty(v.id)) || (v.encrypted_content !== undefined && !nonempty(v.encrypted_content))
    || (v.status !== undefined && !['completed', 'in_progress'].includes(v.status))
    || (v.summary !== undefined && (!Array.isArray(v.summary) || v.summary.some((s: any) => !object(s) || s.type !== 'summary_text' || !text(s.text) || Object.keys(s).some(k => !['type', 'text'].includes(k)))))) fail('invalid_meta_reasoning');
  return bounded({ type: 'reasoning', ...(v.id !== undefined ? { id: v.id } : {}), ...(v.summary !== undefined ? { summary: v.summary.map((s: any) => ({ ...s })) } : {}), ...(v.encrypted_content !== undefined ? { encrypted_content: v.encrypted_content } : {}) });
}

export function metaResponsesBody(compiled: any, replayDetails: { details: any[]; callIds: string[]; calls: any[] }[], reasoningEffort?: string) {
  const input: any[] = [], messages = compiled.messages;
  const replayItems = replayDetails.map(r => ({ ...r, details: r.details.map(reasoningItem) }));
  bounded(replayItems.map(r => r.details));
  const lastAssistant = messages.findLastIndex((m: any) => m.role === 'assistant');
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'system') continue;
    if (m.role === 'assistant') {
      const ids = (m.tool_calls ?? []).map((c: any) => c.id);
      for (const replay of replayItems) {
        if (replay.callIds.length ? replay.callIds.every(id => ids.includes(id)) : i === lastAssistant) input.push(...replay.details.map(reasoningItem));
      }
    }
    if (m.role === 'tool') { input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: text(m.content) ? m.content : contentParts(m.content) }); continue; }
    if (m.content) input.push({ type: 'message', role: m.role, content: contentParts(m.content, m.role === 'assistant') });
    for (const c of m.tool_calls ?? []) input.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: c.arguments });
  }
  return { model: compiled.model, instructions: messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n'), input,
    tools: compiled.tools.map((t: any) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })),
    parallel_tool_calls: compiled.parallel, stream: true, store: false, include: ['reasoning.encrypted_content'],
    ...(reasoningEffort !== undefined ? { reasoning: { effort: reasoningEffort } } : {}) };
}

function usageOf(v: any): OcxUsage | undefined {
  if (v === undefined || v === null) return undefined;
  const integer = (n: any) => { if (!Number.isSafeInteger(n) || n < 0) fail('invalid_meta_usage'); return n; };
  if (!object(v)) fail('invalid_meta_usage');
  const inputTokens = integer(v.input_tokens), outputTokens = integer(v.output_tokens);
  const cache = v.input_tokens_details?.cached_tokens, reasoning = v.output_tokens_details?.reasoning_tokens;
  if (v.total_tokens !== undefined) integer(v.total_tokens);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
    ...(cache !== undefined ? { cacheReadInputTokens: integer(cache), cachedInputTokens: integer(cache) } : {}),
    ...(reasoning !== undefined ? { reasoningOutputTokens: integer(reasoning) } : {}) };
}

type StreamItem = { id?: string; type?: string; name?: string; call_id?: string; args?: string; argsSeen?: boolean; doneArgs?: string; rawThought?: boolean; texts: Map<number, string>; thoughts: Map<number, string> };
export async function* parseMetaResponses(response: Response, budget: any, opaque: { details: any[]; terminal: boolean; upstreamSseError?: boolean }, options: { signal?: AbortSignal; onEvent?: (event: string) => void } = {}): AsyncGenerator<AdapterEvent> {
  opaque.terminal = false;
  if (options.signal?.aborted) fail('provider_request_deadline');
  if (!response.body) fail('provider_eof');
  const items = new Map<number, StreamItem>(); let retained = 0;
  const retainBytes = (count: number) => { retained += count; if (retained > MAX_BYTES) fail('output_limit'); };
  const retain = (v: string) => retainBytes(Buffer.byteLength(v));
  const state = (e: any) => {
    if (!Number.isSafeInteger(e.output_index) || e.output_index < 0) fail('invalid_meta_event');
    let s = items.get(e.output_index);
    if (!s) {
      // Empty delta/lifecycle frames must still pay for their retained state.
      // Otherwise an unbounded set of output indices could bypass byte limits.
      retainBytes(256);
      s = { texts: new Map(), thoughts: new Map() }; items.set(e.output_index, s);
    }
    if (e.item_id !== undefined) { if (!nonempty(e.item_id) || (s.id !== undefined && s.id !== e.item_id)) fail('meta_stream_mismatch'); s.id = e.item_id; }
    return s;
  };
  for await (const frame of decodeServerSentEvents(response.body!, { translatorBudget: budget, signal: options.signal })) {
    if (options.signal?.aborted) fail('provider_request_deadline');
    if (Buffer.byteLength(frame.data) > MAX_BYTES) fail('output_limit');
    let e: any; try { e = JSON.parse(frame.data); } catch { fail('invalid_meta_event'); }
    if (!object(e) || !nonempty(e.type) || (frame.event && frame.event !== e.type)) fail('invalid_meta_event');
    if (['error', 'response.failed', 'response.incomplete'].includes(e.type)) { opaque.upstreamSseError = true; fail('provider_incomplete'); }
    if (e.type === 'response.output_item.added' || e.type === 'response.output_item.done') {
      const s = state(e), v = e.item;
      if (!object(v) || !['message', 'function_call', 'reasoning'].includes(v.type)) fail('unsupported_provider_output');
      for (const k of ['id', 'type', 'name', 'call_id'] as const) if (v[k] !== undefined) { if (!nonempty(v[k]) || (s[k] !== undefined && s[k] !== v[k])) fail('meta_stream_mismatch'); s[k] = v[k]; retain(v[k]); }
      if (e.type === 'response.output_item.done' && v.type === 'function_call') {
        if (!text(v.arguments) || (s.doneArgs !== undefined && s.doneArgs !== v.arguments)) fail('meta_stream_mismatch');
        s.doneArgs = v.arguments; retain(v.arguments);
      }
      continue;
    }
    if (e.type === 'response.function_call_arguments.delta') {
      const s = state(e); if (!text(e.delta)) fail('invalid_meta_event');
      retain(e.delta); s.args = (s.args ?? '') + e.delta; s.argsSeen = true;
      if (e.delta) options.onEvent?.('tool_call_args'); continue;
    }
    if (e.type === 'response.function_call_arguments.done') {
      const s = state(e);
      if (!text(e.arguments) || (s.doneArgs !== undefined && s.doneArgs !== e.arguments)) fail('meta_stream_mismatch');
      s.doneArgs = e.arguments; retain(e.arguments); continue;
    }
    const isText = e.type === 'response.output_text.delta';
    const isThought = ['response.reasoning_summary_text.delta', 'response.reasoning_text.delta'].includes(e.type);
    if (isText || isThought) {
      const s = state(e), index = isText ? e.content_index : (e.summary_index ?? e.content_index ?? 0);
      if (!Number.isSafeInteger(index) || index < 0 || !text(e.delta)) fail('invalid_meta_event');
      retain(e.delta); const map = isText ? s.texts : s.thoughts;
      if (e.type !== 'response.reasoning_text.delta') {
        if (!map.has(index)) retainBytes(64);
        map.set(index, (map.get(index) ?? '') + e.delta);
      }
      else s.rawThought = true;
      yield isText ? { type: 'text_delta', text: e.delta } : { type: 'thinking_delta', thinking: e.delta }; continue;
    }
    if (e.type === 'response.completed') {
      const r = e.response;
      if (!object(r) || r.status !== 'completed' || r.error || !Array.isArray(r.output)) fail('provider_incomplete');
      retain(JSON.stringify(r.output)); const calls: any[] = [], details: any[] = [], residual: AdapterEvent[] = [], ids = new Set<string>();
      for (let i = 0; i < r.output.length; i++) {
        const v = r.output[i], s = items.get(i);
        if (!object(v) || (s?.id !== undefined && s.id !== v.id) || (s?.type !== undefined && s.type !== v.type)) fail('meta_stream_mismatch');
        if (v.status !== undefined && v.status !== 'completed') fail('provider_incomplete');
        if ((s?.argsSeen || s?.doneArgs !== undefined) && v.type !== 'function_call' || s?.texts.size && v.type !== 'message' || (s?.thoughts.size || s?.rawThought) && v.type !== 'reasoning') fail('meta_stream_mismatch');
        if (v.type === 'function_call') {
          if (!nonempty(v.call_id) || !nonempty(v.name) || !text(v.arguments) || ids.has(v.call_id)
            || (s?.call_id !== undefined && s.call_id !== v.call_id) || (s?.name !== undefined && s.name !== v.name) || (s?.argsSeen && s.args !== v.arguments) || (s?.doneArgs !== undefined && s.doneArgs !== v.arguments)) fail('meta_stream_mismatch');
          try { if (!object(JSON.parse(v.arguments))) fail('invalid_tool_arguments'); } catch { fail('invalid_tool_arguments'); }
          ids.add(v.call_id); calls.push(v);
        } else if (v.type === 'message') {
          if (v.role !== 'assistant' || !Array.isArray(v.content)) fail('unsupported_provider_output');
          for (let j = 0; j < v.content.length; j++) {
            const p = v.content[j]; if (!object(p) || p.type !== 'output_text' || !text(p.text)) fail('unsupported_provider_output');
            const prior = s?.texts.get(j); if (prior !== undefined && prior !== p.text) fail('meta_stream_mismatch');
            if (prior === undefined && p.text) residual.push({ type: 'text_delta', text: p.text });
          }
          if (s && [...s.texts.keys()].some(j => j >= v.content.length)) fail('meta_stream_mismatch');
        } else if (v.type === 'reasoning') {
          const detail = reasoningItem(v);
          for (const [j, prior] of s?.thoughts ?? []) if (v.summary?.[j]?.text !== prior) fail('meta_stream_mismatch');
          if (!s?.rawThought) for (let j = 0; j < (detail.summary?.length ?? 0); j++) {
            if (!s?.thoughts.has(j) && detail.summary[j].text) residual.push({ type: 'thinking_delta', thinking: detail.summary[j].text });
          }
          if (detail.encrypted_content) details.push(detail);
        } else fail('unsupported_provider_output');
      }
      if ([...items.keys()].some(i => i >= r.output.length)) fail('meta_stream_mismatch');
      const usage = usageOf(r.usage);
      bounded([...opaque.details, ...details]); opaque.details.push(...details); opaque.terminal = true;
      yield* residual;
      for (const c of calls) { yield { type: 'tool_call_start', id: c.call_id, name: c.name }; yield { type: 'tool_call_delta', arguments: c.arguments }; yield { type: 'tool_call_end' }; }
      yield { type: 'done', usage, stopReason: calls.length ? 'tool_calls' : 'stop' }; return;
    }
    // Lifecycle and redundant done snapshots carry no public content. Unknown
    // events cannot silently introduce a new executable output kind.
    if (!['response.created', 'response.in_progress', 'response.output_text.done', 'response.content_part.added', 'response.content_part.done', 'response.function_call_arguments.done', 'response.reasoning_summary_part.added', 'response.reasoning_summary_part.done', 'response.reasoning_summary_text.done', 'response.reasoning_text.done'].includes(e.type)) fail('unsupported_provider_output');
  }
  fail(options.signal?.aborted ? 'provider_request_deadline' : 'provider_eof');
}
