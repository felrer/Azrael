'use strict';
// Keep freshness and per-consumer ownership when adding later provenance callers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { publish, consume, provenanceArguments } = require('./engine-source-handoff.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-handoff-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const statePath = path.join(root, 'build-state.json');
  const state = { schema: 1, entries: { fixture: { generation: 'generation-1', metadata: { inventory: 'observed' }, snapshot: { sourceSha256: 'verified' } } } };
  fs.writeFileSync(statePath, JSON.stringify(state));
  const options = { statePath, generation: 'generation-1', handoffPath: path.join(root, 'handoff.json'), token: 'attempt-1', releaseDirectory: path.join(root, 'release') };
  return { root, state, options, next: name => ({ ...options, destination: path.join(root, name) }) };
}
test('completed observation gives consumers independent writable copies and exact provenance arguments', t => {
  const { options, next } = fixture(t);
  assert.equal(publish(options).usable, true);
  const a = consume(next('engine.json')), b = consume(next('prepare.json'));
  assert.equal(a.usable, true); assert.equal(b.usable, true);
  assert.deepEqual(provenanceArguments(a.sourceStatePath, a.sourceGeneration), ['--source-state', next('engine.json').destination, '--source-generation', options.generation]);
  const original = fs.readFileSync(options.statePath);
  assert.deepEqual(fs.readFileSync(a.sourceStatePath), original);
  fs.writeFileSync(a.sourceStatePath, 'consumer updates its own state');
  assert.deepEqual(fs.readFileSync(b.sourceStatePath), original);
  assert.deepEqual(fs.readFileSync(options.statePath), original);
});
test('missing, stale, corrupt and changed handoffs fall back without creating a state', t => {
  const { options, next } = fixture(t);
  assert.equal(consume(next('missing.json')).usable, false);
  publish(options);
  for (const change of [{ token: 'new-attempt' }, { releaseDirectory: path.join(options.releaseDirectory, 'other') }]) {
    const input = { ...next('rejected.json'), ...change };
    assert.equal(consume(input).usable, false); assert.equal(fs.existsSync(input.destination), false);
  }
  fs.appendFileSync(options.statePath, ' ');
  assert.equal(consume(next('changed.json')).usable, false);
  fs.writeFileSync(options.handoffPath, 'broken');
  assert.equal(consume(next('corrupt.json')).usable, false);
});
test('unsupported or wrong-generation source states publish explicit full-validation disposition', t => {
  const { options } = fixture(t);
  const result = publish({ ...options, generation: 'new-generation' });
  assert.equal(result.usable, false); assert.match(result.reason, /generation/);
  fs.unlinkSync(options.handoffPath); fs.unlinkSync(options.statePath);
  assert.equal(publish(options).usable, false);
});
test('explicit pairs, safe destinations and no overwrite remain mandatory', t => {
  const { options, next, root } = fixture(t);
  assert.deepEqual(provenanceArguments(), []);
  assert.throws(() => provenanceArguments(options.statePath), /together/);
  assert.throws(() => provenanceArguments('relative.json', 'gen'), /absolute/);
  publish(options); consume(next('once.json'));
  assert.throws(() => consume(next('once.json')), /already exists/);
  fs.linkSync(options.statePath, path.join(root, 'hardlink.json'));
  assert.equal(consume(next('linked-source.json')).usable, false);
  assert.throws(() => consume(next('hardlink.json')), /Linked/);
});
test('CLI JSON preserves Unicode paths across native stdout code pages', t => {
  const { options, next } = fixture(t);
  publish(options);
  const destination = next('관찰-😀.json').destination;
  const result = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'engine-source-handoff.cjs'), 'consume',
    '--handoff', options.handoffPath, '--token', options.token, '--release', options.releaseDirectory, '--destination', destination], { windowsHide: true });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.ok([...result.stdout].every(byte => byte < 128));
  assert.equal(JSON.parse(result.stdout.toString('latin1')).sourceStatePath, destination);
  assert.ok(fs.existsSync(destination));
});
