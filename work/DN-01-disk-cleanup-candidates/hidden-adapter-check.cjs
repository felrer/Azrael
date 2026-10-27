'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const { beginArtifactRun, finishArtifactRun } = require(path.join(root, 'scripts/artifact-run.cjs'));
const names = ['scripts/test-project-maintenance.cjs', 'scripts/test-project.cjs',
  'scripts/project-maintenance.cjs', 'scripts/source-test-policy.cjs', 'scripts/artifact-lifecycle.cjs',
  'project-maintenance.json', 'scripts/azrael-feature-contracts.json', 'engine/codex-rs/project-maintenance/src/paths.rs',
  'engine/codex-rs/project-maintenance/Cargo.toml'];
const hashes = () => Object.fromEntries(names.map(name => [name,
  fs.existsSync(path.join(root, name)) ? crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') : null]));
const run = beginArtifactRun(root, { workId: 'DN-01-hidden-adapter', owner: 'DN-01-hidden-maintenance' });
let code = 1;
try {
  const before = hashes();
  const result = spawnSync(process.execPath, ['--test', 'scripts/test-project-maintenance.cjs'],
    { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  fs.writeFileSync(path.join(run.logs, 'stdout.log'), result.stdout || '');
  fs.writeFileSync(path.join(run.logs, 'stderr.log'), result.stderr || '');
  const after = hashes();
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  fs.writeFileSync(path.join(run.reports, 'result.json'), JSON.stringify({
    exitCode: result.status, signal: result.signal, error: result.error?.message,
    before, after, unchanged, argv: ['node', '--test', 'scripts/test-project-maintenance.cjs'],
  }, null, 2));
  code = result.status === 0 && unchanged && !result.error ? 0 : 1;
  console.log(JSON.stringify({ exitCode: result.status, unchanged, runRoot: run.runRoot }));
} finally { finishArtifactRun(run, { exitCode: code, producerStopped: true }); }
process.exitCode = code;
