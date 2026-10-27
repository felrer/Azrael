'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const { beginArtifactRun, finishArtifactRun } = require(path.join(root, 'scripts/artifact-run.cjs'));
const cargo = require(path.join(root, 'scripts/cargo-target-owner.cjs'));
const failed = path.join(root, 'artifacts/tasks/DN-01-hidden-native/runs/20261024T141642763Z-80490ce2-aff3-4c26-8bd5-4586ad15a659');
const run = beginArtifactRun(root, { workId: 'DN-01-hidden-cargo-recovery', owner: 'DN-01-hidden-maintenance', references: [
  { id: 'run:DN-01-hidden-native:20261024T141642763Z-80490ce2-aff3-4c26-8bd5-4586ad15a659', reason: 'Preserve pre-spawn failure and terminal producer evidence' },
] });
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
let code = 1;
try {
  const producer = JSON.parse(fs.readFileSync(path.join(failed, 'reports/producer.json')));
  const phases = JSON.parse(fs.readFileSync(path.join(failed, 'reports/phases.json')));
  const error = fs.readFileSync(path.join(failed, 'logs/maintenance-library.stderr.log'), 'utf8').trim();
  const script = fs.readFileSync(path.join(root, 'scripts/cargo-target-owner.cjs'), 'utf8');
  const body = script.slice(script.indexOf('function runManagedCargoSync('), script.indexOf('function targetArgument('));
  if (producer.exitCode !== 1 || producer.producerStopped !== true || phases.at(-1)?.exitCode !== 1 ||
      error !== 'New lifecycle generation requires exact revision and known stopped producer' ||
      body.indexOf('recordPending(lease, "pending", false)') < 0 ||
      body.indexOf('recordPending(lease, "pending", false)') > body.indexOf('.spawnSync(command, executionArgs, options)')) throw Error('Pre-spawn terminal proof differs');
  const targetDirectory = path.join(root, 'engine/codex-rs/target');
  const inspected = cargo.inspectTargetOwner({ targetDirectory });
  if (inspected.token !== '1edf6625-b119-481c-abec-670619966211' ||
      inspected.ownerSha256 !== '6e6de31595f133b0148b6a6a507db3958dff79e4f5b6695101c02e34d0d9a6f1' ||
      inspected.owner.producerPid !== null || inspected.owner.coordinatorPid !== 27508) throw Error('Exact failed invocation changed');
  const evidence = path.join(run.reports, 'pre-spawn-proof.json');
  fs.writeFileSync(evidence, JSON.stringify({ producer, phases, error, inspected,
    helperSha256: sha(script), sourceOrdering: body,
    proof: 'Owned synchronous child returned exit 1. recordPending rejected generation before Cargo spawn. No Cargo child existed for this exact invocation. Root observed session 56767 terminal exit 1. This is stronger than PID absence.',
  }, null, 2));
  const result = cargo.recoverTargetOwner({ targetDirectory, expectedToken: inspected.token,
    expectedOwnerSha256: inspected.ownerSha256, producer_stopped_verified: true,
    reason: 'Exact owned native preflight ended before Cargo spawn; recover only its lease, preserve old shared pending generation and unknown result',
    evidence_ref: evidence, evidence_sha256: sha(fs.readFileSync(evidence)), receipt_ref: path.join(run.reports, 'recovery.json') });
  fs.writeFileSync(path.join(run.reports, 'result.json'), JSON.stringify(result, null, 2));
  code = 0; console.log(JSON.stringify({ result, runRoot: run.runRoot }));
} finally { finishArtifactRun(run, { exitCode: code, producerStopped: true }); }
process.exitCode = code;
