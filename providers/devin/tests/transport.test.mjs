import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileRequest, mapStream } from '../mapping.mjs';
import { clearCachedUserJwt } from '../vendor/src/adapters/devin/cloud-direct/auth.ts';
import { clearCachedCatalog } from '../vendor/src/adapters/devin/cloud-direct/catalog.ts';
import { streamChatEvents } from '../vendor/src/adapters/devin/cloud-direct/chat.ts';
import { encodeMessage, encodeString, encodeTag, encodeVarintField, frameConnectStream } from '../vendor/src/adapters/devin/cloud-direct/wire.ts';

const compiled = () => compileRequest({ protocol_version: 1, type: 'request', request_id: 'transport-test',
  model: 'gpt-6-astra-low', input: [], tools: [{ type: 'function', name: 'example', parameters: { type: 'object' } }] });
function eos(value = '{}', compressed = true) {
  const frame = frameConnectStream(Buffer.from(value), compressed); frame[0] |= 2; return frame;
}
async function run(frames, output, signal, onEvent = () => {}, body) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    if (!String(url).endsWith('/GetChatMessage')) return new Response('', { status: 503 });
    calls++;
    return new Response(body ?? Buffer.concat(frames), { headers: { 'content-type': 'application/connect+proto' } });
  };
  try {
    await mapStream(streamChatEvents({ apiKey: 'synthetic-transport-key', apiServerUrl: 'https://server.codeium.com',
      modelUid: 'gpt-6-astra-low', messages: [{ role: 'user', content: 'fixture' }], tools: [], signal }),
    compiled(), event => { output.push(event); onEvent(event); }, 'transport-test');
  } finally { globalThis.fetch = original; assert.equal(calls, 1); }
}
const text = () => frameConnectStream(encodeString(3, 'synthetic answer'));

test('EOS provider evidence survives message enrichment while local transport failures carry none', async () => {
  await assert.rejects(run([eos(JSON.stringify({ error: { code: 'invalid_argument',
    message: 'an internal error occurred (trace ID: 0123456789abcdef)' } }))], []), error => {
    assert.equal(error.code, 'invalid_argument');
    assert.equal(error.status, 400);
    assert.match(error.message, /Cognition denied this request/);
    assert.deepEqual(error.providerDiagnostics, { provider_error_code: 'invalid_argument',
      provider_error_source: 'connect_trailer', provider_reason: 'internal_error',
      provider_trace_id: '0123456789abcdef' });
    return true;
  });
  await assert.rejects(run([text()], []), error => {
    assert.equal(error.code, 'truncated_stream');
    assert.equal(error.providerDiagnostics, undefined);
    return true;
  });
});

test('unknown protobuf groups are skipped without exposing nested finish fields', async () => {
  const group = Buffer.concat([encodeTag(999, 3), encodeTag(998, 3),
    encodeVarintField(5, 13), encodeTag(998, 4), encodeTag(999, 4), encodeString(3, 'answer')]);
  const output = [];
  await run([frameConnectStream(group), eos()], output);
  assert.equal(output.find(event => event.type === 'text_delta').delta, 'answer');
  assert.equal(output.at(-1).type, 'completed');
  for (const invalid of [encodeTag(999, 3), encodeTag(999, 4),
    Buffer.concat([encodeTag(999, 3), encodeTag(998, 4)])]) {
    await assert.rejects(run([text(), frameConnectStream(invalid), eos()], []));
  }
});

test('unsupported Connect flags and tool finish without a call fail closed', async () => {
  const invalidText = text(); invalidText[0] |= 4;
  const invalidEos = eos(); invalidEos[0] |= 4;
  for (const frames of [[invalidText, eos()], [text(), invalidEos],
    [frameConnectStream(encodeVarintField(5, 10)), eos()],
    [text(), frameConnectStream(encodeVarintField(5, 10)), eos()]]) {
    const output = [];
    await assert.rejects(run(frames, output));
    assert(!output.some(event => event.type === 'completed'));
  }
});

test('visible text with clean Connect EOS completes without a protobuf finish field', async () => {
  for (const compressed of [true, false]) {
    const output = [];
    await run([text(), eos('{}', compressed)], output);
    assert.equal(output.find(event => event.type === 'text_delta').delta, 'synthetic answer');
    assert.equal(output.filter(event => event.type === 'completed').length, 1);
  }
});

test('clean EOS validates tool arguments before delivering an executable call', async () => {
  const [name] = compiled().names.keys();
  for (const argumentsText of ['{}', '{"partial":', '']) {
    const output = [];
    const call = frameConnectStream(encodeMessage(6, Buffer.concat([
      encodeString(1, 'exact-call'), encodeString(2, name), encodeString(3, argumentsText),
    ])));
    if (argumentsText === '{}') {
      await run([call, eos()], output);
      assert.equal(output.find(event => event.item?.type === 'function_call').item.call_id, 'exact-call');
      assert.equal(output.at(-1).type, 'completed');
    } else {
      await assert.rejects(run([call, eos()], output));
      assert(!output.some(event => event.item?.type === 'function_call' || event.type === 'completed'));
    }
  }
});

test('missing, malformed, error and trailing EOS states never become successful completion', async () => {
  for (const frames of [
    [text()], [text(), eos().subarray(0, 8)], [text(), eos(), Buffer.from([0])],
    [text(), eos('not-json')], [text(), eos('null')], [text(), eos('[]')],
    [text(), eos('{"error":"invalid"}')], [text(), eos('{"error":null}')], [text(), eos('{"error":{}}')],
    [text(), eos('{"metadata":null}')], [text(), eos('{"metadata":{"key":"not-array"}}')],
    [text(), eos('{"metadata":{"key":[1]}}')],
    [text(), eos('{"error":{"code":"resource_exhausted","message":"synthetic quota"}}')],
    [text(), eos(), text()], [text(), eos(), eos()],
  ]) {
    const output = [];
    await assert.rejects(run(frames, output));
    assert(!output.some(event => event.type === 'completed'));
  }
});

test('clean EOS does not override explicit length termination or create output from reasoning alone', async () => {
  for (const frames of [[eos()], [frameConnectStream(encodeString(9, 'synthetic reasoning')), eos()],
    [text(), frameConnectStream(encodeVarintField(5, 3)), eos()],
    [text(), frameConnectStream(encodeVarintField(5, 13)), eos()],
    [text(), frameConnectStream(encodeVarintField(5, 99)), eos()]]) {
    const output = [];
    await assert.rejects(run(frames, output));
    assert(!output.some(event => event.type === 'completed'));
  }
});

test('explicit successful finish emits only one completion and cancellation emits none', async () => {
  const frames = [text(), frameConnectStream(encodeVarintField(5, 2)), eos()];
  const output = [];
  await run(frames, output);
  assert.equal(output.filter(event => event.type === 'completed').length, 1);
  const cancelled = [];
  await assert.rejects(run(frames, cancelled, AbortSignal.abort()));
  assert(!cancelled.some(event => event.type === 'completed'));
});

test('cancellation after explicit finish cannot turn into successful completion', async () => {
  const controller = new AbortController();
  const output = [];
  await assert.rejects(run([text(), frameConnectStream(encodeVarintField(5, 2)), eos()], output,
    controller.signal, event => { if (event.type === 'item_done') controller.abort(); }));
  assert(!output.some(event => event.type === 'completed'));
});

test('valid trailing metadata preserves successful finish-less completion', async () => {
  const output = [];
  await run([text(), eos('{"metadata":{"example-key":["value"]}}')], output);
  assert.equal(output.at(-1).type, 'completed');
});

test('malformed protobuf after visible output cannot be hidden by a clean EOS', async () => {
  for (const malformed of [Buffer.from([0x1a, 5, 65]), Buffer.from([0x61, 0]),
    Buffer.from([0x65, 0]), Buffer.from([0x0e]), Buffer.from([0, 1]),
    Buffer.from([8, 0x80]), Buffer.from([8, ...Array(10).fill(0x80), 1]),
    encodeMessage(6, Buffer.from([0x1a, 5, 65]))]) {
    const output = [];
    await assert.rejects(run([text(), frameConnectStream(malformed), eos()], output));
    assert(!output.some(event => event.type === 'completed' || event.item?.type === 'function_call'));
  }
});

test('valid unknown protobuf fields do not prevent clean completion', async () => {
  const output = [];
  await run([text(), frameConnectStream(encodeString(999, 'unknown field')), eos()], output);
  assert.equal(output.at(-1).type, 'completed');
});

test('cancellation while the response body is still open never completes', async () => {
  const controller = new AbortController();
  const output = [];
  let cancelled = false, fallback;
  const body = new ReadableStream({
    start(stream) { stream.enqueue(text()); fallback = setTimeout(() => stream.close(), 1000); },
    cancel() { cancelled = true; },
  });
  try {
    await assert.rejects(run([], output, controller.signal,
      event => { if (event.type === 'text_delta') controller.abort(); }, body));
    assert(cancelled, 'cancellation_must_cancel_the_locked_reader');
  } finally { clearTimeout(fallback); }
  assert(!output.some(event => event.type === 'completed'));
});

test('malformed frame after a complete tool delta prevents executable tool delivery', async () => {
  const [name] = compiled().names.keys();
  const output = [];
  const call = frameConnectStream(encodeMessage(6, Buffer.concat([
    encodeString(1, 'exact-call'), encodeString(2, name), encodeString(3, '{}'),
  ])));
  await assert.rejects(run([call, frameConnectStream(Buffer.from([0x1a, 5, 65])), eos()], output));
  assert(!output.some(event => event.type === 'completed' || event.item?.type === 'function_call'));
});

// Per-endpoint variant of run(): the catalog preflight and the chat call are
// counted separately so tests can assert on each leg independently. The
// catalog leg answers 503 — getCachedCatalog treats that as "no catalog" and
// the chat call proceeds, which is also what the pre-existing suite relies on.
// fetchCatalog mints a user_jwt first, so GetUserJwt must answer with a valid
// field-1 JWT protobuf or the catalog fetch is never reached.
const syntheticJwt = () => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString('base64url');
  return `eyJ${'A'.repeat(16)}.${payload}.syntheticsig`;
};
const clearAuthCaches = () => { clearCachedUserJwt(); clearCachedCatalog(); };
async function runEndpoints(frames, output, { skipCatalogPreflight = false, onProgress, chatStatus = 200, signal } = {}) {
  const original = globalThis.fetch;
  const calls = { catalog: 0, chat: 0, other: 0, jwt: 0 };
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.endsWith('/GetUserJwt')) {
      calls.jwt++;
      return new Response(encodeString(1, syntheticJwt()),
        { headers: { 'content-type': 'application/proto' } });
    }
    if (u.endsWith('/GetCascadeModelConfigs')) { calls.catalog++; return new Response('', { status: 503 }); }
    if (u.endsWith('/GetChatMessage')) {
      calls.chat++;
      if (chatStatus !== 200) return new Response('synthetic upstream denial', { status: chatStatus });
      return new Response(Buffer.concat(frames), { headers: { 'content-type': 'application/connect+proto' } });
    }
    calls.other++;
    return new Response('', { status: 503 });
  };
  try {
    await mapStream(streamChatEvents({
      apiKey: 'synthetic-transport-key', apiServerUrl: 'https://server.codeium.com',
      modelUid: 'gpt-6-astra-low', messages: [{ role: 'user', content: 'fixture' }], tools: [],
      ...(signal ? { signal } : {}),
      ...(skipCatalogPreflight ? { skipCatalogPreflight: true } : {}),
      ...(onProgress ? { onProgress } : {}),
    }), compiled(), event => output.push(event), 'transport-test');
  } finally { globalThis.fetch = original; }
  return calls;
}

test('skipCatalogPreflight performs zero catalog fetches but keeps the real chat transport', async () => {
  clearAuthCaches();
  const output = [];
  const calls = await runEndpoints([text(), eos()], output, { skipCatalogPreflight: true });
  assert.equal(calls.catalog, 0, 'opt-out must not touch GetCascadeModelConfigs');
  assert.equal(calls.chat, 1, 'GetChatMessage still runs on the normal transport');
  assert.equal(calls.other, 0);
  assert.equal(calls.jwt, 0, 'no JWT mint when the catalog is skipped');
  assert.equal(output.find(event => event.type === 'text_delta').delta, 'synthetic answer');
  assert.equal(output.at(-1).type, 'completed');
});

test('default request still preflights the model catalog before chatting', async () => {
  clearAuthCaches();
  const output = [];
  const calls = await runEndpoints([text(), eos()], output);
  assert.equal(calls.catalog, 1, 'default path must attempt GetCascadeModelConfigs');
  assert.equal(calls.chat, 1);
  assert.equal(output.at(-1).type, 'completed');
});

test('skipped preflight does not swallow an inference HTTP error', async () => {
  clearAuthCaches();
  const output = [];
  await assert.rejects(
    runEndpoints([], output, { skipCatalogPreflight: true, chatStatus: 500 }),
    error => error?.status === 500);
  assert(!output.some(event => event.type === 'completed'));
});

test('progress events cover reasoning and tool fragments while executable calls wait for a clean finish', async () => {
  clearAuthCaches();
  const [name] = compiled().names.keys();
  // Reasoning (#9), then a tool call split across a start frame carrying an
  // argument fragment and a second frame carrying only the argument tail.
  const fragments = [
    frameConnectStream(encodeString(9, 'synthetic reasoning')),
    frameConnectStream(encodeMessage(6, Buffer.concat([
      encodeString(1, 'call-1'), encodeString(2, name), encodeString(3, '{"partial":'),
    ]))),
    frameConnectStream(encodeMessage(6, encodeString(3, '1}'))),
    frameConnectStream(encodeVarintField(5, 10)),
    eos(),
  ];
  const progress = [];
  const output = [];
  let prematureExecutable = false;
  const calls = await runEndpoints(fragments, output, {
    skipCatalogPreflight: true,
    onProgress: event => {
      progress.push(event);
      // mapStream must not release an executable item while the provider is
      // still streaming — only a clean terminal may unlock it.
      if (event.kind === 'event' && event.event !== 'finish' &&
          output.some(e => e.item?.type === 'function_call')) {
        prematureExecutable = true;
      }
    },
  });
  assert.equal(calls.chat, 1);
  assert.equal(prematureExecutable, false, 'function_call escaped before the finish event');

  const phases = progress.filter(e => e.kind === 'phase').map(e => e.phase);
  assert.deepEqual(phases, ['preflight', 'headers', 'stream']);
  assert(progress.some(e => e.kind === 'bytes' && e.bytes > 0));
  const decoded = progress.filter(e => e.kind === 'event').map(e => e.event);
  for (const kind of ['reasoning', 'tool_call_start', 'tool_call_args', 'finish']) {
    assert(decoded.includes(kind), `progress missing decoded ${kind}`);
  }

  const call = output.find(event => event.item?.type === 'function_call');
  assert.equal(call.item.call_id, 'call-1');
  assert.equal(call.item.arguments, '{"partial":1}');
  assert.equal(output.at(-1).type, 'completed');
});

test('progress still streams on failure but no executable call escapes mapStream', async () => {
  clearAuthCaches();
  const [name] = compiled().names.keys();
  const fragments = [
    frameConnectStream(encodeString(9, 'synthetic reasoning')),
    frameConnectStream(encodeMessage(6, Buffer.concat([
      encodeString(1, 'call-1'), encodeString(2, name), encodeString(3, '{}'),
    ]))),
    frameConnectStream(Buffer.from([0x1a, 5, 65])), // malformed protobuf
    eos(),
  ];
  const progress = [];
  const output = [];
  await assert.rejects(runEndpoints(fragments, output, {
    skipCatalogPreflight: true,
    onProgress: event => progress.push(event),
  }));
  assert(!output.some(event => event.type === 'completed' || event.item?.type === 'function_call'));
  const decoded = progress.filter(e => e.kind === 'event').map(e => e.event);
  assert(decoded.includes('reasoning'));
  assert(decoded.includes('tool_call_start'));
});

test('synthetic finish after verified EOS carries no providerStopReason', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    if (!String(url).endsWith('/GetChatMessage')) return new Response('', { status: 503 });
    return new Response(Buffer.concat([text(), eos()]), { headers: { 'content-type': 'application/connect+proto' } });
  };
  try {
    const events = [];
    for await (const event of streamChatEvents({ apiKey: 'synthetic-transport-key',
      apiServerUrl: 'https://server.codeium.com', modelUid: 'gpt-6-astra-low',
      messages: [{ role: 'user', content: 'fixture' }], tools: [] })) {
      events.push(event);
    }
    const finish = events.find(event => event.kind === 'finish');
    assert.deepEqual(finish, { kind: 'finish', reason: 'stop' });
    assert.equal('providerStopReason' in finish, false,
      'synthetic EOF finish must never fabricate a protobuf stop reason');
  } finally { globalThis.fetch = original; }
});
