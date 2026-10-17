'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildCargoTestCommand } = require('./cargo-verification.cjs');
const { compilationSignature } = require('./cargo-target-owner.cjs');
const gate = require('./feature-preservation.cjs');

function group(id, label, wrapper = 'scripts/check-api-context.cjs', scope = 'core') {
  const check = { id, level: 'native', executable: 'node', args: [wrapper, '{engineSourceRoot}', scope],
    ...(label === undefined ? {} : { cargoScheduleGroup: label }) };
  return { native: true, entries: [{ feature: { area: 'engine' }, check }], check };
}

test('Cargo scheduling groups independent checks without merging or changing any command', () => {
  const groups = [group('other-first'), group('core-one', 'core-lib'), group('protocol-one', 'protocol-lib'),
    group('other-second'), group('core-two', 'core-lib'), group('protocol-two', 'protocol-lib')];
  const before = structuredClone(groups);
  const ordered = gate.scheduleNativeGroups(groups);
  assert.deepEqual(ordered.map(g => g.check.id), ['core-one', 'core-two', 'protocol-one', 'protocol-two', 'other-first', 'other-second']);
  assert.equal(ordered.length, groups.length);
  assert.equal(new Set(ordered).size, groups.length);
  for (const item of ordered) assert(groups.includes(item));
  assert.deepEqual(groups, before);
});

test('declared families match every actual wrapper compilation signature', () => {
  const manifest = gate.loadManifest(path.resolve(__dirname, '..'));
  const families = new Map();
  const root = path.resolve(__dirname, '../engine');
  for (const feature of manifest.features) for (const check of feature.checks) {
    if (!check.cargoScheduleGroup) continue;
    const calls = [];
    const filename = path.resolve(__dirname, '..', check.args[0]);
    const stub = { argv: [process.execPath, filename, root, ...check.args.slice(2)], env: {}, exitCode: undefined };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      process: stub,
      require(id) {
        if (id === 'node:fs') return { statSync() { return { isFile: () => true }; } };
        if (id === 'node:path') return path;
        if (id === './cargo-verification.cjs') return { runCargoTest(source, args, options) {
          calls.push(compilationSignature(buildCargoTestCommand(source, Array.from(args), {
            ...options, env: { CODEX_HOME: 'host-runtime', AZRAEL_SOCKET: 'host-socket' },
          })));
          return { status: 0 };
        } };
        throw Error(`Unexpected dependency ${id}`);
      },
    }, { filename });
    assert.equal(stub.exitCode ?? 0, 0, check.id);
    assert(calls.length > 0, check.id);
    const previous = families.get(check.cargoScheduleGroup);
    for (const signature of calls) assert.equal(signature, previous || calls[0], check.id);
    families.set(check.cargoScheduleGroup, calls[0]);
  }
  assert.equal(families.size, 3);
  assert.equal(new Set(families.values()).size, 3);
});

test('untagged commands and conflicting shared-check hints keep their relative order', () => {
  const a = group('a'), b = group('b', 'one'), c = group('c', 'two'), d = group('d');
  b.entries.push(group('shared-alias', 'different').entries[0]);
  assert.deepEqual(gate.scheduleNativeGroups([a, b, c, d]), [c, a, b, d]);
  assert.deepEqual(gate.scheduleNativeGroups([a, d]), [a, d]);
});

test('fixtures, binary consumers, source checks and unknown wrappers cannot opt into reordering', () => {
  const mutations = [
    g => { g.entries[0].feature.area = 'ui'; },
    g => { g.check.level = 'source'; },
    g => { g.check.executable = 'python'; },
    g => { g.check.args[0] = 'scripts/unknown-wrapper.cjs'; },
    g => { g.check.args[1] = '{fixture}'; },
    g => { g.check.args[2] = '{engine}'; },
    g => { g.check.args.push('{engineDirectory}'); },
    g => { g.check.cargoScheduleGroup = ''; },
    g => { g.check.cargoScheduleGroup = { name: 'core' }; },
  ];
  for (const mutate of mutations) {
    const g = group('unsafe', 'core-lib'); mutate(g);
    assert.throws(() => gate.scheduleNativeGroups([g]), /Invalid Cargo scheduling hint/);
  }
});

test('registered schedule retains every native check and batches declared compilation families', () => {
  const manifest = gate.loadManifest(path.resolve(__dirname, '..'));
  const groups = manifest.features.filter(f => f.area === 'engine').flatMap(feature =>
    feature.checks.filter(check => check.level === 'native').map(check => ({ native: true, entries: [{ feature, check }], check })));
  const ordered = gate.scheduleNativeGroups(groups);
  assert.deepEqual(ordered.map(g => g.check.id).sort(), groups.map(g => g.check.id).sort());
  const tagged = ordered.filter(g => g.check.cargoScheduleGroup);
  assert.equal(tagged.length, 6);
  const labels = tagged.map(g => g.check.cargoScheduleGroup);
  for (const label of new Set(labels)) {
    const positions = labels.flatMap((value, index) => value === label ? [index] : []);
    assert.equal(positions.at(-1) - positions[0] + 1, positions.length);
  }
});
