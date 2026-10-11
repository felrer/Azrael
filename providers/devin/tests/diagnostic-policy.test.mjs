import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diagnosticFlag, diagnosticPolicy } from '../diagnostic-policy.mjs';
import { createProgressMonitor } from '../progress.mjs';
import { createFailureStageTracker, observeRawReads, observeParser } from '../stall-diagnostics.mjs';

test('collection defaults on and recognizes only trimmed case-insensitive flags', () => {
  for (const value of [undefined, '', 'invalid', 'yes', '2']) {
    assert.equal(diagnosticFlag(value), undefined);
    assert.deepEqual(diagnosticPolicy({ AZRAEL_DIAGNOSTICS: value }), { inference: true, tools: true });
  }
  for (const value of ['1', ' TRUE ', 'On']) assert.equal(diagnosticFlag(value), true);
  for (const value of ['0', ' FALSE ', 'oFf']) assert.equal(diagnosticFlag(value), false);
  for (const master of ['on', 'off']) {
    assert.deepEqual(diagnosticPolicy({ AZRAEL_DIAGNOSTICS: master }), { inference: master === 'on', tools: master === 'on' });
    assert.deepEqual(diagnosticPolicy({ AZRAEL_DIAGNOSTICS: master,
      AZRAEL_DIAGNOSTICS_INFERENCE: 'invalid', AZRAEL_DIAGNOSTICS_TOOLS: '' }),
    { inference: master === 'on', tools: master === 'on' });
    assert.deepEqual(diagnosticPolicy({ AZRAEL_DIAGNOSTICS: master,
      AZRAEL_DIAGNOSTICS_INFERENCE: ' OFF ', AZRAEL_DIAGNOSTICS_TOOLS: ' TRUE ' }),
    { inference: false, tools: true });
    assert.deepEqual(diagnosticPolicy({ AZRAEL_DIAGNOSTICS: master,
      AZRAEL_DIAGNOSTICS_INFERENCE: 'on', AZRAEL_DIAGNOSTICS_TOOLS: '0' }),
    { inference: true, tools: false });
  }
});

test('off preserves progress activity, opaque thinking and output accounting without detailed observers', () => {
  const frames = [];
  let time = 0;
  const monitor = createProgressMonitor(frame => frames.push(frame), {
    transportEnabled: diagnosticPolicy({ AZRAEL_DIAGNOSTICS: 'off' }).inference,
    thinkingWaitEnabled: true, now: () => time,
  });
  try {
    monitor.observe({ kind: 'phase', phase: 'headers' });
    time = 50;
    monitor.observe({ kind: 'bytes', bytes: 30 });
    monitor.observe({ kind: 'thinking_block', open: true });
    monitor.observe({ kind: 'thinking_heartbeat' });
    monitor.noteOutput({ bytes: 22, backpressured: true });
    const snapshot = monitor.snapshot();
    assert.equal(frames[0].type, 'progress');
    assert.equal(monitor.transport, undefined);
    assert.equal(monitor.toolDiagnostics, undefined);
    assert.equal(snapshot.transport, undefined);
    assert.equal(snapshot.tool_diagnostics, undefined);
    assert.equal(snapshot.network_idle_ms, 0);
    assert.equal(snapshot.event_count, 0);
    assert.deepEqual(snapshot.thinking_wait, { open: true, heartbeat_count: 1, heartbeat_idle_ms: 0 });
    assert.equal(snapshot.output_bytes, 22);
    assert.equal(snapshot.stdout_backpressure_count, 1);
  } finally { monitor.stop(); }
});

test('default collection, off and re-enable leave the progress protocol active', () => {
  for (const value of [undefined, 'off', 'on']) {
    const frames = [];
    const monitor = createProgressMonitor(frame => frames.push(frame), {
      transportEnabled: diagnosticPolicy({ AZRAEL_DIAGNOSTICS: value }).inference,
    });
    try {
      monitor.observe({ kind: 'phase', phase: 'headers' });
      assert.equal(frames.length, 1);
      assert.equal(frames[0].type, 'progress');
      assert.equal('transport' in frames[0].progress, value !== 'off');
      assert.equal(Boolean(monitor.transport), value !== 'off');
    } finally { monitor.stop(); }
  }
});

test('minimal error state retains raw read origin through parser wrapping without metric callbacks', async () => {
  const error = new TypeError('private', { cause: { code: 'ECONNRESET' } });
  const tracker = createFailureStageTracker();
  const response = observeRawReads(new Response(new ReadableStream({ start(c) { c.error(error); } })), tracker);
  async function* parse() { await response.text(); }
  await assert.rejects(async () => { for await (const event of observeParser(parse(), tracker)) assert.fail(event); }, error);
  tracker.error('map', error);
  assert.equal(tracker.failureStage(), 'body_read');
  assert.equal(tracker.snapshot, undefined);
  assert.equal(tracker.readBegin, undefined);
});
