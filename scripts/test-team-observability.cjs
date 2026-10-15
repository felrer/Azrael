'use strict';

// Retained contract checks. All generated fixtures live in the registered BQ-01
// observer run; the owning work performs ordinary PowerShell cleanup.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createTeamObserver } = require('./team-observability.cjs');
const root = path.resolve(__dirname, '../artifacts/tasks/BQ-01/runs/observer/temporary');
const utc = '2026-10-15T00:00:00.000Z';
let tick = 0n;
const clock = { utc: () => utc, monotonic: () => tick };
const event = (id, extra = {}) => ({ eventId: id, phase: 'tool', state: 'instant', utc, ...extra });
let checks = 0;
async function check(name, action) { await action(); checks++; console.log(`PASS ${name}`); }

async function main() {
  await fs.mkdir(root, { recursive: true });
  const run = await fs.mkdtemp(path.join(root, 'contracts-'));
  const observer = createTeamObserver({ storageDir: path.join(run, 'basic'), teamId: 'one', clock });
  await check('same-process monotonic timing and overlap are separate samples', async () => {
    await observer.record(event('a', { state: 'start', spanId: 's', phase: 'task' }));
    await observer.record(event('b', { state: 'start', spanId: 't' }));
    tick = 40000000n;
    await observer.record(event('c', { state: 'end', spanId: 't' }));
    tick = 100000000n;
    await observer.record(event('d', { state: 'end', spanId: 's', phase: 'task' }));
    const s = await observer.summary();
    assert.equal(s.phases.find(x => x.phase === 'task').p50Ms, 100);
    assert.equal(s.phases.find(x => x.phase === 'tool').p50Ms, 40);
    assert.equal(s.durationsAdditive, false);
    assert.equal(s.totalDurationMs, undefined);
  });
  await check('duplicates deduplicate and conflicts preserve first event', async () => {
    const sample = event('duplicate', { durationMs: 7 });
    await observer.record(sample);
    assert.equal((await observer.record(sample)).duplicate, true);
    assert.equal((await observer.record({ ...sample, durationMs: 9 })).reason, 'duplicate_conflict');
    assert.equal((await observer.summary()).health.duplicateConflicts, 1);
  });
  await check('allowlist excludes payloads and numeric unknowns remain absent', async () => {
    await observer.record(event('privacy', { prompt: 'VERY_SECRET', error: { message: 'VERY_SECRET' }, usage: { inputTokens: 9, outputTokens: -1, secret: 'VERY_SECRET' }, metrics: { cpuMs: Infinity, memoryBytes: 12, raw: 'VERY_SECRET' } }));
    const dirs = await fs.readdir(path.join(run, 'basic'));
    const text = await fs.readFile(path.join(run, 'basic', dirs[0], 'samples.json'), 'utf8');
    assert.equal(text.includes('VERY_SECRET'), false);
    const sample = JSON.parse(text).events.find(e => e.eventId === 'privacy');
    assert.deepEqual(sample.usage, { inputTokens: 9 });
    assert.deepEqual(sample.metrics, { memoryBytes: 12 });
    const s = await observer.summary();
    assert.equal(s.usage.outputTokens, null);
    assert.equal(s.usage.inputTokens, 9);
    assert.equal(s.usage.inputMissing, 0);
    assert.equal(s.usage.outputMissing, 1);
    assert.equal(s.usage.eventCount, 1);
  });
  await check('restart never infers precise elapsed from UTC', async () => {
    const storageDir = path.join(run, 'restart');
    const first = createTeamObserver({ storageDir, teamId: 'two', clock });
    await first.record(event('start', { state: 'start', spanId: 'open' }));
    const second = createTeamObserver({ storageDir, teamId: 'two', clock });
    let s = await second.summary({ now: '2026-10-15T00:00:10.000Z' });
    assert.equal(s.phases[0].activeCount, 1);
    assert.equal(s.phases[0].oldestAgeMs, 10000);
    assert.equal(s.phases[0].ageApproximate, true);
    await second.record(event('end', { state: 'end', spanId: 'open' }));
    s = await second.summary();
    assert.equal(s.phases[0].sampleCount, 0);
    assert.equal(s.phases[0].p50Ms, null);
  });
  await check('percentiles require samples and baseline alerts require explicit baseline', async () => {
    const timed = createTeamObserver({ storageDir: path.join(run, 'percentiles'), teamId: 'three', clock, limits: { minimumSamples: 3, baselines: { validation: { sampleCount: 3, p95Ms: 5 } } } });
    for (let i = 1; i <= 3; i++) await timed.record(event(`p${i}`, { phase: 'validation', durationMs: i * 10 }));
    const s = await timed.summary();
    assert.equal(s.phases[0].sampleCount, 3); assert.equal(s.phases[0].p50Ms, 20); assert.equal(s.phases[0].p95Ms, 30);
    assert.equal(s.bottlenecks[0].kind, 'baseline_exceeded');
    assert.equal((await observer.summary()).bottlenecks.length, 0);
  });
  await check('storage bounds, active retention and sticky loss survive restart', async () => {
    const storageDir = path.join(run, 'bounds');
    const limits = { maxEvents: 3, maxStateBytes: 4096 };
    const small = createTeamObserver({ storageDir, teamId: 'four', clock, limits });
    await small.record(event('active', { state: 'start', spanId: 'active' }));
    for (let i = 0; i < 30; i++) await small.record(event(`bounded${i}`));
    const s = await createTeamObserver({ storageDir, teamId: 'four', clock, limits }).summary();
    assert.equal(s.health.complete, false); assert.ok(s.health.droppedEvents > 0);
    assert.ok(s.health.retainedEvents <= 3); assert.equal(s.phases[0].activeCount, 1);
    const team = (await fs.readdir(storageDir))[0];
    assert.ok((await fs.stat(path.join(storageDir, team, 'samples.json'))).size <= 4096);
    const activeOnly = createTeamObserver({ storageDir: path.join(run, 'active-only'), teamId: 'five', clock, limits: { maxEvents: 1 } });
    await activeOnly.record(event('active1', { state: 'start', spanId: 'first' }));
    assert.equal((await activeOnly.record(event('active2', { state: 'start', spanId: 'second' }))).reason, 'active_capacity');
    assert.equal((await activeOnly.summary()).phases[0].activeCount, 1);
  });
  await check('bounded queue persists loss marker and rejects overflow', async () => {
    const storageDir = path.join(run, 'queue');
    const limited = createTeamObserver({ storageDir, teamId: 'six', clock, limits: { maxBuffer: 1 } });
    const result = await Promise.all([limited.record(event('q1')), limited.record(event('q2'))]);
    assert.equal(result[1].reason, 'buffer_full');
    assert.equal((await createTeamObserver({ storageDir, teamId: 'six', clock }).summary()).health.complete, false);
  });
  await check('exclusive lock and write failures surface health across reopen', async () => {
    const storageDir = path.join(run, 'failure');
    const failing = createTeamObserver({ storageDir, teamId: 'seven', clock });
    await failing.record(event('ok'));
    const team = path.join(storageDir, (await fs.readdir(storageDir))[0]);
    await fs.mkdir(path.join(team, 'writer.lock'));
    assert.equal((await failing.record(event('locked'))).accepted, false);
    assert.equal((await failing.summary()).health.complete, false);
    await fs.rmdir(path.join(team, 'writer.lock'));
    await fs.mkdir(path.join(team, 'samples.pending'));
    assert.equal((await failing.record(event('writefail'))).accepted, false);
    const s = await createTeamObserver({ storageDir, teamId: 'seven', clock }).summary();
    assert.equal(s.health.complete, false); assert.equal(s.health.lossMarker, true);
    assert.ok(s.health.writeFailures >= 1); assert.ok(s.health.lockFailures >= 1);
    // Preserve injected directory and all fixtures for root lifecycle review.
  });
  await check('parallel observer instances serialize or explicitly report collection loss', async () => {
    const storageDir = path.join(run, 'concurrent');
    const a = createTeamObserver({ storageDir, teamId: 'eight', clock });
    const b = createTeamObserver({ storageDir, teamId: 'eight', clock });
    const results = await Promise.all([a.record(event('one')), b.record(event('two'))]);
    const s = await a.summary();
    if (results.some(x => !x.accepted)) assert.equal(s.health.complete, false);
    else assert.equal(s.health.retainedEvents, 2);
  });
  await check('symlink storage path is rejected without writing through the link', async () => {
    const target = path.join(run, 'link-target');
    const linked = path.join(run, 'linked');
    await fs.mkdir(target);
    await fs.symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const unsafe = createTeamObserver({ storageDir: linked, teamId: 'nine', clock });
    assert.equal((await unsafe.record(event('unsafe'))).accepted, false);
    assert.equal((await unsafe.summary()).health.complete, false);
    assert.deepEqual(await fs.readdir(target), []);
  });
  await check('cumulative usage persists baselines and counts only known deltas', async () => {
    const storageDir = path.join(run, 'cumulative');
    const teamId = 'azrael-team:["local","uuid"]';
    const first = createTeamObserver({ storageDir, teamId, clock });
    const sample = (id, inputTokens, outputTokens) => event(id, { teamId, revision: 2, phase: 'turn', usageMode: 'cumulative', usageCursorId: 'thread', usage: { inputTokens, outputTokens } });
    await first.record(sample('baseline', 1000, 500));
    let s = await first.summary();
    assert.equal(s.usage.inputTokens, null); assert.equal(s.usage.complete, false);
    assert.equal(s.usage.inputMissing, 1); assert.equal(s.health.usageBaselineMissing, 1);
    await first.record(sample('delta', 1010, 520));
    const reopened = createTeamObserver({ storageDir, teamId, clock });
    await reopened.record(sample('after-restart', 1015, 527));
    await reopened.record(sample('same-totals', 1015, 527));
    assert.equal((await reopened.record(sample('same-totals', 1015, 527))).duplicate, true);
    s = await reopened.summary();
    assert.equal(s.usage.inputTokens, 15); assert.equal(s.usage.outputTokens, 27);
    await reopened.record(sample('reset', 1, 2));
    await reopened.record(sample('after-reset', 5, 9));
    s = await reopened.summary();
    assert.equal(s.usage.inputTokens, 19); assert.equal(s.usage.outputTokens, 34);
    assert.equal(s.health.usageResets, 1); assert.equal(s.usage.cursorCount, 1);
    const team = (await fs.readdir(storageDir))[0];
    const saved = JSON.parse(await fs.readFile(path.join(storageDir, team, 'samples.json'), 'utf8'));
    assert.equal(saved.events[0].revision, 2);
    assert.equal(saved.usageCursors[0].inputTokens, 5);
    assert.equal((await reopened.record(event('wrong-team', { teamId: 'different' }))).accepted, false);
  });
  await check('usage cursor capacity rejects new cursor without evicting retained baseline', async () => {
    const observer = createTeamObserver({ storageDir: path.join(run, 'cursor-capacity'), teamId: 'cursor-capacity', clock, limits: { maxUsageCursors: 1 } });
    const sample = (id, cursor, total) => event(id, { usageMode: 'cumulative', usageCursorId: cursor, usage: { inputTokens: total } });
    await observer.record(sample('first-baseline', 'first', 10));
    assert.equal((await observer.record(sample('second-baseline', 'second', 20))).reason, 'usage_cursor_capacity');
    await observer.record(sample('first-delta', 'first', 12));
    const s = await observer.summary();
    assert.equal(s.usage.inputTokens, 2); assert.equal(s.usage.cursorCount, 1);
    assert.equal(s.health.usageCursorCapacity, 1);
  });
  await check('collector overhead separates queue wait and active time within current instance', async () => {
    let measurementTick = 0n;
    const measurementClock = { utc: () => utc, monotonic: () => { measurementTick += 10000000n; return measurementTick; } };
    const storageDir = path.join(run, 'collector-cost');
    const measured = createTeamObserver({ storageDir, teamId: 'collector-cost', clock: measurementClock });
    await measured.record(event('measured'));
    const s = await measured.summary();
    assert.deepEqual(s.collector, { scope: 'current_instance', calls: 2, completedCalls: 2, rejectedCalls: 0, queueWaitMs: 20, activeMs: 20, maxActiveMs: 10 });
    assert.equal(s.collector.cpuMs, undefined);
    const reopened = createTeamObserver({ storageDir, teamId: 'collector-cost', clock: measurementClock });
    const next = await reopened.summary();
    assert.equal(next.collector.calls, 1); assert.equal(next.collector.activeMs, 10);
    assert.equal(next.health.retainedEvents, 1);
  });
  await check('usage applicability, latest bounded metrics and cancellation spellings', async () => {
    const observed = createTeamObserver({ storageDir: path.join(run, 'summary-fields'), teamId: 'summary-fields', clock });
    await observed.record(event('nonusage', { metrics: { diskFreeBytes: 100, memoryBytes: 20 }, hostId: 'first', outcome: 'cancelled', reason: 'user' }));
    let s = await observed.summary();
    assert.equal(s.usage.eventCount, 0); assert.equal(s.usage.complete, false);
    assert.equal(s.usage.inputTokens, null); assert.equal(s.usage.inputMissing, 0); assert.equal(s.usage.outputMissing, 0);
    await observed.record(event('usage', { usage: { inputTokens: 3, outputTokens: 5 } }));
    await observed.record(event('latest-metric', { utc: '2026-10-15T00:00:02.000Z', metrics: { diskFreeBytes: 90 }, hostId: 'second', outcome: 'canceled', reason: 'user' }));
    await observed.record(event('older-metric', { utc: '2026-10-15T00:00:01.000Z', metrics: { diskFreeBytes: 95 }, hostId: 'first' }));
    s = await observed.summary();
    assert.equal(s.usage.eventCount, 1); assert.equal(s.usage.complete, true);
    assert.equal(s.usage.inputTokens, 3); assert.equal(s.usage.outputTokens, 5);
    assert.equal(s.usage.inputMissing, 0); assert.equal(s.usage.outputMissing, 0);
    assert.deepEqual(s.metrics.diskFreeBytes, { latest: { value: 90, utc: '2026-10-15T00:00:02.000Z', hostId: 'second' }, sampleCount: 3 });
    assert.equal(s.metrics.memoryBytes.sampleCount, 1);
    assert.equal(s.metrics.cpuMs, undefined);
    assert.deepEqual(s.outcomes, [{ name: 'canceled:user', count: 2 }]);
  });
  console.log(`PASS ${checks} observer contract groups; fixtures ${run}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
