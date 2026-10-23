'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scheduleVerificationGroups: schedule, planVerificationSchedule: plan } = require('./verification-schedule.cjs');

function group(id, label, aliases = []) {
  const check = { id, executable: 'node', args: ['check.cjs', '--package', id], ...(label ? { cargoScheduleGroup: label } : {}) };
  return { check, entries: [check, ...aliases.map(alias => ({ ...check, id: alias }))].map(check => ({ feature: { area: 'engine' }, check })) };
}
const ids = groups => groups.map(group => group.check.id);

test('default scheduling preserves the stable existing Cargo locality order', () => {
  const groups = [group('a'), group('b', 'core'), group('c', 'protocol'), group('d'), group('e', 'core')];
  assert.deepEqual(ids(schedule(groups)), ['b', 'e', 'c', 'a', 'd']);
  assert.deepEqual(ids(schedule([groups[0], groups[3]])), ['a', 'd']);
  groups[1].entries.push(group('alias', 'other').entries[0]);
  assert.deepEqual(ids(schedule(groups)), ['c', 'e', 'a', 'b', 'd']);
  assert.deepEqual(schedule([]), []);
});

test('priority wins over duration and locality; supplied duration wins over unknown duration', () => {
  const groups = ['a', 'b', 'c', 'd', 'e'].map(id => group(id));
  assert.deepEqual(ids(schedule(groups, { priorities: { b: 3, c: 3, d: -1 }, estimatedDurationMs: { a: 0, b: 50, c: 5 } })),
    ['c', 'b', 'a', 'e', 'd']);
});

test('dependencies win over priority, cost and Cargo locality', () => {
  const groups = [group('last', 'core'), group('middle'), group('first')];
  assert.deepEqual(ids(schedule(groups, { priorities: { last: 100 }, estimatedDurationMs: { last: 0 },
    dependencies: { last: ['middle'], middle: ['first'] } })), ['first', 'middle', 'last']);
});

test('unknown dependencies, cycles and invalid advisory values fail closed', () => {
  const groups = [group('a'), group('b')];
  for (const dependencies of [{ a: ['unknown'] }, { unknown: ['a'] }, { a: ['a'] }, { a: ['b'], b: ['a'] }]) {
    assert.throws(() => schedule(groups, { dependencies }), /Unknown|cycle/);
  }
  assert.throws(() => schedule(groups, { priorities: { unknown: 1 } }), /Unknown/);
  assert.throws(() => schedule(groups, { priorities: { a: NaN } }), /Invalid/);
  assert.throws(() => schedule(groups, { estimatedDurationMs: { a: -1 } }), /Invalid/);
});

test('shared commands retain all check IDs once, aggregate hints and honor alias dependencies', () => {
  const shared = group('a', undefined, ['alias']), before = group('before'), after = group('after');
  const groups = [after, shared, before], snapshot = structuredClone(groups);
  const options = { priorities: { alias: 10 }, estimatedDurationMs: { a: 2, alias: 3 },
    dependencies: { a: ['alias'], alias: ['before'], after: ['alias'] } };
  const result = plan(groups, options);
  assert.deepEqual(result.groups, [before, shared, after]);
  assert.deepEqual(result.steps.flatMap(step => step.checkIds).sort(), ['a', 'after', 'alias', 'before']);
  assert.equal(result.steps[1].priority, 10);
  assert.equal(result.steps[1].estimatedDurationMs, 3);
  assert.deepEqual(groups, snapshot);
  assert.deepEqual(plan(groups, options), result);
  assert.equal(new Set(result.groups).size, groups.length);
  for (const item of result.groups) assert(groups.includes(item));
});

test('cycles inside and between shared commands are rejected', () => {
  const groups = [group('a', undefined, ['alias']), group('b', undefined, ['other'])];
  assert.throws(() => schedule(groups, { dependencies: { a: ['alias'], alias: ['a'] } }), /cycle/);
  assert.throws(() => schedule(groups, { dependencies: { a: ['b'], other: ['alias'] } }), /cycle/);
  assert.throws(() => schedule([group('same'), group('same')]), /Duplicate/);
});

test('all priorities and estimates preserve object identity, argv, selection and input order', () => {
  const groups = [group('a', 'core'), group('b'), group('c', 'core')], snapshot = structuredClone(groups);
  const result = schedule(groups, { priorities: { b: 10 }, estimatedDurationMs: { c: 1, a: 2 } });
  assert.deepEqual(ids(result), ['b', 'c', 'a']);
  assert.deepEqual(groups, snapshot);
  assert.equal(result.length, groups.length);
  for (const item of result) assert.strictEqual(item, groups.find(group => group.check.id === item.check.id));
});
