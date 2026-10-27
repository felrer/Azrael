'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const source = process.argv[2];
const expected = process.argv[3];
const scope = process.argv[4] || 'library';
if (!['library', 'consumers'].includes(scope)) throw Error('Unknown verification scope');
if (!source || !path.isAbsolute(source) || !/^[a-f0-9]{64}$/.test(expected || '')) throw Error('Absolute frozen engine and expected source SHA required');
const { beginArtifactRun, finishArtifactRun } = require(path.join(root, 'scripts/artifact-run.cjs'));
const python = 'C:/Users/felre/AppData/Local/Programs/Python/Python312/python.exe';
const target = path.join(root, 'engine/codex-rs/target');
const run = beginArtifactRun(root, { workId: scope === 'library' ? 'DN-01-hidden-native' : 'DN-01-hidden-native-consumers', owner: 'DN-01-hidden-maintenance', references: [
  { id: 'run:dn01-hidden-native-freeze:20261024T141232548Z-21e28fd4-cd72-4c34-9e92-d0f09243b129', reason: 'Verification consumes the unchanged immutable engine input' },
] });
const env = { ...process.env };
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'Path';
env[pathKey] = ['C:/Users/felre/.cargo/bin', path.dirname(python), env[pathKey] || ''].join(path.delimiter);
env.CARGO_TARGET_DIR = target;
// This caller owns the new pending output. Preserve the unrelated unresolved shared generation.
env.INSTA_PENDING_DIR = path.join(run.temporary, 'cargo-pending');
const phases = [];
let code = 1;
function execute(name, command, args) {
  const out = fs.openSync(path.join(run.logs, name + '.stdout.log'), 'wx');
  const err = fs.openSync(path.join(run.logs, name + '.stderr.log'), 'wx');
  const startedUtc = new Date().toISOString();
  let result;
  try { result = spawnSync(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', out, err] }); }
  finally { fs.closeSync(out); fs.closeSync(err); }
  phases.push({ name, command, args, startedUtc, endedUtc: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message });
  fs.writeFileSync(path.join(run.reports, 'phases.json'), JSON.stringify(phases, null, 2));
  if (result.status !== 0 || result.error) throw Error(`${name} failed; see ${run.logs}`);
}
function snapshot(name) {
  const file = path.join(run.reports, name + '.json');
  execute(name, python, ['-X', 'utf8', '-B', path.join(__dirname, 'hidden-native-prep.py'),
    'script', path.join(root, 'scripts/engine-provenance.py'), 'snapshot', '--root', source, '--file', file]);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.sourceSha256 !== expected) throw Error(`${name} fingerprint mismatch`);
}
try {
  snapshot('source-before');
  if (scope === 'consumers') {
    for (const stage of ['prompts', 'core']) execute('maintenance-' + stage, process.execPath, ['scripts/check-project-maintenance.cjs', source, '--stage', stage]);
  } else {
  execute('maintenance-library', process.execPath, ['scripts/check-project-maintenance.cjs', source, '--stage', 'library']);
  const detached = "const r=require('./scripts/cargo-verification.cjs').runCargoTest(process.argv[1],['test','-p','codex-utils-process','--lib','background_commands_have_no_console_under_detached_parent','--locked','--offline','--','--test-threads=1'],{isolateHostEnvironment:true});if(r.error)throw r.error;process.exitCode=r.status??1;";
  execute('detached-console', process.execPath, ['-e', detached, source]);
  }
  snapshot('source-after');
  code = 0;
} finally {
  fs.writeFileSync(path.join(run.reports, 'result.json'), JSON.stringify({ expected, source, target, exitCode: code, phases }, null, 2));
  finishArtifactRun(run, { exitCode: code, producerStopped: true });
  console.log(JSON.stringify({ exitCode: code, runRoot: run.runRoot }));
}
process.exitCode = code;
