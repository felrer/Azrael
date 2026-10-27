'use strict';
// Invoke only after the parent confirms shared disk deletion reached terminal state.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const { beginArtifactRun, finishArtifactRun } = require(path.join(root, 'scripts/artifact-run.cjs'));
const baseline = path.join(root, 'artifacts/verification/dn01-root-provenance-final/baseline');
const python = 'C:/Users/felre/AppData/Local/Programs/Python/Python312/python.exe';
const selected = ['codex-rs/project-maintenance/src/lib.rs', 'codex-rs/project-maintenance/src/apply.rs',
  'codex-rs/project-maintenance/src/retirement.rs', 'codex-rs/project-maintenance/src/bin/maintenance_owner.rs',
  'codex-rs/project-maintenance/tests/root_retirement.rs'];
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const primary = JSON.parse(fs.readFileSync(path.join(__dirname, 'provenance-primary-result.json')));
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (head.status !== 0) throw Error('Cannot anchor HEAD');
const anchoredHead = head.stdout.trim();
const run = beginArtifactRun(root, { workId: 'dn01-root-receipt-isolation', owner: 'isolate-retirement-receipt', references: [
  { id: 'handoff:dn01-root-retirement-commit', reason: 'Private receipt and worktree retained until primary integration verification' },
  { id: 'run:dn01-root-provenance:20261024T062110903Z-63359c93-75db-403e-9175-1f0a6ece085c', reason: 'Original importer-validated baseline input' },
  { id: 'run:dn01-root-receipt-isolation:20261024T064138272Z-944ca377-f899-4d7c-9e08-35512fd3df00', reason: 'Resume owned incomplete initial checkout without another source copy' },
] });
const worktree = path.join(root, 'artifacts/tasks/dn01-root-receipt-isolation/runs/20261024T064138272Z-944ca377-f899-4d7c-9e08-35512fd3df00/outputs');
const commands = [];
function execute(name, executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  const log = path.join(run.logs, name + '.log'); fs.writeFileSync(log, (result.stdout || '') + (result.stderr || ''));
  commands.push({ name, executable, args, exitCode: result.status, signal: result.signal, error: result.error?.message, log });
  fs.writeFileSync(path.join(run.reports, 'commands.json'), JSON.stringify(commands, null, 2));
  if (result.error || result.status !== 0) throw Error(`${name} failed: ${result.error?.message || result.status}; ${log}`);
  return result.stdout;
}
const git = (name, directory, args) => execute(name, 'git', ['-c', 'core.longpaths=true', '-c', 'core.autocrlf=false', '-c', 'core.symlinks=false', '-C', directory, ...args]);
let exitCode = 1;
try {
  if (git('private-head', worktree, ['rev-parse', 'HEAD']).trim() !== anchoredHead) throw Error('Private HEAD differs');
  // Committed eol=crlf materialized this one original LF migration differently
  // from its receipt. Recover only the identical raw HEAD bytes; never stage it.
  const migration = 'codex-rs/state/queue_migrations/0004_accepted_user_input_root.sql';
  const originalEntry = JSON.parse(fs.readFileSync(path.join(worktree, 'engine/SOURCE.json'))).files[migration];
  const originalBlob = spawnSync('git', ['show', anchoredHead + ':engine/' + migration], { cwd: root, maxBuffer: 1024 * 1024, windowsHide: true });
  if (originalBlob.status !== 0 || originalBlob.error || crypto.createHash('sha256').update(originalBlob.stdout).digest('hex') !== originalEntry.sha256 || originalBlob.stdout.length !== originalEntry.size) throw Error('HEAD migration blob differs from receipt');
  fs.writeFileSync(path.join(worktree, 'engine', migration), originalBlob.stdout);
  fs.writeFileSync(path.join(run.reports, 'head-materialization.json'), JSON.stringify({ path: migration, head: anchoredHead, sha256: originalEntry.sha256, size: originalEntry.size, staged: false }, null, 2));
  if (git('head-check', root, ['rev-parse', 'HEAD']).trim() !== anchoredHead) throw Error('Primary HEAD changed before receipt isolation');
  execute('head-source-validate', python, ['-X', 'utf8', '-B', 'scripts/engine-provenance.py', 'snapshot', '--root', path.join(worktree, 'engine'), '--file', path.join(run.reports, 'head-snapshot.json')]);
  const daemon = path.join(worktree, 'engine/codex-rs/app-server-daemon/src/azrael_lifecycle.rs');
  const daemonBefore = sha(daemon);
  const receipt = path.join(worktree, 'engine/SOURCE.json');
  const receiptBefore = sha(receipt);
  const sourceHashes = {};
  for (const name of selected) {
    const source = path.join(root, 'engine', name), destination = path.join(worktree, 'engine', name);
    const frozen = path.join(root, 'artifacts/verification/dn01-root-retirement/inputs/engine', name);
    if (sha(frozen) !== sha(source)) throw Error('Primary source differs from frozen90-test input: ' + name);
    sourceHashes[name] = sha(source); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination);
  }
  git('stage-owned-five', worktree, ['add', '--', ...selected.map(name => 'engine/' + name)]);
  execute('record-isolated', python, ['-X', 'utf8', '-B', 'scripts/record-engine-local-changes.py', '--destination', path.join(worktree, 'engine'), '--baseline', baseline,
    '--baseline-receipt-sha256', primary.before.baselineHash, '--current-receipt-sha256', receiptBefore, ...selected.flatMap(name => ['--expected-path', name])]);
  execute('isolated-snapshot', python, ['-X', 'utf8', '-B', 'scripts/engine-provenance.py', 'snapshot', '--root', path.join(worktree, 'engine'), '--file', path.join(run.reports, 'isolated-snapshot.json')]);
  for (const name of selected) if (sha(path.join(worktree, 'engine', name)) !== sourceHashes[name] || sha(path.join(root, 'engine', name)) !== sourceHashes[name]) throw Error('Owned source changed during isolation: ' + name);
  if (sha(daemon) !== daemonBefore) throw Error('Private HEAD daemon changed');
  if (git('final-primary-head', root, ['rev-parse', 'HEAD']).trim() !== anchoredHead) throw Error('Primary HEAD changed during isolation');
  const result = { lifecycleId: run.lifecycleId, runRoot: run.runRoot, worktree, anchoredHead, receipt, receiptBefore, receiptAfter: sha(receipt), daemonHeadSha256: daemonBefore, sourceHashes, commands };
  fs.writeFileSync(path.join(run.reports, 'result.json'), JSON.stringify(result, null, 2));
  fs.copyFileSync(path.join(run.reports, 'result.json'), path.join(__dirname, 'provenance-isolated-result.json'));
  exitCode = 0; console.log(JSON.stringify(result));
} catch (error) { console.error(error.stack); }
finally { finishArtifactRun(run, { exitCode, producerStopped: true }); }
process.exitCode = exitCode;
