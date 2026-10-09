import { createStallDiagnostics } from './stall-diagnostics.mjs';
// Structural diagnostics only. Never put provider text, tool arguments or IDs here.
export function createProgressMonitor(emit, { intervalMs = 10_000, now = () => performance.now(),
  bufferedBytes = () => 0, transportEnabled = false, thinkingWaitEnabled = false } = {}) {
  const started = now();
  const transport = transportEnabled ? createStallDiagnostics({ now }) : undefined;
  let phase = 'preflight', bytes = 0, count = 0, lastEvent = 'none';
  let phaseStarted = started;
  let firstByteMs, firstEventMs;
  let framesEmitted = 0, outputBytes = 0, backpressureCount = 0;
  let lastNetwork = started, lastDecoded = started, stopped = false;
  let thinkingOpen = false, thinkingHeartbeats = 0, lastThinkingHeartbeat = started;
  const snapshot = () => {
    const time = now();
    // Sample the live stdout queue at snapshot time; a cached value from the
    // last write would keep reporting backlog after the pipe drains.
    const queued = bufferedBytes();
    const progress = { phase, elapsed_ms: Math.floor(time - started),
      phase_elapsed_ms: Math.floor(time - phaseStarted),
      network_idle_ms: Math.floor(time - lastNetwork), event_idle_ms: Math.floor(time - lastDecoded),
      bytes_received: bytes, event_count: count, last_event: lastEvent,
      stdout_buffered_bytes: Number.isSafeInteger(queued) && queued >= 0 ? queued : 0,
      stdout_backpressure_count: backpressureCount,
      // Counters cover frames written before this snapshot; the frame carrying
      // it is counted by noteOutput only after its own write completes.
      frames_emitted: framesEmitted, output_bytes: outputBytes };
    if (firstByteMs !== undefined) progress.first_byte_ms = firstByteMs;
    if (firstEventMs !== undefined) progress.first_event_ms = firstEventMs;
    // Connection liveness during opaque thinking is separate from generation.
    if (thinkingWaitEnabled) progress.thinking_wait = { open: thinkingOpen,
      heartbeat_count: thinkingHeartbeats, heartbeat_idle_ms: Math.floor(time - lastThinkingHeartbeat) };
    const evidence = transport?.snapshot();
    if (evidence) progress.transport = evidence;
    return progress;
  };
  const emitProgress = () => { if (!stopped) emit({ type: 'progress', progress: snapshot() }); };
  const timer = setInterval(emitProgress, intervalMs);
  timer.unref();
  return {
    transport,
    observe(event) {
      if (thinkingWaitEnabled && event.kind === 'thinking_block' && typeof event.open === 'boolean') {
        thinkingOpen = event.open;
      } else if (thinkingWaitEnabled && thinkingOpen && event.kind === 'thinking_heartbeat') {
        thinkingHeartbeats++;
        lastThinkingHeartbeat = now();
      }
      if (event.kind === 'phase' && ['preflight', 'headers', 'stream'].includes(event.phase)) {
        lastNetwork = now();
        if (event.phase !== phase) {
          phase = event.phase;
          phaseStarted = lastNetwork;
          emitProgress();
        }
      } else if (event.kind === 'bytes' && Number.isSafeInteger(event.bytes) && event.bytes > 0) {
        bytes += event.bytes;
        if (firstByteMs === undefined) firstByteMs = Math.floor(now() - started);
        lastNetwork = now();
      } else if (event.kind === 'event' && ['text', 'reasoning', 'reasoning_signature', 'tool_call_start', 'tool_call_args', 'usage', 'finish'].includes(event.event)) {
        count++;
        if (firstEventMs === undefined) firstEventMs = Math.floor(now() - started);
        lastDecoded = now();
        lastEvent = event.event;
      }
    },
    // Output-side counters. The helper reports each emitted frame after its
    // write call so snapshots carry queue depth and backpressure without
    // changing write scheduling.
    noteOutput({ bytes: frameBytes = 0, backpressured = false } = {}) {
      framesEmitted++;
      if (Number.isSafeInteger(frameBytes) && frameBytes > 0) outputBytes += frameBytes;
      if (backpressured === true) backpressureCount++;
    },
    snapshot,
    stop() { stopped = true; clearInterval(timer); },
  };
}
