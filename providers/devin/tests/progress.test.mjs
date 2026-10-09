import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProgressMonitor } from '../progress.mjs';

const SNAPSHOT_KEYS = ['bytes_received', 'elapsed_ms', 'event_count', 'event_idle_ms',
  'last_event', 'network_idle_ms', 'phase', 'phase_elapsed_ms',
  'stdout_buffered_bytes', 'stdout_backpressure_count', 'frames_emitted',
  'output_bytes'].sort();
const FIRST_ACTIVITY_KEYS = ['first_byte_ms', 'first_event_ms'].sort();

function monitor(frames, time = { t: 1000 }) {
  const m = createProgressMonitor(frame => frames.push(frame),
    { intervalMs: 10_000, now: () => time.t });
  return { ...m, time };
}

test('emits structural-only progress snapshots on the injected interval', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const frames = [];
  const mon = monitor(frames);

  t.mock.timers.tick(9_999);
  assert.equal(frames.length, 0, 'no emit before the interval elapses');
  t.mock.timers.tick(1);
  assert.equal(frames.length, 1);

  const [frame] = frames;
  assert.equal(frame.type, 'progress');
  assert.deepEqual(Object.keys(frame.progress).sort(), SNAPSHOT_KEYS);
  assert.equal(frame.progress.phase, 'preflight');
  assert.equal(frame.progress.bytes_received, 0);
  assert.equal(frame.progress.event_count, 0);
  assert.equal(frame.progress.last_event, 'none');
  mon.stop();
});

test('phase, byte and event counters track only whitelisted structural input', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const frames = [];
  const mon = monitor(frames);

  mon.observe({ kind: 'phase', phase: 'headers' });
  mon.observe({ kind: 'bytes', bytes: 128 });
  mon.observe({ kind: 'bytes', bytes: 64 });
  mon.observe({ kind: 'event', event: 'reasoning' });
  mon.observe({ kind: 'event', event: 'tool_call_start' });
  mon.observe({ kind: 'phase', phase: 'stream' });

  // Everything below is malformed or off-whitelist and must be ignored.
  mon.observe({ kind: 'phase', phase: 'exfiltrate' });
  mon.observe({ kind: 'bytes', bytes: -5 });
  mon.observe({ kind: 'bytes', bytes: 1.5 });
  mon.observe({ kind: 'bytes', bytes: '128' });
  mon.observe({ kind: 'event', event: 'secret_payload' });
  mon.observe({ kind: 'unknown_kind', arbitrary: 'data' });
  mon.observe({});
  // A whitelisted kind still counts even when a caller leaked payload fields
  // onto the event object — the counter is structural, the payload is dropped.
  mon.observe({ kind: 'event', event: 'text', text: 'PROVIDER_SECRET_TEXT' });

  mon.time.t += 250;
  t.mock.timers.tick(10_000);
  // Two immediate phase-change frames (headers, stream) plus one interval frame.
  assert.equal(frames.length, 3);
  const p = frames.at(-1).progress;
  assert.equal(p.phase, 'stream', 'unknown phase must not overwrite a valid one');
  assert.equal(p.bytes_received, 192);
  assert.equal(p.event_count, 3);
  assert.equal(p.last_event, 'text');
  assert.equal(p.elapsed_ms, 250);
  assert.equal(p.phase_elapsed_ms, 250);
  assert.equal(p.first_byte_ms, 0);
  assert.equal(p.first_event_ms, 0);
  assert(p.event_idle_ms <= 250 && p.network_idle_ms <= 250);
  assert(!JSON.stringify(frames).includes('PROVIDER_SECRET_TEXT'));
  mon.stop();
});

test('snapshots never carry provider text, tool arguments or identifiers', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const frames = [];
  const mon = monitor(frames);

  // Simulate the helper wiring: decoded provider events are observed by kind
  // alone. Even if a caller leaked payload fields onto the event object, the
  // snapshot must stay structural.
  mon.observe({ kind: 'event', event: 'text', text: 'SECRET_ANSWER_BODY' });
  mon.observe({ kind: 'event', event: 'tool_call_args', argsDelta: 'SECRET_ARGS', id: 'call_SECRET' });
  mon.observe({ kind: 'bytes', bytes: 512 });

  t.mock.timers.tick(10_000);
  const snapshot = frames[0].progress;
  assert.equal(snapshot.event_count, 2);
  assert.equal(snapshot.last_event, 'tool_call_args');
  const serialized = JSON.stringify(frames);
  for (const secret of ['SECRET_ANSWER_BODY', 'SECRET_ARGS', 'call_SECRET']) {
    assert(!serialized.includes(secret), `snapshot leaked ${secret}`);
  }
  assert.deepEqual(Object.keys(snapshot).sort(), [...SNAPSHOT_KEYS, ...FIRST_ACTIVITY_KEYS].sort());
  mon.stop();
});

test('stop clears the timer and freezes further emissions', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const frames = [];
  const mon = monitor(frames);

  t.mock.timers.tick(10_000);
  assert.equal(frames.length, 1);
  mon.stop();
  mon.observe({ kind: 'event', event: 'text' });
  t.mock.timers.tick(120_000);
  assert.equal(frames.length, 1, 'no progress frames after stop');

  // Snapshot remains readable for terminal frames after stop.
  const p = mon.snapshot();
  assert.equal(p.event_count, 1);
  assert.equal(p.last_event, 'text');
});

test('elapsed and idle clocks derive from the injected now source', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const frames = [];
  const mon = monitor(frames);

  mon.time.t += 3000;
  mon.observe({ kind: 'bytes', bytes: 10 });
  mon.time.t += 2000;
  mon.observe({ kind: 'event', event: 'finish' });
  mon.time.t += 4000;

  const p = mon.snapshot();
  assert.equal(p.elapsed_ms, 9000);
  assert.equal(p.network_idle_ms, 6000, 'idle since last bytes/phase event');
  assert.equal(p.event_idle_ms, 4000, 'idle since last decoded event');
  mon.stop();
});

test('actual phase changes emit an immediate frame before the interval', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const frames = [];
  const mon = monitor(frames);

  mon.observe({ kind: 'phase', phase: 'headers' });
  assert.equal(frames.length, 1, 'phase transition emits without waiting for the interval');
  assert.equal(frames[0].type, 'progress');
  assert.equal(frames[0].progress.phase, 'headers');
  assert.equal(frames[0].progress.phase_elapsed_ms, 0);
  assert.equal(frames[0].progress.network_idle_ms, 0,
    'transition snapshot reflects the phase event as fresh network activity');

  // A transition after a quiet stretch still reports zero network idle, not
  // the stale gap since the previous byte.
  mon.time.t += 7000;
  mon.observe({ kind: 'phase', phase: 'preflight' });
  mon.time.t += 3000;
  mon.observe({ kind: 'phase', phase: 'stream' });
  assert.equal(frames.at(-1).progress.network_idle_ms, 0);
  assert.equal(frames.at(-1).progress.phase_elapsed_ms, 0);

  // Re-observing the same phase is not a change and must not emit.
  mon.observe({ kind: 'phase', phase: 'stream' });
  assert.equal(frames.length, 3);

  mon.time.t += 30;
  assert.equal(mon.snapshot().phase_elapsed_ms, 30);
  mon.stop();
});

test('first-activity fields stay absent until bytes or events are observed', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const frames = [];
  const mon = monitor(frames);

  t.mock.timers.tick(10_000);
  const p = frames[0].progress;
  assert(!('first_byte_ms' in p));
  assert(!('first_event_ms' in p));

  mon.time.t += 120;
  mon.observe({ kind: 'bytes', bytes: 32 });
  let s = mon.snapshot();
  assert.equal(s.first_byte_ms, 120);
  assert(!('first_event_ms' in s));

  mon.time.t += 80;
  mon.observe({ kind: 'event', event: 'usage' });
  s = mon.snapshot();
  assert.equal(s.first_byte_ms, 120);
  assert.equal(s.first_event_ms, 200);
  mon.stop();
});

test('noteOutput tracks frame, byte and backpressure counters only', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const frames = [];
  const mon = monitor(frames);

  mon.noteOutput({ bytes: 100, backpressured: false });
  mon.noteOutput({ bytes: 50, backpressured: true });
  mon.noteOutput({ bytes: 25, backpressured: true });

  const p = mon.snapshot();
  assert.equal(p.frames_emitted, 3);
  assert.equal(p.output_bytes, 175);
  assert.equal(p.stdout_backpressure_count, 2);

  // Malformed counter input is ignored rather than corrupting the counters.
  mon.noteOutput({ bytes: -1, backpressured: 'yes' });
  const q = mon.snapshot();
  assert.equal(q.frames_emitted, 4);
  assert.equal(q.output_bytes, 175);
  assert.equal(q.stdout_backpressure_count, 2);
  mon.stop();
});

test('stdout_buffered_bytes samples the live queue through the injected getter', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const frames = [];
  let queued = 0;
  const mon = createProgressMonitor(frame => frames.push(frame),
    { intervalMs: 10_000, now: () => 1000, bufferedBytes: () => queued });

  // The queue drains between writes with no new noteOutput call; the snapshot
  // must follow the getter, not a value cached at write time.
  queued = 8192;
  assert.equal(mon.snapshot().stdout_buffered_bytes, 8192);
  queued = 0;
  assert.equal(mon.snapshot().stdout_buffered_bytes, 0);

  // A throwing or non-numeric getter degrades to zero rather than breaking
  // snapshot emission.
  const broken = createProgressMonitor(frame => frames.push(frame),
    { bufferedBytes: () => 'not-a-number' });
  assert.equal(broken.snapshot().stdout_buffered_bytes, 0);
  broken.stop();
  mon.stop();
});

test('frames_emitted and output_bytes exclude the frame carrying the snapshot', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const frames = [];
  const mon = monitor(frames);

  mon.noteOutput({ bytes: 40 });
  t.mock.timers.tick(10_000);
  // One frame was written before this snapshot; the snapshot frame itself is
  // counted only after its write, so it is excluded from its own counters.
  assert.equal(frames[0].progress.frames_emitted, 1);
  assert.equal(frames[0].progress.output_bytes, 40);
  mon.stop();
});


test('scoped hidden thinking heartbeats survive a 100 second semantic silence without content', () => {
  let time = 0;
  const frames = [];
  const mon = createProgressMonitor(frame => frames.push(frame), {
    thinkingWaitEnabled: true, now: () => time,
  });
  try {
    mon.observe({ kind: 'phase', phase: 'stream' });
    mon.observe({ kind: 'thinking_heartbeat' });
    mon.observe({ kind: 'thinking_block', open: true, text: 'SECRET_THINKING' });
    for (let i = 1; i <= 4; i++) {
      time = i * 90_000;
      mon.observe({ kind: 'thinking_heartbeat', text: 'SECRET_PING' });
      assert.deepEqual(mon.snapshot().thinking_wait, { open: true, heartbeat_count: i, heartbeat_idle_ms: 0 });
    }
    time += 1_000;
    assert.equal(mon.snapshot().thinking_wait.heartbeat_idle_ms, 1_000);
    assert.equal(mon.snapshot().event_count, 0);
    assert.equal(mon.snapshot().last_event, 'none');
    assert.equal(mon.snapshot().event_idle_ms, time);
    mon.observe({ kind: 'thinking_block', open: false });
    mon.observe({ kind: 'thinking_heartbeat' });
    assert.equal(mon.snapshot().thinking_wait.open, false);
    assert.equal(mon.snapshot().thinking_wait.heartbeat_count, 4);
    assert(!JSON.stringify(mon.snapshot()).includes('SECRET'));
  } finally { mon.stop(); }
});

test('ordinary monitors omit thinking wait even when given thinking events', () => {
  const mon = createProgressMonitor(() => {});
  try {
    mon.observe({ kind: 'thinking_block', open: true });
    mon.observe({ kind: 'thinking_heartbeat' });
    assert.equal(mon.snapshot().thinking_wait, undefined);
    assert.equal(mon.snapshot().event_count, 0);
  } finally { mon.stop(); }
});
