'use strict';

// Optional samples only; authoritative recovery/validation records belong to the
// change service. Defaults bound each Team to 2,000 samples / 2 MiB on disk and
// 128 queued calls. Completed samples are compacted first. Loss is sticky.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const PHASES = new Set(('task turn item user_wait requirements handoff dependency_wait ready_queue workspace model tool integration_queue integration_lock merge conflict validation_queue validation metadata collection').split(' '));
const STATES = new Set(['start', 'end', 'blocked', 'unblocked', 'instant']);
const STRINGS = ('eventId teamId taskId changeId revision runId attemptId operationId spanId parentSpanId reason resourceId hostId platform arch executionKind inputId environmentId candidateCommit provider model outcome usageCursorId').split(' ');
const METRICS = ['cpuMs', 'memoryBytes', 'diskFreeBytes', 'artifactBytes', 'cacheHits', 'cacheMisses'];
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const token = value => typeof value === 'string' && /^[\w.:/@+\-]{1,160}$/.test(value);
const teamIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const spanKey = e => e.spanId ? JSON.stringify([e.taskId, e.runId, e.attemptId, e.operationId, e.spanId, e.phase, e.hostId]) : null;
const percentile = (values, q) => values.length ? values[Math.max(0, Math.ceil(values.length * q) - 1)] : null;

async function checked(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('unsafe_path'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}

function createTeamObserver({ storageDir, teamId, limits = {}, clock = {} }) {
  if (!teamIdentity(teamId) || typeof storageDir !== 'string') throw new TypeError('Invalid observer identity');
  const positive = (name, fallback, minimum = 1) => Number.isSafeInteger(limits[name]) && limits[name] >= minimum ? limits[name] : fallback;
  const maxEvents = positive('maxEvents', 2000);
  const maxStateBytes = positive('maxStateBytes', 2 * 1024 * 1024, 4096);
  const maxBuffer = positive('maxBuffer', 128);
  const maxUsageCursors = positive('maxUsageCursors', 256);
  const minimumSamples = positive('minimumSamples', 20);
  const threshold = finite(limits.threshold) && limits.threshold > 1 ? limits.threshold : 1.5;
  const nowUtc = clock.utc || (() => new Date().toISOString());
  const mono = clock.monotonic || (() => process.hrtime.bigint()); // nanoseconds
  const dir = path.join(path.resolve(storageDir), `team-${hash(teamId).slice(0, 32)}`);
  const file = path.join(dir, 'samples.json');
  const lock = path.join(dir, 'writer.lock');
  const marker = path.join(dir, 'incomplete');
  const temp = path.join(dir, 'samples.pending');
  let chain = Promise.resolve();
  let queued = 0;
  // Observer overhead only, never task wall time or shared-process CPU usage.
  const collector = { scope: 'current_instance', calls: 0, completedCalls: 0, rejectedCalls: 0, queueWaitMs: 0, activeMs: 0, maxActiveMs: 0 };
  const elapsedMs = (begin, end) => Math.max(0, Number(end - begin) / 1e6);
  const timers = new Map();
  const health = () => ({ complete: true, droppedEvents: 0, writeFailures: 0, invalidEvents: 0, duplicateConflicts: 0, compactedEvents: 0, lockFailures: 0, usageComplete: true, usageBaselineMissing: 0, usageResets: 0, usageCursorCapacity: 0 });
  let state = { schema: 1, teamId, health: health(), events: [], seen: [], usageCursors: [] };
  let pendingLoss = 0;
  const markerWrites = new Map();
  const loss = (kind, count = 1) => { state.health.complete = false; state.health[kind] += count; };

  function markLoss(kind = 'writeFailures') {
    // Overflow callers share at most one pending filesystem operation per kind.
    if (markerWrites.has(kind)) return markerWrites.get(kind);
    const operation = writeLossMarker(kind).finally(() => markerWrites.delete(kind));
    markerWrites.set(kind, operation);
    return operation;
  }
  async function writeLossMarker(kind) {
    // Fixed-size marker survives a restart even when the state writer is locked.
    try {
      await checked(dir); await fs.mkdir(dir, { recursive: true });
      const failureMarker = `${marker}-${kind}`;
      await checked(failureMarker);
      try { await fs.writeFile(failureMarker, '1\n', { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await checked(marker); await fs.writeFile(marker, 'incomplete\n', { flag: 'wx', mode: 0o600 });
    }
    catch (_) { /* Failure is surfaced in the in-memory health; no raw errors. */ }
  }
  async function readState() {
    await checked(file);
    try {
      if ((await fs.stat(file)).size > maxStateBytes) throw new Error('oversized_state');
      const loaded = JSON.parse(await fs.readFile(file, 'utf8'));
      if (loaded.schema !== 1 || loaded.teamId !== teamId || !Array.isArray(loaded.events) || !Array.isArray(loaded.seen) || !loaded.health) throw new Error('invalid_state');
      // Never trust arbitrary persisted properties when rewriting snapshots.
      state = { schema: 1, teamId, health: Object.fromEntries(Object.entries(health()).map(([k, initial]) => [k, typeof initial === 'boolean' ? loaded.health[k] === undefined ? initial : loaded.health[k] === true : finite(loaded.health[k]) ? loaded.health[k] : 0])), events: loaded.events.map(sanitize).filter(Boolean), seen: loaded.seen.filter(x => Array.isArray(x) && token(x[0]) && /^[a-f0-9]{64}$/.test(x[1])).slice(-maxEvents * 2), usageCursors: [] };
      for (const entry of loaded.usageCursors || []) {
        if (!entry || !token(entry.id) || state.usageCursors.length >= maxUsageCursors) throw new Error('invalid_usage_cursor');
        const cursor = { id: entry.id };
        for (const key of ['inputTokens', 'outputTokens']) if (finite(entry[key])) cursor[key] = entry[key];
        state.usageCursors.push(cursor);
      }
    } catch (error) { if (error.code !== 'ENOENT') { loss('writeFailures'); await markLoss(); throw new Error('collector_read_failure'); } }
    await checked(marker);
    try { await fs.access(marker); state.health.complete = false; state.health.lossMarker = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const kind of ['writeFailures', 'lockFailures', 'droppedEvents']) {
      const failureMarker = `${marker}-${kind}`;
      await checked(failureMarker);
      try { await fs.access(failureMarker); state.health.complete = false; state.health[kind] = Math.max(1, state.health[kind]); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (pendingLoss) { loss('droppedEvents', pendingLoss); pendingLoss = 0; }
  }
  function sanitize(input) {
    if (!input || typeof input !== 'object' || !token(input.eventId) || (input.teamId !== undefined && input.teamId !== teamId) || !PHASES.has(input.phase) || !STATES.has(input.state)) return null;
    const e = {};
    for (const key of STRINGS) if (token(input[key])) e[key] = input[key];
    if (Number.isSafeInteger(input.revision) && input.revision >= 0) e.revision = input.revision;
    e.teamId = teamId; e.phase = input.phase; e.state = input.state;
    if (input.usageMode === 'cumulative') e.usageMode = 'cumulative';
    const utc = input.utc === undefined ? nowUtc() : input.utc;
    if (typeof utc !== 'string' || !/Z$/.test(utc) || !Number.isFinite(Date.parse(utc))) return null;
    e.utc = new Date(utc).toISOString();
    if (finite(input.durationMs)) e.durationMs = input.durationMs;
    e.usage = null;
    if (input.usage && typeof input.usage === 'object') {
      const usage = {};
      for (const key of ['inputTokens', 'outputTokens']) if (finite(input.usage[key])) usage[key] = input.usage[key];
      if (Object.keys(usage).length) e.usage = usage;
    }
    if (input.metrics && typeof input.metrics === 'object') {
      const metrics = {};
      for (const key of METRICS) if (finite(input.metrics[key])) metrics[key] = input.metrics[key];
      if (Object.keys(metrics).length) e.metrics = metrics;
    }
    return e;
  }
  function trim() {
    const active = new Set();
    for (const e of state.events) { const key = spanKey(e); if (key && ['start', 'blocked'].includes(e.state)) active.add(key); if (key && ['end', 'unblocked'].includes(e.state)) active.delete(key); }
    while (state.events.length > maxEvents || Buffer.byteLength(JSON.stringify(state)) > maxStateBytes) {
      const index = state.events.findIndex(e => !active.has(spanKey(e)));
      if (index < 0) return false;
      state.events.splice(index, 1); loss('compactedEvents'); loss('droppedEvents');
    }
    return true;
  }
  async function save() {
    if (!trim()) { await markLoss('droppedEvents'); throw new Error('state_capacity'); }
    await checked(temp); await checked(file);
    await fs.writeFile(temp, JSON.stringify(state), { flag: 'w', mode: 0o600 });
    await fs.rename(temp, file);
  }
  async function locked(action, write = false) {
    let acquired = false;
    try {
      await checked(dir); await fs.mkdir(dir, { recursive: true }); await checked(lock);
      await fs.mkdir(lock); acquired = true;
      await readState();
      const result = await action();
      if (write) await save();
      return result;
    } catch (error) {
      const kind = error.code === 'EEXIST' && !acquired ? 'lockFailures' : 'writeFailures';
      loss(kind);
      pendingLoss++;
      await markLoss(kind);
      return { accepted: false, reason: 'collector_unavailable' };
    } finally { if (acquired) { try { await fs.rmdir(lock); } catch (_) { loss('writeFailures'); await markLoss(); } } }
  }
  function enqueue(action) {
    const admittedAt = mono();
    collector.calls++;
    if (queued >= maxBuffer) { collector.rejectedCalls++; pendingLoss++; loss('droppedEvents'); return markLoss('droppedEvents').then(() => ({ accepted: false, reason: 'buffer_full' })); }
    queued++;
    const result = chain.then(async () => {
      const beganAt = mono();
      collector.queueWaitMs += elapsedMs(admittedAt, beganAt);
      try { return await action(); }
      finally {
        const duration = elapsedMs(beganAt, mono());
        collector.activeMs += duration;
        collector.maxActiveMs = Math.max(collector.maxActiveMs, duration);
        collector.completedCalls++;
      }
    });
    chain = result.catch(() => {}).finally(() => { queued--; });
    return result;
  }
  function record(input) {
    // Snapshot at admission; callers cannot mutate queued samples.
    const e = sanitize(input);
    const fingerprint = e && hash(input.utc === undefined ? { ...e, utc: null } : e);
    const timestamp = mono();
    return enqueue(() => locked(async () => {
      if (!e) { loss('invalidEvents'); loss('droppedEvents'); return { accepted: false, reason: 'invalid_event' }; }
      const previous = state.seen.find(item => item[0] === e.eventId);
      if (previous) {
        if (previous[1] === fingerprint) return { accepted: true, duplicate: true };
        loss('duplicateConflicts'); loss('droppedEvents'); return { accepted: false, reason: 'duplicate_conflict' };
      }
      const key = spanKey(e);
      if (key && ['end', 'unblocked'].includes(e.state) && !finite(e.durationMs) && timers.has(key)) e.durationMs = Math.max(0, Number(timestamp - timers.get(key)) / 1e6);
      const oldEvents = state.events.slice();
      const oldSeen = state.seen.slice();
      const oldCursors = state.usageCursors.map(cursor => ({ ...cursor }));
      if (e.usageMode === 'cumulative') {
        const partial = kind => { state.health.complete = false; state.health.usageComplete = false; state.health[kind]++; };
        if (!e.usageCursorId) { partial('usageBaselineMissing'); loss('invalidEvents'); return { accepted: false, reason: 'missing_usage_cursor' }; }
        let cursor = state.usageCursors.find(entry => entry.id === e.usageCursorId);
        const totals = e.usage;
        if (!cursor && state.usageCursors.length >= maxUsageCursors) { partial('usageCursorCapacity'); loss('droppedEvents'); return { accepted: false, reason: 'usage_cursor_capacity' }; }
        if (!cursor) { cursor = { id: e.usageCursorId }; state.usageCursors.push(cursor); }
        const reset = totals && ['inputTokens', 'outputTokens'].some(key => finite(cursor[key]) && finite(totals[key]) && totals[key] < cursor[key]);
        const delta = {};
        let missingBaseline = false;
        for (const key of ['inputTokens', 'outputTokens']) {
          if (totals && finite(totals[key])) {
            if (!reset && finite(cursor[key])) delta[key] = totals[key] - cursor[key]; else missingBaseline = true;
            cursor[key] = totals[key];
          }
        }
        if (reset) partial('usageResets');
        else if (missingBaseline || !totals) partial('usageBaselineMissing');
        e.usage = Object.keys(delta).length ? delta : null;
      }
      state.events.push(e); state.seen.push([e.eventId, fingerprint]);
      if (state.seen.length > maxEvents * 2) { state.seen.shift(); state.health.complete = false; }
      if (!trim()) { state.events = oldEvents; state.seen = oldSeen; state.usageCursors = oldCursors; loss('droppedEvents'); return { accepted: false, reason: 'active_capacity' }; }
      if (key && ['start', 'blocked'].includes(e.state)) timers.set(key, timestamp);
      if (key && ['end', 'unblocked'].includes(e.state)) timers.delete(key);
      // Timers mirror retained active records, bounded by maxEvents.
      const keys = new Set(state.events.map(spanKey));
      for (const timerKey of timers.keys()) if (!keys.has(timerKey)) timers.delete(timerKey);
      return { accepted: true };
    }, true));
  }
  function aggregate(now) {
    const groups = new Map();
    const active = new Map();
    const usage = { complete: state.health.usageComplete, inputTokens: null, outputTokens: null, inputMissing: 0, outputMissing: 0, eventCount: 0, cursorCount: state.usageCursors.length };
    const metrics = {};
    const counts = { reasons: {}, resources: {}, outcomes: {} };
    for (const e of state.events) {
      if (!groups.has(e.phase)) groups.set(e.phase, []);
      if (['end', 'unblocked', 'instant'].includes(e.state) && finite(e.durationMs)) groups.get(e.phase).push(e.durationMs);
      const key = spanKey(e);
      if (key && ['start', 'blocked'].includes(e.state)) active.set(key, e);
      if (key && ['end', 'unblocked'].includes(e.state)) active.delete(key);
      if (e.usage !== null || e.usageMode === 'cumulative') {
        usage.eventCount++;
        for (const [field, missing] of [['inputTokens', 'inputMissing'], ['outputTokens', 'outputMissing']]) {
          if (e.usage && finite(e.usage[field])) usage[field] = (usage[field] || 0) + e.usage[field]; else usage[missing]++;
        }
      }
      for (const name of METRICS) {
        if (!e.metrics || !finite(e.metrics[name])) continue;
        if (!metrics[name]) metrics[name] = { latest: null, sampleCount: 0 };
        metrics[name].sampleCount++;
        if (!metrics[name].latest || e.utc >= metrics[name].latest.utc) metrics[name].latest = { value: e.metrics[name], utc: e.utc, hostId: e.hostId || null };
      }
      for (const [source, target] of [['reason', 'reasons'], ['resourceId', 'resources']]) if (e[source]) counts[target][e[source]] = (counts[target][e[source]] || 0) + 1;
      if (['failed', 'canceled', 'cancelled', 'retry', 'rework'].includes(e.outcome)) { const outcome = e.outcome === 'cancelled' ? 'canceled' : e.outcome; const id = `${outcome}:${e.reason || 'unspecified'}`; counts.outcomes[id] = (counts.outcomes[id] || 0) + 1; }
    }
    const bottlenecks = [];
    const phases = [...groups].map(([phase, values]) => {
      values.sort((a, b) => a - b);
      const waiting = [...active.values()].filter(e => e.phase === phase);
      const oldestUtc = waiting.length ? waiting.map(e => e.utc).sort()[0] : null;
      const result = { phase, sampleCount: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), activeCount: waiting.length, oldestUtc, oldestAgeMs: oldestUtc ? Math.max(0, Date.parse(now) - Date.parse(oldestUtc)) : null, ageApproximate: true };
      const baseline = limits.baselines && limits.baselines[phase];
      if (values.length >= minimumSamples && baseline && baseline.sampleCount >= minimumSamples && finite(baseline.p95Ms) && baseline.p95Ms > 0 && result.p95Ms > baseline.p95Ms * threshold) bottlenecks.push({ phase, kind: 'baseline_exceeded', ratio: result.p95Ms / baseline.p95Ms, sampleCount: values.length });
      if (waiting.length) bottlenecks.push({ phase, kind: 'active_spans', count: waiting.length, oldestAgeMs: result.oldestAgeMs, approximate: true });
      return result;
    });
    const top = entries => Object.entries(entries).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
    usage.complete = usage.complete && usage.eventCount > 0 && usage.inputMissing === 0 && usage.outputMissing === 0;
    return { schema: 1, teamId, health: { ...state.health, bufferedEvents: queued, retainedEvents: state.events.length, replayWindow: state.seen.length }, phases, usage, metrics, bottlenecks, reasons: top(counts.reasons), resources: top(counts.resources), outcomes: top(counts.outcomes), durationsAdditive: false, providerInternalWait: 'unavailable' };
  }
  function summary({ now = nowUtc() } = {}) {
    return enqueue(async () => {
      await locked(async () => null);
      return aggregate(now);
    }).then(result => ({ ...result, collector: { ...collector } }));
  }
  return { record, summary, flush: () => chain };
}

module.exports = { createTeamObserver };
