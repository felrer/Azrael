import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { isolatedEnvironment, validateInputs } from './check-shared-engine-resources.mjs';

test('resource input guard requires distinct absolute engines and project artifacts output', () => {
  const baseline = resolve('baseline.exe'), candidate = resolve('candidate.exe');
  validateInputs(baseline, candidate, resolve('artifacts/logs/resource-guard'));
  assert.throws(() => validateInputs('baseline.exe', candidate, resolve('artifacts/logs/result')), /absolute_inputs/);
  assert.throws(() => validateInputs(baseline, baseline, resolve('artifacts/logs/result')), /distinct_engines/);
  for (const output of [resolve('artifacts'), resolve('outside-result'), resolve('artifacts/../outside-result')])
    assert.throws(() => validateInputs(baseline, candidate, output), /under_project_artifacts/);
});

test('shared-only input accepts no baseline and never resolves its supplied value', () => {
  const candidate = resolve('candidate.exe'), output = resolve('artifacts/logs/shared-only-guard');
  validateInputs(undefined, candidate, output, { sharedOnly: true });
  const forbiddenBaseline = { toString() { throw new Error('baseline must remain untouched'); } };
  validateInputs(forbiddenBaseline, candidate, output, { sharedOnly: true });
  assert.throws(() => validateInputs(undefined, 'relative-candidate.exe', output, { sharedOnly: true }), /absolute_inputs/);
});

test('isolated environment discards inherited window routing and live credential variables', () => {
  const keys = ['CODEX_HOME', 'OPENAI_API_KEY', 'AZRAEL_EX_WINDOW_CONTEXT', 'ANTHROPIC_API_KEY'];
  const previous = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = 'inherited-user-value';
    const home = resolve('guard-home'), env = isolatedEnvironment(home);
    assert.equal(env.CODEX_HOME, home);
    for (const key of keys.slice(1)) assert.equal(env[key], undefined);
    assert.equal(process.env.OPENAI_API_KEY, 'inherited-user-value');
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});
