'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const lifecycle = require(path.join(root, 'scripts/artifact-run.cjs'));
const baseline = path.join(root, 'artifacts/verification/dn01-root-provenance-final/baseline');
const baselineHash = '12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6';
const python = 'C:/Users/felre/AppData/Local/Programs/Python/Python312/python.exe';
const selected = ['codex-rs/project-maintenance/src/lib.rs', 'codex-rs/project-maintenance/src/apply.rs',
  'codex-rs/project-maintenance/src/retirement.rs', 'codex-rs/project-maintenance/src/bin/maintenance_owner.rs',
  'codex-rs/project-maintenance/tests/root_retirement.rs'];
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (sha(path.join(baseline, 'SOURCE.json')) !== baselineHash) throw Error('Validated baseline receipt changed');
const run = lifecycle.beginArtifactRun(root, { workId: 'dn01-root-provenance', owner: 'record-retirement-provenance', references: [
  { id: 'handoff:dn01-root-retirement-provenance', reason: 'Retain compact recording evidence until parent acceptance and cleanup' },
  { id: 'run:dn01-root-provenance:20261024T062110903Z-63359c93-75db-403e-9175-1f0a6ece085c', reason: 'Reused fully importer-validated original baseline input' },
] });
const commands = [];
function execute(name, executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  const log = path.join(run.logs, name + '.log');
  fs.writeFileSync(log, (result.stdout || '') + (result.stderr || ''));
  commands.push({ name, executable, args, exitCode: result.status, signal: result.signal, error: result.error?.message, log });
  fs.writeFileSync(path.join(run.reports, 'commands.json'), JSON.stringify(commands, null, 2));
  if (result.error || result.status !== 0) throw Error(`${name} failed: ${result.error?.message || result.status}; ${log}`);
}
let exitCode = 1;
try {
  execute('stage-selected-source', 'git', ['add', '--', ...selected.map(name => 'engine/' + name)]);
  const receipt = path.join(root, 'engine/SOURCE.json');
  const daemon = path.join(root, 'engine/codex-rs/app-server-daemon/src/azrael_lifecycle.rs');
  const before = { receiptSha256: sha(receipt), daemonSha256: sha(daemon), baselineHash, baseline, selected };
  fs.copyFileSync(receipt, path.join(run.reports, 'SOURCE.before.json'));
  fs.writeFileSync(path.join(run.inputs, 'anchors.json'), JSON.stringify(before, null, 2));
  execute('record-local-changes', python, ['-X', 'utf8', '-B', 'scripts/record-engine-local-changes.py', '--destination', path.join(root, 'engine'), '--baseline', baseline,
    '--baseline-receipt-sha256', baselineHash, '--current-receipt-sha256', before.receiptSha256, ...selected.flatMap(name => ['--expected-path', name])]);
  execute('snapshot-check', python, ['-X', 'utf8', '-B', 'scripts/engine-provenance.py', 'snapshot', '--root', path.join(root, 'engine'), '--file', path.join(run.reports, 'engine-snapshot.json')]);
  const after = { receiptSha256: sha(receipt), daemonSha256: sha(daemon) };
  if (before.daemonSha256 !== after.daemonSha256) throw Error('Concurrent daemon content changed during recording; preservation unconfirmed');
  fs.copyFileSync(receipt, path.join(run.reports, 'SOURCE.after.json'));
  fs.writeFileSync(path.join(run.reports, 'result.json'), JSON.stringify({ lifecycleId: run.lifecycleId, runRoot: run.runRoot, before, after, commands }, null, 2));
  exitCode = 0;
  console.log(JSON.stringify({ lifecycleId: run.lifecycleId, runRoot: run.runRoot, result: path.join(run.reports, 'result.json') }));
} catch (error) { console.error(error.stack); }
finally { lifecycle.finishArtifactRun(run, { exitCode, producerStopped: true }); }
process.exitCode = exitCode;
