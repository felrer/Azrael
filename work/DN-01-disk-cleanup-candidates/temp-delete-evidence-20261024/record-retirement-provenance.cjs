'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const { beginArtifactRun, finishArtifactRun } = require(path.join(root, 'scripts/artifact-run.cjs'));
const base = path.join(root, 'artifacts/verification/dn01-root-provenance-final');
const python = 'C:/Users/felre/AppData/Local/Programs/Python/Python312/python.exe';
const reviewedBaseline = '12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6';
const selected = [
  'codex-rs/project-maintenance/src/lib.rs',
  'codex-rs/project-maintenance/src/apply.rs',
  'codex-rs/project-maintenance/src/retirement.rs',
  'codex-rs/project-maintenance/src/bin/maintenance_owner.rs',
  'codex-rs/project-maintenance/tests/root_retirement.rs',
];
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = beginArtifactRun(root, { workId: 'dn01-root-provenance', owner: 'record-retirement-provenance',
  references: [{ id: 'handoff:dn01-root-retirement-provenance', reason: 'Retain immutable baseline and recorder evidence until root acceptance and cleanup review' },
    { id: JSON.parse(fs.readFileSync(path.join(root, 'artifacts/verification/dn01-root-provenance-raw/reports/producer.json'))).lifecycleId, reason: 'Immutable raw archive input retained through supported provenance recording' }], paths: {
    temporary: path.join(base, 'baseline'), outputs: path.join(base, 'archive'),
    logs: path.join(base, 'logs'), reports: path.join(base, 'reports'), inputs: path.join(base, 'inputs'),
  } });
const commands = [];
function execute(name, executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  const log = path.join(run.logs, name + '.log');
  fs.writeFileSync(log, (result.stdout || '') + (result.stderr || ''));
  commands.push({ name, executable, args, status: result.status, signal: result.signal, error: result.error?.message, log });
  fs.writeFileSync(path.join(run.reports, 'commands.json'), JSON.stringify(commands, null, 2));
  if (result.error || result.status !== 0) throw Error(`${name} failed: ${result.error?.message || result.status}; ${log}`);
  return result.stdout;
}
let exitCode = 1;
try {
  const archive = path.join(root, 'artifacts/verification/dn01-root-provenance-raw/archive/original-engine.tar');
  // Reuse the independently retained raw archive; select only original inventory.
  execute('extract', 'tar', ['-xf', archive, '-C', run.temporary, '--exclude=codex-rs/core/src/session/root_resume_timing.rs', '--exclude=codex-rs/vendor/bubblewrap/LICENSE']);
  const baselineHash = digest(path.join(run.temporary, 'SOURCE.json'));
  if (baselineHash !== reviewedBaseline) throw Error(`Baseline receipt differs: ${baselineHash}`);
  const recovery = JSON.parse(fs.readFileSync(path.join(__dirname, 'original-blob-recovery.json')));
  const original = JSON.parse(fs.readFileSync(path.join(run.temporary, 'SOURCE.json')));
  for (const recovered of recovery) {
    if (original.files[recovered.path].sha256 !== recovered.sha256) throw Error('Recovery anchor differs from original receipt');
    const blob = spawnSync('git', ['show', recovered.commit + ':engine/' + recovered.path], { cwd: root, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    if (blob.status !== 0 || blob.error || crypto.createHash('sha256').update(blob.stdout).digest('hex') !== recovered.sha256) throw Error('Original Git blob recovery failed: ' + recovered.path);
    fs.writeFileSync(path.join(run.temporary, recovered.path), blob.stdout);
  }
  fs.writeFileSync(path.join(run.reports, 'original-blob-recovery.json'), JSON.stringify(recovery, null, 2));
  execute('baseline-check', python, ['-X', 'utf8', '-B', 'scripts/import-engine-source.py', '--check', '--snapshot-only', '--destination', run.temporary]);
  execute('stage-selected-source', 'git', ['add', '--', ...selected.map(name => 'engine/' + name)]);
  const receipt = path.join(root, 'engine/SOURCE.json');
  fs.copyFileSync(receipt, path.join(run.reports, 'SOURCE.before.json'));
  const daemon = path.join(root, 'engine/codex-rs/daemon/src/azrael_lifecycle.rs');
  const daemonBefore = digest(daemon);
  const currentHash = digest(receipt);
  fs.writeFileSync(path.join(run.inputs, 'anchors.json'), JSON.stringify({ baselineHash, currentHash, daemonBefore, selected }, null, 2));
  execute('record-local-changes', python, ['-X', 'utf8', '-B', 'scripts/record-engine-local-changes.py', '--destination', path.join(root, 'engine'), '--baseline', run.temporary,
    '--baseline-receipt-sha256', reviewedBaseline, '--current-receipt-sha256', currentHash, ...selected.flatMap(name => ['--expected-path', name])]);
  execute('snapshot-check', python, ['-X', 'utf8', '-B', 'scripts/engine-provenance.py', 'snapshot', '--root', path.join(root, 'engine'), '--file', path.join(run.reports, 'engine-snapshot.json')]);
  if (digest(daemon) !== daemonBefore) throw Error('Unrelated daemon changed during recording');
  fs.copyFileSync(receipt, path.join(run.reports, 'SOURCE.after.json'));
  fs.writeFileSync(path.join(run.reports, 'result.json'), JSON.stringify({ lifecycleId: run.lifecycleId, base, baselineHash, currentHash, receiptAfter: digest(receipt), daemonBefore, daemonAfter: digest(daemon), selected, commands }, null, 2));
  exitCode = 0;
  console.log(JSON.stringify({ lifecycleId: run.lifecycleId, base, result: path.join(run.reports, 'result.json') }));
} catch (error) { console.error(error.stack); }
finally { finishArtifactRun(run, { exitCode, producerStopped: true }); }
process.exitCode = exitCode;
