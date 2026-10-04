import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStallDiagnostics, observeRawReads, observeParser } from '../stall-diagnostics.mjs';
import { createProgressMonitor } from '../progress.mjs';

test('read demand, wait, exact bytes and source cancellation', async () => {
  let time = 0, source, cancelled, pulls = 0;
  const tracker = createStallDiagnostics({ now: () => time });
  const response = new Response(new ReadableStream({ start(c) { source = c; }, pull() { pulls++; }, cancel(reason) { cancelled = reason; } }, { highWaterMark: 0 }));
  const reader = observeRawReads(response, tracker).body.getReader();
  assert.equal(pulls, 0);
  const pending = reader.read();
  await Promise.resolve(); time = 35;
  assert.equal(tracker.snapshot().read_state, 'pending');
  assert.equal(tracker.snapshot().read_wait_ms, 35);
  const chunk = new Uint8Array([0, 255, 1]); source.enqueue(chunk);
  assert.strictEqual((await pending).value, chunk);
  assert.equal(tracker.snapshot().chunk_count, 1);
  await reader.cancel('SECRET_CANCEL');
  assert.equal(cancelled, 'SECRET_CANCEL');
  assert.equal(tracker.snapshot().read_state, 'cancelled');
  assert(!JSON.stringify(tracker.snapshot()).includes('SECRET'));
});

test('parser wait does not prefetch and iterator cancellation is forwarded', async () => {
  let resolve, time = 0, returns = 0, next = 0;
  const tracker = createStallDiagnostics({ now: () => time });
  const events = { [Symbol.asyncIterator]() { return { next() { next++; return new Promise(r => { resolve = r; }); }, async return() { returns++; return { done: true }; } }; } };
  const iterator = observeParser(events, tracker);
  const waiting = iterator.next(); time = 70;
  assert.equal(tracker.snapshot().parser_wait_ms, 70);
  resolve({ done: false, value: { type: 'thinking_delta', thinking: 'SECRET_THINKING' } });
  await waiting; assert.equal(next, 1);
  assert.equal(tracker.snapshot().last_parser_event, 'thinking_delta');
  await iterator.return(); assert.equal(returns, 1);
  assert(!JSON.stringify(tracker.snapshot()).includes('SECRET'));
});

test('all secret fields are dropped, headers hashed and bounded, native absent evidence stays absent', () => {
  const tracker = createStallDiagnostics();
  tracker.headers(new Response(null, { headers: { 'request-id': 'SECRET_ID', server: 'SECRET_SERVER', via: 'SECRET_VIA', authorization: 'SECRET_AUTH', 'x-secret': 'SECRET_HEADER' } }));
  tracker.sse({ type: 'content_block_start', content_block: { type: 'thinking', thinking: 'SECRET_THINKING', id: 'SECRET_BLOCK' }, url: 'SECRET_URL', prompt: 'SECRET_PROMPT', args: 'SECRET_ARGS' });
  assert.equal(tracker.snapshot().content_block_kind, 'thinking');
  tracker.sse({ type: 'ping', secret: 'SECRET_PING' });
  tracker.sse({ type: 'unknown_SECRET_EVENT' });
  tracker.error('SECRET_STAGE', { name: 'SECRET_NAME', message: 'SECRET_EXCEPTION', stack: 'SECRET_STACK', token: 'SECRET_TOKEN' });
  const json = JSON.stringify(tracker.snapshot()); assert(!json.includes('SECRET'));
  assert.match(tracker.snapshot().request_id_sha256, /^[a-f0-9]{64}$/);
  assert.equal(tracker.snapshot().heartbeat_count, 1);
  assert.equal(tracker.snapshot().unknown_sse_count, 1);
  const native = createStallDiagnostics(); native.parserBegin(); native.parserEnd({ done: false, value: { kind: 'text', text: 'SECRET_NATIVE' } });
  for (const field of ['read_state', 'sse_event_count', 'headers_status', 'content_block_kind']) assert.equal(native.snapshot()[field], undefined);
  const oversized = createStallDiagnostics(); oversized.headers(new Response(null, { headers: { server: 'x'.repeat(4097) } }));
  assert.equal(oversized.snapshot().server_sha256, undefined);
});

test('progress diagnostics opt in and retain existing periodic plus terminal snapshots', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const frames = [], monitor = createProgressMonitor(f => frames.push(f), { transportEnabled: true });
  monitor.transport.parserBegin(); t.mock.timers.tick(10_000);
  assert.equal(frames[0].progress.transport.parser_state, 'pending');
  monitor.stop(); assert.equal(monitor.snapshot().transport.parser_state, 'pending');
  const disabled = createProgressMonitor(() => {}); assert(!('transport' in disabled.snapshot())); disabled.stop();
});

test('instrumentation failure cannot fail the underlying byte stream', async () => {
  let calls = 0;
  const tracker = createStallDiagnostics({ now() { if (calls++ > 0) throw new Error('SECRET_CLOCK'); return 0; } });
  tracker.headers({ get status() { throw new Error('SECRET_HEADERS'); } });
  const response = observeRawReads(new Response(new Uint8Array([1, 2, 255])), tracker);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 255]);
  assert.doesNotThrow(() => tracker.snapshot());
});
