import { createHash } from 'node:crypto';

// Request-local structural evidence only. Names/IDs stay private; arguments are
// counted, never retained. Instrumentation cannot change inference outcomes.
const hash = value => createHash('sha256').update(value).digest('hex');
const integer = value => Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value))) : 0;
const alias = /^az_[0-9a-f]{40}$/;
const mappingResults = new Set(['undeclared', 'duplicate_id', 'invalid_arguments', 'invalid_custom_wrapper', 'parallel_disabled']);
export function createToolDiagnostics({ now = () => performance.now(), wirePrefix = '' } = {}) {
  let clock = 0;
  const time = () => { try { const value = now(); if (Number.isFinite(value)) clock = Math.max(clock, value); } catch {} return clock; };
  const safe = fn => (...args) => { try { return fn(...args); } catch {} };
  const state = { call_count: 0, call_open: false, call_state: 'none', mapping_result: 'none', json_result: 'not_checked' };
  let names = new Map(), history = new Set(), originals = new Set(), qualified = new Set();
  let current, latestRaw;
  const rawCalls = new Map(), blocks = new Map();
  const nameEvidence = value => {
    if (typeof value !== 'string' || !value) return { bytes: 0, style: 'missing', match: 'missing' };
    const bytes = Buffer.byteLength(value);
    if (bytes > 512) return { bytes: integer(bytes), style: 'oversized', match: 'unknown' };
    const match = names.has(value) ? 'declared' : history.has(value) ? 'history_only' :
      originals.has(value) ? 'current_original' : qualified.has(value) ? 'current_qualified' : 'unknown';
    const style = alias.test(value) ? 'alias' : wirePrefix && value.startsWith(wirePrefix) && alias.test(value.slice(wirePrefix.length)) ? 'prefixed_alias' :
      match === 'current_original' ? 'original' : match === 'current_qualified' ? 'qualified' : 'other';
    return { bytes, style, match, hash: hash(value), canonicalHash: hash(wirePrefix && value.startsWith(wirePrefix) ? value.slice(wirePrefix.length) : value) };
  };
  const callKey = id => typeof id === 'string' && id && Buffer.byteLength(id) <= 512 ? hash(id) : undefined;
  const delta = (record, prefix, value) => {
    if (!record || typeof value !== 'string') return;
    const bytes = Buffer.byteLength(value);
    record[prefix + '_delta_count'] = integer((record[prefix + '_delta_count'] ?? 0) + 1);
    record[prefix + '_bytes'] = integer((record[prefix + '_bytes'] ?? 0) + bytes);
    if (!bytes) record[prefix + '_empty_delta_count'] = integer((record[prefix + '_empty_delta_count'] ?? 0) + 1);
    else record[prefix + '_last_ms'] = time();
  };
  return {
    catalog: safe(compiled => {
      names = compiled.names;
      history = compiled.historyAliases ?? new Set();
      originals = new Set([...names.values()].map(owner => owner.name));
      qualified = new Set([...names.values()].filter(owner => owner.namespace).map(owner => owner.namespace + '.' + owner.name));
      state.catalog_sha256 = hash(JSON.stringify([...names.keys()].sort()));
      state.catalog_tool_count = integer(names.size);
      state.history_alias_count = integer(history.size);
    }),
    raw: safe(value => {
      if (value?.type === 'content_block_start' && value.content_block?.type === 'tool_use') {
        const record = { name: nameEvidence(value.content_block.name), started: time(), sse_args_delta_count: 0, sse_args_empty_delta_count: 0, sse_args_bytes: 0 };
        const key = callKey(value.content_block.id);
        latestRaw = record;
        if (key) { if (rawCalls.size >= 64) rawCalls.delete(rawCalls.keys().next().value); rawCalls.set(key, record); }
        if (Number.isSafeInteger(value.index) && value.index >= 0) {
          if (blocks.size >= 64) blocks.delete(blocks.keys().next().value);
          blocks.set(value.index, record);
        }
      } else if (value?.type === 'content_block_delta' && value.delta?.type === 'input_json_delta') {
        delta(blocks.get(value.index), 'sse_args', value.delta.partial_json);
      } else if (value?.type === 'content_block_stop') blocks.delete(value.index);
    }),
    start: safe(call => {
      const key = callKey(call.id);
      current = { name: nameEvidence(call.name), raw: key ? rawCalls.get(key) : undefined,
        started: time(), args_last_ms: time(), args_delta_count: 0, args_empty_delta_count: 0, args_bytes: 0 };
      state.call_count = integer(state.call_count + 1);
      state.call_open = true; state.call_state = 'started'; state.mapping_result = 'none'; state.json_result = 'not_checked';
      delete state.declared_alias_sha256;
    }),
    args: safe(value => { delta(current, 'args', value); state.call_state = 'receiving_args'; }),
    ended: safe(() => { state.call_open = false; state.call_state = 'ended'; }),
    lookup: safe((name, declared) => {
      state.mapping_result = declared ? 'declared' : 'undeclared';
      if (declared && typeof name === 'string' && Buffer.byteLength(name) <= 512) state.declared_alias_sha256 = hash(name);
      if (!declared) { state.call_state = 'rejected'; state.call_open = false; }
    }),
    json: safe(result => { if (['valid_object', 'not_object', 'invalid_json'].includes(result)) state.json_result = result; }),
    rejected: safe(result => { state.mapping_result = mappingResults.has(result) ? result : 'invalid_arguments'; state.call_state = 'rejected'; state.call_open = false; }),
    validated: safe(() => { state.mapping_result = 'validated'; state.call_state = 'validated'; state.call_open = false; }),
    snapshot: safe(() => {
      const result = { ...state };
      const raw = current?.raw ?? (!current ? latestRaw : undefined);
      if (raw) {
        if (raw.name.hash) result.raw_name_sha256 = raw.name.hash;
        result.raw_name_bytes = raw.name.bytes;
        for (const field of ['sse_args_delta_count', 'sse_args_empty_delta_count', 'sse_args_bytes']) result[field] = raw[field];
      }
      if (current) {
        if (current.name.hash) result.parser_name_sha256 = current.name.hash;
        result.parser_name_bytes = current.name.bytes;
        result.name_style = current.name.style; result.name_match = current.name.match;
        if (raw?.name.canonicalHash && current.name.hash) result.raw_parser_name_equal = raw.name.canonicalHash === current.name.hash;
        for (const field of ['args_delta_count', 'args_empty_delta_count', 'args_bytes']) result[field] = current[field];
        result.args_idle_ms = integer(time() - current.args_last_ms);
        result.call_elapsed_ms = integer(time() - current.started);
      }
      return result;
    }),
  };
}
