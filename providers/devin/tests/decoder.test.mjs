import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileRequest, mapStream } from '../mapping.mjs';
import { decodeChatFrame } from '../vendor/src/adapters/devin/cloud-direct/chat.ts';
import { encodeMessage, encodeString, encodeVarintField } from '../vendor/src/adapters/devin/cloud-direct/wire.ts';

const request = () => compileRequest({ protocol_version: 1, type: 'request', request_id: 'decoder-test',
  model: 'swe-2-medium', input: [], tools: [{ type: 'function', name: 'example', parameters: { type: 'object' } }] });
async function* decoded(frames) { for (const frame of frames) yield* decodeChatFrame(frame); }

test('finish field preceding same-frame tool delta and signature completes one call', async () => {
  const compiled = request();
  const [name] = compiled.names.keys();
  const frame = Buffer.concat([
    encodeVarintField(5, 10),
    encodeMessage(6, Buffer.concat([encodeString(1, 'call-1'), encodeString(2, name), encodeString(3, '{}')])),
    encodeString(10, 'synthetic-signature'),
  ]);
  const emitted = [];
  await mapStream(decoded([frame]), compiled, event => emitted.push(event), 'decoder-test');
  assert.deepEqual(emitted.filter(event => event.item?.type === 'function_call').map(event => event.item.call_id), ['call-1']);
  assert.equal(emitted.at(-1).type, 'completed');
});

test('finish order within one protobuf frame does not change delivered text', async () => {
  for (const fields of [[encodeVarintField(5, 2), encodeString(3, 'answer')], [encodeString(3, 'answer'), encodeVarintField(5, 2)]]) {
    const emitted = [];
    await mapStream(decoded([Buffer.concat(fields)]), request(), event => emitted.push(event), 'decoder-test');
    assert.equal(emitted.find(event => event.type === 'text_delta').delta, 'answer');
    assert.equal(emitted.at(-1).type, 'completed');
  }
});

test('content in a different frame after finish remains a protocol failure', async () => {
  const emitted = [];
  await assert.rejects(mapStream(decoded([encodeVarintField(5, 2), encodeString(3, 'late')]), request(),
    event => emitted.push(event), 'decoder-test'), /event_after_finish/);
  assert.equal(emitted.some(event => event.type === 'completed'), false);
});

test('multiple finish fields cannot downgrade an incomplete response to success', async () => {
  const emitted = [];
  await assert.rejects(mapStream(decoded([Buffer.concat([encodeVarintField(5, 3), encodeVarintField(5, 2)])]),
    request(), event => emitted.push(event), 'decoder-test'), /Multiple finish/);
  assert.equal(emitted.some(event => event.type === 'completed'), false);
});

test('empty and unfinished streams retain failure and expose only structural diagnostics', async () => {
  for (const [frames, expected] of [[[], { event_count: 0, last_event: undefined }],
    [[encodeString(9, 'private reasoning')], { event_count: 1, last_event: 'reasoning' }]]) {
    await assert.rejects(mapStream(decoded(frames), request(), () => {}, 'decoder-test'), error => {
      assert.equal(error.message, 'provider_eof');
      assert.deepEqual(error.diagnostics, expected);
      assert.equal(JSON.stringify(error.diagnostics).includes('private'), false);
      return true;
    });
  }
});

test('wire finish reasons keep their original protobuf StopReason enum', async () => {
  for (const [v, reason] of [[1, 'length'], [3, 'length'], [10, 'tool_calls'], [11, 'content_filter'], [2, 'stop']]) {
    const events = [...decodeChatFrame(encodeVarintField(5, v))];
    assert.deepEqual(events, [{ kind: 'finish', reason, providerStopReason: v }]);
  }
});

test('rejected wire finishes carry provider_stop_reason through provider_incomplete', async () => {
  for (const [v, reason] of [[1, 'length'], [3, 'length'], [11, 'content_filter']]) {
    await assert.rejects(mapStream(decoded([encodeVarintField(5, v)]), request(), () => {}, 'decoder-test'), error => {
      assert.equal(error.message, 'provider_incomplete');
      assert.equal(error.diagnostics.finish_reason, reason);
      assert.equal(error.diagnostics.provider_stop_reason, v);
      assert.equal(error.diagnostics.event_count, 1);
      assert.equal(error.diagnostics.last_event, 'finish');
      assert.equal(error.diagnostics.pending_tool_count, 0);
      assert.equal(error.diagnostics.active_tool_call, false);
      return true;
    });
  }
});
