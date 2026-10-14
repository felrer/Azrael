"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { azraelTaskTimeGroups: automaticGroups, azraelTaskTimeLabel: label } = require("./task-work-time.cjs");

// Timing fixtures use production automatic lineage.
const groups = automaticGroups;
const turn = (turnId, turnStartedAtMs, durationMs, extra = {}) =>
  ({ turnId, turnStartedAtMs, durationMs, status: "completed", rootTurnId: "a", parentTurnId: turnId === "b" ? "a" : turnId === "c" ? "b" : null, turnTrigger: turnId === "b" || turnId === "c" ? "root_resume" : "user", ...extra });

test("continuations exclude user idle gaps and preserve supplied order and records", () => {
  const turns = [turn("a", 1000, 2000), turn("b", 100000, 5000)];
  const [task] = groups(turns, 999999);
  assert.equal(task.durationMs, 7000);
  assert.deepEqual(task.turnIds, ["a", "b"]);
  assert.deepEqual(task.turns, turns);
  assert.equal(task.turns[0], turns[0]);
  assert.equal(task.partial, false);
  assert.equal(task.active, false);
});

test("work includes a build and recorded wait without bridging unrelated gaps", () => {
  const [task] = groups([
    turn("a", 0, 120000, { status: "deferred", rootResumeWait: {
      state: "resumed", waitStartedAtMs: 120000, waitEndedAtMs: 300000 } }),
    turn("b", 300000, 30000), turn("c", 600000, 1000),
  ], 900000);
  assert.equal(task.durationMs, 331000);
  assert.equal(task.partial, false);
});

test("overlapping waits and work plus duplicate IDs count only once", () => {
  const a = turn("a", 1000, 5000, { status: "deferred", rootResumeWait: {
    state: "resumed", waitStartedAtMs: 4000, waitEndedAtMs: 10000 } });
  const b = turn("b", 7000, 5000, { rootResumeWait: {
    state: "resumed", waitStartedAtMs: 8000, waitEndedAtMs: 14000 } });
  const [task] = groups([a, a, b, b], 30000);
  assert.equal(task.durationMs, 13000);
  assert.deepEqual(task.turnIds, ["a", "b"]);
});

test("live ticks advance while completed, interrupted and failed work freezes", () => {
  for (const status of ["inProgress", "in_progress"]) {
    const live = turn("a", 1000, 5, { status });
    assert.equal(groups([live], 3000)[0].durationMs, 2000);
    assert.equal(groups([live], 4000)[0].durationMs, 3000);
    assert.equal(groups([live], 4000)[0].active, true);
  }
  for (const status of ["completed", "interrupted", "failed"]) {
    const stopped = turn("a", 1000, 2000, { status });
    assert.equal(groups([stopped], 3000)[0].durationMs, 2000);
    assert.equal(groups([stopped], 9000)[0].durationMs, 2000);
    assert.equal(groups([stopped], 9000)[0].active, false);
  }
});

test("waiting and claimed turns freeze work and tick only the wait interval", () => {
  for (const state of ["waiting", "claimed"]) {
    const waiting = turn("a", 0, 1000, { status: "inProgress", rootResumeWait: {
      state, waitStartedAtMs: 2000 } });
    assert.equal(groups([waiting], 5000)[0].durationMs, 4000);
    assert.equal(groups([waiting], 6000)[0].durationMs, 5000);
    assert.equal(groups([waiting], 6000)[0].active, true);
    const unknown = groups([{ ...waiting, durationMs: null }], 5000)[0];
    assert.equal(unknown.durationMs, 3000);
    assert.equal(unknown.partial, true);
  }
});

test("unknown or invalid timing marks a partial lower bound without invented starts", () => {
  for (const bad of [undefined, null, NaN, Infinity, -1, "1000"]) {
    const badStart = groups([turn("a", bad, 1000), turn("b", 5000, 2000)], 10000)[0];
    assert.equal(badStart.durationMs, 2000);
    assert.equal(badStart.partial, true);
    const badDuration = groups([turn("a", 1000, bad)], 10000)[0];
    assert.equal(badDuration.durationMs, 0);
    assert.equal(badDuration.partial, true);
  }
  assert.equal(groups([turn("a", 0, 1000, { status: "unknown" })], 10000)[0].partial, true);
  assert.equal(groups([turn("a", 0, 1000, { status: "deferred" })], 10000)[0].partial, true);
});

test("cancelled wait freezes at its end; missing terminal end remains unknown", () => {
  const cancelled = turn("a", 0, 1000, { status: "interrupted", rootResumeWait: {
    state: "cancelled", waitStartedAtMs: 1000, waitEndedAtMs: 5000 } });
  assert.equal(groups([cancelled], 9000)[0].durationMs, 5000);
  assert.equal(groups([cancelled], 19000)[0].durationMs, 5000);
  assert.equal(groups([cancelled], 19000)[0].active, false);
  for (const state of ["resumed", "cancelled"]) {
    const missingEnd = { ...cancelled, rootResumeWait: { state, waitStartedAtMs: 1000 } };
    const [task] = groups([missingEnd], 19000);
    assert.equal(task.durationMs, 1000);
    assert.equal(task.partial, true);
    assert.equal(task.active, false);
  }
});

test("wait boundaries suppress stale live work even after resumption", () => {
  const [task] = groups([turn("a", 0, 1000, { status: "inProgress", rootResumeWait: {
    state: "resumed", waitStartedAtMs: 1000, waitEndedAtMs: 5000 } })], 90000);
  assert.equal(task.durationMs, 5000);
  assert.equal(task.active, false);
});

test("terminal turns freeze despite stale waiting or claimed metadata without an end", () => {
  for (const status of ["completed", "interrupted", "failed"]) {
    for (const state of ["waiting", "claimed"]) {
      const stopped = turn("a", 0, 1000, { status, rootResumeWait: {
        state, waitStartedAtMs: 1000 } });
      for (const now of [5000, 15000]) {
        const [task] = groups([stopped], now);
        assert.equal(task.durationMs, 1000, status + ":" + state);
        assert.equal(task.active, false);
        assert.equal(task.partial, true);
      }
    }
  }
});

test("records lacking a nonempty string ID cannot create or split a task", () => {
  const invalid = [undefined, null, 0, "", " ", "\t"]
    .map(turnId => turn(turnId, 0, 999999));
  assert.deepEqual(groups(invalid, 1000000), []);
  const result = groups([...invalid, turn("a", 0, 1000), ...invalid, turn("b", 2000, 1000)],
    1000000);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].turnIds, ["a", "b"]);
  assert.equal(result[0].durationMs, 2000);
  assert.equal(result[0].partial, false);
});

test("clock reversal clamps intervals to zero and invalid clocks remain partial", () => {
  assert.equal(groups([turn("a", 5000, 1000, { status: "inProgress" })], 4000)[0].durationMs, 0);
  const waiting = turn("a", 0, 1000, { status: "deferred", rootResumeWait: {
    state: "waiting", waitStartedAtMs: 5000 } });
  assert.equal(groups([waiting], 4000)[0].durationMs, 1000);
  assert.equal(groups([waiting], NaN)[0].partial, true);
  const ended = { ...waiting, rootResumeWait: { state: "cancelled", waitStartedAtMs: 5000, waitEndedAtMs: 4000 } };
  assert.equal(groups([ended], 9000)[0].durationMs, 1000);
});

test("several-hour durations and labels retain hours and compact lower units", () => {
  const duration = (3 * 3600 + 24 * 60 + 59) * 1000;
  assert.equal(groups([turn("a", 0, duration)], duration + 999999)[0].durationMs, duration);
  assert.equal(label(duration), "3시간 24분");
  assert.equal(label((8 * 60 + 12) * 1000), "8분 12초");
  assert.equal(label(0), "0초");
  assert.equal(label(999), "0초");
  assert.equal(label(duration, "en-US"), "3h 24m");
  assert.equal(label(492000, "en"), "8m 12s");
  assert.equal(label(0, "en"), "0s");
  assert.equal(label(3600000), "1시간");
  assert.equal(label(492000, "ko-KR"), "8분 12초");
  assert.equal(label(492000, "ja-JP"), "8m 12s");
  assert.equal(label(492000, "fr"), "8m 12s");
});

test("serialized exports run in an isolated browser-like context without dependencies", () => {
  const isolated = vm.runInNewContext(`({groups: (${automaticGroups.toString()}), label: (${label.toString()})})`);
  assert.equal(isolated.groups([turn("a", 0, 1000)], 5000)[0].durationMs, 1000);
  assert.equal(isolated.label(1000), "1초");
  assert.deepEqual(groups([], 1000), []);
});

test("overflow cannot produce an infinite duration or a false exact total", () => {
  const [task] = groups([turn("a", Number.MAX_VALUE, Number.MAX_VALUE)], Number.MAX_VALUE);
  assert.equal(task.durationMs, 0);
  assert.equal(task.partial, true);
});

test("quantized sequential starts preserve measured work while precise starts retain union", () => {
  const precise = [turn("a", 12000, 200), turn("b", 12000, 400)];
  const coarse = precise.map(value => ({ ...value, turnStartedAtPrecisionMs: 1000 }));
  assert.equal(groups(precise, 20000)[0].durationMs, 400);
  const [task] = groups(coarse, 20000);
  assert.equal(task.durationMs, 600);
  assert.equal(task.partial, false);
  assert.deepEqual(task.turns.map(value => value.turnStartedAtMs), [12000, 12000]);
});

test("quantized work followed by an exact wait preserves both measured spans", () => {
  const [task] = groups([
    turn("a", 12000, 200, { turnStartedAtPrecisionMs: 1000 }),
    turn("b", 12000, 400, { turnStartedAtPrecisionMs: 1000, status: "deferred",
      rootResumeWait: { state: "resumed", waitStartedAtMs: 12600, waitEndedAtMs: 13000 } }),
  ], 20000);
  assert.equal(task.durationMs, 1000);
  assert.equal(task.partial, false);
});

test("previous exact wait end positions subsequent coarse work without swallowing it", () => {
  const [task] = groups([
    turn("a", 12000, 200, { turnStartedAtPrecisionMs: 1000, status: "deferred",
      rootResumeWait: { state: "resumed", waitStartedAtMs: 12200, waitEndedAtMs: 12500 } }),
    turn("b", 12000, 400, { turnStartedAtPrecisionMs: 1000 }),
  ], 20000);
  assert.equal(task.durationMs, 900);
  assert.equal(task.partial, false);
});

test("contradictory coarse placement marks partial and retains measured work lower bound", () => {
  const [task] = groups([
    turn("a", 12000, 200, { turnStartedAtPrecisionMs: 1000 }),
    turn("b", 12000, 400, { turnStartedAtPrecisionMs: 1000, status: "deferred",
      rootResumeWait: { state: "resumed", waitStartedAtMs: 12400, waitEndedAtMs: 12450 } }),
  ], 20000);
  assert.equal(task.durationMs, 600);
  assert.equal(task.partial, true);
  const impossible = groups([
    turn("a", 12000, 1500, { turnStartedAtPrecisionMs: 1000 }),
    turn("b", 12000, 400, { turnStartedAtPrecisionMs: 1000 }),
  ], 20000)[0];
  assert.equal(impossible.durationMs, 1900);
  assert.equal(impossible.partial, true);
});

const chain = (prefix, count) => Array.from({length: count}, (_, i) => turn(prefix+i, i*10000, 1000, {
  rootTurnId: prefix+'0', parentTurnId: i ? prefix+(i-1) : null, turnTrigger: i ? 'root_resume' : 'user',
  rootResumeWait: {reservationId: prefix+'wait'+i, state: 'cancelled', waitStartedAtMs: i*10000+1000, waitEndedAtMs: i*10000+2000}
}));
test('automatic group requires three distinct committed registrations in one lineage', () => {
  for (const n of [0,1,2,3,4]) {
    const result=automaticGroups(chain('a',n),99999);
    assert.equal(result.some(g=>g.eligible),n>=3);
    if(n) assert.equal(result[0].resumeCount,n);
  }
  const values=chain('a',4);values[1].rootResumeWait=values[0].rootResumeWait;
  values[2].rootResumeWait={reservationId:'preparing',state:'preparing',waitStartedAtMs:null};
  assert.equal(automaticGroups(values,99999)[0].resumeCount,2);
});
test('user boundary despite inherited root and distinct roots never auto-merge', () => {
  const values=chain('a',6);values[3].turnTrigger='user';
  assert.deepEqual(automaticGroups(values,99999).map(g=>g.turnIds),[['a0','a1','a2'],['a3','a4','a5']]);
  assert.equal(automaticGroups([...chain('a',3),...chain('b',3)],99999).length,2);
  values[1].parentTurnId='missing';
  assert.equal(automaticGroups(values,99999).length,3);
});
test('distinct short chains cannot combine eligibility and metadata gaps remain partial',()=>{
 const values=[...chain('a',1),...chain('b',2)];
 assert.equal(automaticGroups(values,99999).some(g=>g.eligible),false);
 assert.equal(automaticGroups([{...values[0],metadataPartial:true}],99999)[0].partial,true);
});

test('all durable native states count committed use but preparing never counts',()=>{
 const values=chain('s',3);values[0].rootResumeWait.state='blocked';
 assert.equal(automaticGroups(values,99999)[0].eligible,true);
 for(const invalid of [{reservationId:'',state:'waiting',waitStartedAtMs:1000},{reservationId:'x',state:'preparing',waitStartedAtMs:1000},{reservationId:'x',state:'waiting',waitStartedAtMs:NaN}]) {
  values[0].rootResumeWait=invalid;
  assert.equal(automaticGroups(values,99999)[0].eligible,false);
 }
});
