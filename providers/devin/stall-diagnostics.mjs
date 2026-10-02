// Temporary, payload-free stall evidence. Remove together with transport hooks.
import { createHash } from 'node:crypto';
const sseKinds = ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop', 'ping', 'error', 'google_data'];
const parserKinds = ['text_delta', 'thinking_delta', 'reasoning_raw_delta', 'thinking_signature', 'tool_call_start', 'tool_call_delta', 'tool_call_end', 'heartbeat', 'usage', 'done', 'error'];
const integer = value => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)));
export function createStallDiagnostics({ now = () => performance.now() } = {}) {
  const started = now();
  const state = { abort_source: 'none', error_stage: 'none', error_name: 'none' };
  let readStarted, parserStarted, lastSse;
  // Instrumentation must never change request outcomes, even with a broken clock.
  const safe = fn => (...args) => { try { return fn(...args); } catch {} };
  const add = key => state[key] = integer((state[key] ?? 0) + 1);
  return {
    snapshot: safe(() => ({ ...state,
      ...(readStarted !== undefined ? { read_wait_ms: integer(now() - readStarted) } : {}),
      ...(parserStarted !== undefined ? { parser_wait_ms: integer(now() - parserStarted) } : {}),
      ...(lastSse !== undefined ? { sse_idle_ms: integer(now() - lastSse) } : {}) })),
    headers: safe(response => {
      if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) state.headers_status = response.status;
      state.headers_ms = integer(now() - started);
      for (const [header, field] of [['request-id', 'request_id_sha256'], ['server', 'server_sha256'], ['via', 'via_sha256']]) {
        const value = response.headers.get(header);
        // Skip oversized values rather than retain or truncate arbitrary headers.
        if (value && Buffer.byteLength(value) <= 4096) state[field] = createHash('sha256').update(value).digest('hex');
      }
    }),
    readBegin: safe(() => { state.read_state = 'pending'; readStarted = now(); add('read_count'); }),
    readEnd: safe(({ done, value }) => {
      state.read_wait_ms = integer(now() - readStarted); readStarted = undefined;
      state.read_state = done ? 'eof' : 'received';
      if (!done) { add('chunk_count'); state.last_chunk_bytes = integer(value.byteLength); }
    }),
    cancelled: safe(() => {
      if (readStarted !== undefined) state.read_wait_ms = integer(now() - readStarted);
      state.read_state = 'cancelled'; readStarted = undefined; state.abort_source = 'cancelled';
    }),
    pending: safe(bytes => { state.sse_pending_bytes = integer(bytes); }),
    sse: safe(value => {
      const kind = sseKinds.includes(value?.type) ? value.type : 'unknown';
      state.last_sse_event = kind; add('sse_event_count'); lastSse = now();
      if (kind === 'ping') add('heartbeat_count');
      if (kind === 'unknown') add('unknown_sse_count');
      if (kind === 'content_block_start') {
        state.content_block_open = true;
        state.content_block_kind = ['text', 'thinking', 'redacted_thinking', 'tool_use'].includes(value.content_block?.type) ? value.content_block.type : 'unknown';
      }
      if (kind === 'content_block_stop') { state.content_block_open = false; state.content_block_kind = 'none'; }
      if (kind === 'message_stop') state.finish_seen = true;
      if (kind === 'error') { state.error_stage = 'sse_decode'; state.error_name = 'adapter_error'; }
    }),
    parserBegin: safe(() => { state.parser_state = 'pending'; parserStarted = now(); }),
    parserEnd: safe(({ done, value }) => {
      state.parser_wait_ms = integer(now() - parserStarted); parserStarted = undefined;
      state.parser_state = done ? 'done' : 'yielded';
      if (!done) {
        add('parser_event_count');
        const kind = value?.type ?? ({ text: 'text_delta', reasoning: 'thinking_delta', reasoning_signature: 'thinking_signature', tool_call_start: 'tool_call_start', tool_call_args: 'tool_call_delta', usage: 'usage', finish: 'done' })[value?.kind];
        state.last_parser_event = parserKinds.includes(kind) ? kind : 'unknown';
        if (kind === 'done') state.finish_seen = true;
      }
    }),
    error: safe((stage, error, signal) => {
      if (state.error_stage === 'none') state.error_stage = ['build', 'headers', 'body_read', 'sse_decode', 'adapter_parse', 'translate', 'map'].includes(stage) ? stage : 'unknown';
      state.error_name = error?.name === 'TimeoutError' ? 'timeout' : error?.name === 'AbortError' ? 'abort' : error instanceof TypeError ? 'type_error' : error?.constructor?.name === 'AdapterError' ? 'adapter_error' : 'unknown';
      state.abort_source = signal?.aborted ? 'deadline' : ['abort', 'timeout'].includes(state.error_name) ? 'transport' : 'unknown';
      if (stage === 'body_read') {
        if (readStarted !== undefined) state.read_wait_ms = integer(now() - readStarted);
        state.read_state = 'error'; readStarted = undefined;
      }
      if (stage === 'adapter_parse') {
        if (parserStarted !== undefined) state.parser_wait_ms = integer(now() - parserStarted);
        state.parser_state = 'error'; parserStarted = undefined;
      }
    }),
  };
}

// Demand-driven single reader, no tee or eager drain. Cancellation reaches source.
export function observeRawReads(response, tracker) {
  if (!tracker || !response.body) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      tracker.readBegin();
      try {
        const result = await reader.read(); tracker.readEnd(result);
        if (result.done) { controller.close(); reader.releaseLock(); }
        else controller.enqueue(result.value);
      } catch (error) { tracker.error('body_read', error); controller.error(error); reader.releaseLock(); }
    },
    async cancel(reason) { tracker.cancelled(); try { await reader.cancel(reason); } finally { reader.releaseLock(); } },
  }, { highWaterMark: 0 });
  return new Response(body, { status: response.status, headers: response.headers });
}

export async function* observeParser(events, tracker) {
  if (!tracker) { yield* events; return; }
  const iterator = events[Symbol.asyncIterator]();
  let done = false;
  try {
    while (!done) {
      tracker.parserBegin();
      const result = await iterator.next(); tracker.parserEnd(result); done = result.done;
      if (!done) yield result.value;
    }
  } catch (error) { tracker.error('adapter_parse', error); throw error; }
  finally { if (!done) await iterator.return?.(); }
}
